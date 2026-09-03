import "@tanstack/react-start/server-only";

import { isPortalSsoEnabled, loadPortalSsoConfig } from "./auth/portal-sso-config.server.ts";

const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const counters = new Map<string, { count: number; resetAt: number }>();

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be positive.`);
  return parsed;
}

function requestAddress(request: Request): string {
  if (process.env["VIA_HR_TRUST_PROXY"] === "true") {
    return request.headers.get("x-real-ip")?.trim() || "trusted-proxy-unknown";
  }
  return "direct-client";
}

function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response("Too many requests. Please wait and try again.", {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "retry-after": String(retryAfterSeconds),
    },
  });
}

function isStateChanging(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function originFailure(request: Request): Response | null {
  if (!isPortalSsoEnabled() || !isStateChanging(request.method)) return null;
  const origin = request.headers.get("origin");
  if (origin === loadPortalSsoConfig().appOrigin.origin) return null;
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  const apiRequest =
    new URL(request.url).pathname.startsWith("/api/") ||
    new URL(request.url).pathname.startsWith("/_serverFn/") ||
    accept.includes("application/json") ||
    accept.includes("application/x-tss-framed");
  if (apiRequest) {
    return Response.json({ error: "invalid_request_origin" }, { status: 403 });
  }
  return new Response("This request did not come from VIA HR.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function enforceRequestSecurity(request: Request, now = Date.now()): Response | null {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const maximumRequestBytes = positiveInteger(
    "VIA_HR_MAX_REQUEST_BYTES",
    DEFAULT_MAX_REQUEST_BYTES,
  );
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maximumRequestBytes) {
    return new Response("The request is too large.", {
      status: 413,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const rejectedOrigin = originFailure(request);
  if (rejectedOrigin) return rejectedOrigin;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/health/")) return null;
  const mutation = isStateChanging(request.method);
  const windowMs = mutation ? 60_000 : 300_000;
  const limit = positiveInteger(
    mutation ? "VIA_HR_MUTATION_RATE_LIMIT" : "VIA_HR_READ_RATE_LIMIT",
    // TanStack Start transports both reads and writes through server-function POST requests.
    // Keep this application ceiling above the reverse proxy's sustained 10 r/s boundary so a
    // normal page bootstrap or an office sharing one public IP cannot lock everyone out.
    mutation ? 1_200 : 3_000,
  );
  const key = `${requestAddress(request)}:${mutation ? "mutation" : "read"}`;
  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  return rateLimitResponse(Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
}

export function addSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "content-security-policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:",
  );
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(self), payment=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  if (
    new URL(request.url).protocol === "https:" ||
    (process.env["VIA_HR_TRUST_PROXY"] === "true" &&
      request.headers.get("x-forwarded-proto") === "https")
  ) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function resetRequestSecurityForTests(): void {
  counters.clear();
}
