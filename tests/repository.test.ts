import assert from "node:assert/strict";
import test from "node:test";

import { LocalRepository } from "../src/lib/data/repository.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import type { AuditInput, AuditWriter } from "../src/lib/data/audit-service.ts";
import type { ActorContext, AuditEvent, BaseRecord } from "../src/lib/data/types.ts";
import { SYSTEM_ACTOR } from "../src/lib/data/types.ts";

interface Widget extends BaseRecord {
  name: string;
  status: string;
}

const context: ActorContext = { actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" } };

function harness() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  const audit = new AuditService(storage);
  const repo = new LocalRepository<Widget>("widgets", storage, audit, {
    module: "test",
    entityType: "widget",
  });
  return { storage, audit, repo };
}

// Delegates to a real AuditService but throws on the Nth call - used to force the specific
// "first audit write succeeds, second one fails" interleaving that createWithSideEffect's
// rollback path has to handle.
function throwOnNthCall(real: AuditWriter, n: number): AuditWriter {
  let calls = 0;
  return {
    record(input: AuditInput): AuditEvent {
      calls += 1;
      if (calls === n) throw new Error("Simulated audit write failure");
      return real.record(input);
    },
  };
}

test("createWithSideEffect commits the new record and the side-effect update in a single write", () => {
  const { repo } = harness();
  const original = repo.create({ name: "Original", status: "Active" }, context);

  const { created, updated } = repo.createWithSideEffect(
    { name: "Replacement", status: "Active" },
    { id: original.id, changes: { status: "Superseded" } },
    context,
  );

  assert.equal(created.name, "Replacement");
  assert.equal(updated.id, original.id);
  assert.equal(updated.status, "Superseded");

  const stored = repo.list();
  assert.equal(stored.length, 2);
  assert.equal(stored.find((r) => r.id === original.id)?.status, "Superseded");
});

test("if the audit write for the update half fails, the data write is rolled back completely", () => {
  const { storage, audit, repo: realRepo } = harness();
  const original = realRepo.create({ name: "Original", status: "Active" }, context);
  const before = storage.readCollection<Widget>("widgets");

  const flakyAudit = throwOnNthCall(audit, 2); // 1st record() call (the "create") succeeds, 2nd (the "update") throws
  const repo = new LocalRepository<Widget>("widgets", storage, flakyAudit, {
    module: "test",
    entityType: "widget",
  });

  assert.throws(
    () =>
      repo.createWithSideEffect(
        { name: "Replacement", status: "Active" },
        { id: original.id, changes: { status: "Superseded" } },
        context,
      ),
    /Simulated audit write failure/,
  );

  const after = storage.readCollection<Widget>("widgets");
  assert.deepEqual(
    after,
    before,
    "the widgets collection must be restored to exactly its pre-operation state",
  );
  assert.equal(after.length, 1, "the replacement record must not exist after rollback");
  assert.equal(after[0]!.status, "Active", "the original must not have been left as Superseded");
});

test("a rollback after a partially-succeeded audit write leaves a compensating audit entry instead of a silent orphan", () => {
  const { storage, audit, repo: realRepo } = harness();
  const original = realRepo.create({ name: "Original", status: "Active" }, context);

  const flakyAudit = throwOnNthCall(audit, 2);
  const repo = new LocalRepository<Widget>("widgets", storage, flakyAudit, {
    module: "test",
    entityType: "widget",
  });

  const eventsBefore = audit.list().length;

  assert.throws(() =>
    repo.createWithSideEffect(
      { name: "Replacement", status: "Active" },
      { id: original.id, changes: { status: "Superseded" } },
      context,
    ),
  );

  // Only look at events written DURING this call - the harness already has a "create" event for
  // the "Original" widget from the setup above, which must not be mistaken for the orphaned one.
  const newEvents = audit.list().slice(eventsBefore);
  const orphanedCreateEvent = newEvents.find(
    (e) => e.action === "create" && e.entityType === "widget",
  );
  assert.ok(
    orphanedCreateEvent,
    "the first audit call's entry is real and already persisted - it cannot be un-written",
  );

  const rollbackEvent = newEvents.find(
    (e) => e.action === "rollback" && e.entityId === orphanedCreateEvent!.entityId,
  );
  assert.ok(
    rollbackEvent,
    "a compensating rollback audit entry must exist so the log stays honest about what actually happened, rather than describing a create that never took effect",
  );
});
