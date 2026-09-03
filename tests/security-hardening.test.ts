import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";

import postgres from "postgres";

import {
  addSecurityHeaders,
  enforceRequestSecurity,
  resetRequestSecurityForTests,
} from "../src/lib/http-security.server.ts";
import { redactAuditSummary } from "../src/lib/db/repositories/audit.repository.server.ts";
import { maximumUploadBytes, scanUploadForMalware } from "../src/lib/malware-scanner.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();

async function scannerResult(
  result: string,
): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const server = createServer((socket) => {
    let received = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 14 && received.subarray(-4).equals(Buffer.alloc(4))) {
        socket.end(`stream: ${result}\0`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test scanner did not start.");
  return {
    host: "127.0.0.1",
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

test("uploads are size-limited and fail closed when production scanning is unavailable", async () => {
  const prior = {
    nodeEnv: process.env["NODE_ENV"],
    host: process.env["VIA_HR_MALWARE_SCANNER_HOST"],
  };
  try {
    process.env["NODE_ENV"] = "production";
    delete process.env["VIA_HR_MALWARE_SCANNER_HOST"];
    assert.equal(maximumUploadBytes(), 10 * 1024 * 1024);
    await assert.rejects(scanUploadForMalware(new Uint8Array([1])), /scanner is unavailable/i);
  } finally {
    if (prior.nodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prior.nodeEnv;
    if (prior.host === undefined) delete process.env["VIA_HR_MALWARE_SCANNER_HOST"];
    else process.env["VIA_HR_MALWARE_SCANNER_HOST"] = prior.host;
  }
});

test("the ClamAV stream protocol accepts clean files and refuses detected malware", async () => {
  const priorHost = process.env["VIA_HR_MALWARE_SCANNER_HOST"];
  const priorPort = process.env["VIA_HR_MALWARE_SCANNER_PORT"];
  const clean = await scannerResult("OK");
  try {
    process.env["VIA_HR_MALWARE_SCANNER_HOST"] = clean.host;
    process.env["VIA_HR_MALWARE_SCANNER_PORT"] = String(clean.port);
    await scanUploadForMalware(new TextEncoder().encode("clean document"));
  } finally {
    await clean.close();
  }
  const infected = await scannerResult("Eicar-Signature FOUND");
  try {
    process.env["VIA_HR_MALWARE_SCANNER_HOST"] = infected.host;
    process.env["VIA_HR_MALWARE_SCANNER_PORT"] = String(infected.port);
    await assert.rejects(
      scanUploadForMalware(new TextEncoder().encode("unsafe document")),
      /did not pass the security scan/i,
    );
  } finally {
    await infected.close();
    if (priorHost === undefined) delete process.env["VIA_HR_MALWARE_SCANNER_HOST"];
    else process.env["VIA_HR_MALWARE_SCANNER_HOST"] = priorHost;
    if (priorPort === undefined) delete process.env["VIA_HR_MALWARE_SCANNER_PORT"];
    else process.env["VIA_HR_MALWARE_SCANNER_PORT"] = priorPort;
  }
});

test("request protection enforces body limits, rate limits and security headers", () => {
  const priorMutationLimit = process.env["VIA_HR_MUTATION_RATE_LIMIT"];
  try {
    resetRequestSecurityForTests();
    process.env["VIA_HR_MUTATION_RATE_LIMIT"] = "2";
    const oversized = enforceRequestSecurity(
      new Request("https://hr.example.test/action", {
        method: "POST",
        headers: { "content-length": String(17 * 1024 * 1024) },
      }),
      1_000,
    );
    assert.equal(oversized?.status, 413);

    const request = new Request("https://hr.example.test/action", { method: "POST" });
    assert.equal(enforceRequestSecurity(request, 2_000), null);
    assert.equal(enforceRequestSecurity(request, 2_001), null);
    assert.equal(enforceRequestSecurity(request, 2_002)?.status, 429);

    const secured = addSecurityHeaders(new Request("https://hr.example.test/"), new Response("ok"));
    assert.match(secured.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.equal(secured.headers.get("x-content-type-options"), "nosniff");
    assert.match(secured.headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  } finally {
    resetRequestSecurityForTests();
    if (priorMutationLimit === undefined) delete process.env["VIA_HR_MUTATION_RATE_LIMIT"];
    else process.env["VIA_HR_MUTATION_RATE_LIMIT"] = priorMutationLimit;
  }
});

test("audit presentation never exposes credentials, including to Super Admin", () => {
  const redacted = redactAuditSummary(
    {
      apiKey: "gemini-key",
      databasePassword: "database-password",
      nested: { refreshToken: "workspace-token", ordinaryValue: "kept" },
    },
    {
      userId: "security-test-user",
      displayName: "Security Tester",
      activeRole: "Super Admin",
      roles: ["Employee", "Super Admin"],
    },
  ) as Record<string, unknown>;
  assert.equal(redacted["apiKey"], "Restricted");
  assert.equal(redacted["databasePassword"], "Restricted");
  assert.deepEqual(redacted["nested"], {
    refreshToken: "Restricted",
    ordinaryValue: "kept",
  });
});

test(
  "PostgreSQL guards every mutable record version and prevents tenant reassignment",
  { skip: !testDatabaseUrl },
  async () => {
    const query = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [coverage] = await query<{ tables: string; triggers: string }[]>`
        select
          (select count(distinct table_name)::text from information_schema.columns
           where table_schema='public' and column_name='record_version') as tables,
          (select count(*)::text from pg_trigger t
           join pg_class c on c.oid=t.tgrelid
           join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and t.tgname='via_hr_record_version_guard' and not t.tgisinternal) as triggers
      `;
      assert.ok(coverage);
      assert.equal(coverage.triggers, coverage.tables);

      const [project] = await query<
        { id: string; organisation_id: string; record_version: number }[]
      >`select id,organisation_id,record_version from projects limit 1`;
      assert.ok(project);
      const [updated] = await query<{ record_version: number }[]>`
        update projects set updated_at=updated_at where id=${project.id}
        returning record_version
      `;
      assert.equal(updated?.record_version, project.record_version);
      const [versioned] = await query<{ record_version: number }[]>`
        update projects set record_version=record_version+1 where id=${project.id}
        returning record_version
      `;
      assert.equal(versioned?.record_version, project.record_version + 1);
      await assert.rejects(
        query`update projects set record_version=record_version+2 where id=${project.id}`,
        /can advance by at most one/i,
      );
      await assert.rejects(
        query`update projects set organisation_id=${randomUUID()} where id=${project.id}`,
        /organisation_id cannot be changed/i,
      );
    } finally {
      await query.end();
    }
  },
);
