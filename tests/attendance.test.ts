import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AttendanceService } from "../src/lib/data/attendance-service.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import type { FileRepository, SaveFileInput } from "../src/lib/data/file-repository.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { initializeSeedData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, FileMetadata } from "../src/lib/data/types.ts";

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

const unrelated: ActorContext = {
  actor: {
    userId: "user-tariq",
    employeeId: "employee-tariq",
    displayName: "Tariq Al Balushi",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

function fakeFileRepository(): FileRepository {
  const files = new Map<string, { metadata: FileMetadata; blob: Blob }>();
  let counter = 0;
  return {
    async save(input: SaveFileInput, context) {
      const id = `file-${++counter}`;
      const metadata: FileMetadata = {
        id,
        name: input.name,
        mimeType: input.mimeType ?? "application/octet-stream",
        size: input.blob.size,
        owner: input.owner,
        createdAt: new Date().toISOString(),
        createdBy: context.actor.userId,
      } as FileMetadata;
      files.set(id, { metadata, blob: input.blob });
      return metadata;
    },
    async getMetadata(id: string) {
      return files.get(id)?.metadata ?? null;
    },
    async getBlob(id: string) {
      return files.get(id)?.blob ?? null;
    },
    async listByOwner(owner) {
      return [...files.values()]
        .filter(
          (f) => f.metadata.owner.entityType === owner.entityType && f.metadata.owner.entityId === owner.entityId,
        )
        .map((f) => f.metadata);
    },
    async delete(id: string) {
      files.delete(id);
    },
    async clear() {
      files.clear();
    },
  };
}

function harness() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  const files = fakeFileRepository();
  configureApplicationDataServices({ storage, audit, notifications, files });
  return { service: new AttendanceService(), audit, files };
}

function harnessWithClock(now: () => Date) {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  initializeSeedData(storage);
  const audit = new AuditService(storage);
  const notifications = new NotificationService(storage, audit);
  const files = fakeFileRepository();
  configureApplicationDataServices({ storage, audit, notifications, files });
  return { service: new AttendanceService({ now }), audit, files, storage };
}

function seedRecord(service: AttendanceService, date: string) {
  return service.saveRecord(
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

test("only HR/Super Admin can export attendance CSV, and the export is audited", () => {
  const { service, audit } = harness();
  seedRecord(service, "2026-08-24");

  assert.throws(() => service.exportCsv("2026-08-24", employee), /not authorised/);
  assert.throws(() => service.exportCsv("2026-08-24", manager), /not authorised/);

  const csv = service.exportCsv("2026-08-24", hr);
  assert.ok(csv.includes("employee-omar"));
  assert.ok(
    audit.list().some((event) => event.action === "attendance_data_export" && event.entityId === "2026-08-24"),
  );
});

test("attendance CSV export re-derives records server-side rather than trusting page-supplied data", () => {
  const { service } = harness();
  seedRecord(service, "2026-08-24");
  seedRecord(service, "2026-08-25");

  const csv = service.exportCsv("2026-08-24", hr);
  assert.ok(csv.includes("2026-08-24"));
  assert.ok(!csv.includes("2026-08-25"));
});

test("attendance correction evidence is restricted to the owner, their line manager, and HR - and is audited", async () => {
  const { service, files, audit } = harness();
  const record = seedRecord(service, "2026-08-20");

  const uploaded = await files.save(
    {
      blob: new Blob(["late arrival proof"]),
      name: "traffic-note.pdf",
      mimeType: "application/pdf",
      owner: { entityType: "attendance-correction-evidence", entityId: "employee-omar" },
    },
    employee,
  );

  const correction = service.requestCorrection(
    record.id,
    "09:15",
    "18:00",
    "Traffic accident delayed my arrival.",
    employee,
    uploaded.id,
  );

  const ownerResult = await service.getCorrectionEvidence(correction.id, employee);
  assert.equal(ownerResult.fileName, "traffic-note.pdf");

  const managerResult = await service.getCorrectionEvidence(correction.id, manager);
  assert.ok(managerResult.blob);

  const hrResult = await service.getCorrectionEvidence(correction.id, hr);
  assert.ok(hrResult.blob);

  await assert.rejects(
    () => service.getCorrectionEvidence(correction.id, unrelated),
    /not authorised/,
  );
  assert.ok(
    audit.list().some((event) => event.action === "attendance_evidence_access_denied"),
  );

  const accessEvents = audit
    .list()
    .filter((event) => event.action === "attendance_evidence_accessed");
  assert.equal(accessEvents.length, 3);
});

test("requesting a correction with no evidence file cannot be downloaded", () => {
  const { service } = harness();
  const record = seedRecord(service, "2026-08-21");
  const correction = service.requestCorrection(
    record.id,
    "09:10",
    "",
    "Forgot to clock in on time.",
    employee,
  );

  assert.rejects(() => service.getCorrectionEvidence(correction.id, employee), /no supporting evidence/);
});

test("an office-origin site visit that ends without a clock-in opens a persistent, ownable exception case - not just a notification", () => {
  let clock = new Date("2026-08-25T08:00:00");
  const { service, audit, storage } = harnessWithClock(() => clock);

  const visit = service.requestSiteVisit(
    {
      employeeId: "employee-omar",
      date: "2026-08-25",
      startTime: "10:00",
      endTime: "14:00",
      origin: "Office",
      destination: "Client HQ",
      purpose: "Contract negotiation on site.",
    },
    employee,
  );
  service.reviewSiteVisit(visit.id, true, "Approved - standard client visit.", hr);

  // No office clock-in is ever recorded. Advance past the visit's end time and reconcile.
  clock = new Date("2026-08-25T15:00:00");
  const result = service.reconcileSiteVisits();
  assert.equal(result.exceptions, 1);

  const cases = service.getExceptionCases(hr);
  assert.equal(cases.length, 1);
  const openCase = cases[0]!;
  assert.equal(openCase.employeeId, "employee-omar");
  assert.equal(openCase.status, "Open");
  assert.equal(openCase.siteVisitId, visit.id);
  assert.equal(openCase.ownerId, undefined);
  assert.ok(
    audit.list().some((event) => event.entityType === "exception-case" && event.action === "create"),
    "creating the case must itself be an audited event",
  );

  // A plain employee cannot see or act on exception cases.
  assert.throws(() => service.getExceptionCases(employee), /not authorised/);
  assert.throws(() => service.assignExceptionCase(openCase.id, "user-rana", employee), /not authorised/);

  // HR assigns the case to themselves, which also moves it from Open to Investigating.
  const assigned = service.assignExceptionCase(openCase.id, "user-rana", hr);
  assert.equal(assigned.ownerId, "user-rana");
  assert.equal(assigned.status, "Investigating");

  // Reconciling again must not create a second case for the same site visit.
  service.reconcileSiteVisits();
  assert.equal(service.getExceptionCases(hr).length, 1);

  // Resolving requires real notes, and closes the case with an audit trail.
  assert.throws(() => service.resolveExceptionCase(openCase.id, "ok", hr), /Resolution notes/);
  const internalNotes =
    "Confirmed with the client's reception desk - employee was on site the whole time; suspected badge-reader tampering, flagged separately to Security for review.";
  const resolved = service.resolveExceptionCase(openCase.id, internalNotes, hr);
  assert.equal(resolved.status, "Resolved");
  assert.equal(resolved.resolvedBy, "user-rana");
  assert.ok(resolved.resolvedAt);
  assert.equal(resolved.resolutionNotes, internalNotes, "the internal notes must still be stored on the case itself");
  assert.throws(() => service.resolveExceptionCase(openCase.id, "already closed, try again", hr), /already resolved/);

  const employeeNotifications = storage.readCollection<{
    recipientUserId: string;
    title: string;
    message: string;
  }>("notifications");
  const resolutionNotification = employeeNotifications.find(
    (item) => item.recipientUserId === "user-omar" && item.title === "Attendance exception resolved",
  );
  assert.ok(resolutionNotification, "the employee should be notified once their exception case is resolved");
  assert.ok(
    !resolutionNotification!.message.includes(internalNotes),
    "the employee-facing notification must NOT echo HR's internal investigation notes verbatim",
  );
  assert.ok(
    !resolutionNotification!.message.toLowerCase().includes("security"),
    "internal investigative detail must not leak into the employee-facing message",
  );
});

