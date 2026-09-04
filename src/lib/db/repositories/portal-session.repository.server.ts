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
import { onboardingCases, onboardingTasks } from "../schema/onboarding-offboarding.ts";
import {
  auditEvents,
  notifications,
  portalSessions,
  workspaceIdentityMappings,
} from "../schema/system.ts";
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

type Database = ReturnType<typeof getDatabaseClient>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function nameParts(displayName: string): { legalName: string; preferredName: string } {
  const legalName = displayName.trim().replace(/\s+/g, " ");
  return { legalName, preferredName: legalName.split(" ")[0] || legalName };
}

async function selfSetupMasterData(tx: Transaction, organisationId: string, actorId: string) {
  let [department] = await tx
    .select()
    .from(departments)
    .where(and(eq(departments.organisationId, organisationId), eq(departments.code, "SELF-SETUP")))
    .limit(1);
  if (!department) {
    [department] = await tx
      .insert(departments)
      .values({
        organisationId,
        name: "To be confirmed",
        code: "SELF-SETUP",
        description: "Temporary assignment used while an employee completes first-time setup",
        orderIndex: 999,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!department)
      [department] = await tx
        .select()
        .from(departments)
        .where(
          and(eq(departments.organisationId, organisationId), eq(departments.code, "SELF-SETUP")),
        )
        .limit(1);
  }
  if (!department) throw new Error("Employee setup department could not be prepared.");

  let [position] = await tx
    .select()
    .from(positions)
    .where(and(eq(positions.organisationId, organisationId), eq(positions.code, "SELF-SETUP")))
    .limit(1);
  if (!position) {
    [position] = await tx
      .insert(positions)
      .values({
        organisationId,
        name: "To be confirmed",
        code: "SELF-SETUP",
        description: "Temporary position used while an employee completes first-time setup",
        departmentId: department.id,
        orderIndex: 999,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!position)
      [position] = await tx
        .select()
        .from(positions)
        .where(and(eq(positions.organisationId, organisationId), eq(positions.code, "SELF-SETUP")))
        .limit(1);
  }

  let [location] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.organisationId, organisationId), eq(locations.code, "SELF-SETUP")))
    .limit(1);
  if (!location) {
    [location] = await tx
      .insert(locations)
      .values({
        organisationId,
        name: "To be confirmed",
        code: "SELF-SETUP",
        description: "Temporary location used while an employee completes first-time setup",
        orderIndex: 999,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!location)
      [location] = await tx
        .select()
        .from(locations)
        .where(and(eq(locations.organisationId, organisationId), eq(locations.code, "SELF-SETUP")))
        .limit(1);
  }

  let [employmentType] = await tx
    .select()
    .from(employmentTypes)
    .where(
      and(
        eq(employmentTypes.organisationId, organisationId),
        eq(employmentTypes.code, "SELF-SETUP"),
      ),
    )
    .limit(1);
  if (!employmentType) {
    [employmentType] = await tx
      .insert(employmentTypes)
      .values({
        organisationId,
        name: "To be confirmed",
        code: "SELF-SETUP",
        description: "Temporary employment type used during first-time setup",
        orderIndex: 999,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    if (!employmentType)
      [employmentType] = await tx
        .select()
        .from(employmentTypes)
        .where(
          and(
            eq(employmentTypes.organisationId, organisationId),
            eq(employmentTypes.code, "SELF-SETUP"),
          ),
        )
        .limit(1);
  }
  if (!position || !location || !employmentType)
    throw new Error("Employee setup defaults could not be prepared.");
  return { department, position, location, employmentType };
}

async function createFirstLoginChecklist(
  tx: Transaction,
  organisationId: string,
  employeeId: string,
  userId: string,
  dueDate: string,
) {
  const caseId = randomUUID();
  await tx.insert(onboardingCases).values({
    id: caseId,
    organisationId,
    employeeId,
    status: "In Progress",
    createdBy: userId,
    updatedBy: userId,
  });
  const items = [
    [
      "employment-details",
      "Confirm your employment details",
      "Employment Setup",
      "employment_details",
      null,
    ],
    [
      "personal-details",
      "Complete personal and emergency details",
      "Personal & Legal Documents",
      "personal_details",
      null,
    ],
    [
      "passport-copy",
      "Upload passport copy",
      "Personal & Legal Documents",
      "document_upload",
      "passport",
    ],
    [
      "visa-copy",
      "Upload visa or work permit",
      "Visa, Work Permit & ID",
      "document_upload",
      "visa",
    ],
    [
      "national-id",
      "Upload national ID",
      "Visa, Work Permit & ID",
      "document_upload",
      "national_id",
    ],
    ["bank-details", "Provide salary bank details", "Contract & Payroll", "bank_details", null],
  ] as const;
  await tx.insert(onboardingTasks).values(
    items.map(([templateTaskId, title, taskGroup, selfServiceFormKey, documentType]) => ({
      id: randomUUID(),
      organisationId,
      caseId,
      templateTaskId,
      title,
      taskGroup,
      checkpoint: "Pre-Arrival",
      ownerRole: "Employee" as const,
      assignedUserId: userId,
      offsetDaysFromStart: 0,
      dueDate,
      isMandatory: true,
      requiresEvidence: selfServiceFormKey === "document_upload",
      selfServiceFormKey,
      ...(documentType ? { documentType } : {}),
      requiresBankDetails: selfServiceFormKey === "bank_details",
      createdBy: userId,
      updatedBy: userId,
    })),
  );
  return caseId;
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
    ...(employeeRow.staffEntryType ? { staffEntryType: employeeRow.staffEntryType } : {}),
    profileSetupStatus: employeeRow.profileSetupStatus,
    ...(employeeRow.profileSetupCompletedAt
      ? { profileSetupCompletedAt: iso(employeeRow.profileSetupCompletedAt) }
      : {}),
    ...(employeeRow.proposedLineManagerEmail
      ? { proposedLineManagerEmail: employeeRow.proposedLineManagerEmail }
      : {}),
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
      const employeeId = randomUUID();
      const userId = randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const names = nameParts(identity.name);
      const defaults = await selfSetupMasterData(tx, organisationId, employeeId);
      [employee] = await tx
        .insert(employees)
        .values({
          id: employeeId,
          organisationId,
          employeeNumber: identity.email,
          ...names,
          workEmail: identity.email,
          workspaceEmail: identity.email,
          departmentId: defaults.department.id,
          positionId: defaults.position.id,
          locationId: defaults.location.id,
          employmentTypeId: defaults.employmentType.id,
          startDate: today,
          status: "Onboarding",
          profileSetupStatus: "In Progress",
          createdBy: employeeId,
          updatedBy: employeeId,
        })
        .returning();
      if (!employee) throw new Error("Your employee profile could not be created.");
      [user] = await tx
        .insert(users)
        .values({
          id: userId,
          organisationId,
          employeeId,
          displayName: identity.name,
          workspaceEmail: identity.email,
          status: "Active",
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();
      if (!user) throw new Error("Your VIA HR account could not be created.");
      const caseId = await createFirstLoginChecklist(tx, organisationId, employeeId, userId, today);
      await tx.insert(notifications).values({
        organisationId,
        recipientUserId: userId,
        type: "profile_setup_required",
        title: "Complete your VIA HR profile",
        message: "Confirm your employment details and provide the required personal records.",
        priority: "High",
        status: "Unread",
        deduplicationKey: `profile-setup-${employeeId}`,
        link: { entityType: "onboarding-case", entityId: caseId, path: "/staff/me/onboarding" },
        createdBy: userId,
        updatedBy: userId,
      });
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: userId,
        actorEmployeeId: employeeId,
        actorDisplayName: identity.name,
        activeRole: "Employee",
        actorRoles: ["Employee"],
        action: "self-register",
        module: "core-hr",
        entityType: "employee",
        entityId: employeeId,
        afterSummary: {
          workspaceEmail: identity.email,
          employeeReference: identity.email,
          profileSetupStatus: "In Progress",
        },
        reason: "Created automatically after verified first sign-in through VIA Portal",
        riskLevel: "High",
      });
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
      .where(eq(roles.code, "Employee"))
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
    const linkedReports = await tx
      .update(employees)
      .set({
        lineManagerId: employee.id,
        proposedLineManagerEmail: null,
        updatedAt: new Date(),
        updatedBy: activeUser.id,
        recordVersion: sql`${employees.recordVersion} + 1`,
      })
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.proposedLineManagerEmail, identity.email),
          isNull(employees.lineManagerId),
          sql`${employees.id} <> ${employee.id}`,
        ),
      )
      .returning({ id: employees.id });
    if (linkedReports.length) {
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: activeUser.id,
        actorEmployeeId: employee.id,
        actorDisplayName: identity.name,
        activeRole: "Employee",
        actorRoles: ["Employee"],
        action: "manager-link-resolved",
        module: "core-hr",
        entityType: "employee",
        entityId: employee.id,
        afterSummary: { directReportIds: linkedReports.map((item) => item.id) },
        reason: "Resolved pending supervisor links after verified VIA Portal sign-in",
        riskLevel: "Medium",
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
