import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  checkDatabaseConnection,
  closeDatabaseConnection,
  DatabaseConfigurationError,
  getDatabaseClient,
} from "../src/lib/db/client.ts";

const originalDatabaseUrl = process.env["DATABASE_URL"];
const originalPoolSize = process.env["DATABASE_POOL_SIZE"];

afterEach(async () => {
  await closeDatabaseConnection();
  if (originalDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = originalDatabaseUrl;
  if (originalPoolSize === undefined) delete process.env["DATABASE_POOL_SIZE"];
  else process.env["DATABASE_POOL_SIZE"] = originalPoolSize;
});

test("database client refuses to start without a server-side connection URL", () => {
  delete process.env["DATABASE_URL"];
  assert.throws(() => getDatabaseClient(), DatabaseConfigurationError);
});

test("database client rejects a non-PostgreSQL connection URL", () => {
  process.env["DATABASE_URL"] = "https://database.example.test/via_hr";
  assert.throws(
    () => getDatabaseClient(),
    /DATABASE_URL must use the postgres or postgresql protocol/,
  );
});

test("database client rejects unsafe pool-size configuration", () => {
  process.env["DATABASE_URL"] = "postgresql://user:password@localhost:5432/via_hr";
  process.env["DATABASE_POOL_SIZE"] = "1000";
  assert.throws(() => getDatabaseClient(), /whole number between 1 and 20/);
});

test(
  "database client completes a PostgreSQL connectivity check when a test URL is supplied",
  { skip: !process.env["VIA_HR_TEST_DATABASE_URL"] },
  async () => {
    process.env["DATABASE_URL"] = process.env["VIA_HR_TEST_DATABASE_URL"];
    const health = await checkDatabaseConnection();
    assert.equal(health.ok, true);
    assert.ok(health.latencyMs >= 0);
  },
);
