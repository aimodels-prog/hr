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
import { getMasterDataRepository } from "../src/lib/data/master-data.ts";
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
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: {} as never });
  const attendance = new AttendanceService();
  const timesheets = new TimesheetService(attendance);
  timesheets.generatePeriods("2026-08-17", "2026-08-30", hr);
  const [period, nextPeriod] = timesheets
    .getPeriods()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { attendance, audit, storage, timesheets, period: period!, nextPeriod: nextPeriod! };
}

function addAttendance(attendance: AttendanceService, date: string) {
  return attendance.saveRecord(
    {
      employeeId: "employee-omar",
      date,
      expectedClockIn: "09:00",
      expectedClockOut: "18:00",
      clockIn: "09:00",
      clockOut: "18:00",
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

function fillEntry(
  timesheet: TimesheetWithEntries,
  date: string,
  hours: number,
  overrides: Partial<TimesheetWithEntries["entries"][0]> = {},
) {
  timesheet.entries.push({
    id: crypto.randomUUID(),
    projectId: "proj-001",
    costCentreId: "cc-operations",
    activityCodeId: "activity-delivery",
    locationCodeId: "loc-muscat",
    hours: { [date]: hours },
    total: hours,
    notes: "Delivery work.",
    ...overrides,
  });
  timesheet.totalHours += hours;
}

test("a closed period rejects creating, saving, or submitting a timesheet", () => {
  const { timesheets, period, storage } = harness();
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  assert.throws(() => timesheets.closePeriod(period.id, hr), /unfinished timesheet/);
  const records = storage.readCollection<TimesheetWithEntries>("timesheets");
  storage.writeCollection(
    "timesheets",
    records.map((record) =>
      record.id === ts.id ? { ...record, status: "Corrected" as const } : record,
    ),
  );
  timesheets.closePeriod(period.id, hr);

  assert.throws(() => timesheets.saveTimesheetDraft(ts, employee), /closed period/);
  assert.throws(() => timesheets.submitTimesheet(ts.id, employee), /closed period/);
  assert.throws(
    () => timesheets.getOrCreateTimesheet("employee-mariam", period.id, accounts),
    /closed period/,
  );
});

test("timesheet reads are enforced inside the service", () => {
  const { timesheets, audit, period } = harness();
  timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);

  assert.equal(timesheets.getTimesheetsForEmployee("employee-omar", employee).length, 1);
  assert.equal(timesheets.getTimesheetsForEmployee("employee-omar", manager).length, 1);
  assert.throws(
    () => timesheets.getTimesheetsForEmployee("employee-mariam", employee),
    /not authorised/,
  );
  assert.throws(() => timesheets.getAllTimesheets(employee), /not authorised/);
  assert.equal(timesheets.getAllTimesheets(accounts).length, 1);
  assert.ok(
    audit
      .list()
      .some((event) => event.module === "timesheets" && event.action === "timesheet_access_denied"),
  );
});

test("only HR/Super Admin can close a period", () => {
  const { timesheets, period } = harness();
  assert.throws(() => timesheets.closePeriod(period.id, employee), /not authorised/);
  assert.throws(() => timesheets.closePeriod(period.id, manager), /not authorised/);
});

test("negative hours are rejected", () => {
  const { timesheets, period } = harness();
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, period.startDate, -2);
  assert.throws(() => timesheets.saveTimesheetDraft(ts, employee), /cannot be negative/);
});

test("hours dated outside the timesheet's own period are rejected", () => {
  const { timesheets, period, nextPeriod } = harness();
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, nextPeriod.startDate, 4);
  assert.throws(() => timesheets.saveTimesheetDraft(ts, employee), /falls outside/);
});

test("submitting requires real, active cost centre / activity / location references", () => {
  const { timesheets, period } = harness();
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, period.startDate, 8, { costCentreId: "cc-does-not-exist" });
  timesheets.saveTimesheetDraft(ts, employee);
  assert.throws(() => timesheets.submitTimesheet(ts.id, employee), /Cost centre/);
});

test("Lock for Payroll: only HR can manually lock an Approved timesheet, and only from Approved", () => {
  const { timesheets, attendance, period } = harness();
  addAttendance(attendance, period.startDate);
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, period.startDate, 8);
  timesheets.saveTimesheetDraft(ts, employee);
  timesheets.submitTimesheet(ts.id, employee);
  timesheets.approveTimesheet(ts.id, manager);
  const approved = timesheets.approveTimesheet(ts.id, hr);
  assert.equal(approved.status, "Approved");

  assert.throws(() => timesheets.lockPayroll(approved.id, manager), /not authorised/);

  const locked = timesheets.lockPayroll(approved.id, hr);
  assert.equal(locked.status, "Payroll Locked");

  assert.throws(() => timesheets.lockPayroll(locked.id, hr), /Only an Approved timesheet/);
});

test("a line manager cannot reopen an HR-approved or payroll-locked timesheet", () => {
  const { timesheets, attendance, period } = harness();
  addAttendance(attendance, period.startDate);
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, period.startDate, 8);
  timesheets.saveTimesheetDraft(ts, employee);
  timesheets.submitTimesheet(ts.id, employee);
  timesheets.approveTimesheet(ts.id, manager);
  const approved = timesheets.approveTimesheet(ts.id, hr);

  assert.throws(
    () => timesheets.reopenTimesheet(approved.id, "please redo", manager),
    /not authorised/,
  );
  const reopened = timesheets.reopenTimesheet(approved.id, "please redo", hr);
  assert.equal(reopened.status, "Returned");
});

test("reopening a Payroll Locked timesheet does not carry stale dated hours into the new period", () => {
  const { timesheets, attendance, period, nextPeriod } = harness();
  addAttendance(attendance, period.startDate);
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, period.startDate, 8);
  timesheets.saveTimesheetDraft(ts, employee);
  timesheets.submitTimesheet(ts.id, employee);
  timesheets.approveTimesheet(ts.id, manager);
  const approved = timesheets.approveTimesheet(ts.id, hr);
  const locked = timesheets.lockPayroll(approved.id, hr);

  const corrected = timesheets.reopenTimesheet(locked.id, "correction needed", hr);
  assert.equal(corrected.periodId, nextPeriod.id);
  assert.equal(corrected.status, "Returned");
  assert.equal(corrected.totalHours, 0);
  for (const entry of corrected.entries) {
    assert.deepEqual(
      entry.hours,
      {},
      "corrected entries must start with no hours carried over from the old period's dates",
    );
  }

  const original = timesheets
    .getTimesheetsForEmployee("employee-omar", employee)
    .find((t) => t.id === locked.id);
  assert.equal(original?.status, "Corrected");
});

test("Accounts can also reopen a payroll-locked timesheet", () => {
  const { timesheets, attendance, period } = harness();
  addAttendance(attendance, period.startDate);
  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(ts, period.startDate, 8);
  timesheets.saveTimesheetDraft(ts, employee);
  timesheets.submitTimesheet(ts.id, employee);
  timesheets.approveTimesheet(ts.id, manager);
  const approved = timesheets.approveTimesheet(ts.id, hr);
  const locked = timesheets.lockPayroll(approved.id, hr);

  const corrected = timesheets.reopenTimesheet(locked.id, "correction needed", accounts);
  assert.equal(corrected.status, "Returned");
});

test("viewing the timesheet list does not create or persist any timesheet records", () => {
  const { timesheets, period, storage } = harness();
  const before = storage.readCollection("timesheets").length;
  const preview = timesheets.previewTimesheetSummary("employee-omar", period);
  assert.ok(preview);
  assert.equal(preview!.status, "Not Started");
  const after = storage.readCollection("timesheets").length;
  assert.equal(before, after, "previewing must not write a timesheet record");
});

test("working days are computed from the organisation's configured working week, not a hardcoded Sat/Sun weekend", () => {
  const { timesheets, period } = harness();
  // Oman's configured working week (seed data) is Sun-Thu (days 0-4); Fri (5) and Sat (6) are
  // rest days. Under the OLD date-fns isWeekend() logic (which only ever excludes Sat/Sun),
  // Sunday would incorrectly count as an expected working day and Friday would incorrectly be
  // excluded - this asserts against the org's actual configured week instead.
  const start = new Date(`${period.startDate}T00:00:00`);
  const end = new Date(`${period.endDate}T00:00:00`);
  let expectedWorkingDays = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if ([0, 1, 2, 3, 4].includes(d.getDay())) expectedWorkingDays++;
  }

  const ts = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  assert.equal(ts.expectedHours, expectedWorkingDays * 8);
});

test("structured public-holiday dates prefill a holiday row", () => {
  const { timesheets, period } = harness();
  getMasterDataRepository("publicHolidays").create(
    {
      name: "VIA Operations Day",
      code: "OPS_DAY",
      description: "Office holiday",
      date: period.startDate,
      isActive: true,
      orderIndex: 99,
    } as never,
    hr,
  );
  const timesheet = timesheets.getOrCreateTimesheet("employee-mariam", period.id, accounts);
  assert.equal(
    timesheet.entries.find((entry) => entry.isHoliday)?.hours[period.startDate],
    timesheets.getSettings().standardDailyHours,
  );
});

test("copying the previous week keeps work already entered in the current week", () => {
  const { timesheets, period, nextPeriod } = harness();
  const previous = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  fillEntry(previous, period.startDate, 8);
  timesheets.saveTimesheetDraft(previous, employee);

  const current = timesheets.getOrCreateTimesheet("employee-omar", nextPeriod.id, employee);
  fillEntry(current, nextPeriod.startDate, 5);
  timesheets.saveTimesheetDraft(current, employee);
  const copied = timesheets.copyPreviousWeek("employee-omar", nextPeriod.id, employee);

  assert.equal(copied.entries.find((entry) => entry.hours[nextPeriod.startDate] === 5)?.total, 5);
  assert.equal(copied.totalHours, 5);
});

test("HR can reopen a closed timesheet period with a recorded reason", () => {
  const { timesheets, period } = harness();
  const closed = timesheets.closePeriod(period.id, hr);
  assert.equal(closed.status, "Closed");
  assert.throws(
    () => timesheets.reopenPeriod(period.id, "Manager request", manager),
    /not authorised/,
  );
  const reopened = timesheets.reopenPeriod(period.id, "Correction work must be completed", hr);
  assert.equal(reopened.status, "Open");
});
