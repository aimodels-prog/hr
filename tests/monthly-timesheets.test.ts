import assert from "node:assert/strict";
import test from "node:test";
import {
  timesheetPeriodDates,
  timesheetPeriodsInRange,
  isConfiguredTimesheetPeriod,
  timesheetPeriodLabel,
} from "../src/lib/data/timesheet-periods.ts";
import { organisationDate } from "../src/lib/data/approved-leave.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { TimesheetService } from "../src/lib/data/timesheet-service.ts";
import type { ActorContext, Employee } from "../src/lib/data/types.ts";
import type { TimesheetPeriod, TimesheetWithEntries } from "../src/lib/data/timesheet-types.ts";

const actor = (role: "HR" | "Employee" | "Line Manager", person: string): ActorContext => ({
  actor: {
    userId: `user-${person}`,
    employeeId: `employee-${person}`,
    displayName: person,
    activeRole: role,
    roles: [role],
  },
});
const hr = actor("HR", "rana"),
  employee = actor("Employee", "omar"),
  manager = actor("Line Manager", "layla");

function harness() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  configureApplicationDataServices({
    storage,
    audit,
    notifications: new NotificationService(storage, audit),
    files: {} as never,
  });
  return { storage, service: new TimesheetService() };
}

test("calendar months start on day 1 and end on the actual final day, including leap years", () => {
  for (const [date, end] of [
    ["2026-01-19", "2026-01-31"],
    ["2026-02-12", "2026-02-28"],
    ["2028-02-29", "2028-02-29"],
    ["2026-04-30", "2026-04-30"],
    ["2026-12-31", "2026-12-31"],
  ]) {
    assert.deepEqual(timesheetPeriodDates(date!), {
      startDate: `${date!.slice(0, 7)}-01`,
      endDate: end,
    });
  }
});

test("monthly generation spans year boundaries without overlaps or short weeks", () => {
  assert.deepEqual(timesheetPeriodsInRange("2026-12-17", "2027-02-10"), [
    { startDate: "2026-12-01", endDate: "2026-12-31" },
    { startDate: "2027-01-01", endDate: "2027-01-31" },
    { startDate: "2027-02-01", endDate: "2027-02-28" },
  ]);
  assert.throws(() => timesheetPeriodsInRange("2026-03-01", "2026-02-28"), /End date/);
  assert.throws(() => timesheetPeriodDates("2026-02-30"), /valid timesheet date/);
});

test("organisation timezone determines the monthly boundary, not the server timezone", () => {
  const day = organisationDate(new Date("2026-09-30T21:00:00Z"), "Asia/Muscat");
  assert.deepEqual(timesheetPeriodDates(day), { startDate: "2026-10-01", endDate: "2026-10-31" });
  assert.equal(timesheetPeriodLabel(timesheetPeriodDates(day)), "October 2026");
  assert.equal(
    isConfiguredTimesheetPeriod({ startDate: "2026-09-28", endDate: "2026-10-04" }),
    false,
  );
});

test("monthly is the saved default; repeated generation produces one period per calendar month", () => {
  const { service } = harness();
  assert.equal(service.getSettings().periodFrequency, "Monthly");
  assert.equal(service.generatePeriods("2026-08-17", "2026-09-03", hr), 2);
  assert.equal(service.generatePeriods("2026-08-01", "2026-09-30", hr), 0);
  assert.deepEqual(
    service.getPeriods().map(({ startDate, endDate }) => ({ startDate, endDate })),
    [
      { startDate: "2026-09-01", endDate: "2026-09-30" },
      { startDate: "2026-08-01", endDate: "2026-08-31" },
    ],
  );
});

test("new employees are only expected to record hours from their joining date", () => {
  const { storage, service } = harness();
  storage.writeCollection(
    "employees",
    storage
      .readCollection<Employee>("employees")
      .map((person) =>
        person.id === "employee-omar" ? { ...person, startDate: "2026-09-29" } : person,
      ),
  );
  service.generatePeriods("2026-09-01", "2026-09-30", hr);
  const sheet = service.getOrCreateTimesheet(
    "employee-omar",
    service.getPeriods()[0]!.id,
    employee,
  );
  assert.equal(sheet.expectedHours, 18);
});

test("daily hours are saved inside one monthly sheet and the same sheet goes through manager then HR", () => {
  const { service, storage } = harness();
  service.generatePeriods("2026-09-01", "2026-09-30", hr);
  const period = service.getPeriods()[0]!;
  const sheet = service.getOrCreateTimesheet("employee-omar", period.id, employee);
  const workingDays = [0, 1, 2, 3, 4];
  const hours: Record<string, number> = {};
  for (let day = 1; day <= 30; day++) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    if (workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) hours[date] = 9;
  }
  sheet.entries.push({
    id: crypto.randomUUID(),
    projectId: "proj-001",
    costCentreId: "cc-operations",
    activityCodeId: "activity-delivery",
    locationCodeId: "loc-muscat",
    hours,
    total: Object.values(hours).reduce((sum, value) => sum + value, 0),
  });
  const saved = service.saveTimesheetDraft(sheet, employee);
  assert.equal(saved.totalHours, saved.expectedHours);
  assert.equal(service.submitTimesheet(saved.id, employee).status, "Pending Manager");
  assert.throws(() => service.approveTimesheet(saved.id, hr), /supervisor|assigned/i);
  assert.equal(service.approveTimesheet(saved.id, manager).status, "Pending HR");
  assert.equal(service.approveTimesheet(saved.id, hr).status, "Approved");
  assert.equal(storage.readCollection<TimesheetWithEntries>("timesheets").length, 1);
});

test("copying the previous month copies projects, never date-shifted work hours", () => {
  const { service } = harness();
  service.generatePeriods("2026-01-01", "2026-02-28", hr);
  const previousPeriod = service.getPeriods().find((period) => period.startDate === "2026-01-01")!;
  const period = service.getPeriods().find((period) => period.startDate === "2026-02-01")!;
  const previous = service.getOrCreateTimesheet("employee-omar", previousPeriod.id, employee);
  previous.entries.push({
    id: crypto.randomUUID(),
    projectId: "proj-001",
    costCentreId: "cc-operations",
    activityCodeId: "activity-delivery",
    locationCodeId: "loc-muscat",
    hours: { "2026-01-29": 9 },
    total: 9,
  });
  service.saveTimesheetDraft(previous, employee);
  const copied = service.copyPreviousWeek("employee-omar", period.id, employee);
  assert.equal(copied.totalHours, 0);
  assert.deepEqual(copied.entries[0]!.hours, {});
});

test("existing weekly history is kept but cannot overlap a new monthly timesheet", () => {
  const { service, storage } = harness();
  storage.writeCollection("timesheetSettings", [
    { ...service.getSettings(), periodFrequency: "Weekly" },
  ]);
  service.generatePeriods("2026-09-07", "2026-09-07", hr);
  const weekly = service.getPeriods()[0]!;
  const old = service.getOrCreateTimesheet("employee-omar", weekly.id, employee);
  storage.writeCollection("timesheetSettings", [
    { ...service.getSettings(), periodFrequency: "Monthly" },
  ]);
  service.generatePeriods("2026-09-01", "2026-09-30", hr);
  const monthly = service.getPeriods().find((period) => period.startDate === "2026-09-01")!;
  assert.throws(
    () => service.getOrCreateTimesheet("employee-omar", monthly.id, employee),
    /not counted twice/,
  );
  assert.equal(service.getOrCreateTimesheet("employee-omar", weekly.id, employee).id, old.id);
  assert.equal(storage.readCollection<TimesheetWithEntries>("timesheets").length, 1);
  assert.equal(storage.readCollection<TimesheetPeriod>("timesheetPeriods").length, 2);
});

test("monthly reminders follow month-end and ignore retained weekly periods", () => {
  const { service, storage } = harness();
  service.generatePeriods("2026-09-01", "2026-10-31", hr);
  storage.writeCollection("timesheetSettings", [
    { ...service.getSettings(), periodFrequency: "Weekly" },
  ]);
  service.generatePeriods("2026-09-28", "2026-09-28", hr);
  const legacy = service.getPeriods().find((period) => period.startDate === "2026-09-28")!;
  storage.writeCollection("timesheetSettings", [
    { ...service.getSettings(), periodFrequency: "Monthly" },
  ]);
  const september = service.getPeriods().find((period) => period.startDate === "2026-09-01")!;
  const october = service.getPeriods().find((period) => period.startDate === "2026-10-01")!;
  assert.ok(service.reconcileSubmissionReminders(new Date("2026-10-08T12:00:00Z")) > 0);
  const reminders = storage
    .readCollection<{ deduplicationKey?: string }>("notifications")
    .map((item) => item.deduplicationKey ?? "");
  assert.ok(reminders.some((key) => key.includes(september.id)));
  assert.equal(
    reminders.some((key) => key.includes(october.id)),
    false,
  );
  assert.equal(
    reminders.some((key) => key.includes(legacy.id)),
    false,
  );
  assert.equal(service.reconcileSubmissionReminders(new Date("2026-10-08T12:00:00Z")), 0);
});

test("a future monthly timesheet can be saved but cannot be submitted early", () => {
  const { service } = harness();
  service.generatePeriods("2090-04-01", "2090-04-30", hr);
  const sheet = service.getOrCreateTimesheet(
    "employee-omar",
    service.getPeriods()[0]!.id,
    employee,
  );
  service.saveTimesheetDraft(sheet, employee);
  assert.throws(() => service.submitTimesheet(sheet.id, employee), /after the month ends/);
});
