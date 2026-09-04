import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import {
  activityCodes,
  costCentres,
  locations,
  projects,
  publicHolidays,
} from "../schema/master-data.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { appSettings } from "../schema/organisation.ts";
import { leaveRequests } from "../schema/leave.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  attendanceRecords,
  timesheetEntries,
  timesheetPeriods,
  timesheetSettings,
  timesheets,
} from "../schema/time.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const DEFAULT_SETTINGS = {
  weeklyPeriodStartDay: 1,
  standardDailyHours: 8,
  submissionDeadlineDays: 2,
  overtimeThresholdWeekly: 40,
  allowCopyPreviousWeek: true,
  payrollLockBehaviour: "Manual by HR" as const,
  requireHrOvertimeVerification: false,
  overtimePreauthorisationRequired: true,
  overtimeMaxDailyHours: 4,
  overtimeMaxWeeklyHours: 12,
  overtimeMaxMonthlyHours: 40,
  attendanceVarianceToleranceHours: 0.25,
};

function role(actor: AuditActorContext) {
  return actor.activeRole ?? actor.roles?.[0] ?? "Employee";
}

function dateRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const current = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (current <= end) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

function compatibleRecord(row: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  archivedAt: Date | null;
  recordVersion: number;
}) {
  return {
    id: row.id,
    databaseId: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archivedAt: row.archivedAt?.toISOString(),
    recordVersion: row.recordVersion,
  };
}

async function notify(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organisationId: string,
  recipientUserId: string | undefined,
  input: { title: string; message: string; key: string; entityId: string; path: string },
  actorUserId: string | undefined,
) {
  if (!recipientUserId) return;
  if (!actorUserId) throw new Error("A verified user is required.");
  await tx
    .insert(notifications)
    .values({
      organisationId,
      recipientUserId,
      type: "Approval",
      title: input.title,
      message: input.message,
      priority: "High",
      status: "Unread",
      deduplicationKey: input.key,
      link: { entityType: "timesheet", entityId: input.entityId, path: input.path },
      createdBy: actorUserId,
      updatedBy: actorUserId,
    } as typeof notifications.$inferInsert)
    .onConflictDoNothing();
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
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(
      and(eq(table.organisationId, organisationId), eq(table.id, id), eq(table.isActive, true)),
    )
    .limit(1);
  if (!row) throw new Error(`Select an active ${label}.`);
}

export async function saveTimesheetEntryInDatabase(
  organisationId: string,
  input: {
    timesheetId: string;
    workDate: string;
    projectId: string;
    costCentreId: string;
    activityCodeId: string;
    locationId: string;
    hours: number;
    notes?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24)
    throw new Error("Hours must be greater than zero and no more than 24.");
  const db = getDatabaseClient();
  const entryId = randomUUID();
  await db.transaction(async (tx) => {
    const [sheet] = await tx
      .select({
        id: timesheets.id,
        employeeId: timesheets.employeeId,
        periodId: timesheets.periodId,
        status: timesheets.status,
      })
      .from(timesheets)
      .where(
        and(eq(timesheets.organisationId, organisationId), eq(timesheets.id, input.timesheetId)),
      )
      .limit(1);
    if (!sheet || sheet.employeeId !== actor.employeeId)
      throw new Error("You can only edit your own timesheet.");
    if (!["Draft", "Returned"].includes(sheet.status))
      throw new Error("This timesheet is no longer editable.");
    const [period] = await tx
      .select()
      .from(timesheetPeriods)
      .where(eq(timesheetPeriods.id, sheet.periodId))
      .limit(1);
    if (
      !period ||
      period.status !== "Open" ||
      input.workDate < period.startDate ||
      input.workDate > period.endDate
    )
      throw new Error("The entry date is outside an open timesheet period.");
    await activeMaster(tx, projects, organisationId, input.projectId, "project");
    await activeMaster(tx, costCentres, organisationId, input.costCentreId, "cost centre");
    await activeMaster(tx, activityCodes, organisationId, input.activityCodeId, "activity code");
    await activeMaster(tx, locations, organisationId, input.locationId, "work location");
    await tx.insert(timesheetEntries).values({
      id: entryId,
      organisationId,
      timesheetId: input.timesheetId,
      workDate: input.workDate,
      projectId: input.projectId,
      costCentreId: input.costCentreId,
      activityCodeId: input.activityCodeId,
      locationId: input.locationId,
      hours: String(input.hours),
      notes: input.notes,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof timesheetEntries.$inferInsert);
    await tx
      .update(timesheets)
      .set({
        totalHours: sql`${timesheets.totalHours} + ${input.hours}`,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheets.recordVersion} + 1`,
      })
      .where(eq(timesheets.id, input.timesheetId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "create",
      module: "timesheets",
      entityType: "timesheet-entry",
      entityId: entryId,
      afterSummary: {
        timesheetId: input.timesheetId,
        workDate: input.workDate,
        hours: input.hours,
      },
      reason: "Added a timesheet entry",
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
  });
  return entryId;
}

export async function submitTimesheetInDatabase(
  organisationId: string,
  timesheetId: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM timesheets WHERE id = ${timesheetId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [sheet] = await tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.organisationId, organisationId), eq(timesheets.id, timesheetId)))
      .limit(1);
    if (!sheet || sheet.employeeId !== actor.employeeId)
      throw new Error("You can only submit your own timesheet.");
    const [period] = await tx
      .select({ status: timesheetPeriods.status })
      .from(timesheetPeriods)
      .where(eq(timesheetPeriods.id, sheet.periodId))
      .limit(1);
    if (!period || period.status !== "Open") throw new Error("This timesheet period is closed.");
    if (sheet.status !== "Draft" && sheet.status !== "Returned")
      throw new Error("This timesheet is not ready for submission.");
    const [employee] = await tx
      .select({
        lineManagerId: employees.lineManagerId,
        preferredName: employees.preferredName,
        employmentConfirmationStatus: employees.employmentConfirmationStatus,
      })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, sheet.employeeId)))
      .limit(1);
    if (!employee?.lineManagerId || employee.lineManagerId === employeeIdFromActor(actor))
      throw new Error(
        "An active supervisor must be assigned before this timesheet can be submitted.",
      );
    if (employee.employmentConfirmationStatus !== "Confirmed")
      throw new Error("HR must confirm your employment details before you can submit a timesheet.");
    const entryRows = await tx
      .select()
      .from(timesheetEntries)
      .where(eq(timesheetEntries.timesheetId, timesheetId));
    if (!entryRows.length) throw new Error("Add at least one time entry before submitting.");
    if (Number(sheet.totalHours) < Number(sheet.expectedHours))
      throw new Error(
        `Log the remaining ${Number(sheet.expectedHours) - Number(sheet.totalHours)} expected hours before submitting.`,
      );
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const tolerance = Number(
      settings?.attendanceVarianceToleranceHours ??
        DEFAULT_SETTINGS.attendanceVarianceToleranceHours,
    );
    const attendance = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          eq(attendanceRecords.employeeId, sheet.employeeId),
          sql`${attendanceRecords.date} BETWEEN ${(await tx.select().from(timesheetPeriods).where(eq(timesheetPeriods.id, sheet.periodId)).limit(1))[0]!.startDate} AND ${(await tx.select().from(timesheetPeriods).where(eq(timesheetPeriods.id, sheet.periodId)).limit(1))[0]!.endDate}`,
        ),
      );
    const workByDate = new Map<string, number>();
    for (const entry of entryRows)
      workByDate.set(entry.workDate, (workByDate.get(entry.workDate) ?? 0) + Number(entry.hours));
    const attendanceByDate = new Map(attendance.map((item) => [item.date, item]));
    const dates = new Set([...workByDate.keys(), ...attendanceByDate.keys()]);
    const explanations = (sheet.attendanceDiscrepancyExplanations ?? {}) as Record<string, string>;
    const days = [...dates].sort().map((date) => {
      const record = attendanceByDate.get(date);
      const attendanceHours = Number(record?.calculatedHours ?? 0);
      const timesheetWorkHours = workByDate.get(date) ?? 0;
      const varianceHours = Number((timesheetWorkHours - attendanceHours).toFixed(2));
      const requiresExplanation =
        !record?.clockInAt || !record?.clockOutAt || Math.abs(varianceHours) > tolerance;
      const explanation = explanations[date]?.trim();
      return {
        date,
        attendanceHours,
        timesheetWorkHours,
        leaveHours: 0,
        holidayHours: 0,
        varianceHours,
        attendanceStatus: record?.status ?? "No Record",
        status: !record
          ? "Missing Attendance"
          : Math.abs(varianceHours) > tolerance
            ? "Variance"
            : "Matched",
        requiresExplanation,
        ...(explanation ? { explanation } : {}),
        resolved: !requiresExplanation || Boolean(explanation && explanation.length >= 10),
      };
    });
    const unresolved = days.filter((item) => !item.resolved);
    if (unresolved.length)
      throw new Error(
        `Explain the attendance differences for ${unresolved.map((item) => item.date).join(", ")} before submitting.`,
      );
    const snapshot = {
      generatedAt: new Date().toISOString(),
      toleranceHours: tolerance,
      attendanceHours: Number(days.reduce((sum, item) => sum + item.attendanceHours, 0).toFixed(2)),
      timesheetWorkHours: Number(
        days.reduce((sum, item) => sum + item.timesheetWorkHours, 0).toFixed(2),
      ),
      varianceHours: Number(days.reduce((sum, item) => sum + item.varianceHours, 0).toFixed(2)),
      unresolvedCount: 0,
      days,
    };
    await tx
      .update(timesheets)
      .set({
        status: "Pending Manager",
        submittedAt: new Date().toISOString(),
        attendanceReconciliationSnapshot: snapshot,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheets.recordVersion} + 1`,
      })
      .where(eq(timesheets.id, timesheetId));
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
    await notify(
      tx,
      organisationId,
      managerUser?.id,
      {
        title: "Timesheet awaiting your review",
        message: `${employee.preferredName} submitted a timesheet for your review.`,
        key: `timesheet-manager-${timesheetId}-${sheet.recordVersion + 1}`,
        entityId: timesheetId,
        path: `/staff/timesheet-approvals/${timesheetId}`,
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
      action: "submit",
      module: "timesheets",
      entityType: "timesheet",
      entityId: timesheetId,
      afterSummary: { status: "Pending Manager" },
      reason: "Submitted timesheet for review",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
}

function employeeIdFromActor(actor: AuditActorContext) {
  return actor.employeeId;
}

export async function decideTimesheetInDatabase(
  organisationId: string,
  timesheetId: string,
  decision: "approve" | "return",
  notes: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM timesheets WHERE id = ${timesheetId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [sheet] = await tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.organisationId, organisationId), eq(timesheets.id, timesheetId)))
      .limit(1);
    if (!sheet) throw new Error("Timesheet not found.");
    const [employee] = await tx
      .select({ lineManagerId: employees.lineManagerId })
      .from(employees)
      .where(eq(employees.id, sheet.employeeId))
      .limit(1);
    const manager = sheet.status === "Pending Manager";
    const hr = sheet.status === "Pending HR";
    if (
      (manager &&
        (actor.activeRole !== "Line Manager" || actor.employeeId !== employee?.lineManagerId)) ||
      (hr && actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") ||
      (!manager && !hr)
    )
      throw new Error("You are not the assigned timesheet approver.");
    if (decision === "return" && !notes?.trim())
      throw new Error("Explain why the timesheet is being returned.");
    const reconciliation = await buildTimesheetReconciliation(tx, organisationId, sheet);
    if (decision === "approve" && reconciliation.unresolvedCount > 0)
      throw new Error(
        "This timesheet has unexplained attendance differences and must be returned.",
      );
    if (sheet.employeeId === actor.employeeId)
      throw new Error("You cannot approve your own timesheet.");
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const reconciliationDays = reconciliation.days as Array<{
      requiresExplanation?: boolean;
      status?: string;
    }>;
    const requiresHrReview =
      reconciliationDays.some((day) => day.requiresExplanation || day.status !== "Matched") ||
      Number(sheet.totalHours) > Number(sheet.expectedHours);
    const next =
      decision === "return"
        ? "Returned"
        : manager
          ? requiresHrReview
            ? "Pending HR"
            : settings?.payrollLockBehaviour === "Automatic on Approval"
              ? "Payroll Locked"
              : "Approved"
          : settings?.payrollLockBehaviour === "Automatic on Approval"
            ? "Payroll Locked"
            : "Approved";
    await tx
      .update(timesheets)
      .set({
        status: next,
        managerNotes: notes?.trim(),
        attendanceReconciliationSnapshot: reconciliation,
        ...(manager
          ? { supervisorReviewedAt: new Date().toISOString(), supervisorReviewedBy: actor.userId }
          : {}),
        ...(next === "Approved" || next === "Payroll Locked"
          ? { approvedAt: new Date().toISOString(), approvedBy: actor.userId }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheets.recordVersion} + 1`,
      })
      .where(eq(timesheets.id, timesheetId));
    const [employeeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.employeeId, sheet.employeeId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
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
      for (const hrUser of hrUsers)
        await notify(
          tx,
          organisationId,
          hrUser.id,
          {
            title: "Timesheet exception awaiting HR review",
            message:
              "A supervisor-approved timesheet contains an attendance or hours exception requiring HR review.",
            key: `timesheet-hr-${timesheetId}-${sheet.recordVersion + 1}`,
            entityId: timesheetId,
            path: `/staff/timesheet-approvals/${timesheetId}`,
          },
          actor.userId,
        );
    } else {
      await notify(
        tx,
        organisationId,
        employeeUser?.id,
        {
          title: decision === "return" ? "Timesheet returned" : "Timesheet approved",
          message:
            decision === "return"
              ? `Your timesheet was returned: ${notes?.trim()}`
              : "Your timesheet has completed approval.",
          key: `timesheet-employee-${timesheetId}-${sheet.recordVersion + 1}-${next}`,
          entityId: timesheetId,
          path: `/staff/me/timesheets`,
        },
        actor.userId,
      );
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: decision,
      module: "timesheets",
      entityType: "timesheet",
      entityId: timesheetId,
      afterSummary: {
        status: next,
        hrExceptionReviewRequired: manager && requiresHrReview,
      },
      reason: notes?.trim() ?? `Timesheet ${decision}d`,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function listTimesheetSnapshotForActor(
  organisationId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  const activeRole = role(actor);
  let employeeIds: string[] | undefined;
  if (activeRole === "Employee") {
    if (!actor.employeeId) throw new Error("A verified employee is required.");
    employeeIds = [actor.employeeId];
  } else if (activeRole === "Line Manager") {
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
  } else if (!["HR", "Accounts", "Super Admin"].includes(activeRole)) {
    throw new Error("You are not authorised to view timesheets.");
  }

  const [settingsRow] = await db
    .select()
    .from(timesheetSettings)
    .where(eq(timesheetSettings.organisationId, organisationId))
    .limit(1);
  const periodRows = await db
    .select()
    .from(timesheetPeriods)
    .where(eq(timesheetPeriods.organisationId, organisationId))
    .orderBy(desc(timesheetPeriods.startDate));
  const sheetRows =
    employeeIds && employeeIds.length === 0
      ? []
      : await db
          .select()
          .from(timesheets)
          .where(
            employeeIds
              ? and(
                  eq(timesheets.organisationId, organisationId),
                  inArray(timesheets.employeeId, employeeIds),
                  sql`${timesheets.archivedAt} IS NULL`,
                )
              : and(
                  eq(timesheets.organisationId, organisationId),
                  sql`${timesheets.archivedAt} IS NULL`,
                ),
          )
          .orderBy(desc(timesheets.createdAt));
  const sheetIds = sheetRows.map((item) => item.id);
  const entryRows = sheetIds.length
    ? await db
        .select()
        .from(timesheetEntries)
        .where(
          and(
            eq(timesheetEntries.organisationId, organisationId),
            inArray(timesheetEntries.timesheetId, sheetIds),
          ),
        )
        .orderBy(asc(timesheetEntries.workDate), asc(timesheetEntries.createdAt))
    : [];

  const entriesBySheet = new Map<string, typeof entryRows>();
  for (const entry of entryRows) {
    const list = entriesBySheet.get(entry.timesheetId) ?? [];
    list.push(entry);
    entriesBySheet.set(entry.timesheetId, list);
  }
  return {
    settings: settingsRow
      ? {
          weeklyPeriodStartDay: settingsRow.weeklyPeriodStartDay,
          standardDailyHours: Number(settingsRow.standardDailyHours),
          submissionDeadlineDays: settingsRow.submissionDeadlineDays,
          overtimeThresholdWeekly: Number(settingsRow.overtimeThresholdWeekly),
          allowCopyPreviousWeek: settingsRow.allowCopyPreviousWeek,
          payrollLockBehaviour: settingsRow.payrollLockBehaviour as
            "Manual by HR" | "Automatic on Approval",
          requireHrOvertimeVerification: settingsRow.requireHrOvertimeVerification,
          overtimePreauthorisationRequired: settingsRow.overtimePreauthorisationRequired,
          overtimeMaxDailyHours: Number(settingsRow.overtimeMaxDailyHours),
          overtimeMaxWeeklyHours: Number(settingsRow.overtimeMaxWeeklyHours),
          overtimeMaxMonthlyHours: Number(settingsRow.overtimeMaxMonthlyHours),
          attendanceVarianceToleranceHours: Number(settingsRow.attendanceVarianceToleranceHours),
        }
      : DEFAULT_SETTINGS,
    periods: periodRows.map((item) => ({
      ...compatibleRecord(item),
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
    })),
    timesheets: sheetRows.map((item) => ({
      ...compatibleRecord(item),
      employeeId: item.employeeId,
      periodId: item.periodId,
      status: item.status,
      expectedHours: Number(item.expectedHours),
      totalHours: Number(item.totalHours),
      ...(item.submittedAt ? { submittedAt: item.submittedAt } : {}),
      ...(item.approvedAt ? { approvedAt: item.approvedAt } : {}),
      ...(item.approvedBy ? { approvedBy: item.approvedBy } : {}),
      ...(item.supervisorReviewedAt ? { supervisorReviewedAt: item.supervisorReviewedAt } : {}),
      ...(item.supervisorReviewedBy ? { supervisorReviewedBy: item.supervisorReviewedBy } : {}),
      ...(item.managerNotes ? { managerNotes: item.managerNotes } : {}),
      ...(item.attendanceDiscrepancyExplanations
        ? { attendanceDiscrepancyExplanations: item.attendanceDiscrepancyExplanations }
        : {}),
      ...(item.attendanceReconciliationSnapshot
        ? { attendanceReconciliationSnapshot: item.attendanceReconciliationSnapshot }
        : {}),
      ...(item.payrollPeriodId ? { payrollPeriodId: item.payrollPeriodId } : {}),
      ...(item.originalTimesheetId ? { originalTimesheetId: item.originalTimesheetId } : {}),
      entries: (Array.isArray(item.draftPayload)
        ? (
            item.draftPayload as Array<{
              id: string;
              projectId?: string;
              costCentreId?: string;
              activityCodeId?: string;
              locationId?: string;
              hours: Record<string, number>;
              notes?: string;
            }>
          ).map((entry) => ({
            ...entry,
            projectId: entry.projectId ?? "",
            costCentreId: entry.costCentreId ?? "",
            activityCodeId: entry.activityCodeId ?? "",
            locationCodeId: entry.locationId ?? "",
            total: Object.values(entry.hours).reduce((sum, hours) => sum + Number(hours), 0),
          }))
        : (entriesBySheet.get(item.id) ?? []).map((entry) => ({
            id: entry.id,
            databaseId: entry.id,
            projectId: entry.projectId,
            costCentreId: entry.costCentreId,
            activityCodeId: entry.activityCodeId,
            locationCodeId: entry.locationId,
            hours: { [entry.workDate]: Number(entry.hours) },
            total: Number(entry.hours),
            ...(entry.notes ? { notes: entry.notes } : {}),
            isLeave: entry.isLeave,
            isHoliday: entry.isHoliday,
          }))
      ).map((entry) => entry),
    })),
  };
}

export async function updateTimesheetSettingsInDatabase(
  organisationId: string,
  settings: {
    weeklyPeriodStartDay: number;
    standardDailyHours: number;
    submissionDeadlineDays: number;
    overtimeThresholdWeekly: number;
    allowCopyPreviousWeek: boolean;
    payrollLockBehaviour: "Manual by HR" | "Automatic on Approval";
    requireHrOvertimeVerification: boolean;
    overtimePreauthorisationRequired?: boolean;
    overtimeMaxDailyHours?: number;
    overtimeMaxWeeklyHours?: number;
    overtimeMaxMonthlyHours?: number;
    attendanceVarianceToleranceHours: number;
  },
  actor: AuditActorContext,
): Promise<void> {
  if (!["HR", "Super Admin"].includes(role(actor)))
    throw new Error("Only HR or Super Admin can change timesheet settings.");
  if (
    !Number.isInteger(settings.weeklyPeriodStartDay) ||
    settings.weeklyPeriodStartDay < 0 ||
    settings.weeklyPeriodStartDay > 6
  )
    throw new Error("Select a valid weekly period start day.");
  if (
    !Number.isInteger(settings.submissionDeadlineDays) ||
    settings.submissionDeadlineDays < 0 ||
    settings.submissionDeadlineDays > 30
  )
    throw new Error("Submission deadline must be between 0 and 30 days.");
  if (!(settings.standardDailyHours > 0 && settings.standardDailyHours <= 24))
    throw new Error("Standard daily hours must be greater than zero and no more than 24.");
  if (!(settings.overtimeThresholdWeekly > 0 && settings.overtimeThresholdWeekly <= 168))
    throw new Error("Overtime threshold must be greater than zero and no more than 168 hours.");
  const overtimePreauthorisationRequired = settings.overtimePreauthorisationRequired ?? true;
  const overtimeMaxDailyHours = settings.overtimeMaxDailyHours ?? 4;
  const overtimeMaxWeeklyHours = settings.overtimeMaxWeeklyHours ?? 12;
  const overtimeMaxMonthlyHours = settings.overtimeMaxMonthlyHours ?? 40;
  if (
    overtimeMaxDailyHours <= 0 ||
    overtimeMaxDailyHours > 24 ||
    overtimeMaxWeeklyHours < overtimeMaxDailyHours ||
    overtimeMaxMonthlyHours < overtimeMaxWeeklyHours
  )
    throw new Error("Enter valid daily, weekly and monthly overtime limits.");
  if (!(
    settings.attendanceVarianceToleranceHours >= 0 && settings.attendanceVarianceToleranceHours <= 2
  ))
    throw new Error("Attendance tolerance must be between 0 and 2 hours.");
  if (!["Manual by HR", "Automatic on Approval"].includes(settings.payrollLockBehaviour))
    throw new Error("Select a valid payroll lock option.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    if (before) {
      await tx
        .update(timesheetSettings)
        .set({
          ...settings,
          standardDailyHours: String(settings.standardDailyHours),
          overtimeThresholdWeekly: String(settings.overtimeThresholdWeekly),
          overtimePreauthorisationRequired,
          overtimeMaxDailyHours: String(overtimeMaxDailyHours),
          overtimeMaxWeeklyHours: String(overtimeMaxWeeklyHours),
          overtimeMaxMonthlyHours: String(overtimeMaxMonthlyHours),
          attendanceVarianceToleranceHours: String(settings.attendanceVarianceToleranceHours),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${timesheetSettings.recordVersion} + 1`,
        })
        .where(eq(timesheetSettings.id, before.id));
    } else {
      await tx.insert(timesheetSettings).values({
        id: randomUUID(),
        organisationId,
        ...settings,
        standardDailyHours: String(settings.standardDailyHours),
        overtimeThresholdWeekly: String(settings.overtimeThresholdWeekly),
        overtimePreauthorisationRequired,
        overtimeMaxDailyHours: String(overtimeMaxDailyHours),
        overtimeMaxWeeklyHours: String(overtimeMaxWeeklyHours),
        overtimeMaxMonthlyHours: String(overtimeMaxMonthlyHours),
        attendanceVarianceToleranceHours: String(settings.attendanceVarianceToleranceHours),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof timesheetSettings.$inferInsert);
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: role(actor),
      actorRoles: actor.roles ?? [],
      action: "update",
      module: "timesheets",
      entityType: "timesheet-settings",
      entityId: before?.id ?? organisationId,
      beforeSummary: before ? { recordVersion: before.recordVersion } : undefined,
      afterSummary: {
        ...settings,
        overtimePreauthorisationRequired,
        overtimeMaxDailyHours,
        overtimeMaxWeeklyHours,
        overtimeMaxMonthlyHours,
      },
      reason: "Timesheet settings updated",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function generateTimesheetPeriodsInDatabase(
  organisationId: string,
  startDate: string,
  endDate: string,
  actor: AuditActorContext,
): Promise<number> {
  if (!["HR", "Super Admin"].includes(role(actor)))
    throw new Error("Only HR or Super Admin can generate timesheet periods.");
  if (endDate < startDate) throw new Error("End date must be on or after start date.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const weekStart = settings?.weeklyPeriodStartDay ?? DEFAULT_SETTINGS.weeklyPeriodStartDay;
    const start = new Date(`${startDate}T12:00:00Z`);
    const offset = (start.getUTCDay() - weekStart + 7) % 7;
    start.setUTCDate(start.getUTCDate() - offset);
    const end = new Date(`${endDate}T12:00:00Z`);
    let count = 0;
    while (start <= end) {
      const periodStart = start.toISOString().slice(0, 10);
      const periodEndDate = new Date(start);
      periodEndDate.setUTCDate(periodEndDate.getUTCDate() + 6);
      const periodEnd = periodEndDate.toISOString().slice(0, 10);
      const inserted = await tx
        .insert(timesheetPeriods)
        .values({
          id: randomUUID(),
          organisationId,
          startDate: periodStart,
          endDate: periodEnd,
          status: "Open",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof timesheetPeriods.$inferInsert)
        .onConflictDoNothing()
        .returning({ id: timesheetPeriods.id });
      count += inserted.length;
      start.setUTCDate(start.getUTCDate() + 7);
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: role(actor),
      actorRoles: actor.roles ?? [],
      action: "generate",
      module: "timesheets",
      entityType: "timesheet-period",
      entityId: organisationId,
      afterSummary: { startDate, endDate, generated: count },
      reason: "Timesheet periods generated",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
    return count;
  });
}

async function expectedHoursForPeriod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organisationId: string,
  employeeId: string,
  period: { startDate: string; endDate: string },
  dailyHours: number,
) {
  const [orgSettings] = await tx
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  const [employee] = await tx
    .select({ locationId: employees.locationId })
    .from(employees)
    .where(and(eq(employees.organisationId, organisationId), eq(employees.id, employeeId)))
    .limit(1);
  if (!employee) throw new Error("Employee not found.");
  const holidays = await tx
    .select({ date: publicHolidays.holidayDate })
    .from(publicHolidays)
    .where(
      and(
        eq(publicHolidays.organisationId, organisationId),
        eq(publicHolidays.isActive, true),
        sql`${publicHolidays.holidayDate} BETWEEN ${period.startDate} AND ${period.endDate}`,
        or(
          sql`${publicHolidays.locationId} IS NULL`,
          eq(publicHolidays.locationId, employee.locationId),
        ),
      ),
    );
  const leave = await tx
    .select({
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      isHalfDay: leaveRequests.isHalfDay,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.organisationId, organisationId),
        eq(leaveRequests.employeeId, employeeId),
        sql`${leaveRequests.status} IN ('Approved','Taken')`,
        sql`${leaveRequests.startDate} <= ${period.endDate} AND ${leaveRequests.endDate} >= ${period.startDate}`,
      ),
    );
  const holidaySet = new Set(holidays.map((item: { date: string }) => item.date));
  const workingDays = orgSettings?.workingDays ?? [1, 2, 3, 4, 5];
  let hours = 0;
  for (const date of dateRange(period.startDate, period.endDate)) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!workingDays.includes(day) || holidaySet.has(date)) continue;
    const absence = leave.find(
      (item: { startDate: string; endDate: string; isHalfDay: boolean }) =>
        item.startDate <= date && item.endDate >= date,
    );
    hours += absence ? (absence.isHalfDay ? dailyHours / 2 : 0) : dailyHours;
  }
  return hours;
}

async function buildTimesheetReconciliation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organisationId: string,
  sheet: typeof timesheets.$inferSelect,
) {
  const [period] = await tx
    .select()
    .from(timesheetPeriods)
    .where(eq(timesheetPeriods.id, sheet.periodId))
    .limit(1);
  if (!period) throw new Error("Timesheet period not found.");
  const [settings] = await tx
    .select()
    .from(timesheetSettings)
    .where(eq(timesheetSettings.organisationId, organisationId))
    .limit(1);
  const toleranceHours = Number(
    settings?.attendanceVarianceToleranceHours ?? DEFAULT_SETTINGS.attendanceVarianceToleranceHours,
  );
  const entries = (await tx
    .select()
    .from(timesheetEntries)
    .where(eq(timesheetEntries.timesheetId, sheet.id))) as Array<
    typeof timesheetEntries.$inferSelect
  >;
  const records = (await tx
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.organisationId, organisationId),
        eq(attendanceRecords.employeeId, sheet.employeeId),
        sql`${attendanceRecords.date} BETWEEN ${period.startDate} AND ${period.endDate}`,
      ),
    )) as Array<typeof attendanceRecords.$inferSelect>;
  const workByDate = new Map<string, number>();
  for (const entry of entries)
    workByDate.set(entry.workDate, (workByDate.get(entry.workDate) ?? 0) + Number(entry.hours));
  const recordByDate = new Map(records.map((item) => [item.date, item]));
  const explanations = (sheet.attendanceDiscrepancyExplanations ?? {}) as Record<string, string>;
  const days = [...new Set([...workByDate.keys(), ...recordByDate.keys()])].sort().map((date) => {
    const record = recordByDate.get(date);
    const attendanceHours = Number(record?.calculatedHours ?? 0);
    const timesheetWorkHours = workByDate.get(date) ?? 0;
    const varianceHours = Number((timesheetWorkHours - attendanceHours).toFixed(2));
    const incomplete = Boolean(record && (!record.clockInAt || !record.clockOutAt));
    const requiresExplanation = !record || incomplete || Math.abs(varianceHours) > toleranceHours;
    const explanation = explanations[date]?.trim();
    const status = !record
      ? "Missing Attendance"
      : incomplete
        ? "Incomplete Attendance"
        : Math.abs(varianceHours) > toleranceHours
          ? "Variance"
          : "Matched";
    return {
      date,
      attendanceHours,
      timesheetWorkHours,
      leaveHours: 0,
      holidayHours: 0,
      varianceHours,
      attendanceStatus: record?.status ?? "No Record",
      status,
      requiresExplanation,
      ...(explanation ? { explanation } : {}),
      resolved: !requiresExplanation || Boolean(explanation && explanation.length >= 10),
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    toleranceHours,
    attendanceHours: Number(days.reduce((sum, item) => sum + item.attendanceHours, 0).toFixed(2)),
    timesheetWorkHours: Number(
      days.reduce((sum, item) => sum + item.timesheetWorkHours, 0).toFixed(2),
    ),
    varianceHours: Number(days.reduce((sum, item) => sum + item.varianceHours, 0).toFixed(2)),
    unresolvedCount: days.filter((item) => !item.resolved).length,
    days,
  };
}

export async function getOrCreateTimesheetInDatabase(
  organisationId: string,
  employeeId: string,
  periodId: string,
  actor: AuditActorContext,
): Promise<string> {
  if (actor.employeeId !== employeeId && role(actor) !== "Super Admin")
    throw new Error("You can only start your own timesheet.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: timesheets.id })
      .from(timesheets)
      .where(
        and(
          eq(timesheets.organisationId, organisationId),
          eq(timesheets.employeeId, employeeId),
          eq(timesheets.periodId, periodId),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
    const [period] = await tx
      .select()
      .from(timesheetPeriods)
      .where(
        and(eq(timesheetPeriods.organisationId, organisationId), eq(timesheetPeriods.id, periodId)),
      )
      .limit(1);
    if (!period || period.status !== "Open") throw new Error("This timesheet period is not open.");
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const expectedHours = await expectedHoursForPeriod(
      tx,
      organisationId,
      employeeId,
      period,
      Number(settings?.standardDailyHours ?? DEFAULT_SETTINGS.standardDailyHours),
    );
    const id = randomUUID();
    await tx.insert(timesheets).values({
      id,
      organisationId,
      employeeId,
      periodId,
      status: "Draft",
      expectedHours: String(expectedHours),
      totalHours: "0",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof timesheets.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: role(actor),
      actorRoles: actor.roles ?? [],
      action: "create",
      module: "timesheets",
      entityType: "timesheet",
      entityId: id,
      afterSummary: { periodId, expectedHours },
      reason: "Timesheet started",
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
    return id;
  });
}

export type TimesheetDraftEntryInput = {
  id: string;
  projectId?: string;
  costCentreId?: string;
  activityCodeId?: string;
  locationId?: string;
  hours: Record<string, number>;
  notes?: string;
};

export async function saveTimesheetDraftInDatabase(
  organisationId: string,
  timesheetId: string,
  entries: TimesheetDraftEntryInput[],
  explanations: Record<string, string>,
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM timesheets WHERE id = ${timesheetId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [sheet] = await tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.organisationId, organisationId), eq(timesheets.id, timesheetId)))
      .limit(1);
    if (!sheet || sheet.employeeId !== actor.employeeId)
      throw new Error("You can only edit your own timesheet.");
    if (!["Draft", "Returned"].includes(sheet.status))
      throw new Error("This timesheet is no longer editable.");
    const [period] = await tx
      .select()
      .from(timesheetPeriods)
      .where(eq(timesheetPeriods.id, sheet.periodId))
      .limit(1);
    if (!period || period.status !== "Open") throw new Error("This timesheet period is closed.");
    const dailyTotals = new Map<string, number>();
    const normalized: Array<{
      projectId: string;
      costCentreId: string;
      activityCodeId: string;
      locationId: string;
      workDate: string;
      hours: number;
      notes: string;
    }> = [];
    for (const entry of entries) {
      for (const [workDate, hours] of Object.entries(entry.hours)) {
        if (!Number.isFinite(hours) || hours < 0 || hours > 24)
          throw new Error("Hours must be between 0 and 24.");
        if (workDate < period.startDate || workDate > period.endDate)
          throw new Error(`${workDate} is outside this timesheet period.`);
        if (hours === 0) continue;
        if (!entry.projectId || !entry.costCentreId || !entry.activityCodeId || !entry.locationId)
          throw new Error(
            "Select a project, cost centre, activity and work location for entered hours.",
          );
        if (!entry.notes?.trim() || entry.notes.trim().length < 3)
          throw new Error("Describe the work completed for every row containing hours.");
        await activeMaster(tx, projects, organisationId, entry.projectId, "project");
        await activeMaster(tx, costCentres, organisationId, entry.costCentreId, "cost centre");
        await activeMaster(
          tx,
          activityCodes,
          organisationId,
          entry.activityCodeId,
          "activity code",
        );
        await activeMaster(tx, locations, organisationId, entry.locationId, "work location");
        dailyTotals.set(workDate, (dailyTotals.get(workDate) ?? 0) + hours);
        normalized.push({
          projectId: entry.projectId,
          costCentreId: entry.costCentreId,
          activityCodeId: entry.activityCodeId,
          locationId: entry.locationId,
          workDate,
          hours,
          notes: entry.notes.trim(),
        });
      }
    }
    for (const [date, hours] of dailyTotals)
      if (hours > 24) throw new Error(`Total hours on ${date} exceed 24.`);
    await tx.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, timesheetId));
    if (normalized.length)
      await tx.insert(timesheetEntries).values(
        normalized.map((entry) => ({
          id: randomUUID(),
          organisationId,
          timesheetId,
          workDate: entry.workDate,
          projectId: entry.projectId,
          costCentreId: entry.costCentreId,
          activityCodeId: entry.activityCodeId,
          locationId: entry.locationId,
          hours: String(entry.hours),
          notes: entry.notes,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })) as Array<typeof timesheetEntries.$inferInsert>,
      );
    const total = normalized.reduce((sum, item) => sum + item.hours, 0);
    await tx
      .update(timesheets)
      .set({
        totalHours: String(total),
        draftPayload: entries,
        attendanceDiscrepancyExplanations: explanations,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheets.recordVersion} + 1`,
      })
      .where(eq(timesheets.id, timesheetId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: role(actor),
      actorRoles: actor.roles ?? [],
      action: "update",
      module: "timesheets",
      entityType: "timesheet",
      entityId: timesheetId,
      afterSummary: { totalHours: total, entryCount: entries.length },
      reason: "Timesheet draft saved",
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function setTimesheetPeriodStatusInDatabase(
  organisationId: string,
  periodId: string,
  status: "Open" | "Closed",
  reasonText: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  if (!["HR", "Super Admin"].includes(role(actor)))
    throw new Error("Only HR or Super Admin can manage timesheet periods.");
  if (status === "Open" && (!reasonText || reasonText.trim().length < 5))
    throw new Error("Enter a clear reason for reopening this period.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM timesheet_periods WHERE id = ${periodId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [period] = await tx
      .select()
      .from(timesheetPeriods)
      .where(
        and(eq(timesheetPeriods.organisationId, organisationId), eq(timesheetPeriods.id, periodId)),
      )
      .limit(1);
    if (!period) throw new Error("Timesheet period not found.");
    if (period.status === status) return;
    if (status === "Closed") {
      const unfinished = await tx
        .select({ id: timesheets.id })
        .from(timesheets)
        .where(
          and(
            eq(timesheets.organisationId, organisationId),
            eq(timesheets.periodId, periodId),
            sql`${timesheets.archivedAt} IS NULL`,
            sql`${timesheets.status} NOT IN ('Approved','Payroll Locked','Corrected')`,
          ),
        );
      const activeStaff = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            inArray(employees.status, ["Active", "Probation", "Notice"]),
          ),
        );
      const completed = await tx
        .select({ employeeId: timesheets.employeeId })
        .from(timesheets)
        .where(
          and(
            eq(timesheets.organisationId, organisationId),
            eq(timesheets.periodId, periodId),
            sql`${timesheets.archivedAt} IS NULL`,
            inArray(timesheets.status, ["Approved", "Payroll Locked", "Corrected"]),
          ),
        );
      const completedEmployees = new Set(
        completed.map((item: { employeeId: string }) => item.employeeId),
      );
      const notStarted = activeStaff.filter(
        (item: { id: string }) => !completedEmployees.has(item.id),
      ).length;
      if (unfinished.length || notStarted)
        throw new Error(
          `Resolve ${Math.max(unfinished.length, notStarted)} unfinished or missing timesheet${Math.max(unfinished.length, notStarted) === 1 ? "" : "s"} before closing this period.`,
        );
    }
    await tx
      .update(timesheetPeriods)
      .set({
        status,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheetPeriods.recordVersion} + 1`,
      })
      .where(eq(timesheetPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: role(actor),
      actorRoles: actor.roles ?? [],
      action: status === "Closed" ? "close" : "reopen",
      module: "timesheets",
      entityType: "timesheet-period",
      entityId: periodId,
      beforeSummary: { status: period.status },
      afterSummary: { status },
      reason: reasonText?.trim() ?? "Timesheet period closed",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function lockTimesheetForPayrollInDatabase(
  organisationId: string,
  timesheetId: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!["HR", "Super Admin"].includes(role(actor)))
    throw new Error("Only HR or Super Admin can lock an approved timesheet for payroll.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM timesheets WHERE id = ${timesheetId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [sheet] = await tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.organisationId, organisationId), eq(timesheets.id, timesheetId)))
      .limit(1);
    if (!sheet || sheet.status !== "Approved")
      throw new Error("Only an approved timesheet can be locked for payroll.");
    await tx
      .update(timesheets)
      .set({
        status: "Payroll Locked",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheets.recordVersion} + 1`,
      })
      .where(eq(timesheets.id, timesheetId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: role(actor),
      actorRoles: actor.roles ?? [],
      action: "lock",
      module: "timesheets",
      entityType: "timesheet",
      entityId: timesheetId,
      beforeSummary: { status: sheet.status },
      afterSummary: { status: "Payroll Locked" },
      reason: "Timesheet locked for payroll",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function reopenTimesheetInDatabase(
  organisationId: string,
  timesheetId: string,
  reasonText: string,
  actor: AuditActorContext,
): Promise<string> {
  if (reasonText.trim().length < 5)
    throw new Error("Enter a clear reason for reopening this timesheet.");
  const activeRole = role(actor);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM timesheets WHERE id = ${timesheetId} AND organisation_id = ${organisationId} FOR UPDATE`,
    );
    const [sheet] = await tx
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.organisationId, organisationId), eq(timesheets.id, timesheetId)))
      .limit(1);
    if (!sheet) throw new Error("Timesheet not found.");
    if (sheet.employeeId === actor.employeeId)
      throw new Error("You cannot reopen your own timesheet.");
    if (sheet.status === "Approved") {
      if (!["HR", "Super Admin"].includes(activeRole))
        throw new Error("Only HR or Super Admin can reopen an approved timesheet.");
      const [period] = await tx
        .select({ status: timesheetPeriods.status })
        .from(timesheetPeriods)
        .where(eq(timesheetPeriods.id, sheet.periodId))
        .limit(1);
      if (period?.status !== "Open")
        throw new Error(
          "Reopen the timesheet period before returning this timesheet for correction.",
        );
      await tx
        .update(timesheets)
        .set({
          status: "Returned",
          managerNotes: reasonText.trim(),
          approvedAt: null,
          approvedBy: null,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${timesheets.recordVersion} + 1`,
        })
        .where(eq(timesheets.id, timesheetId));
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole,
        actorRoles: actor.roles ?? [],
        action: "reopen",
        module: "timesheets",
        entityType: "timesheet",
        entityId: timesheetId,
        beforeSummary: { status: "Approved" },
        afterSummary: { status: "Returned" },
        reason: reasonText.trim(),
        riskLevel: "Critical",
      } as typeof auditEvents.$inferInsert);
      return timesheetId;
    }
    if (sheet.status !== "Payroll Locked")
      throw new Error("Only approved or payroll-locked timesheets can be reopened.");
    if (!["Accounts", "Super Admin"].includes(activeRole))
      throw new Error("Only Accounts or Super Admin can correct a payroll-locked timesheet.");
    const newId = randomUUID();
    await tx
      .update(timesheets)
      .set({
        status: "Corrected",
        archivedAt: new Date(),
        managerNotes: reasonText.trim(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${timesheets.recordVersion} + 1`,
      })
      .where(eq(timesheets.id, timesheetId));
    await tx.insert(timesheets).values({
      id: newId,
      organisationId,
      employeeId: sheet.employeeId,
      periodId: sheet.periodId,
      status: "Returned",
      expectedHours: sheet.expectedHours,
      totalHours: sheet.totalHours,
      managerNotes: `Correction required: ${reasonText.trim()}`,
      attendanceDiscrepancyExplanations: sheet.attendanceDiscrepancyExplanations,
      attendanceReconciliationSnapshot: sheet.attendanceReconciliationSnapshot,
      originalTimesheetId: sheet.id,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof timesheets.$inferInsert);
    const entries = await tx
      .select()
      .from(timesheetEntries)
      .where(eq(timesheetEntries.timesheetId, timesheetId));
    if (entries.length)
      await tx.insert(timesheetEntries).values(
        entries.map((entry) => ({
          id: randomUUID(),
          organisationId,
          timesheetId: newId,
          workDate: entry.workDate,
          projectId: entry.projectId,
          costCentreId: entry.costCentreId,
          activityCodeId: entry.activityCodeId,
          locationId: entry.locationId,
          hours: entry.hours,
          notes: entry.notes,
          isLeave: entry.isLeave,
          isHoliday: entry.isHoliday,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })) as Array<typeof timesheetEntries.$inferInsert>,
      );
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole,
      actorRoles: actor.roles ?? [],
      action: "correct",
      module: "timesheets",
      entityType: "timesheet",
      entityId: timesheetId,
      beforeSummary: { status: "Payroll Locked" },
      afterSummary: { status: "Corrected", correctionTimesheetId: newId },
      reason: reasonText.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
    const [employeeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.employeeId, sheet.employeeId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    await notify(
      tx,
      organisationId,
      employeeUser?.id,
      {
        title: "Timesheet correction required",
        message: "A payroll-locked timesheet has been reopened for correction.",
        key: `timesheet-correction-${newId}`,
        entityId: newId,
        path: `/staff/me/timesheets`,
      },
      actor.userId,
    );
    return newId;
  });
}

/** Durable, idempotent reminder and attendance-reconciliation pass for the worker process. */
export async function processTimesheetWorker(at = new Date()) {
  const db = getDatabaseClient();
  const organisationsWithSettings = await db
    .select({ organisationId: timesheetSettings.organisationId })
    .from(timesheetSettings);
  let reminders = 0;
  let reconciled = 0;
  for (const organisation of organisationsWithSettings) {
    await db.transaction(async (tx) => {
      const [settings] = await tx
        .select()
        .from(timesheetSettings)
        .where(eq(timesheetSettings.organisationId, organisation.organisationId))
        .limit(1);
      if (!settings) return;
      const openPeriods = await tx
        .select()
        .from(timesheetPeriods)
        .where(
          and(
            eq(timesheetPeriods.organisationId, organisation.organisationId),
            eq(timesheetPeriods.status, "Open"),
          ),
        );
      const activeEmployees = await tx
        .select({
          id: employees.id,
          preferredName: employees.preferredName,
          lineManagerId: employees.lineManagerId,
        })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisation.organisationId),
            inArray(employees.status, ["Active", "Probation", "Notice"]),
          ),
        );
      const orgUsers = await tx
        .select({ id: users.id, employeeId: users.employeeId })
        .from(users)
        .where(
          and(eq(users.organisationId, organisation.organisationId), eq(users.status, "Active")),
        );
      const userByEmployee = new Map(orgUsers.map((item) => [item.employeeId, item.id]));
      const today = new Date(`${at.toISOString().slice(0, 10)}T12:00:00Z`);
      for (const period of openPeriods) {
        const deadline = new Date(`${period.endDate}T12:00:00Z`);
        deadline.setUTCDate(deadline.getUTCDate() + settings.submissionDeadlineDays);
        const daysUntil = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
        if (daysUntil > 2 || daysUntil < -30) continue;
        const periodSheets = await tx
          .select({ employeeId: timesheets.employeeId, status: timesheets.status })
          .from(timesheets)
          .where(
            and(
              eq(timesheets.organisationId, organisation.organisationId),
              eq(timesheets.periodId, period.id),
              sql`${timesheets.archivedAt} IS NULL`,
            ),
          );
        const sheetByEmployee = new Map(periodSheets.map((item) => [item.employeeId, item.status]));
        const stages = [
          ...(daysUntil <= 2
            ? [{ key: "soon", title: "Timesheet due soon", priority: "Normal" as const }]
            : []),
          ...(daysUntil <= 0
            ? [{ key: "due", title: "Timesheet due today", priority: "High" as const }]
            : []),
          ...(daysUntil < 0
            ? [{ key: "overdue", title: "Timesheet overdue", priority: "High" as const }]
            : []),
        ];
        for (const employee of activeEmployees) {
          const status = sheetByEmployee.get(employee.id);
          if (status && !["Draft", "Returned"].includes(status)) continue;
          const recipientUserId = userByEmployee.get(employee.id);
          for (const stage of stages) {
            const inserted = recipientUserId
              ? await tx
                  .insert(notifications)
                  .values({
                    organisationId: organisation.organisationId,
                    recipientUserId,
                    type: stage.key === "overdue" ? "Warning" : "Info",
                    title: stage.title,
                    message: `Complete your timesheet for ${period.startDate} to ${period.endDate}.`,
                    priority: stage.priority,
                    status: "Unread",
                    deduplicationKey: `timesheet-${period.id}-${employee.id}-${stage.key}`,
                    link: {
                      entityType: "timesheet-period",
                      entityId: period.id,
                      path: "/staff/me/timesheets",
                    },
                    createdBy: recipientUserId,
                    updatedBy: recipientUserId,
                  } as typeof notifications.$inferInsert)
                  .onConflictDoNothing()
                  .returning({ id: notifications.id })
              : [];
            reminders += inserted.length;
          }
          if (daysUntil < 0 && employee.lineManagerId) {
            const managerUserId = userByEmployee.get(employee.lineManagerId);
            const inserted = managerUserId
              ? await tx
                  .insert(notifications)
                  .values({
                    organisationId: organisation.organisationId,
                    recipientUserId: managerUserId,
                    type: "Approval",
                    title: "Direct-report timesheet overdue",
                    message: `${employee.preferredName} has not submitted the timesheet for ${period.startDate} to ${period.endDate}.`,
                    priority: "High",
                    status: "Unread",
                    deduplicationKey: `timesheet-overdue-manager-${period.id}-${employee.id}`,
                    link: {
                      entityType: "timesheet-period",
                      entityId: period.id,
                      path: "/staff/timesheet-approvals",
                    },
                    createdBy: managerUserId,
                    updatedBy: managerUserId,
                  } as typeof notifications.$inferInsert)
                  .onConflictDoNothing()
                  .returning({ id: notifications.id })
              : [];
            reminders += inserted.length;
          }
        }
      }
      const mutableSheets = await tx
        .select()
        .from(timesheets)
        .where(
          and(
            eq(timesheets.organisationId, organisation.organisationId),
            inArray(timesheets.status, ["Draft", "Returned", "Pending Manager", "Pending HR"]),
            sql`${timesheets.archivedAt} IS NULL`,
          ),
        );
      for (const sheet of mutableSheets) {
        const snapshot = await buildTimesheetReconciliation(tx, organisation.organisationId, sheet);
        const previous = sheet.attendanceReconciliationSnapshot as Record<string, unknown> | null;
        const comparablePrevious = previous ? { ...previous, generatedAt: "" } : null;
        const comparableNext = { ...snapshot, generatedAt: "" };
        if (JSON.stringify(comparablePrevious) === JSON.stringify(comparableNext)) continue;
        await tx
          .update(timesheets)
          .set({
            attendanceReconciliationSnapshot: snapshot,
            updatedAt: new Date(),
            updatedBy: sheet.updatedBy,
          })
          .where(eq(timesheets.id, sheet.id));
        await tx.insert(auditEvents).values({
          organisationId: organisation.organisationId,
          actorDisplayName: "VIA background worker",
          activeRole: "Super Admin",
          actorRoles: ["Super Admin"],
          action: "reconcile",
          module: "timesheets",
          entityType: "timesheet",
          entityId: sheet.id,
          afterSummary: {
            attendanceHours: snapshot.attendanceHours,
            timesheetWorkHours: snapshot.timesheetWorkHours,
            unresolvedCount: snapshot.unresolvedCount,
          },
          reason: "Scheduled attendance and timesheet reconciliation",
          riskLevel: "Low",
        } as typeof auditEvents.$inferInsert);
        reconciled += 1;
      }
    });
  }
  return { reminders, reconciled };
}
