import assert from "node:assert/strict";
import test from "node:test";
import {
  canViewRequestDecisionSnapshot,
  parseRequestDecisionSnapshot,
  TRACKED_AUDIT_ACTION_PATTERN,
} from "../src/lib/data/request-decision-snapshot.ts";
import { requestDecisionOutcome, toTrackedRequest } from "../src/lib/data/request-tracking.ts";

test("audit prefilter includes each employment review cycle and decision", () => {
  const pattern = new RegExp(TRACKED_AUDIT_ACTION_PATTERN, "i");
  for (const action of ["submit", "confirm", "request-changes", "approve", "return"])
    assert.equal(pattern.test(action), true, action);
  for (const action of ["delete", "read", "export", "random-confirm"])
    assert.equal(pattern.test(action), false, action);
  assert.equal(requestDecisionOutcome("confirm"), "Approved");
  assert.equal(requestDecisionOutcome("request-changes"), "Returned");
});

test("only the subject, HR or an actual reviewer sees a decision snapshot", () => {
  const base = {
    subjectEmployeeId: "employee-1",
    viewerEmployeeId: "employee-2",
    viewerUserId: "viewer-1",
    viewerRole: "Employee",
    actualReviewerUserIds: new Set(["reviewer-1"]),
  };
  assert.equal(canViewRequestDecisionSnapshot(base), false);
  assert.equal(canViewRequestDecisionSnapshot({ ...base, viewerRole: "Super Admin" }), false);
  assert.equal(canViewRequestDecisionSnapshot({ ...base, viewerEmployeeId: "employee-1" }), true);
  assert.equal(canViewRequestDecisionSnapshot({ ...base, viewerRole: "HR" }), true);
  assert.equal(canViewRequestDecisionSnapshot({ ...base, viewerUserId: "reviewer-1" }), true);
});

test("employment snapshot uses immutable human labels and never renders IDs or arbitrary audit text", () => {
  const snapshot = parseRequestDecisionSnapshot("Profile updates", {
    reason: "private text not part of the approved record",
    decisionSnapshot: {
      version: 1,
      kind: "Employment Confirmation",
      employment: {
        legalName: "Emmanuel Essiet",
        staffEntryType: "Existing Employee",
        startDate: "2026-04-01",
        departmentName: "Design",
        departmentId: "3efed322-47cc-46a2-9c15-4e3809492cf0",
        positionName: "Engineer",
        locationName: "Head Office",
        employmentTypeName: "Full-time",
        supervisorName: "Riccardo",
        supervisorEmail: "riccardo@via-int.com",
        visaRequired: false,
      },
    },
  });
  assert.ok(snapshot);
  assert.equal(snapshot.fields.find((field) => field.label === "Department")?.value, "Design");
  assert.equal(snapshot.fields.find((field) => field.label === "Supervisor")?.value, "Riccardo");
  assert.equal(JSON.stringify(snapshot).includes("3efed322"), false);
  assert.equal(JSON.stringify(snapshot).includes("private text"), false);
});

test("older employment decision exposes only saved labels and states missing names", () => {
  const snapshot = parseRequestDecisionSnapshot("Profile updates", {
    submittedDetails: {
      legalName: "Emmanuel Essiet",
      startDate: "2026-04-01",
      departmentId: "3efed322-47cc-46a2-9c15-4e3809492cf0",
      lineManagerEmail: "riccardo@via-int.com",
    },
  });
  assert.ok(snapshot);
  assert.match(snapshot.note ?? "", /names were not saved/);
  assert.equal(
    snapshot.fields.some((field) => field.label === "Department"),
    false,
  );
  assert.equal(JSON.stringify(snapshot).includes("3efed322"), false);
});

test("timesheet snapshot preserves daily and total values without leaking work-entry IDs", () => {
  const snapshot = parseRequestDecisionSnapshot("Timesheets", {
    decisionSnapshot: {
      version: 1,
      period: { startDate: "2026-11-01", endDate: "2026-11-30" },
      totals: {
        expectedHours: 160,
        workedHours: 168,
        attendanceHours: 167,
        leaveHours: 0,
        holidayHours: 0,
      },
      days: [{ date: "2026-11-02", workedHours: 9, leaveHours: 0, status: "Worked" }],
      workEntries: [
        {
          projectId: "private-project-id",
          projectName: "Road Design",
          costCentreId: "private-cost-centre-id",
          costCentreName: "Design team",
          activityCodeId: "private-activity-id",
          activityName: "Drafting",
          locationId: "private-location-id",
          locationName: "Head Office",
          hours: { "2026-11-02": 9 },
          notes: "Bridge drawing review",
        },
      ],
      absences: [{ type: "Annual Leave", isUnpaid: false, hours: { "2026-11-03": 8 } }],
    },
  });
  assert.ok(snapshot);
  assert.equal(snapshot.fields.find((field) => field.label === "Worked hours")?.value, "168 h");
  assert.match(snapshot.days?.[0]?.summary ?? "", /9 h worked/);
  assert.equal(snapshot.sections?.[0]?.heading, "Work allocations");
  assert.equal(snapshot.sections?.[0]?.rows[0]?.title, "Road Design");
  assert.match(snapshot.sections?.[0]?.rows[0]?.detail ?? "", /Design team/);
  assert.match(snapshot.sections?.[0]?.rows[0]?.detail ?? "", /Drafting/);
  assert.match(snapshot.sections?.[0]?.rows[0]?.detail ?? "", /Head Office/);
  assert.match(snapshot.sections?.[0]?.rows[0]?.detail ?? "", /2026-11-02: 9 h/);
  assert.match(snapshot.sections?.[0]?.rows[0]?.detail ?? "", /Bridge drawing review/);
  assert.equal(snapshot.sections?.[1]?.rows[0]?.title, "Annual Leave");
  assert.match(snapshot.sections?.[1]?.rows[0]?.detail ?? "", /2026-11-03: 8 h/);
  assert.equal(JSON.stringify(snapshot).includes("private-project-id"), false);
  assert.equal(JSON.stringify(snapshot).includes("private-cost-centre-id"), false);
  assert.equal(JSON.stringify(snapshot).includes("private-activity-id"), false);
  assert.equal(JSON.stringify(snapshot).includes("private-location-id"), false);
  assert.equal(parseRequestDecisionSnapshot("Timesheets", {}), null);
});

test("timesheet history marks partial snapshots and never substitutes UUIDs for missing names", () => {
  const snapshot = parseRequestDecisionSnapshot("Timesheets", {
    decisionSnapshot: {
      version: 1,
      period: { startDate: "2026-11-01", endDate: "2026-11-30" },
      totals: { expectedHours: 160 },
      truncated: true,
      counts: { days: 30, workEntries: 201, absences: 2 },
      workEntries: [{ projectId: "secret-uuid", hours: { "2026-11-02": 8 } }],
      absences: [{ type: "Sick Leave", isUnpaid: true, hours: { "2026-11-03": 8 } }],
    },
  });
  assert.ok(snapshot);
  assert.equal(snapshot.sections?.[0]?.count, 201);
  assert.equal(snapshot.sections?.[0]?.rows[0]?.title, "Project name not saved");
  assert.equal(snapshot.sections?.[1]?.rows[0]?.title, "Sick Leave (unpaid)");
  assert.match(snapshot.note ?? "", /shortened/);
  assert.equal(JSON.stringify(snapshot).includes("secret-uuid"), false);
});

test("resubmitted employment review keeps every named submission and decision in order", () => {
  const request = toTrackedRequest(
    {
      id: "employee-1",
      module: "Profile updates",
      title: "Employment details",
      employee_id: "employee-1",
      employee_name: "Emmanuel",
      manager_name: "Riccardo",
      status: "Confirmed",
      created_at: "2026-01-01T08:00:00Z",
      updated_at: "2026-11-04T08:00:00Z",
      action_url: "/staff/me/profile",
      metadata: {},
    },
    [
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Returned",
        at: "2026-11-01T09:00:00Z",
        snapshotUnavailable: true,
      },
      {
        actorName: "Roshana",
        role: "HR",
        outcome: "Approved",
        at: "2026-11-04T09:00:00Z",
        snapshot: {
          heading: "Employment details at this decision",
          fields: [{ label: "Position", value: "Engineer" }],
        },
      },
    ],
    {},
    [
      { actorName: "Roshana", at: "2026-11-01T08:00:00Z" },
      { actorName: "Roshana", at: "2026-11-04T08:00:00Z" },
    ],
  );
  assert.deepEqual(
    request.events
      .filter((event) => /Submitted|Roshana \(HR\)/.test(event.label))
      .map((event) => event.label),
    [
      "Submitted by Roshana",
      "Roshana (HR) returned",
      "Submitted by Roshana",
      "Roshana (HR) approved",
    ],
  );
  assert.equal(request.events.at(-1)?.snapshot?.fields[0]?.value, "Engineer");
  assert.equal(
    request.events.some((event) => event.snapshotUnavailable),
    true,
  );
});
