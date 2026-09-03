import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  clearObjectStorageCacheForTests,
  getObjectStorageConfig,
  readObjectFile,
  deleteObjectFile,
  reassignObjectFile,
  saveObjectFile,
  verifyObjectFile,
} from "../src/lib/db/object-storage.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const hasObjectStorage = Boolean(process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"]?.trim());
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test("production object storage permits only explicit private HTTP endpoints", () => {
  const names = [
    "NODE_ENV",
    "VIA_HR_OBJECT_STORAGE_ENDPOINT",
    "VIA_HR_OBJECT_STORAGE_REGION",
    "VIA_HR_OBJECT_STORAGE_BUCKET",
    "VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID",
    "VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "VIA_HR_OBJECT_STORAGE_ALLOW_PRIVATE_HTTP",
  ] as const;
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env["NODE_ENV"] = "production";
    process.env["VIA_HR_OBJECT_STORAGE_BUCKET"] = "via-hr-test";
    process.env["VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID"] = "test-access";
    process.env["VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY"] = "test-secret";
    process.env["VIA_HR_OBJECT_STORAGE_ALLOW_PRIVATE_HTTP"] = "true";

    process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"] = "http://127.0.0.1:9000";
    assert.equal(getObjectStorageConfig().endpoint, "http://127.0.0.1:9000");

    process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"] = "http://object-storage:9000";
    assert.equal(getObjectStorageConfig().endpoint, "http://object-storage:9000");

    process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"] = "http://10.0.0.8:9000";
    assert.throws(getObjectStorageConfig, /HTTPS or an explicitly allowed private endpoint/i);

    process.env["VIA_HR_OBJECT_STORAGE_ALLOW_PRIVATE_HTTP"] = "false";
    process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"] = "http://127.0.0.1:9000";
    assert.throws(getObjectStorageConfig, /HTTPS or an explicitly allowed private endpoint/i);
  } finally {
    for (const name of names) {
      const value = prior[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test(
  "S3-compatible file storage preserves bytes, checksum, ownership and immutable audit history",
  { skip: !testDatabaseUrl || !hasObjectStorage },
  async () => {
    const databaseName = new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase();
    assert.match(databaseName, /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [user] = await sql`
        SELECT u.id, u.employee_id, u.display_name, u.organisation_id
        FROM users u
        WHERE u.workspace_email = 'rana.nair@via-int.com' AND u.status = 'Active'
        LIMIT 1
      `;
      assert.ok(user);
      const actor = {
        userId: String(user.id),
        employeeId: String(user.employee_id),
        displayName: String(user.display_name),
        workspaceEmail: "rana.nair@via-int.com",
        organisationId: String(user.organisation_id),
        roles: ["Employee", "HR"] as const,
        activeRole: "HR" as const,
      };
      const originalOwner = { entityType: "object-storage-test", entityId: randomUUID() };
      const bytes = new TextEncoder().encode("VIA HR secure object storage integration test");
      const saved = await saveObjectFile({
        organisationId: actor.organisationId,
        bytes,
        name: "evidence.pdf",
        mimeType: "application/pdf",
        owner: originalOwner,
        actor,
      });
      assert.equal(saved.size, bytes.byteLength);
      assert.equal(saved.owner.entityId, originalOwner.entityId);
      assert.match(saved.checksum ?? "", /^[a-f0-9]{64}$/);

      const verified = await verifyObjectFile(actor.organisationId, saved.id);
      assert.equal(verified.checksum, saved.checksum);
      const download = await readObjectFile(
        actor.organisationId,
        saved.id,
        actor,
        "Object-storage integration verification",
      );
      assert.deepEqual(new Uint8Array(download.bytes), bytes);

      const newOwner = { entityType: "candidate-cv", entityId: randomUUID() };
      const reassigned = await reassignObjectFile(
        actor.organisationId,
        saved.id,
        newOwner,
        actor,
        "Attached test object to Candidate Pool record",
      );
      assert.deepEqual(reassigned.owner, newOwner);

      await deleteObjectFile(
        actor.organisationId,
        saved.id,
        actor,
        "Removed disposable integration-test object",
      );
      await assert.rejects(() => verifyObjectFile(actor.organisationId, saved.id));
      const [auditCount] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${actor.organisationId}
          AND entity_type = 'file' AND entity_id = ${saved.id}
      `;
      assert.equal(Number(auditCount?.count), 4);
    } finally {
      await sql.end();
      clearObjectStorageCacheForTests();
    }
  },
);
