import "@tanstack/react-start/server-only";

import {
  isApiRequest,
  isPublicApplicationPath,
  isPublicServerFunction,
} from "./auth/portal-auth-http.server.ts";

export type AppSurface = "combined" | "careers" | "staff";

const STATIC_PATH_PREFIXES = [
  "/assets/",
  "/@vite/",
  "/@id/",
  "/@fs/",
  "/src/",
  "/node_modules/",
  "/__vite",
  "/.well-known/",
];

function absoluteHttpsOrigin(name: string, fallback?: string): URL {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is not configured.`);
  const url = new URL(value);
  const loopbackAllowed =
    process.env["VIA_HR_ALLOW_INSECURE_LOOPBACK"] === "true" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopbackAllowed) {
    throw new Error(`${name} must use HTTPS.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must contain an origin only.`);
  }
  return url;
}

export function getAppSurface(): AppSurface {
  const value = process.env["VIA_HR_APP_SURFACE"]?.trim().toLowerCase() || "combined";
  if (value === "combined" || value === "careers" || value === "staff") return value;
  throw new Error("VIA_HR_APP_SURFACE must be combined, careers or staff.");
}

export function getCareersOrigin(): URL {
  return absoluteHttpsOrigin("VIA_HR_CAREERS_ORIGIN", "https://careers.via-int.com");
}

export function getStaffOrigin(): URL {
  return absoluteHttpsOrigin("APP_ORIGIN");
}

export function isStaticApplicationPath(pathname: string): boolean {
  if (pathname === "/favicon.ico" || pathname === "/favicon.png" || pathname === "/robots.txt") {
    return true;
  }
  if (STATIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|txt)$/i.test(pathname);
}

export function isPublicRecruitmentApi(pathname: string): boolean {
  return pathname === "/api/public/vacancies" || pathname === "/api/public/applications";
}

export function expectedRequestOrigin(request: Request): string | undefined {
  const surface = getAppSurface();
  if (surface === "careers") return getCareersOrigin().origin;
  if (surface === "staff") return getStaffOrigin().origin;
  if (isPublicRecruitmentApi(new URL(request.url).pathname)) return getCareersOrigin().origin;
  return getStaffOrigin().origin;
}

function redirectTo(origin: URL, requestUrl: URL): Response {
  const target = new URL(requestUrl.pathname + requestUrl.search, origin);
  target.searchParams.delete("portal_token");
  return new Response(null, {
    status: 308,
    headers: {
      location: target.toString(),
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}

function redirectStaffRootToDashboard(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL("/dashboard", getStaffOrigin()).toString(),
      "cache-control": "no-store, max-age=0",
      "referrer-policy": "no-referrer",
    },
  });
}

function notFound(request: Request): Response {
  if (isApiRequest(request)) {
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "cache-control": "no-store, max-age=0" } },
    );
  }
  return new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

function requestMatchesOrigin(request: Request, expected: URL): boolean {
  const requested = new URL(request.url);
  const forwardedProtocol =
    process.env["VIA_HR_TRUST_PROXY"] === "true"
      ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
      : undefined;
  const effectiveProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requested.protocol;
  return requested.host === expected.host && effectiveProtocol === expected.protocol;
}

/**
 * Enforces the public/private deployment boundary before routing or authentication.
 * The reverse proxy is not the only security boundary: each container refuses routes
 * belonging to the other surface even when addressed directly on the Docker network.
 */
export function resolveAppSurfaceRequest(request: Request): Response | undefined {
  const surface = getAppSurface();
  if (surface === "combined") return undefined;

  const url = new URL(request.url);
  if (url.pathname.startsWith("/health/") || isStaticApplicationPath(url.pathname)) {
    return undefined;
  }

  const expectedOrigin =
    surface === "careers" ? getCareersOrigin().origin : getStaffOrigin().origin;
  if (!requestMatchesOrigin(request, new URL(expectedOrigin))) return notFound(request);

  if (surface === "careers") {
    if (
      isPublicApplicationPath(url.pathname) ||
      isPublicRecruitmentApi(url.pathname) ||
      isPublicServerFunction(url.pathname)
    ) {
      return undefined;
    }
    if (
      url.pathname === "/dashboard" ||
      url.pathname === "/staff" ||
      url.pathname.startsWith("/staff/")
    ) {
      return redirectTo(getStaffOrigin(), url);
    }
    return notFound(request);
  }

  if (isPublicRecruitmentApi(url.pathname) || isPublicServerFunction(url.pathname)) {
    return notFound(request);
  }
  if (url.pathname === "/") return redirectStaffRootToDashboard();
  if (isPublicApplicationPath(url.pathname)) return redirectTo(getCareersOrigin(), url);
  return undefined;
}
