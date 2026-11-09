import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AttendanceService } from "../src/lib/data/attendance-service.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { TimesheetService } from "../src/lib/data/timesheet-service.ts";
import { recordedAttendanceHours } from "../src/lib/data/recorded-hours.ts";
import type { TimesheetWithEntries } from "../src/lib/data/timesheet-types.ts";
import type { ActorContext } from "../src/lib/data/types.ts";

const employee: ActorContext = {
  actor: {
    userId: "user-omar",
    employeeId: "employee-omar",
    displayName: "Omar Rahman",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

const manager: ActorContext = {
  actor: {
    userId: "user-layla",
    employeeId: "employee-layla",
    displayName: "Layla Al Harthy",
    activeRole: "Line Manager",
    roles: ["Employee", "Line Manager"],
  },
};

const hr: ActorContext = {
  actor: {
    userId: "user-rana",
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};

const accounts: ActorContext = {
  actor: {
    userId: "user-mariam",
    employeeId: "employee-mariam",
    displayName: "Mariam Said",
    activeRole: "Accounts",
    roles: ["Employee", "Accounts"],
  },
};

function harness() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  storage.writeCollection("attendanceTracking", [
    {
      headOfficeLocationId: "loc-muscat",
      effectiveFrom: "2020-01-01",
      revision: 1,
      assignments: storage
        .readCollection<{ id: string; databaseId?: string }>("employees")
        .map((person) => ({
          employeeId: person.databaseId ?? person.id,
          effectiveFrom: "2020-01-01",
          mode: "Head Office biometric",
          source: "location",
        })),
    },
  ]);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: {} as never });
  const attendance = new AttendanceService();
  const timesheets = new TimesheetService(attendance);
  // Retained weekly history must still reconcile correctly after the monthly cutover.
  storage.writeCollection("timesheetSettings", [
    { ...timesheets.getSettings(), periodFrequency: "Weekly" },
  ]);
  timesheets.generatePeriods("2026-08-17", "2026-08-23", hr);
  const period = timesheets.getPeriods()[0]!;
  return { attendance, audit, storage, timesheets, period };
}

function addAttendance(attendance: AttendanceService, date: string, clockOut = "18:00") {
  return attendance.saveRecord(
    {
      employeeId: "employee-omar",
      date,
      expectedClockIn: "09:00",
      expectedClockOut: "18:00",
      clockIn: "09:00",
      clockOut,
      breakMinutes: 60,
      location: "Muscat Office",
      locationId: "loc-muscat",
      source: "Manual Entry",
      workMode: "Office",
      status: "Present",
      calculatedHours: 0,
      isLate: false,
      isEarlyDeparture: false,
    },
    hr,
  );
}

function addProjectHours(timesheet: TimesheetWithEntries, date: string, hours: number) {
  timesheet.entries.push({
    id: crypto.randomUUID(),
    projectId: "proj-001",
    costCentreId: "cc-operations",
    activityCodeId: "activity-delivery",
    locationCodeId: "loc-muscat",
    hours: { [date]: hours },
    total: hours,
    notes: "Project delivery and client coordination.",
  });
  timesheet.totalHours += hours;
}

test("existing drafts automatically receive current leave and half-day credit; approved sheets stay frozen", () => {
  const { attendance, timesheets, period, storage } = harness();
  const draft = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const leave = {
    id: "approved-leave-test",
    employeeId: "employee-omar",
    startDate: "2026-08-17",
    endDate: "2026-08-23",
    isHalfDay: false,
    status: "Approved",
    policySnapshot: { name: "Annual Leave — imported history" },
  };
  storage.writeCollection("leave_requests", [leave]);
  const filled = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  assert.equal(filled.id, draft.id);
  assert.equal(filled.totalHours, 0);
  assert.equal(filled.expectedHours, 0);
  assert.equal(filled.entries[0]!.total, 40);
  assert.equal(timesheets.reconcileAttendance(filled).unresolvedCount, 0);
  assert.equal(
    attendance.reconcileDailyStatus("employee-omar", "2026-08-17", hr)?.status,
    "On Leave",
  );
  assert.equal(
    attendance.reconcileDailyStatus("employee-omar", "2026-08-24", hr)?.status,
    "Absent",
    "normal attendance resumes after the last approved date",
  );
  storage.writeCollection("leave_requests", [
    { ...leave, startDate: "2026-08-17", endDate: "2026-08-17", isHalfDay: true },
  ]);
  const partial = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  assert.equal(partial.expectedHours, 36);
  assert.equal(partial.entries[0]!.total, 4);
  assert.equal(
    attendance.reconcileDailyStatus("employee-omar", "2026-08-17", hr)?.status,
    "Half-day Leave",
  );
  storage.writeCollection("leave_requests", [{ ...leave, status: "Cancelled" }]);
  assert.equal(
    timesheets.getOrCreateTimesheet("employee-omar", period.id, employee).entries.length,
    0,
  );
  storage.writeCollection("leave_requests", [leave]);
  const submitted = timesheets.submitTimesheet(
    timesheets.saveTimesheetDraft(filled, employee).id,
    employee,
  );
  timesheets.approveTimesheet(submitted.id, manager);
  const approved = timesheets.approveTimesheet(submitted.id, hr);
  storage.writeCollection("leave_requests", [{ ...leave, status: "Cancelled" }]);
  assert.deepEqual(
    timesheets.getOrCreateTimesheet("employee-omar", period.id, employee).entries,
    approved.entries,
  );
  assert.deepEqual(
    timesheets.reconcileAttendance(
      timesheets.getOrCreateTimesheet("employee-omar", period.id, employee),
    ),
    approved.attendanceReconciliationSnapshot,
    "approved history retains its original reconciliation after a policy or source-data change",
  );
  const legacySnapshot = {
    ...approved.attendanceReconciliationSnapshot!,
    attendanceHours: 45,
    timesheetWorkHours: 45,
  };
  assert.strictEqual(
    timesheets.reconcileAttendance({
      ...approved,
      status: "Payroll Locked",
      expectedHours: 45,
      totalHours: 45,
      attendanceReconciliationSnapshot: legacySnapshot,
    }),
    legacySnapshot,
    "a locked historical nine-hour snapshot is not recalculated under today's eight-hour rule",
  );
});

test("real attendance during full leave remains evidence for HR rather than being erased", () => {
  const { attendance, timesheets, period, storage } = harness();
  storage.writeCollection("leave_requests", [
    {
      id: "leave",
      employeeId: "employee-omar",
      startDate: "2026-08-17",
      endDate: "2026-08-21",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Annual Leave" },
    },
  ]);
  addAttendance(attendance, "2026-08-17");
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  assert.equal(attendance.getRecordsForEmployee("employee-omar", employee)[0]!.clockIn, "09:00");
  const day = timesheets.reconcileAttendance(sheet).days.find((row) => row.date === "2026-08-17");
  assert.equal(day?.timesheetWorkHours, 8);
  assert.equal(day?.status, "Variance");
  assert.equal(timesheets.getPeriodSummary("employee-omar", period, sheet).creditedHours, 32);
  assert.equal(day?.requiresExplanation, true);
  addProjectHours(sheet, "2026-08-17", 9);
  timesheets.saveTimesheetDraft(sheet, employee);
  assert.throws(() => timesheets.submitTimesheet(sheet.id, employee), /full-day leave/);
});

test("staff outside biometric tracking submit project hours without punch explanations", () => {
  const { storage, timesheets, period } = harness();
  storage.writeCollection("attendanceTracking", []);
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 9);
  const saved = timesheets.saveTimesheetDraft(timesheet, employee);
  assert.equal(timesheets.reconcileAttendance(saved).unresolvedCount, 0);
  assert.equal(timesheets.submitTimesheet(saved.id, employee).status, "Pending Manager");
  const reviewed = timesheets.approveTimesheet(saved.id, manager);
  assert.equal(reviewed.status, "Pending HR");
  assert.equal(reviewed.approvedAt, undefined);
  assert.equal(timesheets.approveTimesheet(saved.id, hr).status, "Approved");
});

test("complete punches supply work hours even without manual project allocation", () => {
  const { attendance, storage, timesheets, period } = harness();
  storage.writeCollection("attendanceTracking", []);
  addAttendance(attendance, "2026-08-17");
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);

  const blank = timesheets.reconcileAttendance(sheet);
  const day = blank.days.find((item) => item.date === "2026-08-17");
  assert.equal(day?.attendanceHours, 8);
  assert.equal(day?.timesheetWorkHours, 8);
  assert.equal(day?.status, "Matched");
  assert.equal(day?.requiresExplanation, false);
  assert.equal(blank.unresolvedCount, 0, "optional attendance does not block a timesheet");

  addProjectHours(sheet, "2026-08-17", 8);
  assert.equal(
    timesheets.reconcileAttendance(sheet).days.find((item) => item.date === "2026-08-17")?.status,
    "Matched",
  );
});

test("a complete month of punches can be submitted without duplicate project rows", () => {
  const { attendance, timesheets, period } = harness();
  for (const date of ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"])
    addAttendance(attendance, date);
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const summary = timesheets.getPeriodSummary("employee-omar", period, sheet);
  assert.equal(summary.workedHours, 40);
  assert.equal(summary.creditedHours, 40);
  assert.equal(summary.requiredWorkHours, 40);
  assert.equal(timesheets.submitTimesheet(sheet.id, employee).status, "Pending Manager");
});

test("nine hours of office presence yield eight work hours, but eight hours across lunch yield seven", () => {
  const { attendance, timesheets, period } = harness();
  const full = addAttendance(attendance, "2026-08-17", "18:00");
  for (const date of ["2026-08-18", "2026-08-19", "2026-08-20"])
    addAttendance(attendance, date, "18:00");
  const short = addAttendance(attendance, "2026-08-21", "17:00");
  assert.equal(recordedAttendanceHours(full), 9);
  assert.equal(recordedAttendanceHours(short), 8);
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const days = timesheets.reconcileAttendance(sheet).days;
  assert.equal(days.find((day) => day.date === "2026-08-17")?.timesheetWorkHours, 8);
  assert.equal(days.find((day) => day.date === "2026-08-21")?.timesheetWorkHours, 7);
  const summary = timesheets.getPeriodSummary("employee-omar", period, sheet);
  assert.equal(summary.workedHours, 39);
  assert.equal(summary.requiredWorkHours, 40);
});

test("paid leave credits configured eight work hours while unpaid leave covers a day at zero credit", () => {
  const { attendance, timesheets, period, storage } = harness();
  storage.writeCollection("leave_requests", [
    {
      id: "paid-leave",
      employeeId: "employee-omar",
      startDate: "2026-08-17",
      endDate: "2026-08-17",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Annual Leave", isPaid: true },
    },
    {
      id: "unpaid-leave",
      employeeId: "employee-omar",
      startDate: "2026-08-23",
      endDate: "2026-08-23",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Unpaid Leave", isPaid: false },
    },
  ]);
  for (const date of ["2026-08-18", "2026-08-19", "2026-08-20"]) addAttendance(attendance, date);
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const summary = timesheets.getPeriodSummary("employee-omar", period, sheet);
  assert.deepEqual(summary, {
    workedHours: 24,
    paidLeaveHours: 8,
    unpaidLeaveHours: 8,
    holidayHours: 0,
    creditedHours: 32,
    requiredWorkHours: 24,
  });
  assert.equal(timesheets.submitTimesheet(sheet.id, employee).status, "Pending Manager");
});

test("approved remote work is visible but still needs actual work hours, not a biometric punch", () => {
  const { attendance, timesheets, period, storage } = harness();
  storage.writeCollection("leave_requests", [
    {
      id: "remote-work-monday",
      employeeId: "employee-omar",
      startDate: "2026-08-17",
      endDate: "2026-08-17",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Remote Work Day", type: "Remote", isPaid: true },
    },
    {
      id: "remote-work-weekend",
      employeeId: "employee-omar",
      startDate: "2026-08-22",
      endDate: "2026-08-22",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Remote Work Day", type: "Remote", isPaid: true },
    },
  ]);
  for (const date of ["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"])
    addAttendance(attendance, date);
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const remote = sheet.entries.find((entry) => entry.isRemoteWork);
  assert.equal(remote?.hours["2026-08-17"], 0);
  assert.equal(remote?.hours["2026-08-22"], 0);
  assert.equal(sheet.expectedHours, 40);
  const before = timesheets.getPeriodSummary("employee-omar", period, sheet);
  assert.equal(before.workedHours, 32);
  assert.equal(before.paidLeaveHours, 0);
  const remoteDayBefore = timesheets
    .reconcileAttendance(sheet)
    .days.find((day) => day.date === "2026-08-17");
  assert.equal(remoteDayBefore?.status, "Missing Timesheet");
  assert.equal(remoteDayBefore?.requiresExplanation, false);
  const weekendBefore = timesheets
    .reconcileAttendance(sheet)
    .days.find((day) => day.date === "2026-08-22");
  assert.equal(weekendBefore?.status, "Rest Day");
  assert.equal(weekendBefore?.requiresExplanation, false);

  addProjectHours(sheet, "2026-08-17", 8);
  const saved = timesheets.saveTimesheetDraft(sheet, employee);
  const monday = timesheets
    .reconcileAttendance(saved)
    .days.find((day) => day.date === "2026-08-17");
  assert.equal(monday?.attendanceStatus, "Remote Work");
  assert.equal(monday?.status, "Matched");
  assert.equal(monday?.requiresExplanation, false);
  assert.equal(monday?.timesheetWorkHours, 8);
  const summary = timesheets.getPeriodSummary("employee-omar", period, saved);
  assert.equal(summary.paidLeaveHours, 0);
  assert.equal(summary.workedHours, 40);
  assert.equal(timesheets.submitTimesheet(saved.id, employee).status, "Pending Manager");
});

test("a half-day leave and full punch show actual work without double-crediting leave", () => {
  const { attendance, timesheets, period, storage } = harness();
  storage.writeCollection("leave_requests", [
    {
      id: "half-day",
      employeeId: "employee-omar",
      startDate: "2026-08-17",
      endDate: "2026-08-17",
      isHalfDay: true,
      status: "Approved",
      policySnapshot: { name: "Annual Leave", isPaid: true },
    },
  ]);
  addAttendance(attendance, "2026-08-17");
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const day = timesheets.reconcileAttendance(sheet).days.find((row) => row.date === "2026-08-17");
  const summary = timesheets.getPeriodSummary("employee-omar", period, sheet);
  assert.equal(day?.timesheetWorkHours, 8);
  assert.equal(day?.status, "Variance");
  assert.equal(day?.requiresExplanation, true);
  assert.equal(summary.workedHours, 8);
  assert.equal(summary.paidLeaveHours, 4);
  assert.equal(summary.creditedHours, 8);
});

test("ten actual hours remain ten beside a half-day leave, while extra leave credit is suppressed", () => {
  const { attendance, timesheets, period, storage } = harness();
  storage.writeCollection("leave_requests", [
    {
      id: "half-day-ten-hours",
      employeeId: "employee-omar",
      startDate: "2026-08-17",
      endDate: "2026-08-17",
      isHalfDay: true,
      status: "Approved",
      policySnapshot: { name: "Annual Leave", isPaid: true },
    },
  ]);
  addAttendance(attendance, "2026-08-17", "20:00");
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const day = timesheets.reconcileAttendance(sheet).days.find((row) => row.date === "2026-08-17");
  const summary = timesheets.getPeriodSummary("employee-omar", period, sheet);
  assert.equal(day?.attendanceHours, 10);
  assert.equal(day?.timesheetWorkHours, 10);
  assert.equal(day?.status, "Variance");
  assert.equal(summary.workedHours, 10);
  assert.equal(summary.paidLeaveHours, 4);
  assert.equal(summary.creditedHours, 10);
});

test("matching project and attendance hours reconcile without an explanation", () => {
  const { attendance, timesheets, period } = harness();
  addAttendance(attendance, "2026-08-17");
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 8);
  for (const entry of timesheet.entries) if (!entry.isLeave && !entry.isHoliday) entry.notes = "";
  const saved = timesheets.saveTimesheetDraft(timesheet, employee);
  const reconciliation = timesheets.reconcileAttendance(saved);

  assert.equal(reconciliation.days.find((day) => day.date === "2026-08-17")?.status, "Matched");
  assert.equal(reconciliation.unresolvedCount, 0);
  assert.equal(timesheets.submitTimesheet(saved.id, employee).status, "Pending Manager");
});

test("an unexplained attendance variance blocks submission", () => {
  const { attendance, timesheets, period } = harness();
  addAttendance(attendance, "2026-08-17");
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 6);
  const saved = timesheets.saveTimesheetDraft(timesheet, employee);

  assert.throws(
    () => timesheets.submitTimesheet(saved.id, employee),
    /Explain the attendance differences/,
  );
});

test("ten actual work hours stay visible alongside eight project hours without creating overtime", () => {
  const { attendance, timesheets, period, storage } = harness();
  addAttendance(attendance, "2026-08-17", "20:00");
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(sheet, "2026-08-17", 8);
  const saved = timesheets.saveTimesheetDraft(sheet, employee);
  const reconciliation = timesheets.reconcileAttendance(saved);
  const extraDay = reconciliation.days.find((day) => day.date === "2026-08-17");
  assert.equal(extraDay?.attendanceHours, 10);
  assert.equal(extraDay?.timesheetWorkHours, 10);
  assert.equal(extraDay?.projectHours, 8);
  assert.equal(extraDay?.varianceHours, -2);
  assert.equal(extraDay?.status, "Matched");
  assert.equal(reconciliation.unresolvedCount, 0);
  assert.equal(timesheets.getPeriodSummary("employee-omar", period, saved).workedHours, 10);
  const before = storage.readCollection("overtimeClaims").length;
  timesheets.submitTimesheet(saved.id, employee);
  assert.equal(timesheets.approveTimesheet(saved.id, manager).status, "Pending HR");
  assert.equal(timesheets.approveTimesheet(saved.id, hr).status, "Approved");
  assert.equal(storage.readCollection("overtimeClaims").length, before);
  assert.equal(
    attendance
      .getRecordsForEmployee("employee-omar", employee)
      .find((row) => row.date === "2026-08-17")?.calculatedHours,
    10,
  );
});

test("ten actual work hours remain visible without any optional project row", () => {
  const { attendance, timesheets, period, storage } = harness();
  addAttendance(attendance, "2026-08-17", "20:00");
  const sheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  const day = timesheets.reconcileAttendance(sheet).days.find((item) => item.date === "2026-08-17");
  assert.equal(day?.attendanceHours, 10);
  assert.equal(day?.timesheetWorkHours, 10);
  assert.equal(day?.projectHours, 0);
  assert.equal(day?.varianceHours, 0);
  assert.equal(day?.status, "Matched");
  assert.equal(timesheets.getPeriodSummary("employee-omar", period, sheet).workedHours, 10);
  assert.equal(storage.readCollection("overtimeClaims").length, 0);
});

test("a meaningful variance explanation is persisted, audited, and permits approval", () => {
  const { attendance, audit, timesheets, period } = harness();
  addAttendance(attendance, "2026-08-17");
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 6);
  timesheet.attendanceDiscrepancyExplanations = {
    "2026-08-17": "Two hours were spent on mandatory internal training.",
  };
  const saved = timesheets.saveTimesheetDraft(timesheet, employee);
  const submitted = timesheets.submitTimesheet(saved.id, employee);

  assert.equal(submitted.attendanceReconciliationSnapshot?.unresolvedCount, 0);
  assert.throws(
    () => timesheets.approveTimesheet(submitted.id, hr),
    /reason for completing the unavailable supervisor's review/,
  );
  assert.equal(timesheets.approveTimesheet(submitted.id, manager).status, "Pending HR");
  assert.equal(timesheets.approveTimesheet(submitted.id, hr).status, "Approved");
  assert.equal(
    audit.list().some((event) => event.module === "timesheets" && event.entityId === submitted.id),
    true,
  );
  assert.equal(
    audit.list().some((event) => event.action === "timesheet_access_denied"),
    true,
  );
});

test("a new attendance correction after submission is recalculated before manager approval", () => {
  const { attendance, timesheets, period } = harness();
  const record = addAttendance(attendance, "2026-08-17");
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 8);
  const saved = timesheets.saveTimesheetDraft(timesheet, employee);
  const submitted = timesheets.submitTimesheet(saved.id, employee);

  attendance.updateRecord(record.id, { clockOut: "17:00" }, hr);
  assert.throws(
    () => timesheets.approveTimesheet(submitted.id, manager),
    /unexplained attendance differences/,
  );
});

test("Finance can read organisation timesheets but cannot approve them", () => {
  const { attendance, timesheets, period } = harness();
  addAttendance(attendance, "2026-08-17");
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 8);
  const submitted = timesheets.submitTimesheet(
    timesheets.saveTimesheetDraft(timesheet, employee).id,
    employee,
  );

  assert.ok(
    timesheets.getTimesheetsForContext(accounts).some((candidate) => candidate.id === submitted.id),
  );
  assert.throws(() => timesheets.approveTimesheet(submitted.id, accounts), /not authorised/);
});
