import { SYSTEM_CONTEXT } from "./types.ts";
import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type {
  DailyAttendanceReconciliation,
  TimesheetAttendanceReconciliation,
  TimesheetSettings,
  TimesheetPeriod,
  TimesheetEntry,
  TimesheetWithEntries,
} from "./timesheet-types.ts";
import {
  parseISO,
  addDays,
  nextDay,
  getDay,
  isBefore,
  isSameDay,
  format,
  eachDayOfInterval,
  differenceInCalendarDays,
  startOfDay,
} from "date-fns";
import { getMasterDataRepository, getProjectRepository } from "./master-data.ts";
import type { ActorContext, User } from "./types.ts";
import { LeaveService } from "./leave-service.ts";
import { AttendanceService } from "./attendance-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { SettingsService } from "./settings-service.ts";

const SETTINGS_COLLECTION = "timesheetSettings";

const DEFAULT_SETTINGS: TimesheetSettings = {
  weeklyPeriodStartDay: 1, // Monday
  standardDailyHours: 8,
  submissionDeadlineDays: 2,
  overtimeThresholdWeekly: 40,
  allowCopyPreviousWeek: true,
  payrollLockBehaviour: "Manual by HR",
  requireHrOvertimeVerification: false,
  attendanceVarianceToleranceHours: 0.25,
};

export class TimesheetService {
  private periodRepo: LocalRepository<TimesheetPeriod>;
  private timesheetRepo: LocalRepository<TimesheetWithEntries>;

  constructor(private readonly attendanceService = new AttendanceService()) {
    const { storage, audit } = getApplicationDataServices();
    this.periodRepo = new LocalRepository<TimesheetPeriod>("timesheetPeriods", storage, audit, {
      module: "timesheets",
      entityType: "period",
    });
    this.timesheetRepo = new LocalRepository<TimesheetWithEntries>("timesheets", storage, audit, {
      module: "timesheets",
      entityType: "timesheet",
    });
  }

  private async serverActor(context: ActorContext) {
    const users = getApplicationDataServices().storage.readCollection<User>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    } as const;
  }

  private databaseId(collection: string, id: string): string {
    const record = getApplicationDataServices()
      .storage.readCollection<{ id: string; databaseId?: string }>(collection)
      .find((item) => item.id === id || item.databaseId === id);
    const databaseId = record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    if (!databaseId) throw new Error("This record is not connected to PostgreSQL yet.");
    return databaseId;
  }

  /** PostgreSQL is authoritative; browser collections are a temporary read projection. */
  async hydrateCompatibilityCache(context: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const { storage } = getApplicationDataServices();
    const employeeMap = new Map(
      storage
        .readCollection<{ id: string; databaseId?: string }>("employees")
        .filter((item) => item.databaseId)
        .map((item) => [item.databaseId!, item.id]),
    );
    const userMap = new Map(
      storage
        .readCollection<{ id: string; databaseId?: string }>("users")
        .filter((item) => item.databaseId)
        .map((item) => [item.databaseId!, item.id]),
    );
    const relationMap = new Map<string, string>();
    for (const collection of ["projects", "costCentres", "activityCodes", "locations"]) {
      for (const item of storage.readCollection<{ id: string; databaseId?: string }>(collection)) {
        if (item.databaseId) relationMap.set(item.databaseId, item.id);
      }
    }
    const { getTimesheetSnapshotFn } = await import("../server-functions/timesheet.server.ts");
    const snapshot = await getTimesheetSnapshotFn({
      data: { actor: await this.serverActor(context) },
    });
    storage.writeCollection(SETTINGS_COLLECTION, [snapshot.settings]);
    storage.writeCollection("timesheetPeriods", snapshot.periods);
    storage.writeCollection(
      "timesheets",
      snapshot.timesheets.map((sheet) => ({
        ...sheet,
        employeeId: employeeMap.get(sheet.employeeId) ?? sheet.employeeId,
        ...(sheet.approvedBy
          ? { approvedBy: userMap.get(sheet.approvedBy) ?? sheet.approvedBy }
          : {}),
        ...(sheet.supervisorReviewedBy
          ? {
              supervisorReviewedBy:
                userMap.get(sheet.supervisorReviewedBy) ?? sheet.supervisorReviewedBy,
            }
          : {}),
        entries: sheet.entries.map((entry) => ({
          ...entry,
          projectId: relationMap.get(entry.projectId) ?? entry.projectId,
          costCentreId: relationMap.get(entry.costCentreId) ?? entry.costCentreId,
          activityCodeId: relationMap.get(entry.activityCodeId) ?? entry.activityCodeId,
          locationCodeId: relationMap.get(entry.locationCodeId) ?? entry.locationCodeId,
        })),
      })),
    );
  }

  async saveSettingsAsync(settings: TimesheetSettings, context: ActorContext): Promise<void> {
    if (typeof window === "undefined") return this.saveSettings(settings, context);
    const { updateTimesheetSettingsFn } = await import("../server-functions/timesheet.server.ts");
    await updateTimesheetSettingsFn({ data: { actor: await this.serverActor(context), settings } });
    await this.hydrateCompatibilityCache(context);
  }

  async generatePeriodsAsync(
    startDate: string,
    endDate: string,
    context: ActorContext,
  ): Promise<number> {
    if (typeof window === "undefined") return this.generatePeriods(startDate, endDate, context);
    const { generateTimesheetPeriodsFn } = await import("../server-functions/timesheet.server.ts");
    const count = await generateTimesheetPeriodsFn({
      data: { actor: await this.serverActor(context), startDate, endDate },
    });
    await this.hydrateCompatibilityCache(context);
    return count;
  }

  async getOrCreateTimesheetAsync(
    employeeId: string,
    periodId: string,
    context: ActorContext,
  ): Promise<TimesheetWithEntries> {
    if (typeof window === "undefined")
      return this.getOrCreateTimesheet(employeeId, periodId, context);
    const { getOrCreateTimesheetFn } = await import("../server-functions/timesheet.server.ts");
    const databaseId = await getOrCreateTimesheetFn({
      data: {
        actor: await this.serverActor(context),
        employeeId: this.databaseId("employees", employeeId),
        periodId: this.databaseId("timesheetPeriods", periodId),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const result = this.timesheetRepo
      .list()
      .find((item) => item.databaseId === databaseId || item.id === databaseId);
    if (!result) throw new Error("The timesheet could not be loaded after it was created.");
    return result;
  }

  async saveTimesheetDraftAsync(
    timesheet: TimesheetWithEntries,
    context: ActorContext,
  ): Promise<TimesheetWithEntries> {
    if (typeof window === "undefined") return this.saveTimesheetDraft(timesheet, context);
    const { saveTimesheetDraftFn } = await import("../server-functions/timesheet.server.ts");
    const entries = timesheet.entries
      .filter((entry) => !entry.isLeave && !entry.isHoliday)
      .map((entry) => ({
        id: entry.id,
        ...(entry.projectId ? { projectId: this.databaseId("projects", entry.projectId) } : {}),
        ...(entry.costCentreId
          ? { costCentreId: this.databaseId("costCentres", entry.costCentreId) }
          : {}),
        ...(entry.activityCodeId
          ? { activityCodeId: this.databaseId("activityCodes", entry.activityCodeId) }
          : {}),
        ...(entry.locationCodeId
          ? { locationId: this.databaseId("locations", entry.locationCodeId) }
          : {}),
        hours: Object.fromEntries(
          Object.entries(entry.hours).map(([date, hours]) => [date, Number(hours)]),
        ),
        ...(entry.notes?.trim() ? { notes: entry.notes.trim() } : {}),
      }));
    await saveTimesheetDraftFn({
      data: {
        actor: await this.serverActor(context),
        timesheetId: this.databaseId("timesheets", timesheet.id),
        entries,
        explanations: timesheet.attendanceDiscrepancyExplanations ?? {},
      },
    });
    await this.hydrateCompatibilityCache(context);
    const updated = this.timesheetRepo
      .list()
      .find((item) => item.databaseId === timesheet.databaseId || item.id === timesheet.id);
    if (!updated) throw new Error("The saved timesheet could not be reloaded.");
    return updated;
  }

  async submitTimesheetAsync(
    timesheetId: string,
    context: ActorContext,
  ): Promise<TimesheetWithEntries> {
    if (typeof window === "undefined") return this.submitTimesheet(timesheetId, context);
    const { submitTimesheetFn } = await import("../server-functions/timesheet.server.ts");
    await submitTimesheetFn({
      data: {
        actor: await this.serverActor(context),
        timesheetId: this.databaseId("timesheets", timesheetId),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const result = this.timesheetRepo
      .list()
      .find((item) => item.id === timesheetId || item.databaseId === timesheetId);
    if (!result) throw new Error("The submitted timesheet could not be reloaded.");
    return result;
  }

  async decideTimesheetAsync(
    timesheetId: string,
    decision: "approve" | "return",
    notes: string | undefined,
    context: ActorContext,
  ): Promise<TimesheetWithEntries> {
    if (typeof window === "undefined")
      return decision === "approve"
        ? this.approveTimesheet(timesheetId, context)
        : this.returnTimesheet(timesheetId, notes ?? "Returned", context);
    const { decideTimesheetFn } = await import("../server-functions/timesheet.server.ts");
    await decideTimesheetFn({
      data: {
        actor: await this.serverActor(context),
        timesheetId: this.databaseId("timesheets", timesheetId),
        decision,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const result = this.timesheetRepo
      .list()
      .find((item) => item.id === timesheetId || item.databaseId === timesheetId);
    if (!result) throw new Error("The reviewed timesheet could not be reloaded.");
    return result;
  }

  async copyPreviousWeekAsync(
    employeeId: string,
    currentPeriodId: string,
    context: ActorContext,
  ): Promise<TimesheetWithEntries> {
    if (typeof window === "undefined")
      return this.copyPreviousWeek(employeeId, currentPeriodId, context);
    const settings = this.getSettings();
    if (!settings.allowCopyPreviousWeek) throw new Error("Copying the previous week is disabled.");
    const current = this.timesheetRepo
      .list()
      .find((item) => item.employeeId === employeeId && item.periodId === currentPeriodId);
    const period = this.periodRepo.getById(currentPeriodId);
    if (!current || !period) throw new Error("The current timesheet could not be found.");
    if (current.status !== "Draft")
      throw new Error("Only a draft timesheet can receive copied rows.");
    const previousEnd = format(addDays(parseISO(period.startDate), -1), "yyyy-MM-dd");
    const previousPeriod = this.getPeriods().find((item) => item.endDate === previousEnd);
    const previous = previousPeriod
      ? this.timesheetRepo
          .list()
          .find((item) => item.employeeId === employeeId && item.periodId === previousPeriod.id)
      : undefined;
    if (!previous?.entries.length) throw new Error("No entries were found in the previous week.");
    const keys = new Set(
      current.entries.map(
        (entry) =>
          `${entry.projectId}|${entry.costCentreId}|${entry.activityCodeId}|${entry.locationCodeId}`,
      ),
    );
    const dayOffset = differenceInCalendarDays(
      parseISO(period.startDate),
      parseISO(previousPeriod!.startDate),
    );
    const additions = previous.entries
      .filter((entry) => !entry.isLeave && !entry.isHoliday)
      .filter(
        (entry) =>
          !keys.has(
            `${entry.projectId}|${entry.costCentreId}|${entry.activityCodeId}|${entry.locationCodeId}`,
          ),
      )
      .map((entry) => {
        const hours = Object.fromEntries(
          Object.entries(entry.hours).map(([date, value]) => [
            format(addDays(parseISO(date), dayOffset), "yyyy-MM-dd"),
            value,
          ]),
        );
        return {
          ...entry,
          id: crypto.randomUUID(),
          hours,
          total: Object.values(hours).reduce((sum, value) => sum + value, 0),
        };
      });
    return this.saveTimesheetDraftAsync(
      { ...current, entries: [...current.entries, ...additions] },
      context,
    );
  }

  async setPeriodStatusAsync(
    periodId: string,
    status: "Open" | "Closed",
    reason: string | undefined,
    context: ActorContext,
  ): Promise<void> {
    if (typeof window === "undefined") {
      if (status === "Closed") this.closePeriod(periodId, context);
      else this.reopenPeriod(periodId, reason ?? "Period reopened", context);
      return;
    }
    const { setTimesheetPeriodStatusFn } = await import("../server-functions/timesheet.server.ts");
    await setTimesheetPeriodStatusFn({
      data: {
        actor: await this.serverActor(context),
        periodId: this.databaseId("timesheetPeriods", periodId),
        status,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async lockPayrollAsync(timesheetId: string, context: ActorContext): Promise<void> {
    if (typeof window === "undefined") {
      this.lockPayroll(timesheetId, context);
      return;
    }
    const { lockTimesheetForPayrollFn } = await import("../server-functions/timesheet.server.ts");
    await lockTimesheetForPayrollFn({
      data: {
        actor: await this.serverActor(context),
        timesheetId: this.databaseId("timesheets", timesheetId),
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async reopenTimesheetAsync(
    timesheetId: string,
    reason: string,
    context: ActorContext,
  ): Promise<TimesheetWithEntries> {
    if (typeof window === "undefined") return this.reopenTimesheet(timesheetId, reason, context);
    const { reopenTimesheetFn } = await import("../server-functions/timesheet.server.ts");
    const databaseId = await reopenTimesheetFn({
      data: {
        actor: await this.serverActor(context),
        timesheetId: this.databaseId("timesheets", timesheetId),
        reason,
      },
    });
    await this.hydrateCompatibilityCache(context);
    const result = this.timesheetRepo
      .list()
      .find((item) => item.databaseId === databaseId || item.id === databaseId);
    if (!result) throw new Error("The reopened timesheet could not be reloaded.");
    return result;
  }

  getSettings(): TimesheetSettings {
    const { storage } = getApplicationDataServices();
    const [stored] = storage.readCollection<TimesheetSettings>(SETTINGS_COLLECTION);
    return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
  }

  saveSettings(settings: TimesheetSettings, context: ActorContext) {
    this.requireTimesheetAdmin(context, "change timesheet settings");
    if (
      !Number.isInteger(settings.weeklyPeriodStartDay) ||
      settings.weeklyPeriodStartDay < 0 ||
      settings.weeklyPeriodStartDay > 6
    ) {
      throw new Error("Timesheet week start must be a valid day of the week.");
    }
    if (
      !Number.isInteger(settings.submissionDeadlineDays) ||
      settings.submissionDeadlineDays < 0 ||
      settings.submissionDeadlineDays > 30
    ) {
      throw new Error("Submission deadline must be between 0 and 30 days after period end.");
    }
    if (
      !Number.isFinite(settings.standardDailyHours) ||
      settings.standardDailyHours <= 0 ||
      settings.standardDailyHours > 24
    ) {
      throw new Error("Standard daily hours must be greater than 0 and no more than 24.");
    }
    if (
      !Number.isFinite(settings.overtimeThresholdWeekly) ||
      settings.overtimeThresholdWeekly <= 0 ||
      settings.overtimeThresholdWeekly > 168
    ) {
      throw new Error(
        "The weekly overtime threshold must be greater than 0 and no more than 168 hours.",
      );
    }
    if (!["Manual by HR", "Automatic on Approval"].includes(settings.payrollLockBehaviour)) {
      throw new Error("Select a valid payroll lock option.");
    }
    if (
      typeof settings.allowCopyPreviousWeek !== "boolean" ||
      typeof settings.requireHrOvertimeVerification !== "boolean"
    ) {
      throw new Error("Timesheet workflow choices must be switched on or off.");
    }
    if (
      !Number.isFinite(settings.attendanceVarianceToleranceHours) ||
      settings.attendanceVarianceToleranceHours < 0 ||
      settings.attendanceVarianceToleranceHours > 2
    ) {
      throw new Error("Attendance variance tolerance must be between 0 and 2 hours.");
    }
    const { storage, audit } = getApplicationDataServices();
    const previous = this.getSettings();
    storage.writeCollection(SETTINGS_COLLECTION, [settings]);
    audit.record({
      context,
      action: "UPDATE",
      module: "timesheets",
      entityType: "timesheetSettings",
      entityId: "singleton",
      before: previous,
      after: settings,
      reason: "Timesheet settings updated",
    });
  }

  getPeriods(): TimesheetPeriod[] {
    return this.periodRepo
      .list()
      .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
  }

  generatePeriods(startDateStr: string, endDateStr: string, context: ActorContext): number {
    this.requireTimesheetAdmin(context, "generate timesheet periods");
    const settings = this.getSettings();
    const start = parseISO(startDateStr);
    const end = parseISO(endDateStr);

    if (isBefore(end, start)) {
      throw new Error("End date must be after start date.");
    }

    // Find the first start day
    let currentPeriodStart = start;
    if (getDay(currentPeriodStart) !== settings.weeklyPeriodStartDay) {
      // Find the previous occurrence of this day of the week to align the period
      let offset = getDay(currentPeriodStart) - settings.weeklyPeriodStartDay;
      if (offset < 0) offset += 7;
      currentPeriodStart = addDays(currentPeriodStart, -offset);
    }

    let periodsGenerated = 0;
    const existingPeriods = this.periodRepo.list();

    while (!isBefore(end, currentPeriodStart)) {
      const periodEnd = addDays(currentPeriodStart, 6);

      const pStartStr = format(currentPeriodStart, "yyyy-MM-dd");
      const pEndStr = format(periodEnd, "yyyy-MM-dd");

      const exists = existingPeriods.some(
        (p) => p.startDate === pStartStr && p.endDate === pEndStr,
      );

      if (!exists) {
        this.periodRepo.create(
          {
            startDate: pStartStr,
            endDate: pEndStr,
            status: "Open",
          },
          context,
        );
        periodsGenerated++;
      }

      currentPeriodStart = addDays(periodEnd, 1);
    }

    return periodsGenerated;
  }

  getTimesheetsForPeriod(periodId: string, context: ActorContext): TimesheetWithEntries[] {
    this.requireOrganisationRead(context, "view this timesheet period");
    return this.timesheetRepo.list().filter((t) => t.periodId === periodId);
  }

  getAllTimesheets(context: ActorContext): TimesheetWithEntries[] {
    this.requireOrganisationRead(context, "view all timesheets");
    return this.timesheetRepo.list();
  }

  getTimesheetsForContext(context: ActorContext): TimesheetWithEntries[] {
    const all = this.timesheetRepo.list();
    if (["HR", "Accounts", "Super Admin"].includes(context.actor.activeRole ?? "")) return all;
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const reportIds = new Set(
        new EmployeeService()
          .getEmployees(SYSTEM_CONTEXT)
          .filter((employee) => employee.lineManagerId === context.actor.employeeId)
          .map((employee) => employee.id),
      );
      return all.filter((timesheet) => reportIds.has(timesheet.employeeId));
    }
    return all.filter((timesheet) => timesheet.employeeId === context.actor.employeeId);
  }

  getTimesheetsForEmployee(employeeId: string, context: ActorContext): TimesheetWithEntries[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's timesheets");
    return this.timesheetRepo.list().filter((t) => t.employeeId === employeeId);
  }

  /**
   * Recovers all submission reminders that should already have been sent. This remains safe to
   * call every minute because each employee/period/stage has a permanent deduplication key.
   */
  reconcileSubmissionReminders(at = new Date()): number {
    const { storage, notifications } = getApplicationDataServices();
    const settings = this.getSettings();
    const today = startOfDay(at);
    const existingKeys = new Set(
      notifications
        .list()
        .map((notification) => notification.deduplicationKey)
        .filter((key): key is string => Boolean(key)),
    );
    const users = storage.readCollection<User>("users").filter((user) => user.status === "Active");
    const employees = new EmployeeService()
      .getEmployees(SYSTEM_CONTEXT)
      .filter((employee) => ["Active", "Probation", "Notice"].includes(employee.status));
    const sheets = this.timesheetRepo.list();
    let created = 0;

    for (const period of this.periodRepo.list().filter((item) => item.status === "Open")) {
      const deadline = addDays(parseISO(period.endDate), settings.submissionDeadlineDays);
      const daysUntilDeadline = differenceInCalendarDays(deadline, today);
      if (daysUntilDeadline > 2 || daysUntilDeadline < -30) continue;

      const stages = [
        ...(daysUntilDeadline <= 2
          ? [{ key: "upcoming", title: "Timesheet due soon", priority: "Normal" as const }]
          : []),
        ...(daysUntilDeadline <= 0
          ? [{ key: "due", title: "Timesheet due today", priority: "High" as const }]
          : []),
        ...(daysUntilDeadline < 0
          ? [{ key: "overdue", title: "Timesheet overdue", priority: "High" as const }]
          : []),
      ];

      for (const employee of employees) {
        const sheet = sheets.find(
          (item) => item.employeeId === employee.id && item.periodId === period.id,
        );
        if (sheet && !["Draft", "Returned"].includes(sheet.status)) continue;
        const employeeUser = users.find((user) => user.employeeId === employee.id);
        if (!employeeUser) continue;

        for (const stage of stages) {
          const key = `timesheet-reminder-${period.id}-${employee.id}-${stage.key}`;
          if (existingKeys.has(key)) continue;
          notifications.create(
            {
              recipientUserId: employeeUser.id,
              type: stage.key === "overdue" ? "Warning" : "Info",
              title: stage.title,
              message: `Complete and submit your timesheet for ${period.startDate} to ${period.endDate}. The deadline is ${format(deadline, "dd MMM yyyy")}.`,
              priority: stage.priority,
              status: "Unread",
              deduplicationKey: key,
              link: {
                entityType: "timesheet-period",
                entityId: period.id,
                path: "/staff/me/timesheets",
              },
            },
            SYSTEM_CONTEXT,
          );
          existingKeys.add(key);
          created += 1;
        }

        if (daysUntilDeadline < 0 && employee.lineManagerId) {
          const managerUser = users.find((user) => user.employeeId === employee.lineManagerId);
          const managerKey = `timesheet-overdue-manager-${period.id}-${employee.id}`;
          if (managerUser && !existingKeys.has(managerKey)) {
            notifications.create(
              {
                recipientUserId: managerUser.id,
                type: "Approval",
                title: "Direct-report timesheet overdue",
                message: `${employee.preferredName || employee.legalName} has not submitted the timesheet for ${period.startDate} to ${period.endDate}.`,
                priority: "High",
                status: "Unread",
                deduplicationKey: managerKey,
                link: {
                  entityType: "timesheet-period",
                  entityId: period.id,
                  path: "/staff/timesheet-approvals",
                },
              },
              SYSTEM_CONTEXT,
            );
            existingKeys.add(managerKey);
            created += 1;
          }
        }
      }
    }
    return created;
  }

  reconcileAttendance(timesheet: TimesheetWithEntries): TimesheetAttendanceReconciliation {
    const period = this.periodRepo.getById(timesheet.periodId);
    if (!period) throw new Error("Timesheet period was not found.");
    const settings = this.getSettings();
    const attendanceByDate = new Map(
      this.attendanceService
        .getRecordsForEmployee(timesheet.employeeId, SYSTEM_CONTEXT)
        .filter((record) => record.date >= period.startDate && record.date <= period.endDate)
        .map((record) => [record.date, record]),
    );
    const explanations = timesheet.attendanceDiscrepancyExplanations ?? {};
    const days: DailyAttendanceReconciliation[] = eachDayOfInterval({
      start: parseISO(period.startDate),
      end: parseISO(period.endDate),
    }).map((day) => {
      const date = format(day, "yyyy-MM-dd");
      const record = attendanceByDate.get(date);
      const virtualStatus = record
        ? undefined
        : this.attendanceService.reconcileDailyStatus(timesheet.employeeId, date, SYSTEM_CONTEXT)
            ?.status;
      let workHours = 0;
      let leaveHours = 0;
      let holidayHours = 0;
      for (const entry of timesheet.entries) {
        const hours = entry.hours[date] ?? 0;
        if (entry.isLeave) leaveHours += hours;
        else if (entry.isHoliday) holidayHours += hours;
        else workHours += hours;
      }
      const attendanceHours = record?.calculatedHours ?? 0;
      const attendanceStatus = record?.status ?? virtualStatus ?? "No Record";
      const completeAttendance = Boolean(record?.clockIn && record?.clockOut);
      let status: DailyAttendanceReconciliation["status"] = "Matched";
      let requiresExplanation = false;

      if (attendanceStatus === "On Leave") status = "Leave";
      else if (attendanceStatus === "Holiday") status = "Holiday";
      else if (attendanceStatus === "Rest Day" && workHours === 0) status = "Rest Day";
      else if (record && !completeAttendance) {
        status = "Incomplete Attendance";
        requiresExplanation = workHours > 0;
      } else if (!record && workHours > 0) {
        status = "Missing Attendance";
        requiresExplanation = true;
      } else if (
        completeAttendance &&
        workHours === 0 &&
        attendanceHours > settings.attendanceVarianceToleranceHours
      ) {
        status = "Missing Timesheet";
        requiresExplanation = true;
      } else if (
        Math.abs(workHours - attendanceHours) > settings.attendanceVarianceToleranceHours
      ) {
        status = "Variance";
        requiresExplanation = true;
      }

      const explanation = explanations[date]?.trim();
      return {
        date,
        attendanceHours,
        timesheetWorkHours: workHours,
        leaveHours,
        holidayHours,
        varianceHours: Number((workHours - attendanceHours).toFixed(2)),
        attendanceStatus,
        status,
        requiresExplanation,
        ...(explanation ? { explanation } : {}),
        resolved: !requiresExplanation || Boolean(explanation && explanation.length >= 10),
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      toleranceHours: settings.attendanceVarianceToleranceHours,
      attendanceHours: Number(days.reduce((sum, day) => sum + day.attendanceHours, 0).toFixed(2)),
      timesheetWorkHours: Number(
        days.reduce((sum, day) => sum + day.timesheetWorkHours, 0).toFixed(2),
      ),
      varianceHours: Number(days.reduce((sum, day) => sum + day.varianceHours, 0).toFixed(2)),
      unresolvedCount: days.filter((day) => !day.resolved).length,
      days,
    };
  }

  // Read-only summary for list views - computes expected hours for a period the employee has
  // never opened without calling getOrCreateTimesheet, which persists a new record (and an
  // audit entry) as a side effect. Simply viewing a list of periods must not write data.
  previewTimesheetSummary(
    employeeId: string,
    period: TimesheetPeriod,
  ): { status: "Not Started"; totalHours: number; expectedHours: number } | null {
    const existing = this.timesheetRepo
      .list()
      .find((t) => t.employeeId === employeeId && t.periodId === period.id);
    if (existing) return null;

    const settings = this.getSettings();
    const workingDays = new SettingsService().getAppSettingsSync().workingDays;
    const interval = eachDayOfInterval({
      start: parseISO(period.startDate),
      end: parseISO(period.endDate),
    });
    let expectedHours = 0;
    for (const day of interval) {
      if (workingDays.includes(day.getDay())) {
        expectedHours += settings.standardDailyHours;
      }
    }
    return { status: "Not Started", totalHours: 0, expectedHours };
  }

  getOrCreateTimesheet(
    employeeId: string,
    periodId: string,
    context: ActorContext,
  ): TimesheetWithEntries {
    this.requireSelfOrAdmin(employeeId, context, "create this timesheet");
    const existing = this.timesheetRepo
      .list()
      .find((t) => t.employeeId === employeeId && t.periodId === periodId);
    if (existing) return existing;

    const period = this.periodRepo.getById(periodId);
    if (!period) throw new Error("Period not found");
    if (period.status === "Closed") {
      throw new Error("Cannot create a timesheet in a closed period.");
    }

    const settings = this.getSettings();
    const workingDays = new SettingsService().getAppSettingsSync().workingDays;
    const start = parseISO(period.startDate);
    const end = parseISO(period.endDate);
    const interval = eachDayOfInterval({ start, end });

    const leaveService = new LeaveService();
    const approvedLeaves = leaveService
      .getAllRequests(SYSTEM_CONTEXT)
      .filter(
        (r) => r.employeeId === employeeId && (r.status === "Approved" || r.status === "Taken"),
      );

    const publicHolidaysRepo = getMasterDataRepository("publicHolidays");
    const holidays = publicHolidaysRepo.list().filter((h) => h.isActive);

    let expectedHours = 0;
    const prefilledEntries: TimesheetEntry[] = [];

    // Simple single-entry map for leave and holiday for this week
    const leaveHours: Record<string, number> = {};
    const holidayHours: Record<string, number> = {};

    interval.forEach((day) => {
      if (workingDays.includes(day.getDay())) {
        expectedHours += settings.standardDailyHours;
      }

      const dayStr = format(day, "yyyy-MM-dd");

      const isH = holidays.some((holiday) => {
        const structuredDate = (holiday as typeof holiday & { date?: string }).date;
        return (
          structuredDate === dayStr ||
          holiday.description === dayStr ||
          holiday.name.includes(dayStr)
        );
      });
      if (isH) {
        holidayHours[dayStr] = settings.standardDailyHours;
        return; // Skip checking leave if holiday
      }

      // Check Leave
      const isL = approvedLeaves.some((l) => {
        const lStart = parseISO(l.startDate);
        const lEnd = parseISO(l.endDate);
        return day >= lStart && day <= lEnd;
      });

      if (isL && workingDays.includes(day.getDay())) {
        leaveHours[dayStr] = settings.standardDailyHours;
      }
    });

    if (Object.keys(holidayHours).length > 0) {
      prefilledEntries.push({
        id: crypto.randomUUID(),
        projectId: "HOLIDAY",
        costCentreId: "HOLIDAY",
        activityCodeId: "HOLIDAY",
        locationCodeId: "HOLIDAY",
        hours: holidayHours,
        total: Object.values(holidayHours).reduce((sum, h) => sum + h, 0),
        isHoliday: true,
        notes: "Public Holiday",
      });
    }

    if (Object.keys(leaveHours).length > 0) {
      prefilledEntries.push({
        id: crypto.randomUUID(),
        projectId: "LEAVE",
        costCentreId: "LEAVE",
        activityCodeId: "LEAVE",
        locationCodeId: "LEAVE",
        hours: leaveHours,
        total: Object.values(leaveHours).reduce((sum, h) => sum + h, 0),
        isLeave: true,
        notes: "Approved Leave",
      });
    }

    return this.timesheetRepo.create(
      {
        employeeId,
        periodId,
        status: "Draft",
        expectedHours,
        totalHours: prefilledEntries.reduce((sum, e) => sum + e.total, 0),
        entries: prefilledEntries,
      },
      context,
    );
  }

  saveTimesheetDraft(timesheet: TimesheetWithEntries, context: ActorContext): TimesheetWithEntries {
    this.requireSelfOrAdmin(timesheet.employeeId, context, "save this timesheet");
    const existing = this.timesheetRepo.getById(timesheet.id);
    if (!existing) throw new Error("Timesheet not found");
    const period = this.periodRepo.getById(timesheet.periodId);
    if (!period) throw new Error("Period not found");
    if (period.status === "Closed") {
      throw new Error("Cannot modify a timesheet in a closed period.");
    }
    if (existing.status !== "Draft" && existing.status !== "Returned") {
      throw new Error("Cannot modify a timesheet that is not Draft or Returned.");
    }
    this.validateEntryHours(timesheet, period);

    // Recalculate totals just in case
    let overallTotal = 0;
    timesheet.entries.forEach((e) => {
      let eTotal = 0;
      Object.values(e.hours).forEach((v) => (eTotal += v || 0));
      e.total = eTotal;
      overallTotal += eTotal;
    });
    timesheet.totalHours = overallTotal;

    return this.timesheetRepo.update(timesheet.id, timesheet, context);
  }

  submitTimesheet(timesheetId: string, context: ActorContext): TimesheetWithEntries {
    const ts = this.timesheetRepo.getById(timesheetId);
    if (!ts) throw new Error("Timesheet not found");
    this.requireSelfOrAdmin(ts.employeeId, context, "submit this timesheet");

    const period = this.periodRepo.getById(ts.periodId);
    if (!period) throw new Error("Period not found");
    if (period.status === "Closed") {
      throw new Error("Cannot submit a timesheet in a closed period.");
    }
    if (ts.status !== "Draft" && ts.status !== "Returned") {
      throw new Error("Cannot submit timesheet in current state.");
    }

    // Validation: > 24h per day
    this.validateEntryHours(ts, period);

    const dailyTotals: Record<string, number> = {};
    for (const entry of ts.entries) {
      for (const [date, hrs] of Object.entries(entry.hours)) {
        if (!dailyTotals[date]) dailyTotals[date] = 0;
        dailyTotals[date] += hrs || 0;
      }
    }

    for (const [date, total] of Object.entries(dailyTotals)) {
      if (total > 24) {
        throw new Error(`Total hours on ${date} exceeds 24 hours (${total}h).`);
      }
    }

    // Validation: Required notes if standard entries
    for (const entry of ts.entries) {
      if (!entry.isLeave && !entry.isHoliday) {
        if (!entry.notes || entry.notes.trim().length < 3) {
          throw new Error("Notes are required for all standard time entries.");
        }
      }
    }

    // Validation: Missing project/cost centre/etc, and that each referenced master-data record
    // actually exists and is active - previously only presence was checked, so a stale or
    // fabricated costCentreId/activityCodeId/locationCodeId could pass straight through.
    const projectRepo = getProjectRepository();
    const allProjects = projectRepo.list();
    const allCostCentres = getMasterDataRepository("costCentres").list();
    const allActivityCodes = getMasterDataRepository("activityCodes").list();
    const allLocations = getMasterDataRepository("locations").list();

    for (const entry of ts.entries) {
      if (!entry.isLeave && !entry.isHoliday) {
        if (
          !entry.projectId ||
          !entry.costCentreId ||
          !entry.activityCodeId ||
          !entry.locationCodeId
        ) {
          throw new Error("All fields (Project, Cost Centre, Activity, Location) are required.");
        }

        const proj = allProjects.find((p) => p.id === entry.projectId);
        if (!proj || !proj.isActive) {
          throw new Error(`Project ${proj?.name ?? entry.projectId} is invalid or inactive.`);
        }
        const costCentre = allCostCentres.find((c) => c.id === entry.costCentreId);
        if (!costCentre || !costCentre.isActive) {
          throw new Error(
            `Cost centre ${costCentre?.name ?? entry.costCentreId} is invalid or inactive.`,
          );
        }
        const activity = allActivityCodes.find((a) => a.id === entry.activityCodeId);
        if (!activity || !activity.isActive) {
          throw new Error(
            `Activity code ${activity?.name ?? entry.activityCodeId} is invalid or inactive.`,
          );
        }
        const location = allLocations.find((l) => l.id === entry.locationCodeId);
        if (!location || !location.isActive) {
          throw new Error(
            `Location ${location?.name ?? entry.locationCodeId} is invalid or inactive.`,
          );
        }
      }
    }

    // Validation: Cannot log normal hours on full-day leave/holiday
    // If a day has 8h of leave, they can't log 5h of standard time without > 24h kicking in?
    // Actually standard daily is 8h, but > 24h is the physical cap.
    // The requirement says "Work on full-day approved leave" is an error.
    const settings = this.getSettings();
    for (const entry of ts.entries) {
      if (!entry.isLeave && !entry.isHoliday) {
        for (const [date, hrs] of Object.entries(entry.hours)) {
          if (hrs > 0) {
            // Check if there is full-day leave on this date
            const leaveHrs = ts.entries
              .filter((e) => e.isLeave || e.isHoliday)
              .reduce((sum, e) => sum + (e.hours[date] || 0), 0);
            if (leaveHrs >= settings.standardDailyHours) {
              throw new Error(
                `Cannot log standard hours on ${date} as it is marked as full-day leave/holiday.`,
              );
            }
          }
        }
      }
    }

    const reconciliation = this.reconcileAttendance(ts);
    const unresolvedDates = reconciliation.days
      .filter((day) => !day.resolved)
      .map((day) => day.date);
    if (unresolvedDates.length > 0) {
      throw new Error(
        `Explain the attendance differences for ${unresolvedDates.join(", ")} before submitting.`,
      );
    }

    const employee = new EmployeeService().getById(ts.employeeId, SYSTEM_CONTEXT);
    if (!employee?.lineManagerId) {
      throw new Error(
        "Your supervisor has not been assigned. Ask HR to update your reporting line.",
      );
    }
    ts.status = "Pending Manager";
    ts.submittedAt = new Date().toISOString();
    ts.attendanceReconciliationSnapshot = reconciliation;
    const updated = this.timesheetRepo.update(ts.id, ts, context);
    const { storage, notifications } = getApplicationDataServices();
    const supervisorUser = storage
      .readCollection<User>("users")
      .find((user) => user.employeeId === employee.lineManagerId && user.status === "Active");
    if (supervisorUser) {
      notifications.create(
        {
          recipientUserId: supervisorUser.id,
          type: "Approval",
          title: "Timesheet awaiting your review",
          message: `${employee.preferredName || employee.legalName} submitted a timesheet for your review.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `timesheet-supervisor-${updated.id}-${updated.recordVersion}`,
          link: {
            entityType: "timesheet",
            entityId: updated.id,
            path: `/staff/timesheet-approvals/${updated.id}`,
          },
        },
        context,
      );
    }
    return updated;
  }

  copyPreviousWeek(
    employeeId: string,
    currentPeriodId: string,
    context: ActorContext,
  ): TimesheetWithEntries {
    this.requireSelfOrAdmin(employeeId, context, "copy this timesheet");
    const settings = this.getSettings();
    if (!settings.allowCopyPreviousWeek) {
      throw new Error("Copying previous week is disabled by settings.");
    }

    const currentTs = this.getOrCreateTimesheet(employeeId, currentPeriodId, context);
    if (currentTs.status !== "Draft") {
      throw new Error("Cannot copy into a non-draft timesheet.");
    }

    // Find previous period
    const currentPeriod = this.periodRepo.getById(currentPeriodId);
    if (!currentPeriod) throw new Error("Period not found");

    const allPeriods = this.getPeriods();
    // Assuming periods are continuous, the previous one ends 1 day before this starts
    const expectedPrevEnd = format(addDays(parseISO(currentPeriod.startDate), -1), "yyyy-MM-dd");
    const prevPeriod = allPeriods.find((p) => p.endDate === expectedPrevEnd);

    if (!prevPeriod) {
      throw new Error("Previous period not found.");
    }

    const prevTs = this.timesheetRepo
      .list()
      .find((t) => t.employeeId === employeeId && t.periodId === prevPeriod.id);
    if (!prevTs || prevTs.entries.length === 0) {
      throw new Error("No entries found in the previous week.");
    }

    // Keep every row and hour already entered. Copy adds missing row structures only.
    const newEntries = currentTs.entries.map((entry) => ({
      ...entry,
      hours: { ...entry.hours },
    }));

    // Copy rows from previous (excluding its leave/holidays) but zero out the hours
    prevTs.entries.forEach((e) => {
      if (!e.isLeave && !e.isHoliday) {
        newEntries.push({
          ...e,
          id: crypto.randomUUID(),
          hours: {}, // Empty
          total: 0,
        });
      }
    });

    // De-duplicate exact same Project/CC/Activity/Location combinations
    const uniqueEntries: TimesheetEntry[] = [];
    newEntries.forEach((ne) => {
      const exists = uniqueEntries.find(
        (ue) =>
          ue.projectId === ne.projectId &&
          ue.costCentreId === ne.costCentreId &&
          ue.activityCodeId === ne.activityCodeId &&
          ue.locationCodeId === ne.locationCodeId,
      );
      if (!exists) {
        uniqueEntries.push(ne);
      }
    });

    currentTs.entries = uniqueEntries;
    return this.timesheetRepo.update(currentTs.id, currentTs, context);
  }

  returnTimesheet(
    timesheetId: string,
    reason: string,
    context: ActorContext,
  ): TimesheetWithEntries {
    const ts = this.timesheetRepo.getById(timesheetId);
    if (!ts) throw new Error("Timesheet not found");
    if (ts.status === "Pending Manager") {
      this.requireDirectReport(ts.employeeId, context, "return this timesheet");
    } else if (ts.status === "Pending HR") {
      this.requireHrApproval(context, "return this timesheet");
    } else {
      throw new Error("Only timesheets awaiting review can be returned.");
    }
    if (!reason || reason.trim().length < 3)
      throw new Error("A reason is required to return a timesheet.");

    ts.status = "Returned";
    ts.managerNotes = reason;
    const updated = this.timesheetRepo.update(ts.id, ts, context);
    this.notifyEmployee(updated, context);
    return updated;
  }

  approveTimesheet(timesheetId: string, context: ActorContext): TimesheetWithEntries {
    const ts = this.timesheetRepo.getById(timesheetId);
    if (!ts) throw new Error("Timesheet not found");

    if (ts.status === "Pending Manager") {
      this.requireDirectReport(ts.employeeId, context, "review this timesheet");
      const reconciliation = this.reconcileAttendance(ts);
      if (reconciliation.unresolvedCount > 0) {
        throw new Error(
          "This timesheet has unexplained attendance differences and must be returned to the employee.",
        );
      }
      ts.status = "Pending HR";
      ts.supervisorReviewedAt = new Date().toISOString();
      ts.supervisorReviewedBy = context.actor.userId;
      ts.attendanceReconciliationSnapshot = reconciliation;
      const updated = this.timesheetRepo.update(ts.id, ts, {
        ...context,
        reason: "Supervisor reviewed and sent the timesheet to HR",
      });
      this.notifyHrReviewers(updated, context);
      return updated;
    }

    if (ts.status !== "Pending HR") {
      throw new Error("Only timesheets awaiting supervisor or HR review can be approved.");
    }
    this.requireHrApproval(context, "give final approval to this timesheet");

    const reconciliation = this.reconcileAttendance(ts);
    if (reconciliation.unresolvedCount > 0) {
      throw new Error(
        "This timesheet has unexplained attendance differences and must be returned to the employee.",
      );
    }

    const settings = this.getSettings();
    ts.status =
      settings.payrollLockBehaviour === "Automatic on Approval" ? "Payroll Locked" : "Approved";
    ts.approvedAt = new Date().toISOString();
    ts.approvedBy = context.actor.userId;
    ts.attendanceReconciliationSnapshot = reconciliation;
    const updated = this.timesheetRepo.update(ts.id, ts, {
      ...context,
      reason: "HR completed final timesheet approval",
    });
    this.notifyEmployee(updated, context);
    return updated;
  }

  reopenTimesheet(
    timesheetId: string,
    reason: string,
    context: ActorContext,
  ): TimesheetWithEntries {
    const ts = this.timesheetRepo.getById(timesheetId);
    if (!ts) throw new Error("Timesheet not found");
    if (!reason || reason.trim().length < 3)
      throw new Error("A reason is required to reopen a timesheet.");

    if (ts.status === "Approved") {
      // By this stage HR has already given final approval - only HR/Super Admin may undo that
      // decision, not the line manager whose own review stage is long past.
      this.requireHrApproval(context, "reopen an HR-approved timesheet");
      ts.status = "Returned";
      ts.managerNotes = reason;
      const updated = this.timesheetRepo.update(ts.id, ts, context);
      this.notifyEmployee(updated, context);
      return updated;
    }

    if (ts.status === "Payroll Locked") {
      // Payroll has already consumed this timesheet - reopening it is a finance decision, not a
      // line-manager one.
      if (
        context.actor.activeRole !== "HR" &&
        context.actor.activeRole !== "Accounts" &&
        context.actor.activeRole !== "Super Admin"
      ) {
        this.deny(context, "reopen a payroll-locked timesheet", ts.id);
      }
      const currentPeriod = this.findCorrectionPeriod(ts.employeeId);
      const correctionSummary = this.previewTimesheetSummary(ts.employeeId, currentPeriod);

      // The original entries' hours are keyed by dates from the OLD (locked) period - carrying
      // them as-is into a timesheet for a different period would silently place hours on dates
      // that may not even fall inside the new period. Only the entry metadata (project, cost
      // centre, activity, location) is preserved; hours are cleared so the employee re-enters
      // the correction against the new period's actual dates, the same way copyPreviousWeek
      // hands off rows between periods.
      const correctedEntries: TimesheetEntry[] = ts.entries
        .filter((entry) => !entry.isLeave && !entry.isHoliday)
        .map((entry) => ({
          ...entry,
          id: crypto.randomUUID(),
          hours: {},
          total: 0,
        }));

      const { created } = this.timesheetRepo.createWithSideEffect(
        {
          employeeId: ts.employeeId,
          periodId: currentPeriod.id,
          status: "Returned",
          expectedHours: correctionSummary?.expectedHours ?? ts.expectedHours,
          totalHours: 0,
          entries: correctedEntries,
          managerNotes: `Correction triggered: ${reason}`,
        },
        { id: ts.id, changes: { status: "Corrected", managerNotes: reason } },
        context,
      );
      this.notifyEmployee(created, context);
      return created;
    }

    throw new Error("Only Approved or Payroll Locked timesheets can be reopened.");
  }

  // The manual counterpart to "Automatic on Approval" - lets HR explicitly lock an Approved
  // timesheet for payroll once payrollLockBehaviour is "Manual by HR", rather than the setting
  // existing with no way to actually act on it.
  lockPayroll(timesheetId: string, context: ActorContext): TimesheetWithEntries {
    this.requireHrApproval(context, "lock this timesheet for payroll");
    const ts = this.timesheetRepo.getById(timesheetId);
    if (!ts) throw new Error("Timesheet not found");
    if (ts.status !== "Approved") {
      throw new Error("Only an Approved timesheet can be locked for payroll.");
    }
    ts.status = "Payroll Locked";
    return this.timesheetRepo.update(ts.id, ts, {
      ...context,
      reason: context.reason || "Manually locked for payroll",
    });
  }

  // HR-only lifecycle action closing a period so no timesheet within it can be created,
  // modified, or submitted afterward - the enforcement side of a lifecycle that previously had
  // no way to actually reach "Closed" at all.
  closePeriod(periodId: string, context: ActorContext): TimesheetPeriod {
    this.requireTimesheetAdmin(context, "close this timesheet period");
    const period = this.periodRepo.getById(periodId);
    if (!period) throw new Error("Period not found");
    if (period.status === "Closed") return period;
    const outstanding = this.timesheetRepo
      .list()
      .filter(
        (timesheet) =>
          timesheet.periodId === periodId &&
          !["Approved", "Payroll Locked", "Corrected"].includes(timesheet.status),
      );
    if (outstanding.length > 0) {
      throw new Error(
        `This period has ${outstanding.length} unfinished timesheet${outstanding.length === 1 ? "" : "s"}. Complete or resolve them before closing the period.`,
      );
    }
    return this.periodRepo.update(
      periodId,
      { status: "Closed" },
      { ...context, reason: context.reason || "Timesheet period closed" },
    );
  }

  reopenPeriod(periodId: string, reason: string, context: ActorContext): TimesheetPeriod {
    this.requireTimesheetAdmin(context, "reopen this timesheet period");
    if (reason.trim().length < 5) throw new Error("Enter a reason for reopening the period.");
    const period = this.periodRepo.getById(periodId);
    if (!period) throw new Error("Period not found");
    if (period.status === "Open") return period;
    return this.periodRepo.update(period.id, { status: "Open" }, { ...context, reason });
  }

  getCurrentPeriod(): TimesheetPeriod | undefined {
    const today = new Date().toISOString().slice(0, 10);
    const periods = this.getPeriods();
    return (
      periods.find((period) => period.startDate <= today && period.endDate >= today) ??
      periods.find((period) => period.startDate <= today) ??
      [...periods].reverse().find((period) => period.startDate > today)
    );
  }

  private findCorrectionPeriod(employeeId: string): TimesheetPeriod {
    const today = new Date().toISOString().slice(0, 10);
    const open = this.getPeriods()
      .filter((period) => period.status === "Open")
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const ordered = [
      ...open.filter((period) => period.startDate <= today && period.endDate >= today),
      ...open.filter((period) => period.startDate > today),
      ...open.filter((period) => period.endDate < today).reverse(),
    ];
    const available = ordered.find(
      (period) =>
        !this.timesheetRepo
          .list()
          .some(
            (timesheet) => timesheet.employeeId === employeeId && timesheet.periodId === period.id,
          ),
    );
    if (!available) {
      throw new Error(
        "No open timesheet period is available for this correction without creating a duplicate.",
      );
    }
    return available;
  }

  // Rejects negative hour values (which would silently reduce a total) and any date key that
  // falls outside the timesheet's own period - previously an entry could carry an hours value
  // for a date belonging to a different week entirely with nothing to catch it.
  private validateEntryHours(timesheet: TimesheetWithEntries, period: TimesheetPeriod): void {
    for (const entry of timesheet.entries) {
      for (const [date, hours] of Object.entries(entry.hours)) {
        if (typeof hours === "number" && hours < 0) {
          throw new Error(`Hours on ${date} cannot be negative.`);
        }
        if (date < period.startDate || date > period.endDate) {
          throw new Error(
            `${date} falls outside this timesheet's period (${period.startDate} to ${period.endDate}).`,
          );
        }
      }
    }
  }

  private requireSelfOrAdmin(employeeId: string, context: ActorContext, action: string): void {
    if (context.actor.employeeId === employeeId || context.actor.activeRole === "Super Admin") {
      return;
    }
    this.deny(context, action, employeeId);
  }

  private requireOrganisationRead(context: ActorContext, action: string): void {
    if (["HR", "Accounts", "Super Admin"].includes(context.actor.activeRole ?? "")) return;
    this.deny(context, action, "all-timesheets");
  }

  private requireEmployeeRead(employeeId: string, context: ActorContext, action: string): void {
    if (context.actor.employeeId === employeeId) return;
    if (["HR", "Accounts", "Super Admin"].includes(context.actor.activeRole ?? "")) return;
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
      if (employee?.lineManagerId === context.actor.employeeId) return;
    }
    this.deny(context, action, employeeId);
  }

  private requireTimesheetAdmin(context: ActorContext, action: string): void {
    if (["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) return;
    this.deny(context, action, "timesheet-settings");
  }

  private requireDirectReport(employeeId: string, context: ActorContext, action: string): void {
    const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
    if (
      context.actor.activeRole === "Line Manager" &&
      context.actor.employeeId &&
      employee?.lineManagerId === context.actor.employeeId
    ) {
      return;
    }
    if (["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) {
      if ((context.reason?.trim().length ?? 0) < 5) {
        getApplicationDataServices().audit.record({
          context,
          action: "timesheet_access_denied",
          module: "timesheets",
          entityType: "timesheet",
          entityId: employeeId,
          reason: "Supervisor recovery was attempted without the required explanation.",
          riskLevel: "High",
        });
        throw new Error("Enter a reason for completing the unavailable supervisor's review.");
      }
      return;
    }
    this.deny(context, action, employeeId);
  }

  private requireHrApproval(context: ActorContext, action: string): void {
    if (["HR", "Super Admin"].includes(context.actor.activeRole ?? "")) return;
    this.deny(context, action, "hr-approval");
  }

  private notifyHrReviewers(timesheet: TimesheetWithEntries, context: ActorContext): void {
    const { storage, notifications } = getApplicationDataServices();
    const employee = new EmployeeService().getById(timesheet.employeeId, SYSTEM_CONTEXT);
    for (const user of storage.readCollection<User>("users")) {
      if (
        user.status !== "Active" ||
        !user.roles.some((role) => role === "HR" || role === "Super Admin")
      )
        continue;
      notifications.create(
        {
          recipientUserId: user.id,
          type: "Approval",
          title: "Timesheet ready for HR approval",
          message: `${employee?.preferredName || employee?.legalName || "An employee"}'s timesheet has been reviewed by their supervisor.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `timesheet-hr-${timesheet.id}-${timesheet.recordVersion}`,
          link: {
            entityType: "timesheet",
            entityId: timesheet.id,
            path: `/staff/timesheet-approvals/${timesheet.id}`,
          },
        },
        context,
      );
    }
  }

  private notifyEmployee(timesheet: TimesheetWithEntries, context: ActorContext): void {
    const { storage, notifications } = getApplicationDataServices();
    const user = storage
      .readCollection<User>("users")
      .find(
        (candidate) =>
          candidate.employeeId === timesheet.employeeId && candidate.status === "Active",
      );
    if (!user) return;
    notifications.create(
      {
        recipientUserId: user.id,
        type: "Success",
        title: "Timesheet approved",
        message: "HR has approved your timesheet.",
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `timesheet-approved-${timesheet.id}`,
        link: { entityType: "timesheet", entityId: timesheet.id, path: "/staff/me/timesheets" },
      },
      context,
    );
  }

  private deny(context: ActorContext, action: string, entityId: string): never {
    getApplicationDataServices().audit.record({
      context,
      action: "timesheet_access_denied",
      module: "timesheets",
      entityType: "timesheet",
      entityId,
      reason: `Not authorised to ${action}.`,
      riskLevel: "High",
    });
    throw new Error(`You are not authorised to ${action}.`);
  }
}
