import assert from "node:assert/strict";
import test from "node:test";

import { timesheetDecisionSnapshot } from "../src/lib/data/timesheet-decision-snapshot.ts";

test("timesheet decision snapshot preserves daily hours, work and leave at decision time", () => {
  const workEntry = {
    projectId: "project-1",
    costCentreId: "cost-1",
    activityCodeId: "activity-1",
    locationId: "location-1",
    hours: { "2026-11-01": 8 },
    notes: "Design review",
    secretInternalField: "not an audit field",
  };
  const input = {
    period: { startDate: "2026-11-01", endDate: "2026-11-30" },
    expectedHours: 8,
    reconciliation: {
      timesheetWorkHours: 8,
      attendanceHours: 8.5,
      days: [
        {
          date: "2026-11-01",
          timesheetWorkHours: 8,
          attendanceHours: 8.5,
          projectHours: 8,
          leaveHours: 0,
          holidayHours: 0,
          status: "Matched",
        },
        {
          date: "2026-11-02",
          timesheetWorkHours: 0,
          attendanceHours: 0,
          projectHours: 0,
          leaveHours: 8,
          holidayHours: 0,
          status: "Leave",
        },
      ],
    },
    workEntries: [workEntry],
    absenceEntries: [
      {
        isLeave: true,
        isUnpaidLeave: false,
        notes: "Annual Leave",
        hours: { "2026-11-02": 8 },
      },
    ],
    names: { projects: { "project-1": "Bridge design" } },
  };

  const snapshot = timesheetDecisionSnapshot(input);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.totals, {
    expectedHours: 8,
    workedHours: 8,
    attendanceHours: 8.5,
    leaveHours: 8,
    holidayHours: 0,
  });
  assert.equal(snapshot.workEntries[0]?.projectName, "Bridge design");
  assert.deepEqual(snapshot.workEntries[0]?.hours, { "2026-11-01": 8 });
  assert.equal(snapshot.absences[0]?.type, "Annual Leave");
  assert.equal(JSON.stringify(snapshot).includes("secretInternalField"), false);

  workEntry.hours["2026-11-01"] = 2;
  workEntry.notes = "Changed later";
  input.reconciliation.days[0]!.timesheetWorkHours = 2;
  assert.deepEqual(snapshot.workEntries[0]?.hours, { "2026-11-01": 8 });
  assert.equal(snapshot.workEntries[0]?.notes, "Design review");
  assert.equal(snapshot.days[0]?.workedHours, 8);
});

test("timesheet decision snapshot excludes arbitrary fields and invalid hour keys", () => {
  const snapshot = timesheetDecisionSnapshot({
    period: { startDate: "2026-11-01", endDate: "2026-11-30" },
    expectedHours: 0,
    reconciliation: {
      timesheetWorkHours: 0,
      attendanceHours: 0,
      days: [],
    },
    workEntries: [{ hours: { "bad-date": 10, "2026-11-01": 2 }, extra: "no" }],
    absenceEntries: [{ isRemoteWork: true, hours: { "2026-11-01": 0 }, extra: "no" }],
  });
  assert.deepEqual(snapshot.workEntries[0]?.hours, { "2026-11-01": 2 });
  assert.deepEqual(snapshot.absences[0], {
    type: "Remote work",
    isUnpaid: false,
    hours: { "2026-11-01": 0 },
  });
  assert.equal(JSON.stringify(snapshot).includes('"extra"'), false);
});

test("oversized timesheet audit snapshots are bounded and marked partial", () => {
  const snapshot = timesheetDecisionSnapshot({
    period: { startDate: "2026-11-01", endDate: "2026-11-30" },
    expectedHours: 0,
    reconciliation: {
      timesheetWorkHours: 0,
      attendanceHours: 0,
      days: [],
    },
    workEntries: Array.from({ length: 201 }, () => ({
      projectId: "p".repeat(100),
      hours: { "2026-11-01": 1 },
      notes: "n".repeat(300),
    })),
    absenceEntries: [],
  });

  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.counts.workEntries, 201);
  assert.equal(snapshot.workEntries.length, 200);
  assert.equal(snapshot.workEntries[0]?.projectId?.length, 80);
  assert.equal(snapshot.workEntries[0]?.notes?.length, 240);
});
