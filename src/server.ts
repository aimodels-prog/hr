import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { closeDatabaseConnection } from "./lib/db/client";
import { resolveHealthRequest } from "./lib/health.server";
import { addSecurityHeaders, enforceRequestSecurity } from "./lib/http-security.server";
import { resolvePortalAuthenticationRequest } from "./lib/auth/portal-auth-http.server";
import { resolvePublicRecruitmentRequest } from "./lib/recruitment/public-recruitment-http.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
let shutdownHandlersRegistered = false;

function registerGracefulShutdown(): void {
  if (shutdownHandlersRegistered || typeof process === "undefined") return;
  shutdownHandlersRegistered = true;

  const closeDatabase = () => {
    void closeDatabaseConnection().catch((error: unknown) => {
      console.error("Failed to close the PostgreSQL connection cleanly.", error);
    });
  };

  process.once("SIGTERM", closeDatabase);
  process.once("SIGINT", closeDatabase);
  process.once("beforeExit", closeDatabase);
}

registerGracefulShutdown();

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const rejected = enforceRequestSecurity(request);
      if (rejected) return addSecurityHeaders(request, rejected);
      const healthResponse = await resolveHealthRequest(request);
      if (healthResponse) return addSecurityHeaders(request, healthResponse);
      const publicRecruitmentResponse = await resolvePublicRecruitmentRequest(request);
      if (publicRecruitmentResponse) return addSecurityHeaders(request, publicRecruitmentResponse);
      const authenticationResponse = await resolvePortalAuthenticationRequest(request);
      if (authenticationResponse) return addSecurityHeaders(request, authenticationResponse);

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return addSecurityHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return addSecurityHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
