import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarAuthorisationUrl } from "../src/lib/integrations/google-calendar.server.ts";
import {
  sendWorkflowEmail,
  workflowEmailRaw,
  WorkflowEmailError,
} from "../src/lib/integrations/workflow-email.server.ts";
import { requestGroup, toTrackedRequest } from "../src/lib/data/request-tracking.ts";

test("workflow emails require explicit permission and confirmed Google acceptance", async (t) => {
  const keys = ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "APP_ORIGIN"];
  const previous = keys.map((key) => process.env[key]);
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-client";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-secret";
  process.env.APP_ORIGIN = "https://hr.example.test";
  try {
    assert.ok(
      !calendarAuthorisationUrl("state", "verifier", false, "hr@via-int.com").includes(
        "gmail.send",
      ),
    );
    assert.ok(
      calendarAuthorisationUrl("state", "verifier", true, "hr@via-int.com").includes("gmail.send"),
    );
    const id = "10000000-0000-4000-8000-000000000001";
    assert.throws(() =>
      workflowEmailRaw("person@example.test\r\nBcc: other@example.test", id, "new-hr@example.test"),
    );
    const mime = Buffer.from(
      workflowEmailRaw("person@example.test", id, "new-hr@example.test"),
      "base64url",
    ).toString();
    assert.match(mime, /From: VIA HR Application <new-hr@example.test>/);
    assert.match(mime, /Message-ID: <via-notification-/);
    const morning = Buffer.from(
      workflowEmailRaw("person@example.test", id, "new-hr@example.test", "2026-09-29"),
      "base64url",
    ).toString();
    assert.match(morning, /Subject: VIA HR Application - Missing clock-out for yesterday/);
    const body = Buffer.from(
      morning.split("Content-Transfer-Encoding: base64\r\n\r\n")[1]!.split("\r\n--")[0]!,
      "base64",
    ).toString();
    assert.match(morning, /Content-Type: multipart\/alternative/);
    const html = Buffer.from(
      morning.split("Content-Transfer-Encoding: base64\r\n\r\n")[2]!.split("\r\n--")[0]!,
      "base64",
    ).toString();
    assert.match(html, /Correct clock-out/);
    assert.match(html, /email-via-logo.png/);
    assert.match(html, /max-width:600px/);
    assert.match(body, /\/staff\/me\/attendance\?correct=2026-09-29/);
    assert.match(body, /HR to confirm/);
    assert.doesNotMatch(body, /before leaving|go home/);
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify({ id: "google-message" }), { status: 200 }),
    );
    assert.equal(
      await sendWorkflowEmail("test", "person@example.test", id, "new-hr@example.test"),
      "google-message",
    );
    for (const [status, outcome] of [
      [403, "Blocked"],
      [429, "Queued"],
      [500, "Uncertain"],
      [400, "Failed"],
      [200, "Uncertain"],
    ] as const) {
      fetchMock.mock.mockImplementation(async () => new Response("{}", { status }));
      await assert.rejects(
        () => sendWorkflowEmail("test", "person@example.test", id, "new-hr@example.test"),
        (error: unknown) => error instanceof WorkflowEmailError && error.outcome === outcome,
      );
    }
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("request progress uses the outstanding stage and does not fabricate history", () => {
  const row = {
    id: "request",
    module: "Travel",
    title: "Trip",
    employee_id: "employee",
    employee_name: "Employee",
    manager_name: "Manager",
    status: "Pending HR and Accounts",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    action_url: "/staff/travel/request",
    metadata: { manager: "Approved", hr: "Approved", finance: "Pending" },
  };
  const tracked = toTrackedRequest(row);
  assert.equal(tracked.waitingFor, "Finance");
  assert.equal(tracked.events.length, 1);
  assert.equal(
    toTrackedRequest({ ...row, status: "Pending Super Admin Closure" }).waitingFor,
    "Finance",
  );
  assert.equal(requestGroup("Returned"), "Returned");
  assert.equal(requestGroup("Pending Line Manager"), "Waiting");
});
