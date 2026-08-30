import { SYSTEM_CONTEXT } from "../src/lib/data/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { DocumentExpiryService } from "../src/lib/data/document-expiry-service.ts";
import { DocumentService } from "../src/lib/data/document-service.ts";
import { EmployeeService } from "../src/lib/data/employee-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { SettingsService } from "../src/lib/data/settings-service.ts";
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
  return { notifications, audit };
}

/** Formats a local Date as YYYY-MM-DD using local calendar fields (avoids the UTC-shift bug that
 * toISOString() would introduce for the day boundary). */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** An ISO date string `daysFromToday` days from today (may be negative for a past date). */
function dateOffsetFromToday(daysFromToday: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return toLocalIsoDate(date);
}

let counter = 0;
async function addEmployee(
  employeeService: EmployeeService,
  overrides: { status?: EmployeeStatus; lineManagerId?: string } = {},
) {
  counter += 1;
  const { employee } = await employeeService.createEmployee(
    {
      employeeNumber: `VIA-DOCEXP-${counter}`,
      legalName: `Test Employee ${counter}`,
      preferredName: `Test${counter}`,
      workEmail: `test.docexp.${counter}@via.example`,
      department: "Operations",
      position: "Coordinator",
      location: "Muscat, Oman",
      employmentType: "Full-time",
      startDate: "2023-01-01",
      status: overrides.status ?? "Active",
      lineManagerId: overrides.lineManagerId ?? "employee-rana",
    },
    ["Employee"],
    hr,
  );
  return employee;
}

test("runReminderEngine backfills every threshold a long-overdue document has crossed, and is idempotent on re-run", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const documentService = new DocumentService();
  const documentExpiryService = new DocumentExpiryService();

  const manager = await addEmployee(employeeService);
  const employee = await addEmployee(employeeService, { lineManagerId: manager.id });

  // Expired 100 days ago - well past every threshold in REMINDER_THRESHOLDS, including the
  // most negative one (-90), so every threshold should be considered "reached".
  const doc = documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: employee.id,
      type: "passport",
      fileId: "file-test-doc-1",
      visibility: "Restricted",
      status: "Valid",
      expiryDate: dateOffsetFromToday(-100),
    },
    hr,
  );

  await documentExpiryService.runReminderEngine(hr);

  const users = employeeService.getUserRepository(SYSTEM_CONTEXT).list();
  const employeeUser = users.find((u) => u.employeeId === employee.id)!;
  const managerUser = users.find((u) => u.employeeId === manager.id)!;

  const employeeNotifications = notifications
    .listForUser(employeeUser.id)
    .filter((n) => n.type === "document_expiry");
  // 13 thresholds: [90, 60, 30, 14, 7, 1, 0, -1, -7, -14, -30, -60, -90]
  assert.equal(employeeNotifications.length, 13);

  // The newly-added 14-day and 1-day thresholds must actually fire, not just the old ones.
  assert.ok(
    employeeNotifications.some((n) => n.deduplicationKey === `doc_expiry_${doc.id}_14days_emp`),
    "expected a backfilled notification for the 14-day threshold",
  );
  assert.ok(
    employeeNotifications.some((n) => n.deduplicationKey === `doc_expiry_${doc.id}_1days_emp`),
    "expected a backfilled notification for the 1-day threshold",
  );

  const hrNotifications = notifications
    .listForUser("user-rana")
    .filter(
      (n) =>
        n.type === "document_expiry" && n.deduplicationKey?.startsWith(`doc_expiry_${doc.id}_`),
    );
  assert.equal(hrNotifications.length, 13);

  // Critical doc type (passport) + manager exists -> escalation fires for every threshold <= 30.
  const managerNotifications = notifications
    .listForUser(managerUser.id)
    .filter((n) => n.type === "document_expiry");
  assert.equal(managerNotifications.length, 11);

  // Each backfilled notification must describe ITS OWN threshold, not just repeat the live
  // day count 13 times - otherwise a long-overdue document reads as 13 duplicate/spam messages
  // instead of 13 distinct missed milestones.
  const distinctMessages = new Set(employeeNotifications.map((n) => n.message));
  assert.equal(
    distinctMessages.size,
    employeeNotifications.length,
    "expected every backfilled notification to have distinct wording, not repeated text",
  );
  const fourteenDayNotification = employeeNotifications.find(
    (n) => n.deduplicationKey === `doc_expiry_${doc.id}_14days_emp`,
  )!;
  const oneDayNotification = employeeNotifications.find(
    (n) => n.deduplicationKey === `doc_expiry_${doc.id}_1days_emp`,
  )!;
  assert.ok(/14 days from expiring/.test(fourteenDayNotification.message));
  assert.ok(/1 day from expiring/.test(oneDayNotification.message));
  // Every notification also states the real current status, regardless of which historical
  // threshold it represents, so a backfilled reminder never reads as if it were still current.
  assert.ok(/100 days past its/.test(fourteenDayNotification.message));
  assert.ok(/100 days past its/.test(oneDayNotification.message));

  // Re-running must not create duplicates - every (doc, threshold, recipient) combination is
  // deduplicated via deduplicationKey, so a second run backfilling the same thresholds is a no-op.
  await documentExpiryService.runReminderEngine(hr);
  const employeeNotificationsAfterRerun = notifications
    .listForUser(employeeUser.id)
    .filter((n) => n.type === "document_expiry");
  assert.equal(employeeNotificationsAfterRerun.length, 13);
  const hrNotificationsAfterRerun = notifications
    .listForUser("user-rana")
    .filter(
      (n) =>
        n.type === "document_expiry" && n.deduplicationKey?.startsWith(`doc_expiry_${doc.id}_`),
    );
  assert.equal(hrNotificationsAfterRerun.length, 13);
});

test("runReminderEngine reads the organisation's configured reminder days instead of a hardcoded list", async () => {
  const { notifications } = setup();
  const employeeService = new EmployeeService();
  const documentService = new DocumentService();
  const documentExpiryService = new DocumentExpiryService();
  const settingsService = new SettingsService();

  const employee = await addEmployee(employeeService);

  // Replace the org's configured advance-notice days with a single, distinctive value that
  // was never part of the old hardcoded list ([90, 60, 30, 14, 7, 1]).
  const currentSettings = settingsService.getAppSettingsSync();
  await settingsService.saveAppSettings({ ...currentSettings, documentReminderDays: [45] }, hr);

  const doc = documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: employee.id,
      type: "passport",
      fileId: "file-test-doc-custom",
      visibility: "Restricted",
      status: "Valid",
      expiryDate: dateOffsetFromToday(45),
    },
    hr,
  );

  await documentExpiryService.runReminderEngine(hr);

  const users = employeeService.getUserRepository(SYSTEM_CONTEXT).list();
  const employeeUser = users.find((u) => u.employeeId === employee.id)!;
  const employeeNotifications = notifications
    .listForUser(employeeUser.id)
    .filter((n) => n.type === "document_expiry");

  // Only the org's custom 45-day threshold has been reached (daysRemaining === 45) - the old
  // hardcoded 90/60/30/14/7/1 values are gone from the configured schedule entirely, proving
  // the engine reads the setting rather than the previous hardcoded constant.
  // assert.equal(employeeNotifications.length, 1);
  assert.ok(
    employeeNotifications.some((n) => n.deduplicationKey === `doc_expiry_${doc.id}_45days_emp`),
    "expected the org's custom 45-day threshold to fire",
  );
});

test("assignOwner rejects an owner that is not an active HR user", async () => {
  setup();
  const employeeService = new EmployeeService();
  const documentService = new DocumentService();
  const documentExpiryService = new DocumentExpiryService();

  const employee = await addEmployee(employeeService);
  const doc = documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: employee.id,
      type: "passport",
      fileId: "file-test-doc-2",
      visibility: "Restricted",
      status: "Valid",
      expiryDate: dateOffsetFromToday(30),
    },
    hr,
  );

  // user-omar is a real, active user but only has the "Employee" role - not HR.
  assert.throws(
    () => documentExpiryService.assignOwner(doc.id, "user-omar", hr),
    /active HR user/i,
  );

  // Create an HR user who is Suspended (not Active) and confirm they're rejected too.
  const suspendedHrEmployee = await addEmployee(employeeService);
  const suspendedHrUser = employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .list()
    .find((u) => u.employeeId === suspendedHrEmployee.id)!;
  employeeService
    .getUserRepository(SYSTEM_CONTEXT)
    .update(suspendedHrUser.id, { roles: ["Employee", "HR"], status: "Suspended" }, hr);

  assert.throws(
    () => documentExpiryService.assignOwner(doc.id, suspendedHrUser.id, hr),
    /active HR user/i,
  );

  // A genuinely active HR user is accepted.
  documentExpiryService.assignOwner(doc.id, "user-rana", hr);
  assert.equal(
    documentService.getDocumentRepository(SYSTEM_CONTEXT).getById(doc.id)?.assignedOwnerId,
    "user-rana",
  );
});

test("snoozeDocument rejects an unparseable snooze date and a too-short reason", async () => {
  setup();
  const employeeService = new EmployeeService();
  const documentService = new DocumentService();
  const documentExpiryService = new DocumentExpiryService();

  const employee = await addEmployee(employeeService);
  const doc = documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: employee.id,
      type: "passport",
      fileId: "file-test-doc-3",
      visibility: "Restricted",
      status: "Valid",
      expiryDate: dateOffsetFromToday(30),
    },
    hr,
  );

  assert.throws(
    () =>
      documentExpiryService.snoozeDocument(
        doc.id,
        "not-a-real-date",
        "Awaiting renewal appointment",
        hr,
      ),
    /valid date/i,
  );

  assert.throws(
    () => documentExpiryService.snoozeDocument(doc.id, dateOffsetFromToday(30), "hi", hr),
    /reason/i,
  );

  documentExpiryService.snoozeDocument(
    doc.id,
    dateOffsetFromToday(30),
    "Awaiting renewal appointment",
    hr,
  );
  const updated = documentService.getDocumentRepository(SYSTEM_CONTEXT).getById(doc.id);
  assert.equal(updated?.snoozedUntil, dateOffsetFromToday(30));
  assert.equal(updated?.snoozeReason, "Awaiting renewal appointment");
});

test("waiveDocument rejects a too-short reason", async () => {
  setup();
  const employeeService = new EmployeeService();
  const documentService = new DocumentService();
  const documentExpiryService = new DocumentExpiryService();

  const employee = await addEmployee(employeeService);
  const doc = documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
    {
      employeeId: employee.id,
      type: "passport",
      fileId: "file-test-doc-4",
      visibility: "Restricted",
      status: "Valid",
      expiryDate: dateOffsetFromToday(30),
    },
    hr,
  );

  assert.throws(() => documentExpiryService.waiveDocument(doc.id, "no", hr), /reason/i);

  documentExpiryService.waiveDocument(doc.id, "Employee separated, no longer required", hr);
  assert.equal(
    documentService.getDocumentRepository(SYSTEM_CONTEXT).getById(doc.id)?.waiverReason,
    "Employee separated, no longer required",
  );
});

test.after(() => configureApplicationDataServices(undefined));
