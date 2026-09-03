import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceRequestSecurity,
  resetRequestSecurityForTests,
} from "../src/lib/http-security.server.ts";

const ssoEnvironment = {
  PORTAL_SSO_ENABLED: "true",
  PORTAL_URL: "https://portal.via-int.com",
  APP_ORIGIN: "https://hr.via-int.com",
  PORTAL_CALLBACK_URL: "https://hr.via-int.com/auth/portal/callback",
  POST_LOGIN_URL: "https://hr.via-int.com/dashboard",
  POST_LOGOUT_URL: "https://portal.via-int.com",
} as const;

async function withSsoEnvironment<T>(operation: () => T | Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(ssoEnvironment)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    resetRequestSecurityForTests();
    return await operation();
  } finally {
    resetRequestSecurityForTests();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("production mutations accept only the configured HR origin", async () => {
  await withSsoEnvironment(() => {
    const accepted = enforceRequestSecurity(
      new Request("https://hr.via-int.com/_serverFn/action", {
        method: "POST",
        headers: { origin: "https://hr.via-int.com" },
      }),
    );
    assert.equal(accepted, null);

    const rejected = enforceRequestSecurity(
      new Request("https://hr.via-int.com/_serverFn/action", {
        method: "POST",
        headers: { origin: "https://portal.via-int.com", accept: "application/json" },
      }),
    );
    assert.equal(rejected?.status, 403);
  });
});

test("production mutations without an Origin header are rejected", async () => {
  await withSsoEnvironment(async () => {
    const rejected = enforceRequestSecurity(
      new Request("https://hr.via-int.com/api/change", {
        method: "POST",
        headers: { accept: "application/json" },
      }),
    );
    assert.equal(rejected?.status, 403);
    assert.deepEqual(await rejected?.json(), { error: "invalid_request_origin" });
  });
});

test("safe reads and health checks do not require an Origin header", async () => {
  await withSsoEnvironment(() => {
    assert.equal(enforceRequestSecurity(new Request("https://hr.via-int.com/staff")), null);
    assert.equal(enforceRequestSecurity(new Request("https://hr.via-int.com/health/ready")), null);
  });
});
