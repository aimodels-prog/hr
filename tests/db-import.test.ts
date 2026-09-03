import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { createSeedCollections } from "../src/lib/data/seeds.ts";
import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import { decryptSensitiveJson } from "../src/lib/db/encryption.server.ts";
import * as schema from "../src/lib/db/schema/index.ts";
import { generateDeterministicUuid, IMPORT_SEED_VERSION } from "../scripts/import-staging-seed.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const testKey = Buffer.alloc(32, 7).toString("base64");
const childEnvironment = testDatabaseUrl
  ? {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: "test",
      VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID: "import-test",
      VIA_HR_FIELD_ENCRYPTION_KEYS: JSON.stringify({ "import-test": testKey }),
    }
  : undefined;

function assertDedicatedTestDatabase(url: string): void {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.slice(1).toLowerCase();
  assert.match(
    databaseName,
    /(test|scratch|audit|h34)/,
    "Importer integration tests refuse to truncate a database whose name is not explicitly test-only.",
  );
}

function runImporter(...args: string[]): string {
  assert.ok(childEnvironment);
  return execFileSync(
    process.execPath,
    ["--experimental-transform-types", "scripts/import-staging-seed.ts", ...args],
    { cwd: process.cwd(), encoding: "utf8", env: childEnvironment },
  );
}

describe(
  "deterministic staging-data importer",
  { skip: !testDatabaseUrl, concurrency: false },
  () => {
    before(async () => {
      assert.ok(testDatabaseUrl);
      assertDedicatedTestDatabase(testDatabaseUrl);
      process.env["DATABASE_URL"] = testDatabaseUrl;
      process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "import-test";
      process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({
        "import-test": testKey,
      });
      const db = getDatabaseClient();
      await db.execute(sql`TRUNCATE TABLE organisations CASCADE`);
      await closeDatabaseConnection();
    });

    after(async () => {
      await closeDatabaseConnection();
    });

    test("UUID mapping is deterministic and RFC 4122 version 5", () => {
      const first = generateDeterministicUuid("employees", "employee-rana");
      const second = generateDeterministicUuid("employees", "employee-rana");
      assert.equal(first, second);
      assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.notEqual(first, generateDeterministicUuid("users", "employee-rana"));
    });

    test("preview validates every collection without writing", async () => {
      const output = runImporter("--preview");
      assert.match(output, /Mode: PREVIEW/);
      assert.match(output, /employee_documents/);
      assert.match(output, /training_courses/);
      assert.match(output, /\[PREVIEW COMPLETE\]/);
      const db = getDatabaseClient();
      assert.equal((await db.select().from(schema.organisations)).length, 0);
      assert.equal((await db.select().from(schema.importBatches)).length, 0);
      await closeDatabaseConnection();
    });

    test("first import loads every non-empty seed collection and encrypts sensitive values", async () => {
      const output = runImporter("--apply");
      assert.match(output, /Source records: 75 \| Inserted: 75/);
      const seeds = createSeedCollections();
      const db = getDatabaseClient();
      assert.equal((await db.select().from(schema.organisations)).length, 1);
      assert.equal((await db.select().from(schema.appSettings)).length, seeds.appSettings.length);
      assert.equal(
        (await db.select().from(schema.attendancePolicies)).length,
        seeds.attendancePolicies.length,
      );
      assert.equal((await db.select().from(schema.employees)).length, seeds.employees.length);
      assert.equal((await db.select().from(schema.users)).length, seeds.users.length);
      assert.equal((await db.select().from(schema.vacancies)).length, seeds.vacancies.length);
      assert.equal(
        (await db.select().from(schema.employeeDocuments)).length,
        seeds.employee_documents.length,
      );
      assert.equal(
        (await db.select().from(schema.trainingCourses)).length,
        seeds.training_courses.length,
      );
      assert.equal(
        (await db.select().from(schema.trainingRequests)).length,
        seeds.training_requests.length,
      );
      assert.equal(
        (await db.select().from(schema.trainingSessions)).length,
        seeds.training_sessions.length,
      );
      assert.equal(
        (await db.select().from(schema.trainingAssignments)).length,
        seeds.training_enrollments.length,
      );
      assert.equal(
        (await db.select().from(schema.notifications)).length,
        seeds.notifications.length,
      );

      const compensation = (await db.select().from(schema.employeeCompensation))[0]!;
      assert.match(compensation.encryptedPayload, /^via1\./);
      assert.equal(
        decryptSensitiveJson<{ currency: string }>(compensation.encryptedPayload).currency,
        "OMR",
      );
      const batch = (await db.select().from(schema.importBatches))[0]!;
      assert.equal(batch.status, "Completed");
      assert.equal(batch.seedVersion, IMPORT_SEED_VERSION);
      assert.equal(batch.totalRows, 75);
      assert.equal(batch.validRows, 75);
      await closeDatabaseConnection();
    });

    test("verify is read-only and repeat import creates a separate unchanged attempt", async () => {
      const verifyOutput = runImporter("--verify");
      assert.match(verifyOutput, /\[VERIFY COMPLETE\]/);
      const repeatOutput = runImporter("--apply");
      assert.match(repeatOutput, /Inserted: 0 \| Unchanged: 75/);
      const db = getDatabaseClient();
      const batches = await db.select().from(schema.importBatches);
      assert.equal(batches.length, 2);
      assert.deepEqual(batches.map((batch) => batch.status).sort(), ["Completed", "Completed"]);
      assert.equal((await db.select().from(schema.employees)).length, 7);
      const lifecycleAudits = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityType, "ImportBatch"));
      assert.equal(lifecycleAudits.length, 4);
      await closeDatabaseConnection();
    });

    test("a changed deterministic record stops the import and records a failed attempt", async () => {
      const db = getDatabaseClient();
      const departmentId = generateDeterministicUuid("departments", "dept-operations");
      await db
        .update(schema.departments)
        .set({ name: "Operations - manually changed" })
        .where(eq(schema.departments.id, departmentId));
      await closeDatabaseConnection();

      assert.ok(childEnvironment);
      const result = spawnSync(
        process.execPath,
        ["--experimental-transform-types", "scripts/import-staging-seed.ts", "--apply"],
        { cwd: process.cwd(), encoding: "utf8", env: childEnvironment },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /conflicts with existing records/);
      const checkDb = getDatabaseClient();
      const changed = await checkDb
        .select()
        .from(schema.departments)
        .where(eq(schema.departments.id, departmentId));
      assert.equal(changed[0]!.name, "Operations - manually changed");
      const failed = await checkDb
        .select()
        .from(schema.importBatches)
        .where(eq(schema.importBatches.status, "Failed"));
      assert.equal(failed.length, 1);
      await checkDb
        .update(schema.departments)
        .set({ name: "Operations" })
        .where(eq(schema.departments.id, departmentId));
      await closeDatabaseConnection();
    });

    test("an injected late failure rolls back all business writes", async () => {
      const db = getDatabaseClient();
      const assignmentId = generateDeterministicUuid(
        "training_enrollments",
        "training-enrollment-tariq-cargo",
      );
      await db
        .delete(schema.trainingAssignments)
        .where(eq(schema.trainingAssignments.id, assignmentId));
      await closeDatabaseConnection();

      assert.ok(childEnvironment);
      const result = spawnSync(
        process.execPath,
        ["--experimental-transform-types", "scripts/import-staging-seed.ts", "--apply"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...childEnvironment, VIA_HR_IMPORT_TEST_FAIL_AT_END: "1" },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Injected end-of-import failure/);
      const checkDb = getDatabaseClient();
      assert.equal(
        (
          await checkDb
            .select()
            .from(schema.trainingAssignments)
            .where(eq(schema.trainingAssignments.id, assignmentId))
        ).length,
        0,
      );
      const failed = await checkDb
        .select()
        .from(schema.importBatches)
        .where(eq(schema.importBatches.status, "Failed"));
      assert.equal(failed.length, 2);
      await closeDatabaseConnection();
    });
  },
);
