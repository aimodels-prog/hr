import "@tanstack/react-start/server-only";
import { requireEmployeeSupervisor } from "./supervisor-access.repository.server.ts";
import { syncWorkingHours } from "./working-hours.repository.server.ts";

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
import { appSettings, organisations } from "../schema/organisation.ts";
import { isAttendanceTracked, readAttendanceTracking } from "../../data/attendance-tracking.ts";
import { ordinaryAttendanceHours } from "../../data/office-schedule.ts";
import { recordedDailyHours, recordedAttendanceHours } from "../../data/recorded-hours.ts";
import {
  isConfiguredTimesheetPeriod,
  timesheetPeriodsInRange,
  timesheetPeriodDates,
} from "../../data/timesheet-periods.ts";
import {
  EFFECTIVE_LEAVE_STATUSES,
  organisationDate,
  timesheetAbsences,
} from "../../data/approved-leave.ts";
import { officeCredits, applyOfficeCredits } from "./office-exception.repository.server.ts";
import { leaveRequests } from "../schema/leave.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  attendanceRecords,
  attendancePolicies,
  timesheetEntries,
  timesheetPeriods,
  timesheetSettings,
  timesheets,
} from "../schema/time.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const DEFAULT_SETTINGS = {
  periodFrequency: "Monthly" as const,
  weeklyPeriodStartDay: 1,
  standardDailyHours: 8,
  submissionDeadlineDays: 2,
  overtimeThresholdWeekly: 40,
  allowCopyPreviousWeek: true,
  payrollLockBehaviour: "Manual by HR" as const,
  requireHrOvertimeVerification: true,
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
    await requireEmployeeSupervisor(tx, organisationId, sheet.employeeId);
    const [settings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const [submissionPeriod] = await tx
      .select()
      .from(timesheetPeriods)
      .where(eq(timesheetPeriods.id, sheet.periodId))
      .limit(1);
    if (!submissionPeriod) throw new Error("Timesheet period not found.");
    const [calendarSettings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (
      isConfiguredTimesheetPeriod(submissionPeriod) &&
      submissionPeriod.endDate >= organisationDate(new Date(), calendarSettings?.timezone ?? "UTC")
    )
      throw new Error(
        "You can save daily hours now and submit the monthly timesheet after the month ends.",
      );
    const expected = await expectedHoursForPeriod(
      tx,
      organisationId,
      sheet.employeeId,
      submissionPeriod,
      Number(settings?.standardDailyHours ?? 8),
    );
    if (Number(sheet.totalHours) < expected)
      throw new Error(
        `Log the remaining ${expected - Number(sheet.totalHours)} expected hours before submitting.`,
      );
    await tx
      .update(timesheets)
      .set({ expectedHours: String(expected) })
      .where(eq(timesheets.id, sheet.id));
    const snapshot = await buildTimesheetReconciliation(tx, organisationId, sheet);
    const unresolved = snapshot.days.filter((item) => !item.resolved);
    if (unresolved.length)
      throw new Error(
        `Explain the attendance differences for ${unresolved.map((item) => item.date).join(", ")} before submitting.`,
      );
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
    const next =
      decision === "return"
        ? "Returned"
        : manager
          ? "Pending HR"
          : settings?.payrollLockBehaviour === "Automatic on Approval"
            ? "Payroll Locked"
            : "Approved";
    const [approvalPeriod] = await tx
      .select()
      .from(timesheetPeriods)
      .where(eq(timesheetPeriods.id, sheet.periodId))
      .limit(1);
    if (!approvalPeriod) throw new Error("Timesheet period not found.");
    const absence = await absencesForPeriod(
      tx,
      organisationId,
      sheet.employeeId,
      approvalPeriod,
      Number(settings?.standardDailyHours ?? 8),
    );
    if (decision === "approve" && Number(sheet.totalHours) < absence.expectedWorkHours)
      throw new Error("The required work hours have changed. Return the timesheet for correction.");
    const finalApproval = next === "Approved" || next === "Payroll Locked";
    const workEntries = Array.isArray(sheet.draftPayload)
      ? sheet.draftPayload.filter(
          (entry: { isLeave?: boolean; isHoliday?: boolean }) => !entry.isLeave && !entry.isHoliday,
        )
      : (await tx.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id)))
          .filter((entry) => !entry.isLeave && !entry.isHoliday)
          .map((entry) => ({
            id: entry.id,
            projectId: entry.projectId,
            costCentreId: entry.costCentreId,
            activityCodeId: entry.activityCodeId,
            locationId: entry.locationId,
            hours: { [entry.workDate]: Number(entry.hours) },
            notes: entry.notes,
          }));
    await tx
      .update(timesheets)
      .set({
        status: next,
        managerNotes: notes?.trim(),
        attendanceReconciliationSnapshot: reconciliation,
        expectedHours: String(absence.expectedWorkHours),
        ...(finalApproval
          ? {
              draftPayload: [
                ...workEntries,
                ...absence.entries.map((entry) => ({ ...entry, locationId: entry.locationCodeId })),
              ],
            }
          : {}),
        ...(manager
          ? { supervisorReviewedAt: new Date().toISOString(), supervisorReviewedBy: actor.userId }
          : {}),
        ...(finalApproval
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
            title: "Timesheet awaiting HR approval",
            message:
              "A supervisor has reviewed this timesheet. HR final approval is required before payroll.",
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
        hrReviewRequired: manager && decision === "approve",
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
  const [breakPolicy] = await db
    .select({ minutes: attendancePolicies.defaultBreakMinutes })
    .from(attendancePolicies)
    .where(eq(attendancePolicies.organisationId, organisationId))
    .limit(1);
  const activeRole = role(actor);
  let employeeIds: string[] | undefined;
  if (activeRole === "Employee" || activeRole === "IT") {
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
  const [calendarSettings] = await db
    .select({ timezone: appSettings.timezone })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  const currentPeriod = timesheetPeriodDates(
    organisationDate(new Date(), calendarSettings?.timezone ?? "UTC"),
    settingsRow?.periodFrequency ?? "Monthly",
    settingsRow?.weeklyPeriodStartDay ?? 1,
  );
  if (!settingsRow || settingsRow.periodFrequency === "Monthly")
    await db
      .insert(timesheetPeriods)
      .values({
        organisationId,
        ...currentPeriod,
        status: "Open",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof timesheetPeriods.$inferInsert)
      .onConflictDoNothing();
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
  const [organisationSettings, people, leaveRows, holidayRows] = await Promise.all([
    db.select().from(appSettings).where(eq(appSettings.organisationId, organisationId)).limit(1),
    db
      .select({
        id: employees.id,
        locationId: employees.locationId,
        startDate: employees.startDate,
      })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          ...(employeeIds ? [inArray(employees.id, employeeIds)] : []),
        ),
      ),
    db
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.organisationId, organisationId),
          inArray(leaveRequests.status, [...EFFECTIVE_LEAVE_STATUSES]),
          sql`${leaveRequests.archivedAt} IS NULL`,
          ...(employeeIds ? [inArray(leaveRequests.employeeId, employeeIds)] : []),
        ),
      ),
    db
      .select({ date: publicHolidays.holidayDate, locationId: publicHolidays.locationId })
      .from(publicHolidays)
      .where(
        and(
          eq(publicHolidays.organisationId, organisationId),
          eq(publicHolidays.isActive, true),
          sql`${publicHolidays.archivedAt} IS NULL`,
        ),
      ),
  ]);
  const calendarForSheet = (item: typeof timesheets.$inferSelect) => {
    const period = periodRows.find((period) => period.id === item.periodId);
    const person = people.find((person) => person.id === item.employeeId);
    if (!period || !["Draft", "Returned", "Pending Manager", "Pending HR"].includes(item.status))
      return null;
    return timesheetAbsences({
      dates: dateRange(period.startDate, period.endDate).filter(
        (date) => !person?.startDate || date >= person.startDate,
      ),
      dailyHours: recordedDailyHours(
        Number(settingsRow?.standardDailyHours ?? organisationSettings[0]?.standardDailyHours ?? 8),
        breakPolicy?.minutes ?? 60,
      ),
      workingDays: organisationSettings[0]?.workingDays ?? [1, 2, 3, 4, 5],
      holidays: new Set(
        holidayRows
          .filter((holiday) => !holiday.locationId || holiday.locationId === person?.locationId)
          .map((holiday) => holiday.date),
      ),
      leave: leaveRows
        .filter((leave) => leave.employeeId === item.employeeId)
        .map((leave) => ({ ...leave, policySnapshot: leave.policySnapshot as { name?: string } })),
    });
  };
  const calendars = new Map(sheetRows.map((sheet) => [sheet.id, calendarForSheet(sheet)]));
  return {
    settings: settingsRow
      ? {
          periodFrequency: settingsRow.periodFrequency,
          weeklyPeriodStartDay: settingsRow.weeklyPeriodStartDay,
          standardDailyHours: Number(settingsRow.standardDailyHours),
          recordedBreakMinutes: breakPolicy?.minutes ?? 60,
          submissionDeadlineDays: settingsRow.submissionDeadlineDays,
          overtimeThresholdWeekly: Number(settingsRow.overtimeThresholdWeekly),
          allowCopyPreviousWeek: settingsRow.allowCopyPreviousWeek,
          payrollLockBehaviour: settingsRow.payrollLockBehaviour as
            "Manual by HR" | "Automatic on Approval",
          requireHrOvertimeVerification: true,
          overtimePreauthorisationRequired: settingsRow.overtimePreauthorisationRequired,
          overtimeMaxDailyHours: Number(settingsRow.overtimeMaxDailyHours),
          overtimeMaxWeeklyHours: Number(settingsRow.overtimeMaxWeeklyHours),
          overtimeMaxMonthlyHours: Number(settingsRow.overtimeMaxMonthlyHours),
          attendanceVarianceToleranceHours: Number(settingsRow.attendanceVarianceToleranceHours),
        }
      : { ...DEFAULT_SETTINGS, recordedBreakMinutes: breakPolicy?.minutes ?? 60 },
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
      expectedHours: calendars.get(item.id)?.expectedWorkHours ?? Number(item.expectedHours),
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
      entries: [
        ...(Array.isArray(item.draftPayload)
          ? (
              item.draftPayload as Array<{
                id: string;
                projectId?: string;
                costCentreId?: string;
                activityCodeId?: string;
                locationId?: string;
                hours: Record<string, number>;
                notes?: string;
                isLeave?: boolean;
                isHoliday?: boolean;
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
        ).filter((entry) => !calendars.get(item.id) || (!entry.isLeave && !entry.isHoliday)),
        ...(calendars.get(item.id)?.entries ?? []),
      ],
    })),
  };
}

export async function updateTimesheetSettingsInDatabase(
  organisationId: string,
  settings: {
    periodFrequency?: "Monthly" | "Weekly";
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
  const periodFrequency = settings.periodFrequency ?? "Monthly";
  if (!["Monthly", "Weekly"].includes(periodFrequency))
    throw new Error("Select a valid timesheet frequency.");
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
    await syncWorkingHours(tx, organisationId, settings.standardDailyHours, actor, "timesheets");
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
          periodFrequency,
          requireHrOvertimeVerification: true,
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
        periodFrequency,
        requireHrOvertimeVerification: true,
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
    let count = 0;
    for (const period of timesheetPeriodsInRange(
      startDate,
      endDate,
      settings?.periodFrequency ?? "Monthly",
      settings?.weeklyPeriodStartDay ?? 1,
    )) {
      const inserted = await tx
        .insert(timesheetPeriods)
        .values({
          id: randomUUID(),
          organisationId,
          ...period,
          status: "Open",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof timesheetPeriods.$inferInsert)
        .onConflictDoNothing()
        .returning({ id: timesheetPeriods.id });
      count += inserted.length;
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

// Read the single, persisted break policy instead of changing the working-hours setting.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordedDayForOrganisation(tx: any, organisationId: string, workingHours: number) {
  const [policy] = await tx
    .select({ minutes: attendancePolicies.defaultBreakMinutes })
    .from(attendancePolicies)
    .where(eq(attendancePolicies.organisationId, organisationId))
    .limit(1);
  return recordedDailyHours(workingHours, policy?.minutes ?? 60);
}

async function absencesForPeriod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organisationId: string,
  employeeId: string,
  period: { startDate: string; endDate: string },
  dailyHours: number,
) {
  dailyHours = await recordedDayForOrganisation(tx, organisationId, dailyHours);
  const [orgSettings] = await tx
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  const [employee] = await tx
    .select({ locationId: employees.locationId, startDate: employees.startDate })
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
        sql`${publicHolidays.archivedAt} IS NULL`,
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
      policySnapshot: leaveRequests.policySnapshot,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.organisationId, organisationId),
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, [...EFFECTIVE_LEAVE_STATUSES]),
        sql`${leaveRequests.archivedAt} IS NULL`,
        sql`${leaveRequests.startDate} <= ${period.endDate} AND ${leaveRequests.endDate} >= ${period.startDate}`,
      ),
    );
  const holidaySet = new Set<string>(holidays.map((item: { date: string }) => item.date));
  const workingDays = orgSettings?.workingDays ?? [1, 2, 3, 4, 5];
  return timesheetAbsences({
    dates: dateRange(period.startDate, period.endDate).filter((date) => date >= employee.startDate),
    workingDays,
    dailyHours,
    holidays: holidaySet,
    leave,
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
  return (await absencesForPeriod(tx, organisationId, employeeId, period, dailyHours))
    .expectedWorkHours;
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
    if (!entry.isLeave && !entry.isHoliday)
      workByDate.set(entry.workDate, (workByDate.get(entry.workDate) ?? 0) + Number(entry.hours));
  const recordedDay = await recordedDayForOrganisation(
    tx,
    organisationId,
    Number(settings?.standardDailyHours ?? 8),
  );
  const recordByDate = new Map(
    applyOfficeCredits(
      records,
      await officeCredits(organisationId, [sheet.employeeId], period.startDate, period.endDate, tx),
    ).map((item) => [item.date, item]),
  );
  const explanations = (sheet.attendanceDiscrepancyExplanations ?? {}) as Record<string, string>;
  const [trackingSettings] = await tx
    .select({ additional: appSettings.additionalSettings })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  const tracking = readAttendanceTracking(trackingSettings?.additional);
  const absence = await absencesForPeriod(
    tx,
    organisationId,
    sheet.employeeId,
    period,
    Number(settings?.standardDailyHours ?? 8),
  );
  const leaveByDate = new Map<string, number>();
  const holidayByDate = new Map<string, number>();
  for (const entry of absence.entries)
    for (const [date, hours] of Object.entries(entry.hours)) {
      const target = entry.isLeave ? leaveByDate : holidayByDate;
      target.set(date, (target.get(date) ?? 0) + hours);
    }
  const days = [
    ...new Set([
      ...workByDate.keys(),
      ...recordByDate.keys(),
      ...leaveByDate.keys(),
      ...holidayByDate.keys(),
    ]),
  ]
    .filter(
      (date) =>
        isAttendanceTracked(tracking, sheet.employeeId, date) ||
        leaveByDate.has(date) ||
        holidayByDate.has(date),
    )
    .sort()
    .map((date) => {
      const record = recordByDate.get(date);
      const leaveHours = leaveByDate.get(date) ?? 0;
      const holidayHours = holidayByDate.get(date) ?? 0;
      const nonWorking = leaveHours + holidayHours >= recordedDay;
      const attendanceHours = ordinaryAttendanceHours(
        recordedAttendanceHours(record),
        nonWorking ? recordedDay : recordedDay - leaveHours,
      );
      const timesheetWorkHours = workByDate.get(date) ?? 0;
      const varianceHours = Number((timesheetWorkHours - attendanceHours).toFixed(2));
      const incomplete = Boolean(
        record &&
        !record.officeExceptionLabel &&
        (record.clockInAt || record.clockOutAt) &&
        (!record.clockInAt || !record.clockOutAt),
      );
      const tracked = isAttendanceTracked(tracking, sheet.employeeId, date);
      const requiresExplanation =
        (tracked &&
          !nonWorking &&
          (!record || incomplete || Math.abs(varianceHours) > toleranceHours)) ||
        (nonWorking && (timesheetWorkHours > 0 || attendanceHours > 0 || incomplete));
      const explanation = explanations[date]?.trim();
      const status =
        nonWorking && !requiresExplanation
          ? holidayHours
            ? "Holiday"
            : "Leave"
          : !tracked && !requiresExplanation
            ? "Matched"
            : !record
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
        leaveHours,
        holidayHours,
        varianceHours,
        attendanceStatus:
          nonWorking && !record?.clockInAt && !record?.clockOutAt
            ? holidayHours
              ? "Holiday"
              : "On Leave"
            : (record?.status ?? "No Record"),
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

// Serialised per employee during creation: a legacy weekly sheet cannot be counted
// a second time in a new monthly sheet. Reviewed records are never rewritten.
async function overlappingTimesheets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  organisationId: string,
  employeeId: string,
  period: { startDate: string; endDate: string },
) {
  return tx
    .select({ id: timesheets.id })
    .from(timesheets)
    .innerJoin(timesheetPeriods, eq(timesheetPeriods.id, timesheets.periodId))
    .where(
      and(
        eq(timesheets.organisationId, organisationId),
        eq(timesheets.employeeId, employeeId),
        sql`${timesheets.archivedAt} IS NULL`,
        sql`${timesheets.status} <> 'Corrected'`,
        sql`${timesheetPeriods.startDate} <= ${period.endDate} AND ${timesheetPeriods.endDate} >= ${period.startDate}`,
      ),
    );
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
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`timesheet-employee:${organisationId}:${employeeId}`}, 0))`,
    );
    const [existing] = await tx
      .select({ id: timesheets.id })
      .from(timesheets)
      .where(
        and(
          eq(timesheets.organisationId, organisationId),
          eq(timesheets.employeeId, employeeId),
          eq(timesheets.periodId, periodId),
          sql`${timesheets.archivedAt} IS NULL`,
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
    if (
      !isConfiguredTimesheetPeriod(
        period,
        settings?.periodFrequency ?? "Monthly",
        settings?.weeklyPeriodStartDay ?? 1,
      )
    )
      throw new Error(
        "New timesheets must use the configured period. Existing records remain available in history.",
      );
    if ((await overlappingTimesheets(tx, organisationId, employeeId, period)).length)
      throw new Error(
        "An existing timesheet already covers part of this month. Ask HR to review it before starting another, so the hours are not counted twice.",
      );
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
          notes: entry.notes?.trim() ?? "",
        });
      }
    }
    for (const [date, hours] of dailyTotals)
      if (hours > 24) throw new Error(`Total hours on ${date} exceed 24.`);
    const [workingSettings] = await tx
      .select()
      .from(timesheetSettings)
      .where(eq(timesheetSettings.organisationId, organisationId))
      .limit(1);
    const absence = await absencesForPeriod(
      tx,
      organisationId,
      sheet.employeeId,
      period,
      Number(workingSettings?.standardDailyHours ?? DEFAULT_SETTINGS.standardDailyHours),
    );
    for (const [date, hours] of dailyTotals) {
      const covered = absence.entries.reduce((sum, entry) => sum + (entry.hours[date] ?? 0), 0);
      if (hours > 0 && covered >= absence.dailyHours)
        throw new Error(
          `Cannot log work hours on ${date}: it is approved leave or a public holiday.`,
        );
    }
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
    const expectedHours = absence.expectedWorkHours;
    await tx
      .update(timesheets)
      .set({
        totalHours: String(total),
        expectedHours: String(expectedHours),
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
    .from(timesheetSettings)
    .innerJoin(organisations, eq(organisations.id, timesheetSettings.organisationId))
    .where(eq(organisations.isActive, true));
  let reminders = 0;
  let reconciled = 0;
  let leaveSubmitted = 0;
  for (const organisation of organisationsWithSettings) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`leave-timesheets:${organisation.organisationId}`}, 0))`,
      );
      const [settings] = await tx
        .select()
        .from(timesheetSettings)
        .where(eq(timesheetSettings.organisationId, organisation.organisationId))
        .limit(1);
      if (!settings) return;
      const [calendarSettings] = await tx
        .select()
        .from(appSettings)
        .where(eq(appSettings.organisationId, organisation.organisationId))
        .limit(1);
      const todayKey = organisationDate(at, calendarSettings?.timezone ?? "UTC");
      const earliest = new Date(`${todayKey}T12:00:00Z`);
      if (settings.periodFrequency === "Monthly") {
        earliest.setUTCDate(1);
        earliest.setUTCMonth(earliest.getUTCMonth() - 1);
      } else earliest.setUTCDate(earliest.getUTCDate() - 30);
      const earliestKey = earliest.toISOString().slice(0, 10);
      const leaveRanges = await tx
        .select({
          employeeId: leaveRequests.employeeId,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
        })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.organisationId, organisation.organisationId),
            inArray(leaveRequests.status, [...EFFECTIVE_LEAVE_STATUSES]),
            sql`${leaveRequests.archivedAt} IS NULL`,
            sql`${leaveRequests.startDate} <= ${todayKey} AND ${leaveRequests.endDate} >= ${earliestKey}`,
          ),
        );
      // Calendar months are prepared without requiring staff on leave to open the app.
      const requiredPeriods = new Map<string, { startDate: string; endDate: string }>();
      const currentPeriod = timesheetPeriodDates(
        todayKey,
        settings.periodFrequency,
        settings.weeklyPeriodStartDay,
      );
      requiredPeriods.set(currentPeriod.startDate, currentPeriod);
      for (const leave of leaveRanges) {
        for (const period of timesheetPeriodsInRange(
          leave.startDate < earliestKey ? earliestKey : leave.startDate,
          leave.endDate > todayKey ? todayKey : leave.endDate,
          settings.periodFrequency,
          settings.weeklyPeriodStartDay,
        ))
          requiredPeriods.set(period.startDate, period);
      }
      for (const period of requiredPeriods.values()) {
        await tx
          .insert(timesheetPeriods)
          .values({
            organisationId: organisation.organisationId,
            ...period,
            status: "Open",
            createdBy: settings.createdBy,
            updatedBy: settings.updatedBy,
          })
          .onConflictDoNothing();
      }
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
          employmentConfirmationStatus: employees.employmentConfirmationStatus,
          startDate: employees.startDate,
        })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisation.organisationId),
            inArray(employees.status, ["Active", "Probation", "Notice"]),
            sql`${employees.archivedAt} IS NULL`,
          ),
        );
      const orgUsers = await tx
        .select({ id: users.id, employeeId: users.employeeId })
        .from(users)
        .where(
          and(eq(users.organisationId, organisation.organisationId), eq(users.status, "Active")),
        );
      const userByEmployee = new Map(orgUsers.map((item) => [item.employeeId, item.id]));
      const hrRecipients = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisation.organisationId),
            eq(userRoles.organisationId, organisation.organisationId),
            eq(users.status, "Active"),
            eq(roles.code, "HR"),
            sql`${users.archivedAt} IS NULL`,
          ),
        );
      const today = new Date(`${todayKey}T12:00:00Z`);
      for (const period of openPeriods) {
        // Previous weekly records remain history, not new monthly submission obligations.
        if (
          !isConfiguredTimesheetPeriod(
            period,
            settings.periodFrequency,
            settings.weeklyPeriodStartDay,
          )
        )
          continue;
        const deadline = new Date(`${period.endDate}T12:00:00Z`);
        deadline.setUTCDate(deadline.getUTCDate() + settings.submissionDeadlineDays);
        const daysUntil = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
        if (
          daysUntil < -30 ||
          (daysUntil > 2 && (!requiredPeriods.has(period.startDate) || period.startDate > todayKey))
        )
          continue;
        const periodSheets = await tx
          .select()
          .from(timesheets)
          .where(
            and(
              eq(timesheets.organisationId, organisation.organisationId),
              eq(timesheets.periodId, period.id),
              sql`${timesheets.archivedAt} IS NULL`,
            ),
          );
        const sheetByEmployee = new Map(periodSheets.map((item) => [item.employeeId, item]));
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
          if (period.endDate < employee.startDate) continue;
          let sheet = sheetByEmployee.get(employee.id);
          if (!sheet) {
            const overlaps = await overlappingTimesheets(
              tx,
              organisation.organisationId,
              employee.id,
              period,
            );
            if (overlaps.length) {
              // Do not ask staff to start a month that would duplicate their old records.
              for (const recipient of hrRecipients)
                await notify(
                  tx,
                  organisation.organisationId,
                  recipient.id,
                  {
                    title: "Timesheet periods need review",
                    message: `${employee.preferredName}: an existing timesheet covers part of ${period.startDate} to ${period.endDate}. Review it before starting a monthly sheet so hours are not counted twice.`,
                    key: `timesheet-overlap-${period.id}-${employee.id}`,
                    entityId: overlaps[0].id,
                    path: `/staff/timesheet-approvals/${overlaps[0].id}`,
                  },
                  settings.updatedBy,
                );
              continue;
            }
          }
          let fullyCovered = false;
          // Returned/approved/locked sheets are never automatically submitted or rewritten.
          if (
            (!sheet || sheet.status === "Draft") &&
            period.endDate >= employee.startDate &&
            leaveRanges.some(
              (leave) =>
                leave.employeeId === employee.id &&
                leave.startDate <= period.endDate &&
                leave.endDate >= period.startDate,
            )
          ) {
            const absence = await absencesForPeriod(
              tx,
              organisation.organisationId,
              employee.id,
              period,
              Number(settings.standardDailyHours),
            );
            fullyCovered =
              absence.expectedWorkHours === 0 && absence.entries.some((entry) => entry.isLeave);
            if (!sheet) {
              await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtextextended(${`timesheet-employee:${organisation.organisationId}:${employee.id}`}, 0))`,
              );
              const overlaps = await overlappingTimesheets(
                tx,
                organisation.organisationId,
                employee.id,
                period,
              );
              if (overlaps.length) continue; // Never duplicate existing approved/unfinished periods.
              [sheet] = await tx
                .insert(timesheets)
                .values({
                  organisationId: organisation.organisationId,
                  employeeId: employee.id,
                  periodId: period.id,
                  status: "Draft",
                  totalHours: "0",
                  expectedHours: String(absence.expectedWorkHours),
                  draftPayload: [],
                  createdBy: settings.createdBy,
                  updatedBy: settings.updatedBy,
                })
                .onConflictDoNothing()
                .returning();
            }
            if (
              sheet &&
              period.endDate < todayKey &&
              absence.expectedWorkHours === 0 &&
              absence.entries.some((entry) => entry.isLeave) &&
              Number(sheet.totalHours) === 0 &&
              employee.employmentConfirmationStatus === "Confirmed"
            ) {
              let manager: Awaited<ReturnType<typeof requireEmployeeSupervisor>> | undefined;
              try {
                manager = await requireEmployeeSupervisor(
                  tx,
                  organisation.organisationId,
                  employee.id,
                );
              } catch {
                /* HR must assign an authorised supervisor; no automatic permission grants. */
              }
              if (manager) {
                // Serialize with an employee saving/submitting or a reviewer deciding the sheet.
                const [current] = await tx
                  .select()
                  .from(timesheets)
                  .where(eq(timesheets.id, sheet.id))
                  .for("update")
                  .limit(1);
                if (current?.status === "Draft" && Number(current.totalHours) === 0) {
                  const snapshot = await buildTimesheetReconciliation(
                    tx,
                    organisation.organisationId,
                    current,
                  );
                  const evidence = await tx
                    .select({ id: timesheetEntries.id })
                    .from(timesheetEntries)
                    .where(
                      and(
                        eq(timesheetEntries.timesheetId, current.id),
                        sql`${timesheetEntries.hours} > 0`,
                      ),
                    )
                    .limit(1);
                  if (
                    snapshot.unresolvedCount === 0 &&
                    !evidence.length &&
                    snapshot.timesheetWorkHours === 0 &&
                    snapshot.attendanceHours === 0
                  ) {
                    [sheet] = await tx
                      .update(timesheets)
                      .set({
                        status: "Pending Manager",
                        expectedHours: "0",
                        draftPayload: absence.entries.map((entry) => ({
                          ...entry,
                          locationId: entry.locationCodeId,
                        })),
                        submittedAt: at.toISOString(),
                        attendanceReconciliationSnapshot: snapshot,
                        updatedAt: at,
                        recordVersion: sql`${timesheets.recordVersion} + 1`,
                      })
                      .where(eq(timesheets.id, current.id))
                      .returning();
                    await notify(
                      tx,
                      organisation.organisationId,
                      manager.userId,
                      {
                        title: "Leave-only timesheet awaiting review",
                        message: `${employee.preferredName}: approved leave covers the timesheet for ${period.startDate} to ${period.endDate}. Review it before HR approval.`,
                        key: `timesheet-leave-only-${current.id}`,
                        entityId: current.id,
                        path: `/staff/timesheet-approvals/${current.id}`,
                      },
                      settings.updatedBy,
                    );
                    await tx.insert(auditEvents).values({
                      organisationId: organisation.organisationId,
                      actorDisplayName: "VIA background worker",
                      activeRole: "Super Admin",
                      actorRoles: ["Super Admin"],
                      action: "leave_timesheet_submitted",
                      module: "timesheets",
                      entityType: "timesheet",
                      entityId: current.id,
                      afterSummary: { status: "Pending Manager", workHours: 0 },
                      reason:
                        "Approved leave covers the completed period; manager and HR approval remain required",
                      riskLevel: "Low",
                    });
                    leaveSubmitted += 1;
                  }
                }
              }
            }
          }
          const status = sheet?.status;
          if (status && !["Draft", "Returned"].includes(status)) continue;
          if (fullyCovered && sheet?.status === "Draft") {
            if (period.endDate < todayKey)
              for (const recipient of hrRecipients)
                await notify(
                  tx,
                  organisation.organisationId,
                  recipient.id,
                  {
                    title: "Leave-only timesheet needs HR attention",
                    message: `${employee.preferredName}: leave covers ${period.startDate} to ${period.endDate}. Check the employment details, supervisor or attendance before it can proceed.`,
                    key: `timesheet-leave-setup-${sheet.id}`,
                    entityId: sheet.id,
                    path: `/staff/timesheet-approvals/${sheet.id}`,
                  },
                  settings.updatedBy,
                );
            continue; // No request to enter work hours while the whole period is approved leave.
          }
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
        )
        .for("update");
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
  return { reminders, reconciled, leaveSubmitted };
}
