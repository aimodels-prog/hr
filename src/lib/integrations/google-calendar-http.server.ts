import "@tanstack/react-start/server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getPortalPrincipalForRequest } from "../auth/portal-auth-http.server.ts";
import { getDatabaseClient } from "../db/client.ts";
import { encryptSensitiveJson, decryptSensitiveJson } from "../db/encryption.server.ts";
import {
  getCalendarOrganiserEmail,
  saveCalendarOrganiserEmail,
  calendarEmailFromSettings,
} from "../db/repositories/calendar-settings.repository.server.ts";
import { appSettings } from "../db/schema/organisation.ts";
import { googleAuthorisationPage } from "./google-authorisation-page.ts";
import { GoogleConnectionError, googleConnectionResult } from "./google-connection-result.ts";
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
  if (url.pathname === "/auth/google-calendar/result" && request.method === "GET")
    return googleConnectionResult(url.searchParams.get("result") ?? "connection-failed");
  const callback = url.pathname === "/auth/google-calendar/callback";
  const api = url.pathname === "/api/integrations/google-calendar";
  if (!callback && !api) return undefined;
  const redirect = (result: string) =>
    new Response(null, {
      status: 303,
      headers: {
        ...headers,
        location: callback
          ? `/auth/google-calendar/result?result=${encodeURIComponent(result)}`
          : `${destination}?calendar=${result}`,
      },
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
        .select({
          email: connections.accountEmail,
          connectedAt: connections.connectedAt,
          emailEnabledAt: connections.emailEnabledAt,
        })
        .from(connections)
        .where(eq(connections.organisationId, principal.organisationId));
      const deliveryCounts = await db.execute(
        sql`SELECT status,count(*)::int count FROM workflow_notification_emails WHERE organisation_id=${principal.organisationId} GROUP BY status`,
      );
      return Response.json(
        {
          configured,
          connected: !!connection,
          accountEmail: await getCalendarOrganiserEmail(principal.organisationId),
          emailEnabled: !!connection?.emailEnabledAt,
          emailDeliveryCounts: deliveryCounts,
        },
        { headers },
      );
    }
    if (api && request.method === "PATCH") {
      const origin = process.env["APP_ORIGIN"]?.trim();
      if (!origin || request.headers.get("origin") !== new URL(origin).origin)
        return Response.json({ error: "forbidden_origin" }, { status: 403, headers });
      const body = await request.json();
      if (typeof body?.accountEmail !== "string" || body.accountEmail.length > 254)
        return Response.json(
          { error: "Enter a valid Google account email." },
          { status: 400, headers },
        );
      try {
        const accountEmail = await saveCalendarOrganiserEmail(
          principal.organisationId,
          body.accountEmail,
          {
            userId: principal.user.id,
            displayName: principal.user.displayName,
            activeRole: principal.user.roles.includes("HR") ? "HR" : "Super Admin",
          },
        );
        return Response.json({ accountEmail }, { headers });
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error && error.message.startsWith("This account has linked")
                ? error.message
                : "The account could not be saved. Check the email address and try again.",
          },
          { status: 409, headers },
        );
      }
    }
    if (callback && request.method === "GET") {
      const state = url.searchParams.get("state") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return redirect("approval-expired");
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
      if (!pending) return redirect("approval-expired");
      if (url.searchParams.has("error")) return redirect("permission-declined");
      const code = url.searchParams.get("code");
      if (!code || code.length > 8_192) return redirect("connection-failed");
      const account = await exchangeCalendarCode(
        code,
        decryptSensitiveJson<string>(pending.verifierEncrypted),
        await getCalendarOrganiserEmail(principal.organisationId),
      );
      await db.transaction(async (tx) => {
        const [settings] = await tx
          .select()
          .from(appSettings)
          .where(eq(appSettings.organisationId, principal.organisationId))
          .for("update");
        if (!settings || calendarEmailFromSettings(settings.additionalSettings) !== account.email)
          throw new GoogleConnectionError("account-changed");
        await tx
          .insert(connections)
          .values({
            organisationId: principal.organisationId,
            accountEmail: account.email,
            refreshTokenEncrypted: encryptSensitiveJson(account.refreshToken),
            connectedBy: principal.user.id,
            emailEnabledAt: account.emailAuthorised ? new Date() : null,
          })
          .onConflictDoUpdate({
            target: connections.organisationId,
            set: {
              accountEmail: account.email,
              refreshTokenEncrypted: encryptSensitiveJson(account.refreshToken),
              connectedBy: principal.user.id,
              connectedAt: new Date(),
              emailEnabledAt: account.emailAuthorised
                ? sql`coalesce(${connections.emailEnabledAt},now())`
                : null,
            },
          });
      });
      if (account.emailAuthorised)
        await db.execute(
          sql`UPDATE workflow_notification_emails SET attempts=0,next_attempt_at=now() WHERE organisation_id=${principal.organisationId} AND status='Blocked'`,
        );
      return redirect("connected");
    }
    if (api && request.method === "POST") {
      const config = googleCalendarConfig();
      if (request.headers.get("origin") !== config.origin)
        return Response.json({ error: "forbidden_origin" }, { status: 403, headers });
      if (url.searchParams.get("email") === "disable") {
        await db
          .update(connections)
          .set({ emailEnabledAt: null })
          .where(eq(connections.organisationId, principal.organisationId));
        return redirect("connected");
      }
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
      return googleAuthorisationPage(
        calendarAuthorisationUrl(
          state,
          verifier,
          url.searchParams.get("email") === "enable",
          await getCalendarOrganiserEmail(principal.organisationId),
        ),
      );
    }
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
  } catch (error) {
    // Never log OAuth codes, token responses, request URLs or provider exceptions.
    const reason =
      error instanceof GoogleConnectionError
        ? error.reason
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "google-unavailable"
          : "connection-failed";
    if (callback) console.warn("Google connection callback failed", { reason });
    return callback
      ? redirect(reason)
      : Response.json(
          { error: "Calendar connection is unavailable. Contact your administrator." },
          { status: 503, headers },
        );
  }
}
