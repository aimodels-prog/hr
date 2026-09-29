import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAttendanceTracked,
  setTrackingAssignment,
  type AttendanceTrackingPolicy,
} from "../src/lib/data/attendance-tracking.ts";
import {
  attendanceToday,
  calculateAttendanceAnalytics,
} from "../src/lib/data/workforce-analytics.ts";

const policy: AttendanceTrackingPolicy = {
  headOfficeLocationId: "hq",
  effectiveFrom: "2026-09-01",
  revision: 1,
  assignments: [
    {
      employeeId: "hq-person",
      effectiveFrom: "2026-09-01",
      mode: "Head Office biometric",
      source: "location",
    },
    { employeeId: "remote", effectiveFrom: "2026-09-01", mode: "Not required", source: "location" },
  ],
};
test("attendance requires explicit eligibility, not a missing machine punch", () => {
  assert.equal(isAttendanceTracked(null, "remote", "2026-09-14"), false);
  assert.equal(isAttendanceTracked(policy, "remote", "2026-09-14"), false);
  assert.equal(isAttendanceTracked(policy, "unknown", "2026-09-14"), false);
  assert.equal(isAttendanceTracked(policy, "hq-person", "2026-09-14"), true);
  assert.equal(isAttendanceTracked(policy, "hq-person", "2026-08-31"), false);
});
test("dated transfers and exceptions preserve previous eligibility and do not mutate input", () => {
  const next = setTrackingAssignment(policy, {
    employeeId: "hq-person",
    effectiveFrom: "2026-10-01",
    mode: "Not required",
    source: "override",
  });
  assert.equal(isAttendanceTracked(next, "hq-person", "2026-09-30"), true);
  assert.equal(isAttendanceTracked(next, "hq-person", "2026-10-01"), false);
  assert.equal(policy.assignments.length, 2);
  assert.equal(next.revision, 2);
});
test("remote staff have no expected biometric hours or absence; leave counts still include them", () => {
  const people = ["hq-person", "remote"].map((id) => ({
    id,
    startDate: "2026-01-01",
    terminationDate: null,
    status: "Active",
    locationId: id === "remote" ? "other" : "hq",
    department: "Operations",
  }));
  const leave = [{ employeeId: "remote", startDate: "2026-09-14", endDate: "2026-09-14" }];
  const today = attendanceToday({
    tracking: policy,
    date: "2026-09-14",
    now: new Date("2026-09-14T12:00Z"),
    people,
    records: [],
    leave,
    pendingVisits: [],
  });
  assert.equal(today.headcount, 1);
  assert.equal(today.onLeave, 1);
  const result = calculateAttendanceAnalytics({
    tracking: policy,
    dates: ["2026-09-14"],
    employees: people.filter((p) => p.id === "remote"),
    workingDays: [1, 2, 3, 4, 5],
    dailyHours: 8,
    holidays: [],
    leave: [],
    records: [],
    pendingVisits: [],
  });
  assert.equal(result[0]?.expected, 0);
});
