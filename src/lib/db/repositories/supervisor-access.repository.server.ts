import "@tanstack/react-start/server-only";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { getDatabaseClient } from "../client.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type Tx = Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0];
const unavailable = "Ask HR to assign an active supervisor with Line Manager approval access.";

/** Checking a request never grants permissions. Account locks serialize access changes. */
export async function validateSupervisorAccount(
  tx: Tx,
  organisationId: string,
  employeeId: string,
  supervisorId: string | null | undefined,
  lock: "share" | "update" = "share",
) {
  if (!supervisorId || supervisorId === employeeId) throw new Error(unavailable);
  const [supervisor] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, supervisorId),
        inArray(employees.status, ["Active", "Probation", "Notice"]),
        isNull(employees.archivedAt),
      ),
    )
    .limit(1);
  if (!supervisor) throw new Error(unavailable);
  const [account] = await tx
    .select({ userId: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.employeeId, supervisorId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
      ),
    )
    .limit(1)
    .for(lock);
  if (!account) throw new Error(unavailable);
  return { ...account, employeeId: supervisorId };
}

async function grantManagerRole(
  tx: Tx,
  organisationId: string,
  account: { userId: string; employeeId: string },
  actor: AuditActorContext,
) {
  const [managerRole] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, "Line Manager"))
    .limit(1);
  if (!managerRole) throw new Error("The Line Manager responsibility is not configured.");
  const granted = await tx
    .insert(userRoles)
    .values({
      organisationId,
      userId: account.userId,
      roleId: managerRole.id,
      assignedBy: actor.userId ?? organisationId,
      reason: "HR-authorised supervisor assignment",
    })
    .onConflictDoNothing()
    .returning({ userId: userRoles.userId });
  if (granted.length)
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "supervisor_access_granted",
      module: "security",
      entityType: "user",
      entityId: account.userId,
      afterSummary: { addedRole: "Line Manager", employeeId: account.employeeId },
      reason:
        "Approval access added for an HR-authorised reporting assignment; existing roles retained",
      riskLevel: "High",
    });
  return account;
}

/** Only HR-authorised assignment flows may add the responsibility, never request submission. */
export async function assignSupervisorApprovalAccess(
  tx: Tx,
  organisationId: string,
  employeeId: string,
  supervisorId: string,
  actor: AuditActorContext,
) {
  if (!["HR", "Super Admin"].includes(actor.activeRole))
    throw new Error("Only HR can assign supervisor approval access.");
  const account = await validateSupervisorAccount(
    tx,
    organisationId,
    employeeId,
    supervisorId,
    "update",
  );
  return grantManagerRole(tx, organisationId, account, actor);
}

export async function requireEmployeeSupervisor(
  tx: Tx,
  organisationId: string,
  employeeId: string,
) {
  const [employee] = await tx
    .select({ supervisorId: employees.lineManagerId })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, employeeId),
        isNull(employees.archivedAt),
      ),
    )
    .limit(1);
  const account = await validateSupervisorAccount(
    tx,
    organisationId,
    employeeId,
    employee?.supervisorId,
  );
  const [access] = await tx
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(userRoles.organisationId, organisationId),
        eq(userRoles.userId, account.userId),
        eq(roles.code, "Line Manager"),
      ),
    )
    .limit(1);
  if (!access) throw new Error(unavailable);
  return account;
}

/** Portal identity resolution may restore only a reporting relationship already confirmed by HR. */
export async function restoreConfirmedSupervisorAccess(
  tx: Tx,
  organisationId: string,
  supervisorId: string,
  actor: AuditActorContext,
) {
  const [report] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.lineManagerId, supervisorId),
        ne(employees.id, supervisorId),
        eq(employees.employmentConfirmationStatus, "Confirmed"),
        inArray(employees.status, ["Onboarding", "Active", "Probation", "Notice"]),
        isNull(employees.archivedAt),
      ),
    )
    .limit(1);
  if (!report) return;
  const account = await validateSupervisorAccount(
    tx,
    organisationId,
    report.id,
    supervisorId,
    "update",
  );
  return grantManagerRole(tx, organisationId, account, actor);
}
