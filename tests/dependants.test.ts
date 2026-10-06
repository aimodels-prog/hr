import assert from "node:assert/strict";
import test from "node:test";
import { dependantSchema, missingDependantInformation } from "../src/lib/data/dependants.ts";
import {
  workflowEmailDestination,
  workflowEmailRaw,
} from "../src/lib/integrations/workflow-email.server.ts";

const child = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Child",
  relationship: "Child",
  dateOfBirth: "2020-01-01",
};
test("existing dependant details are kept while new missing requirements are listed", () => {
  assert.deepEqual(dependantSchema.parse(child), child);
  assert.equal(missingDependantInformation(child, []).length, 4);
  const completed = {
    ...child,
    phone: "guardian phone",
    nationality: "Omani",
    visaRequired: "No" as const,
  };
  assert.deepEqual(
    missingDependantInformation(completed, [
      {
        dependantId: child.id,
        dependantDocumentKind: "national_id",
        status: "Pending Verification",
      },
    ]),
    [],
  );
  assert.ok(
    missingDependantInformation({ ...completed, visaRequired: "Yes" }, []).includes(
      "visa document",
    ),
  );
  assert.ok(
    missingDependantInformation(completed, [
      { dependantId: "someone-else", dependantDocumentKind: "passport", status: "Valid" },
    ]).includes("passport or ID document"),
  );
  assert.ok(
    missingDependantInformation(completed, [
      { dependantId: child.id, dependantDocumentKind: "passport", status: "Rejected" },
    ]).includes("passport or ID document"),
  );
});
test("workflow email explains the event, carries its action link and keeps family identifiers inside the app", () => {
  const before = { ...process.env };
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "test";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test";
  process.env.APP_ORIGIN = "https://hr.example.com";
  try {
    const make = (context: Parameters<typeof workflowEmailRaw>[4]) => {
      const raw = Buffer.from(
        workflowEmailRaw("employee@example.com", child.id, "hr@example.com", undefined, context),
        "base64url",
      ).toString();
      return Buffer.from(
        raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[1]!.split("\r\n--")[0]!,
        "base64",
      ).toString();
    };
    const body = make({
      title: "Leave request approved",
      message: "Your leave request has been approved. No further action is required.",
      path: "/staff/me/leave-balances",
    });
    assert.match(body, /^Leave request approved/);
    assert.match(body, /No further action is required/);
    assert.match(body, /https:\/\/hr.example.com\/staff\/me\/leave-balances/);
    const family = make({
      title: "Complete your family information",
      message: "Child Passport SECRET",
      type: "dependants.missing_information_reminder",
      path: "/staff/me/profile",
    });
    assert.doesNotMatch(family, /SECRET/);
    assert.match(family, /missing required details or documents/);
    assert.equal(
      workflowEmailDestination("https://hr.example.com", "https://evil.example"),
      "https://hr.example.com/staff/requests",
    );
  } finally {
    for (const key of [
      "GOOGLE_CALENDAR_CLIENT_ID",
      "GOOGLE_CALENDAR_CLIENT_SECRET",
      "APP_ORIGIN",
    ]) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
