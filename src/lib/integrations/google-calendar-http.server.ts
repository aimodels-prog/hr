import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { getPortalPrincipalForRequest } from "../auth/portal-auth-http.server.ts";
import { getDatabaseClient } from "../db/client.ts";
import { encryptSensitiveJson, decryptSensitiveJson } from "../db/encryption.server.ts";
import {
  googleCalendarConnections as connections,
  googleCalendarOAuthStates as states,
} from "../db/schema/google-calendar.ts";
import {
  calendarAuthorisationUrl,
  exchangeCalendarCode,
  googleCalendarConfig,
} from "./google-calendar.server.ts";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const destination = "/staff/interviews";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function resolveGoogleCalendarRequest(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const callback = url.pathname === "/auth/google-calendar/callback";
  const api = url.pathname === "/api/integrations/google-calendar";
  if (!callback && !api) return undefined;
  const redirect = (result: string) =>
    new Response(null, {
      status: 303,
      headers: { ...headers, location: `${destination}?calendar=${result}` },
    });
  try {
    const principal = await getPortalPrincipalForRequest(request);
    if (!principal)
      return callback
        ? redirect("session-expired")
        : Response.json({ error: "unauthorized" }, { status: 401, headers });
    if (!principal.user.roles.some((role) => role === "HR" || role === "Super Admin"))
      return callback
        ? redirect("not-authorised")
        : Response.json({ error: "forbidden" }, { status: 403, headers });
    const db = getDatabaseClient();
    if (api && request.method === "GET") {
      let configured = false;
      try {
        googleCalendarConfig();
        configured = true;
      } catch {
        /* No secret details in the response. */
      }
      const [connection] = await db
        .select({ email: connections.accountEmail, connectedAt: connections.connectedAt })
        .from(connections)
        .where(eq(connections.organisationId, principal.organisationId));
      return Response.json(
        {
          configured,
          connected: !!connection,
          accountEmail: connection?.email ?? "hr@via-int.com",
        },
        { headers },
      );
    }
    if (callback && request.method === "GET") {
      const state = url.searchParams.get("state") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return redirect("connection-failed");
      const [pending] = await db
        .delete(states)
        .where(
          and(
            eq(states.stateHash, hash(state)),
            eq(states.organisationId, principal.organisationId),
            eq(states.userId, principal.user.id),
            eq(states.sessionId, principal.sessionId),
            gt(states.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!pending || url.searchParams.has("error")) return redirect("connection-failed");
      const code = url.searchParams.get("code");
      if (!code || code.length > 8_192) return redirect("connection-failed");
      const account = await exchangeCalendarCode(
        code,
        decryptSensitiveJson<string>(pending.verifierEncrypted),
      );
      await db
        .insert(connections)
        .values({
          organisationId: principal.organisationId,
          accountEmail: account.email,
          refreshTokenEncrypted: encryptSensitiveJson(account.refreshToken),
          connectedBy: principal.user.id,
        })
        .onConflictDoUpdate({
          target: connections.organisationId,
          set: {
            accountEmail: account.email,
            refreshTokenEncrypted: encryptSensitiveJson(account.refreshToken),
            connectedBy: principal.user.id,
            connectedAt: new Date(),
          },
        });
      return redirect("connected");
    }
    if (api && request.method === "POST") {
      const config = googleCalendarConfig();
      if (request.headers.get("origin") !== config.origin)
        return Response.json({ error: "forbidden_origin" }, { status: 403, headers });
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      await db.transaction(async (tx) => {
        await tx
          .delete(states)
          .where(
            and(
              eq(states.organisationId, principal.organisationId),
              lt(states.expiresAt, new Date()),
            ),
          );
        await tx
          .delete(states)
          .where(
            and(
              eq(states.organisationId, principal.organisationId),
              eq(states.userId, principal.user.id),
            ),
          );
        await tx.insert(states).values({
          stateHash: hash(state),
          organisationId: principal.organisationId,
          userId: principal.user.id,
          sessionId: principal.sessionId,
          verifierEncrypted: encryptSensitiveJson(verifier),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
      });
      return new Response(null, {
        status: 303,
        headers: { ...headers, location: calendarAuthorisationUrl(state, verifier) },
      });
    }
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
  } catch {
    // Never log OAuth codes, token responses, request URLs or provider exceptions.
    return callback
      ? redirect("connection-failed")
      : Response.json(
          { error: "Calendar connection is unavailable. Contact your administrator." },
          { status: 503, headers },
        );
  }
}
