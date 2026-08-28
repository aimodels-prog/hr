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

test("matching project and attendance hours reconcile without an explanation", () => {
  const { attendance, timesheets, period } = harness();
  addAttendance(attendance, "2026-08-17");
  const timesheet = timesheets.getOrCreateTimesheet("employee-omar", period.id, employee);
  addProjectHours(timesheet, "2026-08-17", 8);
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
