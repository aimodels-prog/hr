import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarEventId,
  synchroniseCalendarInterview,
  calendarAuthorisationUrl,
  exchangeCalendarCode,
} from "../src/lib/integrations/google-calendar.server.ts";

const interview = {
  organisationId: "org-a",
  interviewId: "interview-a",
  title: "Interview",
  attendeeEmails: ["candidate@example.com"],
  startTime: "2026-10-01T10:00:00Z",
  endTime: "2026-10-01T11:00:00Z",
  timezone: "Asia/Muscat",
  cancelled: false,
};

test("Calendar event IDs are stable, tenant-specific and Google-compatible", () => {
  assert.equal(calendarEventId("a", "b"), calendarEventId("a", "b"));
  assert.notEqual(calendarEventId("a", "b"), calendarEventId("c", "b"));
  assert.match(calendarEventId("a", "b"), /^[0-9a-f]{64}$/);
});

test("Calendar insert requests Meet and invitations; retry reads existing event without re-sending", async (t) => {
  let stored: Record<string, unknown> | undefined;
  let inserts = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      inserts++;
      stored = JSON.parse(String(options.body)) as Record<string, unknown>;
      assert.ok(stored["conferenceData"]);
      assert.match(_url, /sendUpdates=all/);
      return Response.json({ ...stored, hangoutLink: "https://meet.google.com/abc-defg-hij" });
    }
    assert.equal(options?.method, undefined);
    return stored
      ? Response.json({ ...stored, hangoutLink: "https://meet.google.com/abc-defg-hij" })
      : new Response(null, { status: 404 });
  });
  await synchroniseCalendarInterview("test-access", interview);
  await synchroniseCalendarInterview("test-access", interview);
  assert.equal(inserts, 1);
});

test("Cancellation of an absent event never creates an invitation", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, options?: RequestInit) => {
    assert.equal(options?.method, undefined);
    return new Response(null, { status: 404 });
  });
  const result = await synchroniseCalendarInterview("test-access", {
    ...interview,
    cancelled: true,
  });
  assert.equal(result.cancelled, true);
});

test("Authorisation requests offline Calendar access without placing secrets in URL", async (t) => {
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });
  process.env["GOOGLE_CALENDAR_CLIENT_ID"] = "test-client";
  process.env["GOOGLE_CALENDAR_CLIENT_SECRET"] = "secret-not-in-url";
  process.env["APP_ORIGIN"] = "https://hr.via-int.com";
  const url = new URL(calendarAuthorisationUrl("state", "verifier"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("login_hint"), "hr@via-int.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.doesNotMatch(url.toString(), /secret-not-in-url/);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ access_token: "test", refresh_token: "test", scope: "openid email" }),
  );
  await assert.rejects(() => exchangeCalendarCode("code", "verifier"), /permission/);
});
