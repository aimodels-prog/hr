import "@tanstack/react-start/server-only";

export const PORTAL_SESSION_COOKIE_NAME = "__Host-via_hr_session";
export const MAX_HR_SESSION_SECONDS = 8 * 60 * 60;

export interface PortalSsoConfig {
  enabled: boolean;
  portalUrl: URL;
  issuer: string;
  audience: string;
  appSlug: string;
  algorithm: "HS256";
  tokenLifetimeSeconds: number;
  allowedEmailDomain: string;
  appOrigin: URL;
  callbackUrl: URL;
  postLoginUrl: URL;
  postLogoutUrl: URL;
  sessionLifetimeSeconds: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a whole number between 1 and ${maximum}.`);
  }
  return value;
}

function absoluteUrl(name: string, fallback?: string): URL {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is not configured.`);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

function isExplicitlyAllowedLoopback(url: URL): boolean {
  if (process.env["VIA_HR_ALLOW_INSECURE_LOOPBACK"] !== "true") return false;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
  );
}

export function isPortalSsoEnabled(): boolean {
  // The public careers container never handles Portal callbacks or HR sessions.
  // Its route boundary is enforced before authentication in the server entry.
  if (process.env["VIA_HR_APP_SURFACE"]?.trim().toLowerCase() === "careers") return false;
  if (process.env["NODE_ENV"] === "production") return true;
  return process.env["PORTAL_SSO_ENABLED"]?.trim().toLowerCase() === "true";
}

export function getPortalSsoSecret(): Uint8Array {
  const secret = required("PORTAL_SSO_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("PORTAL_SSO_SECRET must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(secret);
}

function resolveAllowedEmailDomain(): string {
  const domain = (process.env["ALLOWED_EMAIL_DOMAIN"]?.trim() || "via-int.com").toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(domain) || domain.includes("..")) {
    throw new Error("ALLOWED_EMAIL_DOMAIN is invalid.");
  }
  return domain;
}

/**
 * Deployment-controlled identities that receive Super Admin access on their first
 * verified VIA Portal sign-in. Portal role claims are deliberately not consulted.
 */
export function loadBootstrapSuperAdminEmails(): ReadonlySet<string> {
  const domain = resolveAllowedEmailDomain();
  const configured = process.env["VIA_HR_SUPER_ADMIN_EMAILS"]?.trim();
  if (!configured) return new Set<string>();

  const emails = configured
    .split(/[;,]/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  for (const email of emails) {
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !email.endsWith(`@${domain}`)) {
      throw new Error(
        `VIA_HR_SUPER_ADMIN_EMAILS must contain only valid @${domain} email addresses.`,
      );
    }
  }
  return new Set(emails);
}

export function loadPortalSsoConfig(): PortalSsoConfig {
  const enabled = isPortalSsoEnabled();
  const portalUrl = absoluteUrl("PORTAL_URL", "https://portal.via-int.com");
  const appOrigin = absoluteUrl("APP_ORIGIN");
  const callbackUrl = absoluteUrl(
    "PORTAL_CALLBACK_URL",
    new URL("/auth/portal/callback", appOrigin).toString(),
  );
  const postLoginUrl = absoluteUrl("POST_LOGIN_URL", new URL("/dashboard", appOrigin).toString());
  const postLogoutUrl = absoluteUrl("POST_LOGOUT_URL", portalUrl.toString());
  const issuer = process.env["PORTAL_SSO_ISSUER"]?.trim() || "via-portal";
  const audience = process.env["PORTAL_SSO_AUDIENCE"]?.trim() || "via-hr";
  const appSlug = process.env["PORTAL_APP_SLUG"]?.trim() || "via-hr";
  const algorithm = process.env["PORTAL_SSO_ALGORITHM"]?.trim() || "HS256";
  const allowedEmailDomain = resolveAllowedEmailDomain();

  if (algorithm !== "HS256") throw new Error("PORTAL_SSO_ALGORITHM must be HS256.");
  if (
    portalUrl.protocol !== "https:" ||
    (appOrigin.protocol !== "https:" && !isExplicitlyAllowedLoopback(appOrigin))
  ) {
    throw new Error("PORTAL_URL and APP_ORIGIN must use HTTPS.");
  }
  if (callbackUrl.origin !== appOrigin.origin || callbackUrl.pathname !== "/auth/portal/callback") {
    throw new Error("PORTAL_CALLBACK_URL must be the HR application's callback URL.");
  }
  if (postLoginUrl.origin !== appOrigin.origin || postLoginUrl.pathname !== "/dashboard") {
    throw new Error("POST_LOGIN_URL must be the HR application's /dashboard URL.");
  }
  if (postLogoutUrl.origin !== portalUrl.origin) {
    throw new Error("POST_LOGOUT_URL must return to the configured VIA Portal origin.");
  }

  return {
    enabled,
    portalUrl,
    issuer,
    audience,
    appSlug,
    algorithm: "HS256",
    tokenLifetimeSeconds: positiveInteger("PORTAL_TOKEN_LIFETIME_SECONDS", 120, 300),
    allowedEmailDomain,
    appOrigin,
    callbackUrl,
    postLoginUrl,
    postLogoutUrl,
    sessionLifetimeSeconds: positiveInteger(
      "VIA_HR_SESSION_LIFETIME_SECONDS",
      MAX_HR_SESSION_SECONDS,
      MAX_HR_SESSION_SECONDS,
    ),
  };
}
