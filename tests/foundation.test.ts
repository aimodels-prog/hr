import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../src/lib/data/audit-service.ts";
import { createStructuredBackup, restoreStructuredBackup } from "../src/lib/data/backup-service.ts";
import { LocalRepository } from "../src/lib/data/repository.ts";
import { initializeSeedData, resetStructuredDemoData } from "../src/lib/data/seed-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, BaseRecord } from "../src/lib/data/types.ts";

const fixedNow = () => "2026-08-16T09:00:00.000Z";
const actor: ActorContext = {
  actor: {
    userId: "user-test-hr",
    employeeId: "employee-test-hr",
    displayName: "Test HR",
    activeRole: "HR",
    roles: ["Employee", "HR"],
  },
};

interface TestRecord extends BaseRecord {
  name: string;
}

test("seed data initialises only once and survives a new service instance", () => {
  const driver = new MemoryStorageDriver();
  const firstStorage = new VersionedStorageService(driver, { now: fixedNow });
  const first = initializeSeedData(firstStorage);
  assert.equal(first.seeded, true);

  const employeesBefore = firstStorage.readCollection("employees");
  const secondStorage = new VersionedStorageService(driver, { now: fixedNow });
  const second = initializeSeedData(secondStorage);

  assert.equal(second.seeded, false);
  assert.deepEqual(secondStorage.readCollection("employees"), employeesBefore);
});

test("reset restores deterministic seed collections", () => {
  const driver = new MemoryStorageDriver();
  const storage = new VersionedStorageService(driver, { now: fixedNow });
  initializeSeedData(storage);
  const initial = storage.exportState();

  storage.writeCollection("employees", []);
  resetStructuredDemoData(storage);
  const firstReset = storage.exportState();
  resetStructuredDemoData(storage);
  const secondReset = storage.exportState();

  assert.deepEqual(firstReset, initial);
  assert.deepEqual(secondReset, initial);
});

test("invalid restore is rejected without overwriting current data", () => {
  const driver = new MemoryStorageDriver();
  const storage = new VersionedStorageService(driver, { now: fixedNow });
  initializeSeedData(storage);
  const before = storage.createRawSnapshot();

  assert.throws(
    () => restoreStructuredBackup(storage, { format: "wrong", collections: [] }),
    /Backup validation failed/,
  );
  assert.deepEqual(storage.createRawSnapshot(), before);
});

test("registered migrations transform persisted collections", () => {
  const driver = new MemoryStorageDriver();
  const versionOne = new VersionedStorageService(driver, {
    prefix: "via_hr_migration_test",
    schemaVersion: 1,
    now: fixedNow,
  });
  versionOne.initialize();
  versionOne.writeCollection("examples", [{ id: "example-1", name: "Original" }]);

  const versionTwo = new VersionedStorageService(driver, {
    prefix: "via_hr_migration_test",
    schemaVersion: 2,
    now: fixedNow,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate: (collections) => ({
          ...collections,
          examples: (collections.examples ?? []).map((item) => ({
            ...(item as Record<string, unknown>),
            migrated: true,
          })),
        }),
      },
    ],
  });

  assert.equal(versionTwo.initialize().schemaVersion, 2);
  assert.deepEqual(versionTwo.readCollection("examples"), [
    { id: "example-1", name: "Original", migrated: true },
  ]);
});

test("repository create and archive persist records and audit each mutation", () => {
  const driver = new MemoryStorageDriver();
  const storage = new VersionedStorageService(driver, { now: fixedNow });
  storage.initialize();
  const audit = new AuditService(storage, {
    now: fixedNow,
    createId: (() => {
      let id = 0;
      return () => `audit-${++id}`;
    })(),
  });
  const repository = new LocalRepository<TestRecord>("testRecords", storage, audit, {
    module: "foundation-test",
    entityType: "test-record",
    now: fixedNow,
    createId: () => "record-1",
  });

  const created = repository.create({ name: "Persistent record" }, actor);
  assert.equal(created.recordVersion, 1);
  assert.equal(repository.getById("record-1")?.name, "Persistent record");
  assert.equal(audit.list()[0]?.action, "create");

  const archived = repository.archive("record-1", { ...actor, reason: "Test archive" });
  assert.equal(archived.recordVersion, 2);
  assert.equal(repository.getById("record-1"), null);
  assert.equal(repository.getById("record-1", { includeArchived: true })?.id, "record-1");
  assert.equal(audit.list()[1]?.action, "archive");
  assert.equal(audit.list()[1]?.reason, "Test archive");
});

test("a valid structured backup can replace state after preview-quality validation", () => {
  const source = new VersionedStorageService(new MemoryStorageDriver(), { now: fixedNow });
  initializeSeedData(source);
  const backup = createStructuredBackup(source, fixedNow);

  const target = new VersionedStorageService(new MemoryStorageDriver(), { now: fixedNow });
  target.initialize();
  const result = restoreStructuredBackup(target, backup);

  assert.equal(result.restored, true);
  assert.deepEqual(target.exportState(), source.exportState());
});
