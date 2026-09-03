import "@tanstack/react-start/server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import type { Employee, Role, User } from "../../data/types.ts";
import type { CurrentUserContext } from "../../auth/permissions.ts";
import { getRolePermissions } from "../../auth/permissions.ts";
import type { VerifiedPortalIdentity } from "../../auth/portal-token.server.ts";
import { MAX_HR_SESSION_SECONDS } from "../../auth/portal-sso-config.server.ts";
import { getDatabaseClient } from "../client.ts";
import { departments, employmentTypes, locations, positions } from "../schema/master-data.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { auditEvents, portalSessions, workspaceIdentityMappings } from "../schema/system.ts";
import { resolveDefaultOrganisationId } from "../organisation.server.ts";

export interface PortalSessionPrincipal {
  sessionId: string;
  organisationId: string;
  expiresAt: string;
  user: User;
  employee: Employee;
}

export interface CreatedPortalSession extends PortalSessionPrincipal {
  sessionToken: string;
}

export class PortalAccessError extends Error {
  constructor(
    message: string,
    readonly code: "access_not_configured" | "access_suspended",
  ) {
    super(message);
    this.name = "PortalAccessError";
  }
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mappedUser(row: typeof users.$inferSelect, assignedRoles: Role[]): User {
  return {
    id: row.id,
    employeeId: row.employeeId,
    displayName: row.displayName,
    workspaceEmail: row.workspaceEmail,
    ...(row.workspaceSubject ? { workspaceSubject: row.workspaceSubject } : {}),
    roles: assignedRoles.length > 0 ? assignedRoles : ["Employee"],
    status: row.status,
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: iso(row.updatedAt),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: iso(row.archivedAt) } : {}),
    recordVersion: row.recordVersion,
  };
}

async function loadPrincipal(
  organisationId: string,
  userId: string,
  sessionId: string,
  expiresAt: string,
): Promise<PortalSessionPrincipal> {
  const db = getDatabaseClient();
  const [row] = await db
    .select({
      user: users,
      employee: employees,
      department: departments.name,
      position: positions.name,
      location: locations.name,
      employmentType: employmentTypes.name,
    })
    .from(users)
    .innerJoin(employees, eq(users.employeeId, employees.id))
    .innerJoin(departments, eq(employees.departmentId, departments.id))
    .innerJoin(positions, eq(employees.positionId, positions.id))
    .innerJoin(locations, eq(employees.locationId, locations.id))
    .innerJoin(employmentTypes, eq(employees.employmentTypeId, employmentTypes.id))
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.id, userId),
        eq(users.status, "Active"),
        inArray(employees.status, ["Onboarding", "Active", "Probation", "Notice"]),
      ),
    )
    .limit(1);
  if (!row) throw new PortalAccessError("Your VIA HR access is not active.", "access_suspended");

  const roleRows = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.organisationId, organisationId), eq(userRoles.userId, userId)));
  const assignedRoles = roleRows.map((item) => item.code as Role);
  const employeeRow = row.employee;
  const employee: Employee = {
    id: employeeRow.id,
    createdAt: iso(employeeRow.createdAt),
    createdBy: employeeRow.createdBy,
    updatedAt: iso(employeeRow.updatedAt),
    updatedBy: employeeRow.updatedBy,
    ...(employeeRow.archivedAt ? { archivedAt: iso(employeeRow.archivedAt) } : {}),
    recordVersion: employeeRow.recordVersion,
    employeeNumber: employeeRow.employeeNumber,
    legalName: employeeRow.legalName,
    preferredName: employeeRow.preferredName,
    workEmail: employeeRow.workEmail,
    department: row.department,
    position: row.position,
    location: row.location,
    employmentType: row.employmentType,
    startDate: employeeRow.startDate,
    status: employeeRow.status,
    ...(employeeRow.workspaceEmail ? { workspaceEmail: employeeRow.workspaceEmail } : {}),
    ...(employeeRow.lineManagerId ? { lineManagerId: employeeRow.lineManagerId } : {}),
    ...(employeeRow.projectId ? { projectId: employeeRow.projectId } : {}),
    ...(employeeRow.costCentreId ? { costCentreId: employeeRow.costCentreId } : {}),
  };
  return {
    sessionId,
    organisationId,
    expiresAt,
    user: mappedUser(row.user, assignedRoles),
    employee,
  };
}

async function findOrCreatePortalUser(
  identity: VerifiedPortalIdentity,
): Promise<{ organisationId: string; userId: string }> {
  const organisationId = await resolveDefaultOrganisationId();
  const db = getDatabaseClient();

  return db.transaction(async (tx) => {
    let [user] = await tx
      .select()
      .from(users)
      .where(
        and(eq(users.organisationId, organisationId), eq(users.workspaceEmail, identity.email)),
      )
      .limit(1)
      .for("update");

    let employee: typeof employees.$inferSelect | undefined;
    if (user) {
      [employee] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.organisationId, organisationId), eq(employees.id, user.employeeId)))
        .limit(1)
        .for("update");
    } else {
      [employee] = await tx
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            or(
              eq(employees.workspaceEmail, identity.email),
              eq(employees.workEmail, identity.email),
            ),
          ),
        )
        .limit(1)
        .for("update");
    }

    if (!employee) {
      throw new PortalAccessError(
        "Your portal identity is valid, but VIA HR access has not been configured. Contact HR or the System Administrator.",
        "access_not_configured",
      );
    }
    if (["Inactive", "Archived"].includes(employee.status) || employee.archivedAt) {
      throw new PortalAccessError("Your VIA HR access is not active.", "access_suspended");
    }

    let createdUser = false;
    if (!user) {
      const userId = randomUUID();
      [user] = await tx
        .insert(users)
        .values({
          id: userId,
          organisationId,
          employeeId: employee.id,
          displayName: identity.name,
          workspaceEmail: identity.email,
          status: "Active",
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      createdUser = true;
    }
    if (!user || user.status !== "Active" || user.archivedAt) {
      throw new PortalAccessError("Your VIA HR access is not active.", "access_suspended");
    }

    const userChanges: Partial<typeof users.$inferInsert> = {};
    if (identity.name !== user.displayName) userChanges.displayName = identity.name;
    if (Object.keys(userChanges).length > 0) {
      const updatedUsers = await tx
        .update(users)
        .set({
          ...userChanges,
          updatedAt: new Date(),
          updatedBy: user.id,
          recordVersion: sql`${users.recordVersion} + 1`,
        })
        .where(and(eq(users.organisationId, organisationId), eq(users.id, user.id)))
        .returning();
      if (!updatedUsers[0]) throw new Error("The VIA HR user could not be updated.");
      user = updatedUsers[0];
    }
    const activeUser = user;

    if (employee.workspaceEmail !== identity.email) {
      await tx
        .update(employees)
        .set({
          workspaceEmail: identity.email,
          updatedAt: new Date(),
          updatedBy: activeUser.id,
          recordVersion: sql`${employees.recordVersion} + 1`,
        })
        .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employee.id)));
    }

    const [employeeRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, identity.mappedRole))
      .limit(1);
    if (!employeeRole) throw new Error("The Employee role is not configured.");
    await tx
      .insert(userRoles)
      .values({
        organisationId,
        userId: activeUser.id,
        roleId: employeeRole.id,
        assignedBy: activeUser.id,
        reason: "Baseline access verified by VIA Portal",
      })
      .onConflictDoNothing();

    const [mapping] = await tx
      .select()
      .from(workspaceIdentityMappings)
      .where(
        and(
          eq(workspaceIdentityMappings.organisationId, organisationId),
          eq(workspaceIdentityMappings.userId, activeUser.id),
        ),
      )
      .limit(1)
      .for("update");
    if (mapping && ["Suspended", "Archived"].includes(mapping.status)) {
      throw new PortalAccessError("Your VIA HR access is not active.", "access_suspended");
    }
    if (mapping) {
      await tx
        .update(workspaceIdentityMappings)
        .set({
          workspaceEmail: identity.email,
          status: "Verified",
          verifiedAt: new Date().toISOString(),
          updatedAt: new Date(),
          updatedBy: activeUser.id,
          recordVersion: sql`${workspaceIdentityMappings.recordVersion} + 1`,
        })
        .where(eq(workspaceIdentityMappings.id, mapping.id));
    } else {
      await tx.insert(workspaceIdentityMappings).values({
        organisationId,
        employeeId: employee.id,
        userId: activeUser.id,
        workspaceEmail: identity.email,
        status: "Verified",
        verifiedAt: new Date().toISOString(),
        createdBy: activeUser.id,
        updatedBy: activeUser.id,
      });
    }

    if (createdUser || !mapping) {
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: activeUser.id,
        actorEmployeeId: employee.id,
        actorDisplayName: identity.name,
        activeRole: "Employee",
        actorRoles: ["Employee"],
        action: "portal_identity_linked",
        module: "security",
        entityType: "user",
        entityId: activeUser.id,
        afterSummary: { email: identity.email, source: "VIA Portal" },
        reason: "Verified VIA Portal identity linked to the existing employee record",
        riskLevel: "High",
      });
    }
    return { organisationId, userId: activeUser.id };
  });
}

export async function createPortalSession(
  identity: VerifiedPortalIdentity,
  input: { lifetimeSeconds: number; ipAddress?: string; userAgent?: string },
): Promise<CreatedPortalSession> {
  if (
    !Number.isSafeInteger(input.lifetimeSeconds) ||
    input.lifetimeSeconds < 1 ||
    input.lifetimeSeconds > MAX_HR_SESSION_SECONDS
  ) {
    throw new Error("The VIA HR session lifetime must be between one second and eight hours.");
  }
  const account = await findOrCreatePortalUser(identity);
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.lifetimeSeconds * 1000).toISOString();
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx
      .update(portalSessions)
      .set({ revokedAt: now.toISOString() })
      .where(
        and(
          eq(portalSessions.organisationId, account.organisationId),
          eq(portalSessions.userId, account.userId),
          isNull(portalSessions.revokedAt),
        ),
      );
    await tx.insert(portalSessions).values({
      id: sessionId,
      organisationId: account.organisationId,
      userId: account.userId,
      tokenHash: sessionHash(sessionToken),
      expiresAt,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 500) } : {}),
    });
    const [user] = await tx.select().from(users).where(eq(users.id, account.userId)).limit(1);
    if (!user) throw new Error("The VIA HR user could not be loaded.");
    const roleRows = await tx
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));
    await tx.insert(auditEvents).values({
      organisationId: account.organisationId,
      actorUserId: user.id,
      actorEmployeeId: user.employeeId,
      actorDisplayName: user.displayName,
      activeRole: roleRows[0]?.code ?? "Employee",
      actorRoles: roleRows.map((row) => row.code),
      sessionId,
      action: "portal_sign_in",
      module: "security",
      entityType: "portal-session",
      entityId: sessionId,
      afterSummary: { provider: "VIA Portal", expiresAt },
      reason: "Authenticated through VIA Portal single sign-on",
      riskLevel: "High",
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent.slice(0, 500) } : {}),
    });
  });
  return {
    ...(await loadPrincipal(account.organisationId, account.userId, sessionId, expiresAt)),
    sessionToken,
  };
}

export async function findPortalSession(token: string): Promise<PortalSessionPrincipal | null> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const now = new Date().toISOString();
  const [session] = await getDatabaseClient()
    .select()
    .from(portalSessions)
    .where(
      and(
        eq(portalSessions.tokenHash, sessionHash(token)),
        isNull(portalSessions.revokedAt),
        gt(portalSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session) return null;
  try {
    return await loadPrincipal(
      session.organisationId,
      session.userId,
      session.id,
      session.expiresAt,
    );
  } catch (error) {
    if (error instanceof PortalAccessError) return null;
    throw error;
  }
}

export async function revokePortalSession(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return;
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(portalSessions)
      .where(
        and(eq(portalSessions.tokenHash, sessionHash(token)), isNull(portalSessions.revokedAt)),
      )
      .limit(1)
      .for("update");
    if (!session) return;
    const [user] = await tx.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user) return;
    const roleRows = await tx
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, user.id));
    await tx
      .update(portalSessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(portalSessions.id, session.id));
    await tx.insert(auditEvents).values({
      organisationId: session.organisationId,
      actorUserId: user.id,
      actorEmployeeId: user.employeeId,
      actorDisplayName: user.displayName,
      activeRole: roleRows[0]?.code ?? "Employee",
      actorRoles: roleRows.map((row) => row.code),
      sessionId: session.id,
      action: "portal_sign_out",
      module: "security",
      entityType: "portal-session",
      entityId: session.id,
      reason: "Local VIA HR session ended",
      riskLevel: "Low",
    });
  });
}

export function principalContext(principal: PortalSessionPrincipal): CurrentUserContext {
  const activeRole =
    principal.user.roles.find((role) => role !== "Employee") ??
    principal.user.roles[0] ??
    "Employee";
  return {
    userId: principal.user.id,
    employeeId: principal.employee.id,
    displayName: principal.user.displayName,
    workspaceEmail: principal.user.workspaceEmail,
    assignedRoles: principal.user.roles,
    activeRole,
    permissions: getRolePermissions(activeRole),
    isDevelopmentPreview: false,
  };
}
