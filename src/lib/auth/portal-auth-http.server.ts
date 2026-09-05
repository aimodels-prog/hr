import "@tanstack/react-start/server-only";

import type { PortalSessionPrincipal } from "../db/repositories/portal-session.repository.server.ts";
import {
  createPortalSession,
  findPortalSession,
  PortalAccessError,
  revokePortalSession,
} from "../db/repositories/portal-session.repository.server.ts";
import {
  isPortalSsoEnabled,
  loadPortalSsoConfig,
  PORTAL_SESSION_COOKIE_NAME,
  type PortalSsoConfig,
} from "./portal-sso-config.server.ts";
import { PortalTokenError, verifyPortalToken } from "./portal-token.server.ts";

interface PortalAuthDependencies {
  enabled: () => boolean;
  config: () => PortalSsoConfig;
  verifyToken: typeof verifyPortalToken;
  createSession: typeof createPortalSession;
  findSession: typeof findPortalSession;
  revokeSession: typeof revokePortalSession;
}

const defaultDependencies: PortalAuthDependencies = {
  enabled: isPortalSsoEnabled,
  config: loadPortalSsoConfig,
  verifyToken: verifyPortalToken,
  createSession: createPortalSession,
  findSession: findPortalSession,
  revokeSession: revokePortalSession,
};

const requestPrincipalCache = new WeakMap<Request, Promise<PortalSessionPrincipal | null>>();

function responseHeaders(contentType?: string): HeadersInit {
  return {
    ...(contentType ? { "content-type": contentType } : {}),
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
  };
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const item of header.split(/;\s*/)) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator) === name) return item.slice(separator + 1);
  }
  return undefined;
}

export function portalSessionCookie(token: string, maxAge: number): string {
  return `${PORTAL_SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearedPortalSessionCookie(): string {
  return `${PORTAL_SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function redactPortalTokenFromUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has("portal_token")) url.searchParams.set("portal_token", "[REDACTED]");
    return url.toString();
  } catch {
    return value.replace(/([?&]portal_token=)[^&#\s]*/gi, "$1[REDACTED]");
  }
}

function currentAppUrl(request: Request, config: PortalSsoConfig): URL {
  const requested = new URL(request.url);
  const safe = new URL(requested.pathname + requested.search, config.appOrigin);
  safe.searchParams.delete("portal_token");
  return safe;
}

export function portalLaunchUrl(request: Request, config: PortalSsoConfig): string {
  const launch = new URL("/sso/launch", config.portalUrl);
  launch.searchParams.set("app", config.appSlug);
  launch.searchParams.set("returnTo", currentAppUrl(request, config).toString());
  return launch.toString();
}

function decodeServerFunction(pathname: string): { file?: string; export?: string } | null {
  const encoded = pathname.split("/")[2];
  if (!encoded || encoded.length > 4096) return null;
  try {
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") return null;
    const record = decoded as Record<string, unknown>;
    return {
      ...(typeof record["file"] === "string" ? { file: record["file"] } : {}),
      ...(typeof record["export"] === "string" ? { export: record["export"] } : {}),
    };
  } catch {
    return null;
  }
}

export function isPublicServerFunction(pathname: string): boolean {
  if (!pathname.startsWith("/_serverFn/")) return false;
  const details = decodeServerFunction(pathname);
  if (!details?.file || !details.export) return false;
  if (details.file.includes("/src/lib/server-functions/vacancy.server.ts")) {
    return details.export.startsWith("getPublicVacanciesFn_");
  }
  if (details.file.includes("/src/lib/server-functions/candidate.server.ts")) {
    return details.export.startsWith("submitPublicApplicationFn_");
  }
  return false;
}

export function isPublicApplicationPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    pathname === "/jobs" ||
    pathname.startsWith("/jobs/") ||
    pathname === "/candidate-privacy" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/accessibility"
  )
    return true;
  if (pathname.startsWith("/health/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/favicon.png" || pathname === "/robots.txt") {
    return true;
  }
  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/@vite/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@fs/") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/__vite") ||
    pathname.startsWith("/.well-known/")
  ) {
    return true;
  }
  return /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|txt)$/i.test(pathname);
}

export function isApiRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_serverFn/")
  )
    return true;
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  return (
    accept.includes("application/json") ||
    accept.includes("application/x-tss-framed") ||
    accept.includes("application/x-ndjson")
  );
}

function errorRedirect(code: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...responseHeaders(),
      location: `/auth/portal/error?reason=${encodeURIComponent(code)}`,
      "set-cookie": clearedPortalSessionCookie(),
    },
  });
}

function authenticationErrorPage(config: PortalSsoConfig, reason: string | null): Response {
  const accessProblem = reason === "access_not_configured" || reason === "access_suspended";
  const title = accessProblem
    ? "VIA HR access is unavailable"
    : "Portal sign-in could not be completed";
  const message =
    reason === "access_not_configured"
      ? "Your VIA Portal identity is valid, but your employee access has not been configured in VIA HR. Contact HR or the System Administrator."
      : reason === "access_suspended"
        ? "Your VIA HR account or employee record is not active. Contact HR or the System Administrator."
        : "The portal sign-in link is missing, invalid or expired. Return to VIA Portal and open VIA HR again.";
  const portal = config.portalUrl.origin;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#f4f7fb;color:#10233d;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{background:white;border:1px solid #dbe4ef;border-radius:18px;box-shadow:0 16px 50px #17395f18;max-width:520px;padding:36px;text-align:center}h1{font-size:24px;margin:0 0 12px}p{color:#53657a;line-height:1.6;margin:0 0 24px}a{display:inline-block;background:#0b5b98;color:white;text-decoration:none;border-radius:10px;padding:11px 18px;font-weight:650}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p><a href="${portal}">Return to VIA Portal</a></main></body></html>`;
  return new Response(body, {
    status: accessProblem ? 403 : 401,
    headers: responseHeaders("text/html; charset=utf-8"),
  });
}

function requestAddress(request: Request): string | undefined {
  if (process.env["VIA_HR_TRUST_PROXY"] === "true") {
    return request.headers.get("x-real-ip")?.trim() || undefined;
  }
  return undefined;
}

export async function getPortalPrincipalForRequest(
  request: Request,
  findSession: typeof findPortalSession = findPortalSession,
): Promise<PortalSessionPrincipal | null> {
  const token = cookieValue(request, PORTAL_SESSION_COOKIE_NAME);
  if (!token) return null;
  if (findSession !== findPortalSession) return findSession(token);
  const cached = requestPrincipalCache.get(request);
  if (cached) return cached;
  const principal = findSession(token);
  requestPrincipalCache.set(request, principal);
  return principal;
}

export async function resolvePortalAuthenticationRequest(
  request: Request,
  dependencies: PortalAuthDependencies = defaultDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const enabled = dependencies.enabled();

  if (url.pathname === "/auth/session") {
    if (!enabled) {
      return Response.json(
        { mode: "development" },
        { status: 200, headers: responseHeaders("application/json; charset=utf-8") },
      );
    }
    const principal = await getPortalPrincipalForRequest(request, dependencies.findSession);
    if (!principal) {
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: responseHeaders("application/json; charset=utf-8") },
      );
    }
    return Response.json(
      {
        mode: "portal",
        user: principal.user,
        employee: principal.employee,
        sessionExpiresAt: principal.expiresAt,
      },
      { status: 200, headers: responseHeaders("application/json; charset=utf-8") },
    );
  }

  if (!enabled) return undefined;
  const config = dependencies.config();

  if (url.pathname === "/auth/portal/callback") {
    if (request.method !== "GET") {
      return Response.json(
        { error: "method_not_allowed" },
        {
          status: 405,
          headers: { ...responseHeaders("application/json; charset=utf-8"), allow: "GET" },
        },
      );
    }
    const token = url.searchParams.get("portal_token") ?? "";
    try {
      const identity = await dependencies.verifyToken(token, { config });
      const ipAddress = requestAddress(request);
      const userAgent = request.headers.get("user-agent")?.trim() || undefined;
      const session = await dependencies.createSession(identity, {
        lifetimeSeconds: config.sessionLifetimeSeconds,
        ...(ipAddress ? { ipAddress } : {}),
        ...(userAgent ? { userAgent } : {}),
      });
      return new Response(null, {
        status: 303,
        headers: {
          ...responseHeaders(),
          location: config.postLoginUrl.pathname + config.postLoginUrl.search,
          "set-cookie": portalSessionCookie(session.sessionToken, config.sessionLifetimeSeconds),
        },
      });
    } catch (error) {
      if (error instanceof PortalAccessError) return errorRedirect(error.code);
      if (error instanceof PortalTokenError) return errorRedirect("invalid_token");
      return errorRedirect("authentication_failed");
    }
  }

  if (url.pathname === "/auth/portal/error") {
    return authenticationErrorPage(config, url.searchParams.get("reason"));
  }

  if (url.pathname === "/auth/logout") {
    if (request.method !== "POST") {
      return Response.json(
        { error: "method_not_allowed" },
        {
          status: 405,
          headers: { ...responseHeaders("application/json; charset=utf-8"), allow: "POST" },
        },
      );
    }
    const token = cookieValue(request, PORTAL_SESSION_COOKIE_NAME);
    if (token) await dependencies.revokeSession(token);
    return new Response(null, {
      status: 303,
      headers: {
        ...responseHeaders(),
        location: config.postLogoutUrl.toString(),
        "set-cookie": clearedPortalSessionCookie(),
      },
    });
  }

  if (request.method === "OPTIONS") return undefined;
  if (isPublicApplicationPath(url.pathname) || isPublicServerFunction(url.pathname)) {
    return undefined;
  }

  const principal = await getPortalPrincipalForRequest(request, dependencies.findSession);
  if (principal) {
    if (url.pathname === "/dashboard") {
      return new Response(null, {
        status: 303,
        headers: { ...responseHeaders(), location: "/staff" },
      });
    }
    return undefined;
  }

  if (isApiRequest(request)) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: responseHeaders("application/json; charset=utf-8") },
    );
  }
  return new Response(null, {
    status: 302,
    headers: { ...responseHeaders(), location: portalLaunchUrl(request, config) },
  });
}
