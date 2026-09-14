import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import * as z from "zod";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export function googleCalendarConfig() {
  const clientId = process.env["GOOGLE_CALENDAR_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_CALENDAR_CLIENT_SECRET"]?.trim();
  const origin = process.env["APP_ORIGIN"]?.trim();
  if (!clientId || !clientSecret || !origin)
    throw new Error("Google Calendar is not configured yet.");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Google Calendar requires a secure application origin.");
  return {
    clientId,
    clientSecret,
    origin: url.origin,
    redirectUri: new URL("/auth/google-calendar/callback", url).toString(),
    accountEmail: "hr@via-int.com",
  };
}

export function calendarAuthorisationUrl(state: string, verifier: string) {
  const config = googleCalendarConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: `openid email ${GOOGLE_CALENDAR_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    login_hint: config.accountEmail,
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  return url.toString();
}

const Tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});
export async function exchangeCalendarCode(code: string, verifier: string) {
  const config = googleCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("Google did not accept the connection. Please reconnect.");
  const tokens = Tokens.parse(await response.json());
  if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(GOOGLE_CALENDAR_SCOPE))
    throw new Error("Google Calendar permission and offline access are required.");
  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!identityResponse.ok) throw new Error("The organising account could not be verified.");
  const identity = z
    .object({ email: z.string().email(), email_verified: z.literal(true) })
    .parse(await identityResponse.json());
  if (identity.email.trim().toLowerCase() !== config.accountEmail)
    throw new Error("Connect the hr@via-int.com Google account.");
  return { email: config.accountEmail, refreshToken: tokens.refresh_token };
}

export async function calendarAccessToken(refreshToken: string) {
  const config = googleCalendarConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok)
    throw new Error("Google Calendar access failed. Reconnect if permission was revoked.");
  return Tokens.parse(await response.json()).access_token;
}

// Deterministic IDs make an uncertain insert safe to recover without duplicating the event.
export function calendarEventId(organisationId: string, interviewId: string) {
  return createHash("sha256").update(`${organisationId}:${interviewId}`).digest("hex");
}

export interface CalendarInterview {
  organisationId: string;
  interviewId: string;
  title: string;
  attendeeEmails: string[];
  startTime: string;
  endTime: string;
  timezone: string;
  cancelled: boolean;
}

/** One event per interview. Re-read after uncertain responses before modifying again. */
export async function synchroniseCalendarInterview(accessToken: string, input: CalendarInterview) {
  const id = calendarEventId(input.organisationId, input.interviewId);
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const read = await fetch(`${base}/${id}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (input.cancelled) {
    if (read.status === 404 || read.status === 410) return { id, cancelled: true, meetUrl: null };
    if (!read.ok) throw new Error("Google Calendar cancellation could not be confirmed.");
    const result = await fetch(`${base}/${id}?sendUpdates=all`, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!result.ok && result.status !== 410)
      throw new Error("Google Calendar cancellation could not be confirmed.");
    return { id, cancelled: true, meetUrl: null };
  }
  const payload = {
    summary: input.title,
    start: { dateTime: input.startTime, timeZone: input.timezone },
    end: { dateTime: input.endTime, timeZone: input.timezone },
    attendees: [...new Set(input.attendeeEmails.map((email) => email.trim().toLowerCase()))]
      .sort()
      .map((email) => ({ email })),
    guestsCanModify: false,
    guestsCanInviteOthers: false,
  };
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const Event = z.object({
    id: z.string(),
    status: z.string().optional(),
    hangoutLink: z.string().url().optional(),
    extendedProperties: z
      .object({ private: z.record(z.string(), z.string()).optional() })
      .optional(),
  });
  let event;
  if (read.ok) {
    event = Event.parse(await read.json());
    if (event.status === "cancelled")
      throw new Error("The Google event was cancelled. HR must review the interview.");
    if (event.extendedProperties?.private?.["viaPayloadHash"] !== payloadHash) {
      const updated = await fetch(`${base}/${id}?sendUpdates=all&conferenceDataVersion=1`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          ...payload,
          extendedProperties: { private: { viaPayloadHash: payloadHash } },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!updated.ok) throw new Error("Google Calendar update is pending; retry safely.");
      event = Event.parse(await updated.json());
    }
  } else if (read.status === 404) {
    const created = await fetch(`${base}?sendUpdates=all&conferenceDataVersion=1`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payload,
        id,
        extendedProperties: { private: { viaPayloadHash: payloadHash } },
        conferenceData: {
          createRequest: { requestId: id, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!created.ok) throw new Error("Google Calendar creation is pending; retry safely.");
    event = Event.parse(await created.json());
  } else throw new Error("Google Calendar could not be read.");
  if (!event.hangoutLink || new URL(event.hangoutLink).hostname !== "meet.google.com")
    throw new Error("Calendar event exists; Google Meet link is not ready yet. Retry safely.");
  return { id, cancelled: false, meetUrl: event.hangoutLink };
}
