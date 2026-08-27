import assert from "node:assert/strict";
import test from "node:test";

import { AnniversaryService } from "../src/lib/data/anniversary-service.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { EmployeeService } from "../src/lib/data/employee-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, EmployeeStatus } from "../src/lib/data/types.ts";

const hr: ActorContext = {
  actor: {
    userId: "user-rana",
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};

function setup() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  configureApplicationDataServices({ storage, audit, notifications, files: {} as never });
  return { notifications };
}

/** Formats a local Date as YYYY-MM-DD using local calendar fields. Deliberately NOT
 * toISOString(), which converts to UTC first and silently shifts the date by a day in any
 * timezone that isn't UTC+0 - the exact bug this whole feature has to avoid. */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A start date whose hire-date anniversary this year falls `daysFromNow` days from today,
 * `yearsAgo` years ago (small offsets only, to stay clear of new-year boundary edge cases). */
function startDateForAnniversary(daysFromNow: number, yearsAgo: number): string {
  const anniversaryThisYear = new Date();
  anniversaryThisYear.setHours(0, 0, 0, 0);
  anniversaryThisYear.setDate(anniversaryThisYear.getDate() + daysFromNow);
  const start = new Date(anniversaryThisYear);
  start.setFullYear(start.getFullYear() - yearsAgo);
  return toLocalIsoDate(start);
}

let counter = 0;
async function addEmployee(
  employeeService: EmployeeService,
  startDate: string,
  overrides: { status?: EmployeeStatus; lineManagerId?: string } = {},
) {
  counter += 1;
  const { employee } = await employeeService.createEmployee(
    {
      employeeNumber: `VIA-ANNIV-${counter}`,
      legalName: `Test Employee ${counter}`,
      preferredName: `Test${counter}`,
      workEmail: `test.anniv.${counter}@via.example`,
      department: "Operations",
      position: "Coordinator",
      location: "Muscat, Oman",
      employmentType: "Full-time",
      startDate,
      status: overrides.status ?? "Active",
      lineManagerId: overrides.lineManagerId ?? "employee-rana",
    },
    ["Employee"],
    hr,
  );
  return employee;
}

test("getUpcomingAnniversaries includes an upcoming milestone with correct years and days remaining", async () => {
  setup();
  const employeeService = new EmployeeService();
  const anniversaryService = new AnniversaryService();

  await addEmployee(employeeService, startDateForAnniversary(7, 5));

  const upcoming = anniversaryService.getUpcomingAnniversaries(90, 14);
  const match = upcoming.find((e) => e.yearsOfService === 5);
  assert.ok(match, "expected a 5-year milestone in the upcoming list");
  assert.equal(match!.daysRemaining, 7);
  assert.equal(match!.isMilestone, true);
});

test("getUpcomingAnniversaries includes a recently passed anniversary within the lookback window", async () => {
  setup();
  const employeeService = new EmployeeService();
  const anniversaryService = new AnniversaryService();

  await addEmployee(employeeService, startDateForAnniversary(-10, 4));

  const upcoming = anniversaryService.getUpcomingAnniversaries(90, 14);
  const match = upcoming.find((e) => e.yearsOfService === 4);
  assert.ok(match, "expected the 4-year anniversary to still show as recently passed");
  assert.equal(match!.daysRemaining, -10);
  assert.equal(match!.isMilestone, false); // 4 is not a recognized milestone length
});

test("getUpcomingAnniversaries rolls a long-past anniversary to next year once outside the lookback window", async () => {
  setup();
  const employeeService = new EmployeeService();
  const anniversaryService = new AnniversaryService();

  const employee = await addEmployee(employeeService, startDateForAnniversary(-40, 3));

  const withDefaultWindow = anniversaryService.getUpcomingAnniversaries(90, 14);
  assert.equal(
    withDefaultWindow.some((e) => e.employee.id === employee.id),
    false,
    "40 days past should be excluded once outside the 14-day lookback",
  );

  const withWideWindow = anniversaryService.getUpcomingAnniversaries(400, 14);
  const rolled = withWideWindow.find((e) => e.employee.id === employee.id);
  assert.ok(
    rolled,
    "expected the rolled-forward next occurrence to appear with a wide enough window",
  );
  assert.equal(rolled!.yearsOfService, 4); // one year further along than the 3 originally passed
  assert.ok(rolled!.daysRemaining > 300);
});

test("getUpcomingAnniversaries excludes archived employees and employees with no anniversary yet", async () => {
  setup();
  const employeeService = new EmployeeService();
  const anniversaryService = new AnniversaryService();

  const archivedMilestone = await addEmployee(employeeService, startDateForAnniversary(7, 5), {
    status: "Archived",
  });
  const tooNew = await addEmployee(employeeService, startDateForAnniversary(-30, 0));

  const upcoming = anniversaryService.getUpcomingAnniversaries(90, 14);
  assert.equal(
    upcoming.some((e) => e.employee.id === archivedMilestone.id),
    false,
  );
  assert.equal(
    upcoming.some((e) => e.employee.id === tooNew.id),
    false,
  );
});

test("runReminderEngine notifies the employee, their manager, and HR only for milestone years, and is idempotent", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const anniversaryService = new AnniversaryService();

  const manager = await addEmployee(employeeService, startDateForAnniversary(-200, 12), {
    lineManagerId: "employee-rana",
  });
  const milestoneEmployee = await addEmployee(employeeService, startDateForAnniversary(7, 5), {
    lineManagerId: manager.id,
  });
  const nonMilestoneEmployee = await addEmployee(employeeService, startDateForAnniversary(7, 4), {
    lineManagerId: manager.id,
  });

  await anniversaryService.runReminderEngine(hr);

  const users = employeeService.getUserRepository().list();
  const employeeUser = users.find((u) => u.employeeId === milestoneEmployee.id)!;
  const managerUser = users.find((u) => u.employeeId === manager.id)!;
  const hrUser = users.find((u) => u.employeeId === "employee-rana")!;
  const nonMilestoneUser = users.find((u) => u.employeeId === nonMilestoneEmployee.id)!;

  const employeeNotifications = notifications
    .listForUser(employeeUser.id)
    .filter((n) => n.type === "work_anniversary");
  assert.equal(employeeNotifications.length, 1);

  const managerNotifications = notifications
    .listForUser(managerUser.id)
    .filter((n) => n.type === "work_anniversary");
  assert.ok(managerNotifications.length >= 1);

  const hrNotifications = notifications
    .listForUser(hrUser.id)
    .filter((n) => n.type === "work_anniversary");
  assert.ok(hrNotifications.length >= 1);

  const nonMilestoneNotifications = notifications
    .listForUser(nonMilestoneUser.id)
    .filter((n) => n.type === "work_anniversary");
  assert.equal(nonMilestoneNotifications.length, 0);

  // Re-running must not create duplicates - each recipient/employee/milestone/threshold is deduplicated.
  await anniversaryService.runReminderEngine(hr);
  const employeeNotificationsAfterRerun = notifications
    .listForUser(employeeUser.id)
    .filter((n) => n.type === "work_anniversary");
  assert.equal(employeeNotificationsAfterRerun.length, employeeNotifications.length);
});

test.after(() => configureApplicationDataServices(undefined));
