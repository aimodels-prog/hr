import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT } from "jose";

import {
  clearedPortalSessionCookie,
  isPublicServerFunction,
  portalLaunchUrl,
  portalSessionCookie,
  redactPortalTokenFromUrl,
  resolvePortalAuthenticationRequest,
} from "../src/lib/auth/portal-auth-http.server.ts";
import {
  MAX_HR_SESSION_SECONDS,
  type PortalSsoConfig,
} from "../src/lib/auth/portal-sso-config.server.ts";
import {
  mapPortalRole,
  PortalTokenError,
  verifyPortalToken,
  type VerifiedPortalIdentity,
} from "../src/lib/auth/portal-token.server.ts";
import type { PortalSessionPrincipal } from "../src/lib/db/repositories/portal-session.repository.server.ts";

const secret = "portal-sso-test-secret-1234567890-abcdefgh";
const now = 1_800_000_000;

function config(): PortalSsoConfig {
  return {
    enabled: true,
    portalUrl: new URL("https://portal.via-int.com"),
    issuer: "via-portal",
    audience: "via-hr",
    appSlug: "via-hr",
    algorithm: "HS256",
    tokenLifetimeSeconds: 120,
    allowedEmailDomain: "via-int.com",
    appOrigin: new URL("https://hr.via-int.com"),
    callbackUrl: new URL("https://hr.via-int.com/auth/portal/callback"),
    postLoginUrl: new URL("https://hr.via-int.com/dashboard"),
    postLogoutUrl: new URL("https://portal.via-int.com"),
    sessionLifetimeSeconds: MAX_HR_SESSION_SECONDS,
  };
}

async function token(
  changes: Record<string, unknown> = {},
  algorithm: "HS256" | "HS384" = "HS256",
  signingSecret = secret,
): Promise<string> {
  const payload = {
    iss: "via-portal",
    aud: "via-hr",
    appSlug: "via-hr",
    email: "Staff.Member@via-int.com",
    name: "Staff Member",
    role: "user",
    exp: now + 120,
    ...changes,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: algorithm })
    .sign(new TextEncoder().encode(signingSecret));
}

async function withSecret<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.env["PORTAL_SSO_SECRET"];
  process.env["PORTAL_SSO_SECRET"] = secret;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env["PORTAL_SSO_SECRET"];
    else process.env["PORTAL_SSO_SECRET"] = previous;
  }
}

test("valid VIA Portal token is signature-verified and normalized", async () => {
  await withSecret(async () => {
    const identity = await verifyPortalToken(await token(), { config: config(), nowSeconds: now });
    assert.deepEqual(identity, {
      email: "staff.member@via-int.com",
      name: "Staff Member",
      portalRole: "user",
      mappedRole: "Employee",
      expiresAt: now + 120,
    });
  });
});

for (const scenario of [
  {
    name: "wrong signature",
    make: () => token({}, "HS256", "different-secret-1234567890-abcdefghij"),
  },
  { name: "wrong issuer", make: () => token({ iss: "another-portal" }) },
  { name: "wrong audience", make: () => token({ aud: "another-app" }) },
  { name: "wrong appSlug", make: () => token({ appSlug: "another-app" }) },
  { name: "expired token", make: () => token({ exp: now - 30 }) },
  { name: "email outside allowed domain", make: () => token({ email: "person@example.com" }) },
  { name: "non-HS256 algorithm", make: () => token({}, "HS384") },
] as const) {
  test(`portal token rejects ${scenario.name}`, async () => {
    await withSecret(async () => {
      const invalidToken = await scenario.make();
      await assert.rejects(
        () => verifyPortalToken(invalidToken, { config: config(), nowSeconds: now }),
        PortalTokenError,
      );
    });
  });
}

test("unknown portal roles can never grant administrator access", () => {
  assert.equal(mapPortalRole("user"), "Employee");
  assert.equal(mapPortalRole("super-admin-from-untrusted-claim"), "Employee");
  assert.equal(mapPortalRole(undefined), "Employee");
});

function principal(): PortalSessionPrincipal {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    organisationId: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2027-01-15T08:00:00.000Z",
    user: {
      id: "33333333-3333-4333-8333-333333333333",
      employeeId: "44444444-4444-4444-8444-444444444444",
      displayName: "Staff Member",
      workspaceEmail: "staff.member@via-int.com",
      roles: ["Employee"],
      status: "Active",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "33333333-3333-4333-8333-333333333333",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "33333333-3333-4333-8333-333333333333",
      recordVersion: 1,
    },
    employee: {
      id: "44444444-4444-4444-8444-444444444444",
      employeeNumber: "VIA-0100",
      legalName: "Staff Member",
      preferredName: "Staff",
      workEmail: "staff.member@via-int.com",
      workspaceEmail: "staff.member@via-int.com",
      department: "Operations",
      position: "Coordinator",
      location: "Muscat Office",
      employmentType: "Full Time",
      startDate: "2026-01-01",
      status: "Active",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "33333333-3333-4333-8333-333333333333",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "33333333-3333-4333-8333-333333333333",
      recordVersion: 1,
    },
  };
}

function dependencies(options: {
  authenticated?: boolean;
  verifiedIdentity?: VerifiedPortalIdentity;
  onRevoke?: (token: string) => void;
}) {
  const identity: VerifiedPortalIdentity = options.verifiedIdentity ?? {
    email: "staff.member@via-int.com",
    name: "Staff Member",
    portalRole: "user",
    mappedRole: "Employee",
    expiresAt: now + 120,
  };
  return {
    enabled: () => true,
    config,
    verifyToken: async (value: string) => {
      if (!value) throw new PortalTokenError();
      return identity;
    },
    createSession: async () => ({ ...principal(), sessionToken: "s".repeat(43) }),
    findSession: async () => (options.authenticated ? principal() : null),
    revokeSession: async (value: string) => options.onRevoke?.(value),
  };
}

test("successful callback creates a secure local cookie and redirects to a clean dashboard", async () => {
  const portalToken = "signed-portal-token-that-must-disappear";
  const response = await resolvePortalAuthenticationRequest(
    new Request(`https://hr.via-int.com/auth/portal/callback?portal_token=${portalToken}`),
    dependencies({}),
  );
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), "/dashboard");
  assert.doesNotMatch(response?.headers.get("location") ?? "", /portal_token|signed-portal-token/);
  const cookie = response?.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^__Host-via_hr_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=28800/);
});

test("missing token clears any partial session and leads to a controlled non-looping error", async () => {
  const callback = await resolvePortalAuthenticationRequest(
    new Request("https://hr.via-int.com/auth/portal/callback"),
    dependencies({}),
  );
  assert.equal(callback?.status, 303);
  assert.equal(callback?.headers.get("location"), "/auth/portal/error?reason=invalid_token");
  assert.equal(callback?.headers.get("set-cookie"), clearedPortalSessionCookie());

  const errorPage = await resolvePortalAuthenticationRequest(
    new Request("https://hr.via-int.com/auth/portal/error?reason=invalid_token"),
    dependencies({}),
  );
  assert.equal(errorPage?.status, 401);
  assert.equal(errorPage?.headers.get("location"), null);
  assert.match(await errorPage!.text(), /Return to VIA Portal/);
});

test("direct protected-page access redirects once to VIA Portal with a safe return URL", async () => {
  const request = new Request("https://hr.via-int.com/staff/me/profile?tab=personal");
  const response = await resolvePortalAuthenticationRequest(request, dependencies({}));
  assert.equal(response?.status, 302);
  const location = response?.headers.get("location") ?? "";
  const launch = new URL(location);
  assert.equal(launch.origin, "https://portal.via-int.com");
  assert.equal(launch.pathname, "/sso/launch");
  assert.equal(launch.searchParams.get("app"), "via-hr");
  assert.equal(
    launch.searchParams.get("returnTo"),
    "https://hr.via-int.com/staff/me/profile?tab=personal",
  );
});

test("unauthenticated API requests receive JSON 401 rather than an HTML redirect", async () => {
  const response = await resolvePortalAuthenticationRequest(
    new Request("https://hr.via-int.com/api/private", {
      headers: { accept: "application/json" },
    }),
    dependencies({}),
  );
  assert.equal(response?.status, 401);
  assert.equal(response?.headers.get("location"), null);
  assert.deepEqual(await response?.json(), { error: "unauthorized" });
});

test("logout revokes only the local session, clears its cookie and returns to VIA Portal", async () => {
  let revoked = "";
  const response = await resolvePortalAuthenticationRequest(
    new Request("https://hr.via-int.com/auth/logout", {
      method: "POST",
      headers: { cookie: "__Host-via_hr_session=local-session-token" },
    }),
    dependencies({ onRevoke: (value) => (revoked = value) }),
  );
  assert.equal(revoked, "local-session-token");
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), "https://portal.via-int.com/");
  assert.equal(response?.headers.get("set-cookie"), clearedPortalSessionCookie());
});

test("an authenticated dashboard request enters the clean staff dashboard", async () => {
  const response = await resolvePortalAuthenticationRequest(
    new Request("https://hr.via-int.com/dashboard", {
      headers: { cookie: `__Host-via_hr_session=${"s".repeat(43)}` },
    }),
    dependencies({ authenticated: true }),
  );
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), "/staff");
});

test("public careers server functions remain available without an HR session", async () => {
  const encoded = Buffer.from(
    JSON.stringify({
      file: "/src/lib/server-functions/vacancy.server.ts?tss-serverfn-split",
      export: "getPublicVacanciesFn_createServerFn_handler",
    }),
  ).toString("base64url");
  assert.equal(isPublicServerFunction(`/_serverFn/${encoded}`), true);
  const response = await resolvePortalAuthenticationRequest(
    new Request(`https://hr.via-int.com/_serverFn/${encoded}`),
    dependencies({}),
  );
  assert.equal(response, undefined);
});

test("portal tokens are redacted from diagnostic URLs and removed from portal return URLs", () => {
  assert.equal(
    redactPortalTokenFromUrl(
      "https://hr.via-int.com/auth/portal/callback?portal_token=secret-value&next=x",
    ),
    "https://hr.via-int.com/auth/portal/callback?portal_token=%5BREDACTED%5D&next=x",
  );
  const launch = new URL(
    portalLaunchUrl(
      new Request("https://hr.via-int.com/staff?portal_token=must-not-leak"),
      config(),
    ),
  );
  assert.doesNotMatch(launch.searchParams.get("returnTo") ?? "", /portal_token|must-not-leak/);
});

test("session cookie helpers enforce the exact production cookie policy", () => {
  assert.equal(
    portalSessionCookie("opaque", MAX_HR_SESSION_SECONDS),
    "__Host-via_hr_session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800",
  );
});
