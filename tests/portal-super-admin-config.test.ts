import assert from "node:assert/strict";
import test from "node:test";

import { loadBootstrapSuperAdminEmails } from "../src/lib/auth/portal-sso-config.server.ts";

function withEnvironment(values: Record<string, string | undefined>, run: () => void): void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Super Admin email allowlist is normalized and deduplicated", () => {
  withEnvironment(
    {
      ALLOWED_EMAIL_DOMAIN: "via-int.com",
      VIA_HR_SUPER_ADMIN_EMAILS: " AI.MODELS@VIA-INT.COM, hr@via-int.com;ai.models@via-int.com ",
    },
    () => {
      assert.deepEqual(
        [...loadBootstrapSuperAdminEmails()],
        ["ai.models@via-int.com", "hr@via-int.com"],
      );
    },
  );
});

test("Super Admin email allowlist rejects identities outside VIA", () => {
  withEnvironment(
    {
      ALLOWED_EMAIL_DOMAIN: "via-int.com",
      VIA_HR_SUPER_ADMIN_EMAILS: "attacker@example.com",
    },
    () => {
      assert.throws(loadBootstrapSuperAdminEmails, /only valid @via-int\.com email addresses/);
    },
  );
});
