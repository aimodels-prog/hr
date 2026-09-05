import assert from "node:assert/strict";
import test from "node:test";

import {
  resetZktecoPairingRateLimitForTests,
  resolveZktecoIntegrationRequest,
  signZktecoPayload,
} from "../src/lib/integrations/zkteco-http.server.ts";

test.afterEach(() => resetZktecoPairingRateLimitForTests());

const secret = "test-only-zkteco-secret-that-is-long-enough";
const now = new Date("2026-09-04T08:00:00.000Z");
const timestamp = String(Math.floor(now.getTime() / 1000));
const payload = JSON.stringify({
  serialNumber: "F18-001",
  model: "ZKTeco F18",
  punches: [
    {
      externalEventId: "7f19c6255bbd4fcc8f0e8b77143475c2",
      deviceUserId: "VIA-0007",
      deviceUserName: "Ahmed Hassan",
      occurredAt: "2026-09-04T07:59:00.000Z",
      status: 0,
      punchMethod: 1,
    },
  ],
});

function request(overrides: { signature?: string; timestamp?: string } = {}) {
  const usedTimestamp = overrides.timestamp ?? timestamp;
  return new Request("https://hr.via-int.com/api/integrations/zkteco/punches", {
    method: "POST",
    body: payload,
    headers: {
      "content-type": "application/json",
      "x-via-device-id": "main-entrance",
      "x-via-timestamp": usedTimestamp,
      "x-via-signature":
        overrides.signature ?? `sha256=${signZktecoPayload(usedTimestamp, payload, secret)}`,
    },
  });
}

test("accepts a correctly signed ZKTeco batch without a portal session", async () => {
  let captured: unknown;
  const response = await resolveZktecoIntegrationRequest(request(), now, {
    secret: () => secret,
    organisationId: async () => "00000000-0000-4000-8000-000000000001",
    ingest: async (organisationId, deviceCode, batch) => {
      captured = { organisationId, deviceCode, batch };
      return { accepted: 1, duplicates: 0, unmatched: 0, rejected: 0 };
    },
  });
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), {
    accepted: 1,
    duplicates: 0,
    unmatched: 0,
    rejected: 0,
  });
  assert.equal((captured as { deviceCode: string }).deviceCode, "main-entrance");
  assert.equal(
    (captured as { batch: { punches: Array<{ deviceUserName?: string }> } }).batch.punches[0]
      ?.deviceUserName,
    "Ahmed Hassan",
  );
});

test("accepts a paired connector credential without using the legacy shared secret", async () => {
  let legacySecretRead = false;
  const pairedRequest = request();
  pairedRequest.headers.set("x-via-auth-version", "2");
  const response = await resolveZktecoIntegrationRequest(pairedRequest, now, {
    secret: () => {
      legacySecretRead = true;
      return "wrong-legacy-secret-that-is-long-enough";
    },
    organisationId: async () => "00000000-0000-4000-8000-000000000001",
    credential: async () => secret,
    ingest: async () => ({ accepted: 1, duplicates: 0, unmatched: 0, rejected: 0 }),
  });
  assert.equal(response?.status, 200);
  assert.equal(legacySecretRead, false);
});

test("redeems a one-time connector pairing code without an HR browser session", async () => {
  let suppliedCode = "";
  const response = await resolveZktecoIntegrationRequest(
    new Request("https://hr.via-int.com/api/integrations/zkteco/pair", {
      method: "POST",
      body: JSON.stringify({
        pairingCode: "ABCD-EFGH-2345",
        connectorVersion: "1.1",
        connectorPlatform: "Windows",
      }),
      headers: { "content-type": "application/json", "x-real-ip": "192.0.2.10" },
    }),
    now,
    {
      secret: () => secret,
      organisationId: async () => "not-used",
      ingest: async () => ({ accepted: 0, duplicates: 0, unmatched: 0, rejected: 0 }),
      pair: async (code) => {
        suppliedCode = code;
        return {
          deviceCode: "main-entrance",
          deviceName: "Main Entrance",
          ingestUrl: "/api/integrations/zkteco/punches",
          credential: "paired-device-credential-that-is-long-enough",
        };
      },
    },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(suppliedCode, "ABCD-EFGH-2345");
  assert.equal((await response.json()).deviceCode, "main-entrance");
});

test("rate limits repeated pairing attempts", async () => {
  const dependencies = {
    secret: () => secret,
    organisationId: async () => "not-used",
    ingest: async () => ({ accepted: 0, duplicates: 0, unmatched: 0, rejected: 0 }),
    pair: async () => {
      throw new Error("The pairing code is invalid or expired.");
    },
  };
  let response: Response | undefined;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    response = await resolveZktecoIntegrationRequest(
      new Request("https://hr.via-int.com/api/integrations/zkteco/pair", {
        method: "POST",
        body: JSON.stringify({ pairingCode: "ABCD-EFGH-2345" }),
        headers: { "content-type": "application/json", "x-real-ip": "198.51.100.4" },
      }),
      now,
      dependencies,
    );
  }
  assert.equal(response?.status, 429);
});

test("rejects a wrong ZKTeco signature before database access", async () => {
  let called = false;
  const response = await resolveZktecoIntegrationRequest(
    request({ signature: `sha256=${"0".repeat(64)}` }),
    now,
    {
      secret: () => secret,
      organisationId: async () => {
        called = true;
        return "not-used";
      },
      ingest: async () => ({ accepted: 0, duplicates: 0, unmatched: 0, rejected: 0 }),
    },
  );
  assert.equal(response?.status, 401);
  assert.equal(called, false);
});

test("rejects an expired signed request to prevent replay", async () => {
  const old = String(Math.floor((now.getTime() - 6 * 60_000) / 1000));
  const response = await resolveZktecoIntegrationRequest(request({ timestamp: old }), now, {
    secret: () => secret,
    organisationId: async () => "not-used",
    ingest: async () => ({ accepted: 0, duplicates: 0, unmatched: 0, rejected: 0 }),
  });
  assert.equal(response?.status, 401);
  assert.deepEqual(await response?.json(), { error: "expired_device_request" });
});

test("rejects malformed punch batches after authenticating the collector", async () => {
  const invalidBody = JSON.stringify({ punches: [] });
  const response = await resolveZktecoIntegrationRequest(
    new Request("https://hr.via-int.com/api/integrations/zkteco/punches", {
      method: "POST",
      body: invalidBody,
      headers: {
        "x-via-device-id": "main-entrance",
        "x-via-timestamp": timestamp,
        "x-via-signature": signZktecoPayload(timestamp, invalidBody, secret),
      },
    }),
    now,
    {
      secret: () => secret,
      organisationId: async () => "not-used",
      ingest: async () => ({ accepted: 0, duplicates: 0, unmatched: 0, rejected: 0 }),
    },
  );
  assert.equal(response?.status, 400);
});
