import assert from "node:assert/strict";
import test from "node:test";
import { toTrackedRequest, type RequestRow } from "../src/lib/data/request-tracking.ts";

const base: RequestRow = {
  id: "request-1",
  module: "Travel",
  title: "Muscat trip",
  employee_id: "employee-1",
  employee_name: "Emmanuel",
  manager_name: "Riccardo",
  status: "Pending HR and Accounts",
  created_at: "2026-11-01T08:00:00.000Z",
  updated_at: "2026-11-02T10:00:00.000Z",
  action_url: "/staff/travel/request-1",
  metadata: { manager: "Approved", hr: "Approved", finance: "Pending" },
};

test("request tracking names earlier approvers while showing the outstanding reviewer", () => {
  const tracked = toTrackedRequest(base, [
    {
      actorName: "Riccardo",
      role: "Line Manager",
      outcome: "Approved",
      at: "2026-11-01T09:00:00.000Z",
    },
    {
      actorName: "Roshana",
      role: "HR",
      outcome: "Approved",
      at: "2026-11-02T09:00:00.000Z",
    },
  ]);
  assert.equal(tracked.group, "Waiting");
  assert.equal(tracked.waitingFor, "Finance");
  assert.deepEqual(tracked.approvedBy, ["Riccardo", "Roshana"]);
  assert.ok(tracked.events.some((event) => event.label === "Riccardo (Line Manager) approved"));
  assert.ok(tracked.events.some((event) => event.label === "Roshana (HR) approved"));
});

test("older leave records keep their recorded approval chain without inventing a decision", () => {
  const tracked = toTrackedRequest(
    {
      ...base,
      module: "Leave",
      status: "Pending HR",
      metadata: {
        chain: [
          {
            role: "Line Manager",
            status: "Approved",
            approvedBy: "user-manager",
            date: "2026-11-01T09:00:00.000Z",
          },
          { role: "HR", status: "Pending" },
        ],
      },
    },
    [],
    { "user-manager": "Riccardo" },
  );
  assert.deepEqual(tracked.approvedBy, ["Riccardo"]);
  assert.equal(tracked.waitingFor, "HR");
  assert.ok(tracked.events.some((event) => event.label === "Line Manager: Approved by Riccardo"));
  assert.equal(
    tracked.events.some((event) => event.label.includes("HR: Approved")),
    false,
  );
});

test("leave amendment decisions remain visible alongside the original approval chain", () => {
  const tracked = toTrackedRequest(
    {
      ...base,
      module: "Leave",
      status: "Approved",
      metadata: {
        chain: [
          {
            role: "Line Manager",
            status: "Approved",
            approvedBy: "manager",
            date: "2026-11-01T09:00:00Z",
          },
        ],
        amendmentChain: [
          { role: "HR", status: "Approved", approvedBy: "hr", date: "2026-11-03T09:00:00Z" },
        ],
      },
    },
    [],
    { manager: "Riccardo", hr: "Roshana" },
  );
  assert.deepEqual(tracked.approvedBy, ["Riccardo", "Roshana"]);
  assert.ok(tracked.events.some((event) => event.label === "HR: Approved by Roshana"));
});

test("a legacy leave stage is not lost when a later stage has an audit event", () => {
  const tracked = toTrackedRequest(
    {
      ...base,
      module: "Leave",
      status: "Approved",
      metadata: {
        chain: [
          {
            role: "Line Manager",
            status: "Approved",
            approvedBy: "manager",
            date: "2026-11-01T09:00:00Z",
          },
          { role: "HR", status: "Approved", approvedBy: "hr", date: "2026-11-02T09:00:00Z" },
        ],
      },
    },
    [
      {
        actorId: "hr",
        actorName: "Roshana",
        role: "HR",
        outcome: "Approved",
        at: "2026-11-02T09:00:01Z",
      },
    ],
    { manager: "Riccardo", hr: "Roshana" },
  );
  assert.equal(tracked.events.filter((event) => event.label.includes("Riccardo")).length, 1);
  assert.equal(tracked.events.filter((event) => event.label.includes("Roshana")).length, 1);
});

test("an approved record remains visible with a clear final state", () => {
  const tracked = toTrackedRequest(
    { ...base, status: "Approved", module: "Time Away", metadata: {} },
    [
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Approved",
        at: "2026-11-02T09:00:00.000Z",
      },
    ],
  );
  assert.equal(tracked.group, "Approved");
  assert.equal(tracked.nextStep, "Approved. No further decision is waiting.");
  assert.deepEqual(tracked.approvedBy, ["Roshana"]);
});

test("the latest decision, not an earlier approval, determines the current approver summary", () => {
  const tracked = toTrackedRequest(
    { ...base, status: "Rejected", module: "Time Away", metadata: {} },
    [
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Approved",
        at: "2026-11-01T09:00:00.000Z",
      },
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Rejected",
        at: "2026-11-02T09:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(tracked.approvedBy, []);
  assert.equal(tracked.events.filter((event) => event.label.includes("Roshana")).length, 2);
});

test("older training records can name a manager who approved before HR review", () => {
  const tracked = toTrackedRequest(
    {
      ...base,
      status: "Pending HR",
      module: "Training",
      metadata: {
        managerAt: "2026-11-01T09:00:00.000Z",
        managerBy: "manager-1",
      },
    },
    [],
    { "manager-1": "Riccardo" },
  );
  assert.deepEqual(tracked.approvedBy, ["Riccardo"]);
  assert.equal(tracked.waitingFor, "HR");
});

test("a replaced document stays in approval history as a closed record", () => {
  const tracked = toTrackedRequest(
    { ...base, module: "Documents", title: "Passport", status: "Replaced" },
    [
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Approved",
        at: "2026-11-01T09:00:00.000Z",
      },
    ],
  );
  assert.equal(tracked.group, "Closed");
  assert.deepEqual(tracked.approvedBy, ["Roshana"]);
});

test("an archived approved request remains history, not a pending task", () => {
  const tracked = toTrackedRequest({
    ...base,
    module: "Leave",
    status: "Approved",
    archived_at: "2026-11-04T12:00:00Z",
  });
  assert.equal(tracked.group, "Closed");
  assert.equal(tracked.archivedAt, "2026-11-04T12:00:00Z");
  assert.match(tracked.status, /^Archived/);
  assert.equal(tracked.waitingFor, "No approval pending");
});

test("travel closure is named once without being mistaken for another approval", () => {
  const tracked = toTrackedRequest(
    {
      ...base,
      status: "Closed",
      metadata: { closedAt: "2026-11-02T09:00:00.000Z" },
    },
    [
      {
        actorName: "Finance Manager",
        role: "Accounts",
        outcome: "Closed",
        at: "2026-11-02T09:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(tracked.approvedBy, []);
  assert.deepEqual(
    tracked.events.map((event) => event.label),
    ["Record created", "Finance Manager (Accounts) closed"],
  );
});

test("request details name the person who created the record without confusing them with its subject", () => {
  const tracked = toTrackedRequest({
    ...base,
    employee_name: "Paolo",
    created_by_name: "Roshana",
    details: { Destination: "Muscat", Purpose: "Client meeting" },
  });
  assert.equal(tracked.employeeName, "Paolo");
  assert.equal(tracked.createdByName, "Roshana");
  assert.equal(tracked.events[0]?.label, "Record created by Roshana");
  assert.equal(tracked.details.Purpose, "Client meeting");
});

test("every resubmission remains in the timeline with its actual submitter", () => {
  const tracked = toTrackedRequest(
    { ...base, metadata: { submittedAt: "2026-11-01T10:00:00.000Z" } },
    [],
    {},
    [
      { actorName: "Emmanuel", at: "2026-11-01T10:00:00.000Z" },
      { actorName: "Roshana", at: "2026-11-02T10:00:00.000Z" },
    ],
  );
  assert.equal(tracked.submittedByName, "Roshana");
  assert.equal(tracked.events.filter((event) => event.label.startsWith("Submitted by")).length, 2);
});

test("recorded stage history is retained when another stage has an audit decision", () => {
  const tracked = toTrackedRequest(
    {
      ...base,
      module: "Timesheets",
      status: "Approved",
      metadata: {
        managerAt: "2026-11-01T09:00:00.000Z",
        managerBy: "manager-1",
        approvedAt: "2026-11-02T09:00:00.000Z",
        approvedBy: "hr-1",
      },
    },
    [
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Approved",
        at: "2026-11-02T09:00:01.000Z",
      },
    ],
    { "manager-1": "Riccardo", "hr-1": "Roshana" },
  );
  assert.ok(tracked.events.some((event) => event.label.includes("Riccardo")));
  assert.equal(tracked.events.filter((event) => event.label.includes("Roshana")).length, 1);
});

test("reopening payroll is a separate event, never a new approval", () => {
  const tracked = toTrackedRequest({ ...base, module: "Payroll", status: "Prepared" }, [
    {
      actorName: "Finance Manager",
      role: "Accounts",
      outcome: "Approved",
      at: "2026-11-01T09:00:00.000Z",
    },
    {
      actorName: "Finance Manager",
      role: "Accounts",
      outcome: "Reopened",
      at: "2026-11-02T09:00:00.000Z",
    },
  ]);
  assert.deepEqual(tracked.approvedBy, []);
  assert.ok(tracked.events.some((event) => event.label.endsWith("reopened")));
});

test("decision history follows actual time even when timestamps have different offsets", () => {
  const tracked = toTrackedRequest({ ...base, status: "Rejected" }, [
    {
      actorName: "Riccardo",
      role: "Line Manager",
      outcome: "Rejected",
      at: "2026-11-02T13:00:00+04:00",
    },
    {
      actorName: "Riccardo",
      role: "Line Manager",
      outcome: "Approved",
      at: "2026-11-02T08:30:00Z",
    },
  ]);
  assert.deepEqual(tracked.approvedBy, []);
  assert.equal(tracked.events[1]?.label, "Riccardo (Line Manager) approved");
  assert.equal(tracked.events[2]?.label, "Riccardo (Line Manager) rejected");
});
