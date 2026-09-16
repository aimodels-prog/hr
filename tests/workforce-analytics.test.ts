import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateAttendanceAnalytics,
  completedDateRange,
  type AnalyticsEmployee,
} from "../src/lib/data/workforce-analytics.ts";

const employee: AnalyticsEmployee = {
  id: "a",
  startDate: "2026-01-01",
  terminationDate: null,
  status: "Active",
  locationId: "office",
  department: "Operations",
};
const base = {
  dates: ["2026-09-14"],
  employees: [employee],
  workingDays: [1, 2, 3, 4, 5],
  dailyHours: 8,
  holidays: [],
  leave: [],
  records: [],
  pendingVisits: [],
};
test("analytics excludes today and handles year boundaries", () => {
  assert.deepEqual(completedDateRange("2026-01-02", 3), ["2025-12-30", "2025-12-31", "2026-01-01"]);
});
test("expected hours honour holidays, leave and employment dates", () => {
  assert.equal(calculateAttendanceAnalytics(base)[0]?.expected, 8);
  for (const locationId of [null, "office"])
    assert.equal(
      calculateAttendanceAnalytics({ ...base, holidays: [{ date: base.dates[0]!, locationId }] })[0]
        ?.expected,
      0,
    );
  assert.equal(
    calculateAttendanceAnalytics({
      ...base,
      holidays: [{ date: base.dates[0]!, locationId: "other" }],
    })[0]?.expected,
    8,
  );
  assert.equal(calculateAttendanceAnalytics({ ...base, dates: ["2026-09-13"] })[0]?.expected, 0);
  const leave = {
    employeeId: "a",
    startDate: base.dates[0]!,
    endDate: base.dates[0]!,
    isHalfDay: true,
  };
  assert.equal(calculateAttendanceAnalytics({ ...base, leave: [leave] })[0]?.expected, 4);
  assert.equal(
    calculateAttendanceAnalytics({ ...base, leave: [{ ...leave, isHalfDay: false }] })[0]?.expected,
    0,
  );
  for (const person of [
    { ...employee, startDate: "2026-09-15" },
    { ...employee, terminationDate: "2026-09-13" },
  ])
    assert.equal(calculateAttendanceAnalytics({ ...base, employees: [person] })[0]?.expected, 0);
});
test("only closed valid attendance counts; missing and provisional records remain distinct", () => {
  const record = {
    employeeId: "a",
    date: base.dates[0]!,
    clockInAt: "2026-09-14T08:00:00Z",
    clockOutAt: "2026-09-14T16:00:00Z",
    calculatedHours: "8",
    status: "Present",
  };
  assert.equal(calculateAttendanceAnalytics({ ...base, records: [record] })[0]?.worked, 8);
  assert.equal(calculateAttendanceAnalytics(base)[0]?.missing, 1);
  for (const invalid of [
    { ...record, clockOutAt: null },
    { ...record, status: "Correction Pending" },
    { ...record, calculatedHours: "NaN" },
    { ...record, calculatedHours: "-1" },
    { ...record, calculatedHours: "25" },
  ]) {
    const day = calculateAttendanceAnalytics({ ...base, records: [invalid] })[0]!;
    assert.equal(day.worked, 0);
    assert.equal(day.review, 1);
    assert.equal(day.missing, 0);
  }
  const pending = calculateAttendanceAnalytics({
    ...base,
    records: [record],
    pendingVisits: [{ employeeId: "a", date: base.dates[0]! }],
  })[0]!;
  assert.equal(pending.worked, 0);
  assert.equal(pending.review, 1);
});
