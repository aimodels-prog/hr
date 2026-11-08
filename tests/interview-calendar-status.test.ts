import assert from "node:assert/strict";
import test from "node:test";

import {
  interviewCalendarNeedsRetry,
  isRealGoogleMeetUrl,
} from "../src/lib/data/interview-calendar-status.ts";

test("only real Google Meet links can be shown to interviewers", () => {
  assert.equal(isRealGoogleMeetUrl("https://meet.google.com/abc-defg-hij"), true);
  assert.equal(isRealGoogleMeetUrl("https://meet.google.com/simulated-1234567890"), false);
  assert.equal(isRealGoogleMeetUrl("https://meet.google.com.evil.test/abc"), false);
  assert.equal(isRealGoogleMeetUrl("javascript:alert(1)"), false);
});

test("Google interview booking, changes and cancellation expose a retry state", () => {
  const base = {
    videoMethod: "Google Meet",
    status: "Scheduled" as const,
    calendarEventReference: undefined,
    meetingJoinUrl: undefined,
  };
  assert.equal(interviewCalendarNeedsRetry(base), true);
  assert.equal(
    interviewCalendarNeedsRetry({
      ...base,
      calendarEventReference: "pending",
      meetingJoinUrl: "https://meet.google.com/abc-defg-hij",
    }),
    true,
  );
  assert.equal(
    interviewCalendarNeedsRetry({
      ...base,
      calendarEventReference: "event-id",
      meetingJoinUrl: "https://meet.google.com/abc-defg-hij",
    }),
    false,
  );
  assert.equal(
    interviewCalendarNeedsRetry({
      ...base,
      status: "Cancelled",
      calendarEventReference: "pending",
    }),
    true,
  );
  assert.equal(
    interviewCalendarNeedsRetry({
      ...base,
      status: "Cancelled",
      calendarEventReference: undefined,
    }),
    false,
  );
  assert.equal(interviewCalendarNeedsRetry({ ...base, videoMethod: "In person" }), false);
});
