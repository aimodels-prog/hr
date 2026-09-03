import assert from "node:assert/strict";
import test from "node:test";

import { resolveHealthRequest } from "../src/lib/health.server.ts";

const healthyDatabase = async () => ({
  ok: true as const,
  checkedAt: "2026-08-30T00:00:00.000Z",
  latencyMs: 7,
});

const healthyWorker = async () => ({
  healthy: true,
  checkedAt: "2026-09-02T00:00:00.000Z",
  activeWorkers: 1,
  staleWorkers: 0,
  queuedJobs: 2,
  retryJobs: 0,
  failedJobs: 1,
  overdueSchedules: 0,
});

test("liveness responds without touching the database", async () => {
  let databaseCalled = false;
  const response = await resolveHealthRequest(
    new Request("http://localhost/health/live"),
    async () => {
      databaseCalled = true;
      return healthyDatabase();
    },
  );

  assert.equal(response?.status, 200);
  assert.equal(databaseCalled, false);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  const body = (await response?.json()) as Record<string, unknown>;
  assert.equal(body["status"], "ok");
  assert.equal(body["service"], "via-hr-system");
  assert.match(String(body["checkedAt"]), /^\d{4}-\d{2}-\d{2}T/);
});

test("readiness returns a safe success response when PostgreSQL is reachable", async () => {
  const response = await resolveHealthRequest(
    new Request("http://localhost/health/ready"),
    healthyDatabase,
  );

  assert.equal(response?.status, 200);
  const body = (await response?.json()) as Record<string, unknown>;
  assert.equal(body["status"], "ready");
  assert.equal(body["database"], "ok");
  assert.equal(body["databaseLatencyMs"], 7);
});

test("readiness hides database errors and returns 503", async () => {
  const response = await resolveHealthRequest(
    new Request("http://localhost/health/ready"),
    async () => {
      throw new Error("postgresql://secret-user:secret-password@private-host/via_hr");
    },
  );

  assert.equal(response?.status, 503);
  const text = await response?.text();
  assert.match(text ?? "", /not_ready/);
  assert.doesNotMatch(text ?? "", /secret-user|secret-password|private-host/);
});

test("worker health reports only safe operational counts", async () => {
  const response = await resolveHealthRequest(
    new Request("http://localhost/health/worker"),
    healthyDatabase,
    healthyWorker,
  );
  assert.equal(response?.status, 200);
  const body = (await response?.json()) as Record<string, unknown>;
  assert.equal(body["service"], "via-hr-background-worker");
  assert.equal(body["activeWorkers"], 1);
  assert.equal(body["failedJobs"], 1);
  assert.equal("lastError" in body, false);
});

test("worker health fails closed when the heartbeat is stale", async () => {
  const response = await resolveHealthRequest(
    new Request("http://localhost/health/worker"),
    healthyDatabase,
    async () => ({ ...(await healthyWorker()), healthy: false, activeWorkers: 0, staleWorkers: 1 }),
  );
  assert.equal(response?.status, 503);
});

test("health endpoints permit only GET and HEAD", async () => {
  const response = await resolveHealthRequest(
    new Request("http://localhost/health/live", { method: "POST" }),
    healthyDatabase,
  );

  assert.equal(response?.status, 405);
  assert.equal(response?.headers.get("allow"), "GET, HEAD");

  const head = await resolveHealthRequest(
    new Request("http://localhost/health/live", { method: "HEAD" }),
    healthyDatabase,
  );
  assert.equal(head?.status, 200);
  assert.equal(await head?.text(), "");
});

test("non-health requests continue to the application router", async () => {
  const response = await resolveHealthRequest(
    new Request("http://localhost/staff"),
    healthyDatabase,
  );
  assert.equal(response, undefined);
});
