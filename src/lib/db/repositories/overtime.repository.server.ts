import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { fileMetadata } from "../schema/documents.ts";
import { activityCodes, costCentres, locations, projects } from "../schema/master-data.ts";
import { leaveBalances, leavePolicies, leaveTransactions } from "../schema/leave.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  attendanceRecords,
  overtimeClaims,
  timesheetEntries,
  timesheetSettings,
  timesheets,
} from "../schema/time.ts";
import { payrollPeriods } from "../schema/travel-payroll.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import { readObjectFile } from "../object-storage.server.ts";

function activeRole(actor: AuditActorContext) {
  return actor.activeRole ?? actor.roles?.[0] ?? "Employee";
}

async function activeMaster(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  organisationId: string,
  id: string,
  label: string,
) {
  const [record] = await tx
    .select({ id: table.id })
    .from(table)
    .where(
      and(eq(table.organisationId, organisationId), eq(table.id, id), eq(table.isActive, true)),
    )
    .limit(1);
  if (!record) throw new Error(`Select an active ${label}.`);
}

async function createNotice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organisationId: string,
  recipientUserId: string | undefined,
  input: { type: string; title: string; message: string; key: string; claimId: string },
  actorUserId: string | undefined,
) {
  if (!recipientUserId || !actorUserId) return;
  await tx
    .insert(notifications)
    .values({
      organisationId,
      recipientUserId,
      type: input.type,
      title: input.title,
      message: input.message,
      priority: "High",
      status: "Unread",
      deduplicationKey: input.key,
      link: {
        entityType: "overtime-claim",
        entityId: input.claimId,
        path: "/staff/overtime-approvals",
      },
      createdBy: actorUserId,
      updatedBy: actorUserId,
    } as typeof notifications.$inferInsert)
    .onConflictDoNothing();
}

export async function createOvertimeClaimInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    date: string;
    hours: number;
    reason: string;
    requestKind?: "Planned" | "Emergency Retrospective";
    emergencyReason?: string;
    compensationType: "Payment" | "TOIL";
    projectId?: string;
    costCentreId: string;
    activityCodeId: string;
    locationId: string;
    evidenceFileId?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  const requestKind = input.requestKind ?? "Emergency Retrospective";
  if (
    input.requestKind === "Emergency Retrospective" &&
    (input.emergencyReason?.trim().length ?? 0) < 5
  )
    throw new Error("Explain why prior approval could not be obtained for emergency overtime.");
  const today = new Date().toISOString().slice(0, 10);
  if (requestKind === "Planned" && input.date < today)
    throw new Error("Planned overtime must be requested before the work is performed.");
  if (requestKind === "Emergency Retrospective" && input.date > today)
    throw new Error("Use a planned overtime request for a future date.");
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24)
    throw new Error("Overtime hours must be greater than zero and no more than 24.");
  if (!input.reason.trim()) throw new Error("Explain why the overtime was worked.");
  const emergencyReason = input.emergencyReason?.trim() || input.reason.trim();
  const db = getDatabaseClient();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select({
        id: employees.id,
        lineManagerId: employees.lineManagerId,
        status: employees.status,
        preferredName: employees.preferredName,
        employmentConfirmationStatus: employees.employmentConfirmationStatus,
      })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)))
      .limit(1);
    if (!employee || !["Active", "Probation", "Notice"].includes(employee.status))
      throw new Error("Select an active employee.");
    if (employee.employmentConfirmationStatus !== "Confirmed")
      throw new Error(
        "HR must confirm the employee's employment details before overtime can be submitted.",
      );
    const isSelf = actor.employeeId === input.employeeId;
    const isAssignedManager =
      activeRole(actor) === "Line Manager" && employee.lineManagerId === actor.employeeId;
    const isHr = ["HR", "Super Admin"].includes(activeRole(actor));
    if (!isSelf && !isAssignedManager && !isHr)
      throw new Error("You may record overtime only for yourself or an assigned direct report.");
    if (!employee.lineManagerId || employee.lineManagerId === input.employeeId)
      throw new Error(
        "An active, independent supervisor must be assigned before overtime can be submitted.",
      );
    if (input.projectId)
      await activeMaster(tx, projects, organisationId, input.projectId, "project");
    await activeMaster(tx, costCentres, organisationId, input.costCentreId, "cost centre");
    await activeMaster(tx, activityCodes, organisationId, input.activityCodeId, "activity");
    await activeMaster(tx, locations, organisationId, input.locationId, "work location");
    const [duplicate] = await tx
      .select({ id: overtimeClaims.id })
      .from(overtimeClaims)
      .where(
        and(
          eq(overtimeClaims.organisationId, organisationId),
          eq(overtimeClaims.employeeId, input.employeeId),
          eq(overtimeClaims.date, input.date),
          sql`${overtimeClaims.archivedAt} IS NULL`,
          sql`${overtimeClaims.status} NOT IN ('Rejected','Corrected')`,
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("An active overtime claim already exists for this date.");
    if (input.evidenceFileId) {
      const [file] = await tx
        .select({
          ownerEntityId: fileMetadata.ownerEntityId,
          ownerEntityType: fileMetadata.ownerEntityType,
          storageStatus: fileMetadata.storageStatus,
        })
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, organisationId),
            eq(fileMetadata.id, input.evidenceFileId),
          ),
        )
        .limit(1);
      if (
        !file ||
        file.ownerEntityId !== input.employeeId ||
        file.ownerEntityType !== "overtime-claim-evidence" ||
        file.storageStatus !== "Available"
      )
        throw new Error("The evidence file does not belong to this employee.");
    }
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const standardHours = Number(settings?.standardDailyHours ?? 8);
    const dailyLimit = Number(settings?.overtimeMaxDailyHours ?? 4);
    const weeklyLimit = Number(settings?.overtimeMaxWeeklyHours ?? 12);
    const monthlyLimit = Number(settings?.overtimeMaxMonthlyHours ?? 40);
    if (input.hours > dailyLimit)
      throw new Error(`Overtime cannot exceed the configured daily limit of ${dailyLimit} hours.`);
    const [periodTotals] = await tx
      .select({
        weekly: sql<number>`coalesce(sum(${overtimeClaims.hours}) filter (where date_trunc('week', ${overtimeClaims.date}::timestamp) = date_trunc('week', ${input.date}::date::timestamp)), 0)`,
        monthly: sql<number>`coalesce(sum(${overtimeClaims.hours}) filter (where date_trunc('month', ${overtimeClaims.date}::timestamp) = date_trunc('month', ${input.date}::date::timestamp)), 0)`,
      })
      .from(overtimeClaims)
      .where(
        and(
          eq(overtimeClaims.organisationId, organisationId),
          eq(overtimeClaims.employeeId, input.employeeId),
          sql`${overtimeClaims.archivedAt} IS NULL`,
          sql`${overtimeClaims.status} NOT IN ('Rejected','Corrected')`,
        ),
      );
    if (Number(periodTotals?.weekly ?? 0) + input.hours > weeklyLimit)
      throw new Error(`This request exceeds the weekly overtime limit of ${weeklyLimit} hours.`);
    if (Number(periodTotals?.monthly ?? 0) + input.hours > monthlyLimit)
      throw new Error(`This request exceeds the monthly overtime limit of ${monthlyLimit} hours.`);
    const [timesheetHours] = await tx
      .select({ total: sql<number>`coalesce(sum(${timesheetEntries.hours}),0)` })
      .from(timesheetEntries)
      .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
      .where(
        and(
          eq(timesheets.organisationId, organisationId),
          eq(timesheets.employeeId, input.employeeId),
          eq(timesheetEntries.workDate, input.date),
          sql`${timesheets.status} NOT IN ('Corrected')`,
          sql`${timesheets.archivedAt} IS NULL`,
        ),
      );
    const [attendance] = await tx
      .select({ hours: attendanceRecords.calculatedHours })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          eq(attendanceRecords.employeeId, input.employeeId),
          eq(attendanceRecords.date, input.date),
        ),
      )
      .limit(1);
    const crossCheckWarnings: string[] = [];
    if (
      requestKind === "Emergency Retrospective" &&
      Number(timesheetHours?.total ?? 0) < standardHours + input.hours
    )
      crossCheckWarnings.push(`Timesheet hours do not yet support ${input.hours} overtime hours.`);
    if (
      requestKind === "Emergency Retrospective" &&
      Number(attendance?.hours ?? 0) < standardHours + input.hours
    )
      crossCheckWarnings.push(`Attendance hours do not yet support ${input.hours} overtime hours.`);
    await tx.insert(overtimeClaims).values({
      id,
      organisationId,
      employeeId: input.employeeId,
      date: input.date,
      hours: String(input.hours),
      reason: input.reason.trim(),
      requestKind,
      ...(requestKind === "Emergency Retrospective" ? { emergencyReason } : {}),
      compensationType: input.compensationType,
      projectId: input.projectId,
      costCentreId: input.costCentreId,
      activityCodeId: input.activityCodeId,
      locationId: input.locationId,
      evidenceFileId: input.evidenceFileId,
      crossCheckWarnings,
      status: requestKind === "Planned" ? "Pending Pre-authorisation" : "Pending Manager",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof overtimeClaims.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "submit",
      module: "overtime",
      entityType: "overtime-claim",
      entityId: id,
      afterSummary: {
        hours: input.hours,
        compensationType: input.compensationType,
        requestKind,
      },
      reason: isSelf ? "Submitted an overtime claim" : "Recorded overtime on behalf of an employee",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
    const [managerUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.employeeId, employee.lineManagerId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    await createNotice(
      tx,
      organisationId,
      managerUser?.id,
      {
        type: "Approval",
        title:
          requestKind === "Planned"
            ? "Planned overtime awaiting pre-authorisation"
            : "Emergency overtime awaiting your review",
        message: `${employee.preferredName}'s ${input.hours} hour overtime request is ready for review.`,
        key: `overtime-manager-${id}`,
        claimId: id,
      },
      actor.userId,
    );
  });
  return id;
}

export async function decideOvertimeClaimInDatabase(
  organisationId: string,
  claimId: string,
  decision: "approve" | "reject",
  notes: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM overtime_claims WHERE id = ${claimId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [claim] = await tx
      .select()
      .from(overtimeClaims)
      .where(and(eq(overtimeClaims.organisationId, organisationId), eq(overtimeClaims.id, claimId)))
      .limit(1);
    if (!claim) throw new Error("Overtime claim not found.");
    const [employee] = await tx
      .select({ lineManagerId: employees.lineManagerId })
      .from(employees)
      .where(eq(employees.id, claim.employeeId))
      .limit(1);
    const preAuthorisation = claim.status === "Pending Pre-authorisation";
    const manager = claim.status === "Pending Manager" || preAuthorisation;
    const hr = claim.status === "Pending HR";
    if (
      (manager &&
        (actor.activeRole !== "Line Manager" || actor.employeeId !== employee?.lineManagerId)) ||
      (hr && actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") ||
      (!manager && !hr)
    )
      throw new Error("You are not the assigned overtime approver.");
    if (actor.employeeId === claim.employeeId)
      throw new Error("You cannot approve your own overtime claim.");
    if (decision === "reject" && !notes?.trim())
      throw new Error("A reason is required when rejecting overtime.");
    const next =
      decision === "reject"
        ? "Rejected"
        : preAuthorisation
          ? "Pre-authorised"
          : manager
            ? "Pending HR"
            : "Approved";
    let toilCreditedAt: string | undefined;
    let toilPolicy: typeof leavePolicies.$inferSelect | undefined;
    let toilDays = 0;
    if (next === "Approved" && claim.compensationType === "TOIL") {
      [toilPolicy] = await tx
        .select()
        .from(leavePolicies)
        .where(
          and(
            eq(leavePolicies.organisationId, organisationId),
            eq(leavePolicies.isEnabled, true),
            sql`(lower(${leavePolicies.name}) LIKE '%compensation%' OR lower(${leavePolicies.name}) LIKE '%time off%')`,
          ),
        )
        .limit(1);
      if (!toilPolicy)
        throw new Error("Configure an active Compensation Leave policy before approving TOIL.");
      const [settings] = await tx
        .select()
        .from(timesheetSettings)
        .where(eq(timesheetSettings.organisationId, organisationId))
        .limit(1);
      toilDays = Number(claim.hours) / Number(settings?.standardDailyHours ?? 8);
      toilCreditedAt = new Date().toISOString();
    }
    await tx
      .update(overtimeClaims)
      .set({
        status: next,
        ...(manager ? { managerNotes: notes?.trim() } : { hrNotes: notes?.trim() }),
        ...(next === "Pre-authorised"
          ? {
              authorisedHours: claim.hours,
              preAuthorisedAt: new Date().toISOString(),
              preAuthorisedBy: actor.userId,
            }
          : {}),
        ...(next === "Approved"
          ? {
              approvedAt: new Date().toISOString(),
              approvedBy: actor.userId,
              ...(toilCreditedAt ? { toilCreditedAt } : {}),
            }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${overtimeClaims.recordVersion} + 1`,
      })
      .where(eq(overtimeClaims.id, claimId));
    if (next === "Approved" && claim.compensationType === "TOIL" && toilPolicy) {
      const year = new Date(claim.date).getUTCFullYear();
      await tx
        .insert(leaveBalances)
        .values({
          id: randomUUID(),
          organisationId,
          employeeId: claim.employeeId,
          policyId: toilPolicy.id,
          leaveYear: year,
          balanceDays: String(toilDays),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof leaveBalances.$inferInsert)
        .onConflictDoUpdate({
          target: [leaveBalances.employeeId, leaveBalances.policyId, leaveBalances.leaveYear],
          set: {
            balanceDays: sql`${leaveBalances.balanceDays} + ${toilDays}`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
          },
        });
      await tx.insert(leaveTransactions).values({
        id: randomUUID(),
        organisationId,
        employeeId: claim.employeeId,
        policyId: toilPolicy.id,
        date: claim.date,
        transactionType: "Manual Adjustment",
        days: String(toilDays),
        reason: `TOIL credit from approved overtime ${claim.id}`,
        referenceId: claim.id,
        actorUserId: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof leaveTransactions.$inferInsert);
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: decision,
      module: "overtime",
      entityType: "overtime-claim",
      entityId: claimId,
      afterSummary: { status: next },
      reason: notes?.trim() ?? `Overtime ${decision}d`,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    if (next === "Pending HR") {
      const hrUsers = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            inArray(roles.code, ["HR", "Super Admin"]),
          ),
        );
      for (const reviewer of hrUsers)
        await createNotice(
          tx,
          organisationId,
          reviewer.id,
          {
            type: "Approval",
            title: "Overtime ready for HR verification",
            message: "A supervisor-approved overtime claim is ready for final verification.",
            key: `overtime-hr-${claimId}`,
            claimId,
          },
          actor.userId,
        );
    } else {
      const [employeeUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.employeeId, claim.employeeId),
            eq(users.status, "Active"),
          ),
        )
        .limit(1);
      await createNotice(
        tx,
        organisationId,
        employeeUser?.id,
        {
          type: "Info",
          title:
            next === "Approved"
              ? "Overtime approved"
              : next === "Pre-authorised"
                ? "Planned overtime pre-authorised"
                : "Overtime rejected",
          message:
            next === "Approved"
              ? "Your overtime claim has completed approval."
              : next === "Pre-authorised"
                ? "Your supervisor approved the planned overtime. Confirm the actual hours after the work date."
                : `Your overtime claim was rejected: ${notes?.trim()}`,
          key: `overtime-decision-${claimId}-${next}`,
          claimId,
        },
        actor.userId,
      );
    }
  });
}

export async function confirmPlannedOvertimeInDatabase(
  organisationId: string,
  claimId: string,
  actualHours: number,
  note: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [claim] = await tx
      .select()
      .from(overtimeClaims)
      .where(and(eq(overtimeClaims.organisationId, organisationId), eq(overtimeClaims.id, claimId)))
      .limit(1)
      .for("update");
    if (!claim || claim.employeeId !== actor.employeeId)
      throw new Error("You can confirm only your own planned overtime.");
    if (claim.status !== "Pre-authorised" || claim.requestKind !== "Planned")
      throw new Error("This planned overtime is not ready for actual-hours confirmation.");
    const today = new Date().toISOString().slice(0, 10);
    if (claim.date > today)
      throw new Error("Confirm actual hours on or after the planned work date.");
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const dailyLimit = Number(settings?.overtimeMaxDailyHours ?? 4);
    const weeklyLimit = Number(settings?.overtimeMaxWeeklyHours ?? 12);
    const monthlyLimit = Number(settings?.overtimeMaxMonthlyHours ?? 40);
    if (!Number.isFinite(actualHours) || actualHours <= 0 || actualHours > dailyLimit)
      throw new Error(`Actual overtime must be above zero and within ${dailyLimit} hours.`);
    const [otherTotals] = await tx
      .select({
        weekly: sql<number>`coalesce(sum(${overtimeClaims.hours}) filter (where date_trunc('week', ${overtimeClaims.date}::timestamp) = date_trunc('week', ${claim.date}::date::timestamp)), 0)`,
        monthly: sql<number>`coalesce(sum(${overtimeClaims.hours}) filter (where date_trunc('month', ${overtimeClaims.date}::timestamp) = date_trunc('month', ${claim.date}::date::timestamp)), 0)`,
      })
      .from(overtimeClaims)
      .where(
        and(
          eq(overtimeClaims.organisationId, organisationId),
          eq(overtimeClaims.employeeId, claim.employeeId),
          sql`${overtimeClaims.id} <> ${claim.id}`,
          sql`${overtimeClaims.archivedAt} IS NULL`,
          sql`${overtimeClaims.status} NOT IN ('Rejected','Corrected')`,
        ),
      );
    if (Number(otherTotals?.weekly ?? 0) + actualHours > weeklyLimit)
      throw new Error(`Actual overtime exceeds the weekly limit of ${weeklyLimit} hours.`);
    if (Number(otherTotals?.monthly ?? 0) + actualHours > monthlyLimit)
      throw new Error(`Actual overtime exceeds the monthly limit of ${monthlyLimit} hours.`);
    const authorisedHours = Number(claim.authorisedHours ?? claim.hours);
    const exceeded = actualHours > authorisedHours;
    if (exceeded && note.trim().length < 5)
      throw new Error("Explain why actual overtime exceeded the pre-authorised hours.");

    await tx
      .update(overtimeClaims)
      .set({
        hours: String(actualHours),
        actualConfirmedAt: new Date().toISOString(),
        status: exceeded ? "Pending Manager" : "Pending HR",
        ...(note.trim() ? { reason: `${claim.reason}\nActual-hours note: ${note.trim()}` } : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${overtimeClaims.recordVersion} + 1`,
      })
      .where(eq(overtimeClaims.id, claim.id));

    let reviewerIds: Array<string | undefined>;
    if (exceeded) {
      const [employee] = await tx
        .select({ managerId: employees.lineManagerId })
        .from(employees)
        .where(eq(employees.id, claim.employeeId))
        .limit(1);
      const [managerUser] = employee?.managerId
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.organisationId, organisationId),
                eq(users.employeeId, employee.managerId),
                eq(users.status, "Active"),
              ),
            )
            .limit(1)
        : [];
      reviewerIds = [managerUser?.id];
    } else {
      reviewerIds = (
        await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.status, "Active"),
              inArray(roles.code, ["HR", "Super Admin"]),
            ),
          )
      ).map((row) => row.id);
    }
    for (const reviewerId of reviewerIds)
      await createNotice(
        tx,
        organisationId,
        reviewerId,
        {
          type: "Approval",
          title: exceeded
            ? "Overtime exceeded pre-authorisation"
            : "Overtime ready for HR verification",
          message: exceeded
            ? `Actual overtime was ${actualHours} hours against ${authorisedHours} authorised hours.`
            : "Pre-authorised overtime was completed and is ready for HR verification.",
          key: `overtime-actual-${claim.id}-${claim.recordVersion + 1}-${reviewerId}`,
          claimId: claim.id,
        },
        actor.userId,
      );
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "confirm-actual-hours",
      module: "overtime",
      entityType: "overtime-claim",
      entityId: claim.id,
      beforeSummary: { authorisedHours },
      afterSummary: { actualHours, status: exceeded ? "Pending Manager" : "Pending HR" },
      reason: note.trim() || "Confirmed actual planned overtime hours",
      riskLevel: exceeded ? "High" : "Medium",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function listOvertimeClaimsForActor(organisationId: string, actor: AuditActorContext) {
  const db = getDatabaseClient();
  const role = activeRole(actor);
  let employeeIds: string[] | undefined;
  if (role === "Employee") {
    if (!actor.employeeId) throw new Error("A verified employee is required.");
    employeeIds = [actor.employeeId];
  } else if (role === "Line Manager") {
    if (!actor.employeeId) throw new Error("A verified supervisor is required.");
    const reports = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.lineManagerId, actor.employeeId),
        ),
      );
    employeeIds = [actor.employeeId, ...reports.map((item) => item.id)];
  } else if (!["HR", "Accounts", "Super Admin"].includes(role)) {
    throw new Error("You are not authorised to view overtime claims.");
  }
  const rows = await db
    .select()
    .from(overtimeClaims)
    .where(
      and(
        eq(overtimeClaims.organisationId, organisationId),
        sql`${overtimeClaims.archivedAt} IS NULL`,
        ...(employeeIds ? [inArray(overtimeClaims.employeeId, employeeIds)] : []),
        ...(role === "Accounts" ? [eq(overtimeClaims.status, "Approved")] : []),
      ),
    )
    .orderBy(desc(overtimeClaims.date), desc(overtimeClaims.createdAt));
  return rows.map((row) => ({
    id: row.id,
    databaseId: row.id,
    employeeId: row.employeeId,
    date: row.date,
    hours: Number(row.hours),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    costCentreId: row.costCentreId,
    activityCodeId: row.activityCodeId,
    locationCodeId: row.locationId,
    reason: row.reason,
    requestKind: row.requestKind as "Planned" | "Emergency Retrospective",
    ...(row.emergencyReason ? { emergencyReason: row.emergencyReason } : {}),
    ...(row.authorisedHours !== null ? { authorisedHours: Number(row.authorisedHours) } : {}),
    ...(row.preAuthorisedAt ? { preAuthorisedAt: row.preAuthorisedAt } : {}),
    ...(row.preAuthorisedBy ? { preAuthorisedBy: row.preAuthorisedBy } : {}),
    ...(row.actualConfirmedAt ? { actualConfirmedAt: row.actualConfirmedAt } : {}),
    ...(row.evidenceFileId ? { evidenceFileId: row.evidenceFileId } : {}),
    compensationType: row.compensationType as "Payment" | "TOIL",
    ...(row.toilCreditedAt ? { toilCreditedAt: row.toilCreditedAt } : {}),
    ...(row.toilReversedAt ? { toilReversedAt: row.toilReversedAt } : {}),
    ...(row.payrollPeriodId ? { payrollPeriodId: row.payrollPeriodId } : {}),
    crossCheckWarnings: row.crossCheckWarnings,
    status: row.status,
    ...(row.managerNotes ? { managerNotes: row.managerNotes } : {}),
    ...(row.hrNotes ? { hrNotes: row.hrNotes } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt } : {}),
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.originalClaimId ? { originalClaimId: row.originalClaimId } : {}),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archivedAt: row.archivedAt?.toISOString(),
    recordVersion: row.recordVersion,
  }));
}

export async function correctOvertimeClaimInDatabase(
  organisationId: string,
  claimId: string,
  input: { hours: number; reason: string; evidenceFileId?: string },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  if (!(input.hours > 0 && input.hours <= 12))
    throw new Error("Corrected overtime must be between 0 and 12 hours.");
  if (input.reason.trim().length < 5)
    throw new Error("Explain why the overtime claim is being corrected.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM overtime_claims WHERE id = ${claimId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [original] = await tx
      .select()
      .from(overtimeClaims)
      .where(and(eq(overtimeClaims.organisationId, organisationId), eq(overtimeClaims.id, claimId)))
      .limit(1);
    if (!original || original.status !== "Approved" || original.archivedAt)
      throw new Error("Only a current approved claim can be corrected.");
    if (
      actor.employeeId !== original.employeeId &&
      !["HR", "Super Admin"].includes(activeRole(actor))
    )
      throw new Error("Only the employee, HR or Super Admin can request this correction.");
    const evidenceFileId = input.evidenceFileId ?? original.evidenceFileId ?? undefined;
    if (evidenceFileId) {
      const [file] = await tx
        .select()
        .from(fileMetadata)
        .where(
          and(eq(fileMetadata.organisationId, organisationId), eq(fileMetadata.id, evidenceFileId)),
        )
        .limit(1);
      if (
        !file ||
        file.ownerEntityType !== "overtime-claim-evidence" ||
        file.ownerEntityId !== original.employeeId ||
        file.storageStatus !== "Available"
      )
        throw new Error("The correction evidence does not belong to this employee.");
    }
    let reversedAt: string | undefined;
    if (
      original.compensationType === "TOIL" &&
      original.toilCreditedAt &&
      !original.toilReversedAt
    ) {
      const [transaction] = await tx
        .select()
        .from(leaveTransactions)
        .where(
          and(
            eq(leaveTransactions.organisationId, organisationId),
            eq(leaveTransactions.referenceId, original.id),
            sql`${leaveTransactions.reason} LIKE 'TOIL credit%'`,
          ),
        )
        .limit(1);
      if (!transaction) throw new Error("The original TOIL credit could not be reconciled.");
      await tx
        .update(leaveBalances)
        .set({
          balanceDays: sql`${leaveBalances.balanceDays} - ${Number(transaction.days)}`,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${leaveBalances.recordVersion} + 1`,
        })
        .where(
          and(
            eq(leaveBalances.employeeId, original.employeeId),
            eq(leaveBalances.policyId, transaction.policyId),
            eq(leaveBalances.leaveYear, new Date(original.date).getUTCFullYear()),
          ),
        );
      await tx.insert(leaveTransactions).values({
        id: randomUUID(),
        organisationId,
        employeeId: original.employeeId,
        policyId: transaction.policyId,
        date: original.date,
        transactionType: "Manual Adjustment",
        days: String(-Number(transaction.days)),
        reason: `TOIL credit reversal for corrected overtime ${original.id}`,
        referenceId: original.id,
        actorUserId: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof leaveTransactions.$inferInsert);
      reversedAt = new Date().toISOString();
    }
    const newId = randomUUID();
    await tx
      .update(overtimeClaims)
      .set({
        status: "Corrected",
        archivedAt: new Date(),
        ...(reversedAt ? { toilReversedAt: reversedAt } : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${overtimeClaims.recordVersion} + 1`,
      })
      .where(eq(overtimeClaims.id, claimId));
    await tx.insert(overtimeClaims).values({
      id: newId,
      organisationId,
      employeeId: original.employeeId,
      date: original.date,
      hours: String(input.hours),
      projectId: original.projectId,
      costCentreId: original.costCentreId,
      activityCodeId: original.activityCodeId,
      locationId: original.locationId,
      reason: input.reason.trim(),
      requestKind: "Emergency Retrospective",
      emergencyReason: input.reason.trim(),
      evidenceFileId,
      compensationType: original.compensationType,
      crossCheckWarnings: original.crossCheckWarnings,
      status: "Pending Manager",
      originalClaimId: original.id,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof overtimeClaims.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: activeRole(actor),
      actorRoles: actor.roles ?? [],
      action: "correct",
      module: "overtime",
      entityType: "overtime-claim",
      entityId: claimId,
      beforeSummary: { status: "Approved", hours: Number(original.hours) },
      afterSummary: { status: "Corrected", replacementClaimId: newId, hours: input.hours },
      reason: input.reason.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
    const [claimEmployee] = await tx
      .select({ lineManagerId: employees.lineManagerId })
      .from(employees)
      .where(eq(employees.id, original.employeeId))
      .limit(1);
    const [managerUser] = claimEmployee?.lineManagerId
      ? await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.employeeId, claimEmployee.lineManagerId),
              eq(users.status, "Active"),
            ),
          )
          .limit(1)
      : [];
    await createNotice(
      tx,
      organisationId,
      managerUser?.id,
      {
        type: "Approval",
        title: "Corrected overtime awaiting review",
        message: "A corrected overtime claim is ready for your review.",
        key: `overtime-manager-${newId}`,
        claimId: newId,
      },
      actor.userId,
    );
    return newId;
  });
}

export async function readOvertimeEvidenceInDatabase(
  organisationId: string,
  claimId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  const [claim] = await db
    .select({
      employeeId: overtimeClaims.employeeId,
      evidenceFileId: overtimeClaims.evidenceFileId,
    })
    .from(overtimeClaims)
    .where(and(eq(overtimeClaims.organisationId, organisationId), eq(overtimeClaims.id, claimId)))
    .limit(1);
  if (!claim?.evidenceFileId) throw new Error("This claim has no supporting evidence.");
  const [employee] = await db
    .select({ lineManagerId: employees.lineManagerId })
    .from(employees)
    .where(eq(employees.id, claim.employeeId))
    .limit(1);
  const allowed =
    actor.employeeId === claim.employeeId ||
    employee?.lineManagerId === actor.employeeId ||
    ["HR", "Accounts", "Super Admin"].includes(activeRole(actor));
  if (!allowed) throw new Error("You are not authorised to view this overtime evidence.");
  return readObjectFile(
    organisationId,
    claim.evidenceFileId,
    { ...actor, activeRole: activeRole(actor) },
    `Viewed evidence for overtime claim ${claimId}`,
  );
}

export async function listPayrollOvertimeLedgerInDatabase(
  organisationId: string,
  actor: AuditActorContext,
) {
  if (!["Accounts", "Super Admin"].includes(activeRole(actor)))
    throw new Error("Payroll overtime is restricted to Accounts and Super Admin.");
  const db = getDatabaseClient();
  const rows = await db
    .select({
      claim: overtimeClaims,
      employeeName: employees.preferredName,
      employeeNumber: employees.employeeNumber,
      projectName: projects.name,
      costCentreName: costCentres.name,
      activityName: activityCodes.name,
      locationName: locations.name,
      payrollPeriodName: payrollPeriods.name,
      payrollPeriodStatus: payrollPeriods.status,
    })
    .from(overtimeClaims)
    .innerJoin(employees, eq(employees.id, overtimeClaims.employeeId))
    .leftJoin(projects, eq(projects.id, overtimeClaims.projectId))
    .innerJoin(costCentres, eq(costCentres.id, overtimeClaims.costCentreId))
    .innerJoin(activityCodes, eq(activityCodes.id, overtimeClaims.activityCodeId))
    .innerJoin(locations, eq(locations.id, overtimeClaims.locationId))
    .leftJoin(payrollPeriods, eq(payrollPeriods.id, overtimeClaims.payrollPeriodId))
    .where(
      and(
        eq(overtimeClaims.organisationId, organisationId),
        eq(overtimeClaims.status, "Approved"),
        sql`${overtimeClaims.archivedAt} IS NULL`,
      ),
    )
    .orderBy(desc(overtimeClaims.date));
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: activeRole(actor),
    actorRoles: actor.roles ?? [],
    action: "view",
    module: "payroll",
    entityType: "overtime-ledger",
    entityId: organisationId,
    afterSummary: { rowCount: rows.length },
    reason: "Viewed the overtime payroll ledger",
    riskLevel: "Medium",
  } as typeof auditEvents.$inferInsert);
  return rows.map(({ claim, ...names }) => ({
    claimId: claim.id,
    employeeId: claim.employeeId,
    employeeName: names.employeeName,
    employeeNumber: names.employeeNumber,
    date: claim.date,
    hours: Number(claim.hours),
    compensationType: claim.compensationType as "Payment" | "TOIL",
    projectName: names.projectName ?? "General operations",
    costCentreName: names.costCentreName,
    activityName: names.activityName,
    locationName: names.locationName,
    reason: claim.reason,
    hasEvidence: Boolean(claim.evidenceFileId),
    crossCheckWarnings: claim.crossCheckWarnings,
    ...(claim.managerNotes ? { managerNotes: claim.managerNotes } : {}),
    ...(claim.hrNotes ? { hrNotes: claim.hrNotes } : {}),
    approvedAt: claim.approvedAt!,
    ...(claim.approvedBy ? { approvedBy: claim.approvedBy } : {}),
    ...(claim.payrollPeriodId ? { payrollPeriodId: claim.payrollPeriodId } : {}),
    ...(names.payrollPeriodName ? { payrollPeriodName: names.payrollPeriodName } : {}),
    ...(names.payrollPeriodStatus ? { payrollPeriodStatus: names.payrollPeriodStatus } : {}),
    state:
      claim.compensationType === "TOIL" && claim.payrollPeriodId
        ? "Review Needed"
        : claim.compensationType === "TOIL" && claim.toilCreditedAt
          ? "Time Off Credited"
          : claim.compensationType === "TOIL"
            ? "Time Off Pending"
            : claim.payrollPeriodId
              ? "Included in Payroll"
              : "Ready for Payroll",
  }));
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportPayrollOvertimeLedgerInDatabase(
  organisationId: string,
  actor: AuditActorContext,
  filters: {
    search?: string;
    view?: "all" | "ready" | "included" | "time-off" | "exceptions";
    dateFrom?: string;
    dateTo?: string;
    payrollPeriodId?: string;
  } = {},
): Promise<string> {
  const allRows = await listPayrollOvertimeLedgerInDatabase(organisationId, actor);
  const search = filters.search?.trim().toLowerCase();
  const rows = allRows
    .filter((row) => !filters.dateFrom || row.date >= filters.dateFrom)
    .filter((row) => !filters.dateTo || row.date <= filters.dateTo)
    .filter(
      (row) =>
        !filters.payrollPeriodId ||
        (filters.payrollPeriodId === "unassigned"
          ? !row.payrollPeriodId
          : row.payrollPeriodId === filters.payrollPeriodId),
    )
    .filter((row) => {
      if (filters.view === "ready") return row.state === "Ready for Payroll";
      if (filters.view === "included") return row.state === "Included in Payroll";
      if (filters.view === "time-off") return row.compensationType === "TOIL";
      if (filters.view === "exceptions")
        return row.state === "Review Needed" || row.crossCheckWarnings.length > 0;
      return true;
    })
    .filter(
      (row) =>
        !search ||
        [
          row.employeeName,
          row.employeeNumber,
          row.projectName,
          row.costCentreName,
          row.activityName,
          row.locationName,
          row.reason,
          row.payrollPeriodName,
        ].some((value) => value?.toLowerCase().includes(search)),
    );
  const data = [
    [
      "Employee Number",
      "Employee",
      "Overtime Date",
      "Approved Hours",
      "Compensation",
      "Project",
      "Cost Centre",
      "Activity",
      "Work Location",
      "Reason",
      "Approved Date",
      "Payroll Period",
      "Ledger Status",
      "Warnings",
    ],
    ...rows.map((row) => [
      row.employeeNumber,
      row.employeeName,
      row.date,
      row.hours,
      row.compensationType,
      row.projectName,
      row.costCentreName,
      row.activityName,
      row.locationName,
      row.reason,
      row.approvedAt,
      row.payrollPeriodName ?? "",
      row.state,
      row.crossCheckWarnings.join(" | "),
    ]),
  ];
  const csv = data.map((row) => row.map(csvCell).join(",")).join("\n");
  const db = getDatabaseClient();
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: activeRole(actor),
    actorRoles: actor.roles ?? [],
    action: "export",
    module: "payroll",
    entityType: "overtime-ledger",
    entityId: organisationId,
    afterSummary: { rowCount: rows.length, filters },
    reason: "Exported the overtime payroll ledger",
    riskLevel: "High",
  } as typeof auditEvents.$inferInsert);
  return csv;
}

export async function assignOvertimeToPayrollInDatabase(
  organisationId: string,
  claimIds: string[],
  payrollPeriodId: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!["Accounts", "Super Admin"].includes(activeRole(actor)))
    throw new Error("Only Accounts or Super Admin can include overtime in payroll.");
  const uniqueIds = [...new Set(claimIds)];
  if (!uniqueIds.length) throw new Error("Select at least one overtime claim.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM payroll_periods WHERE id = ${payrollPeriodId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.organisationId, organisationId),
          eq(payrollPeriods.id, payrollPeriodId),
        ),
      )
      .limit(1);
    if (!period || !["Draft", "Collecting Inputs", "Exceptions"].includes(period.status))
      throw new Error("Select a payroll period that is still collecting inputs.");
    for (const claimId of uniqueIds)
      await tx.execute(
        sql`SELECT id FROM overtime_claims WHERE organisation_id = ${organisationId} AND id = ${claimId} FOR UPDATE`,
      );
    const claims = await tx
      .select()
      .from(overtimeClaims)
      .where(
        and(
          eq(overtimeClaims.organisationId, organisationId),
          inArray(overtimeClaims.id, uniqueIds),
        ),
      );
    if (claims.length !== uniqueIds.length)
      throw new Error("One or more overtime claims could not be found.");
    for (const claim of claims) {
      if (claim.status !== "Approved" || claim.archivedAt)
        throw new Error("Only current approved overtime can be included in payroll.");
      if (claim.compensationType !== "Payment")
        throw new Error("TOIL cannot be included as payable overtime.");
      if (claim.payrollPeriodId && claim.payrollPeriodId !== payrollPeriodId)
        throw new Error("An overtime claim is already included in another payroll period.");
    }
    await tx
      .update(overtimeClaims)
      .set({
        payrollPeriodId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${overtimeClaims.recordVersion} + 1`,
      })
      .where(
        and(
          eq(overtimeClaims.organisationId, organisationId),
          inArray(overtimeClaims.id, uniqueIds),
        ),
      );
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: activeRole(actor),
      actorRoles: actor.roles ?? [],
      action: "assign",
      module: "payroll",
      entityType: "overtime-ledger",
      entityId: payrollPeriodId,
      afterSummary: { claimIds: uniqueIds, claimCount: uniqueIds.length },
      reason: `Included approved overtime in payroll period ${period.name}`,
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function processOvertimeWorker(at = new Date()) {
  const db = getDatabaseClient();
  const cutoff = new Date(at.getTime() - 48 * 60 * 60 * 1000);
  const pending = await db
    .select({
      claim: overtimeClaims,
      employeeName: employees.preferredName,
      lineManagerId: employees.lineManagerId,
    })
    .from(overtimeClaims)
    .innerJoin(employees, eq(employees.id, overtimeClaims.employeeId))
    .where(
      and(
        inArray(overtimeClaims.status, ["Pending Manager", "Pending HR"]),
        sql`${overtimeClaims.archivedAt} IS NULL`,
        sql`${overtimeClaims.updatedAt} <= ${cutoff.toISOString()}`,
      ),
    );
  let reminders = 0;
  for (const row of pending) {
    await db.transaction(async (tx) => {
      if (row.claim.status === "Pending Manager") {
        const [manager] = row.lineManagerId
          ? await tx
              .select({ id: users.id })
              .from(users)
              .where(
                and(
                  eq(users.organisationId, row.claim.organisationId),
                  eq(users.employeeId, row.lineManagerId),
                  eq(users.status, "Active"),
                ),
              )
              .limit(1)
          : [];
        const inserted = manager?.id
          ? await tx
              .insert(notifications)
              .values({
                organisationId: row.claim.organisationId,
                recipientUserId: manager.id,
                type: "Approval",
                title: "Overtime review overdue",
                message: `${row.employeeName}'s overtime claim has waited more than two days for supervisor review.`,
                priority: "High",
                status: "Unread",
                deduplicationKey: `overtime-overdue-manager-${row.claim.id}`,
                link: {
                  entityType: "overtime-claim",
                  entityId: row.claim.id,
                  path: "/staff/overtime-approvals",
                },
                createdBy: manager.id,
                updatedBy: manager.id,
              } as typeof notifications.$inferInsert)
              .onConflictDoNothing()
              .returning({ id: notifications.id })
          : [];
        reminders += inserted.length;
      } else {
        const reviewers = await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(users.organisationId, row.claim.organisationId),
              eq(users.status, "Active"),
              inArray(roles.code, ["HR", "Super Admin"]),
            ),
          );
        for (const reviewer of reviewers) {
          const inserted = await tx
            .insert(notifications)
            .values({
              organisationId: row.claim.organisationId,
              recipientUserId: reviewer.id,
              type: "Approval",
              title: "Overtime verification overdue",
              message: `${row.employeeName}'s overtime claim has waited more than two days for HR verification.`,
              priority: "High",
              status: "Unread",
              deduplicationKey: `overtime-overdue-hr-${row.claim.id}`,
              link: {
                entityType: "overtime-claim",
                entityId: row.claim.id,
                path: "/staff/overtime-approvals",
              },
              createdBy: reviewer.id,
              updatedBy: reviewer.id,
            } as typeof notifications.$inferInsert)
            .onConflictDoNothing()
            .returning({ id: notifications.id });
          reminders += inserted.length;
        }
      }
    });
  }
  return { reviewedClaims: pending.length, reminders };
}
