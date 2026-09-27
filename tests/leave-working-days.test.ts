import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveWorkingDates, payrollLeaveDaysInPeriod } from "../src/lib/data/leave-working-days.ts";

const noHolidays = new Set<string>();
const week = [1, 2, 3, 4, 5];
const september = { startDate: "2026-09-01", endDate: "2026-09-30" };
const october = { startDate: "2026-10-01", endDate: "2026-10-31" };
const dates = ["2026-09-28", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"];
const leave = {
  startDate: "2026-09-28",
  endDate: "2026-10-05",
  isHalfDay: false,
  workingDaysRequested: 5,
  workingDates: dates,
};
const noFallback = (): string[] => {
  throw new Error("Snapshot must not use the current calendar");
};

test("working dates exclude holidays and use the configured weekend", () => {
  assert.deepEqual(
    leaveWorkingDates(leave.startDate, leave.endDate, new Set(["2026-09-29"]), week, false),
    dates,
  );
  assert.deepEqual(
    leaveWorkingDates("2026-10-02", "2026-10-05", noHolidays, [0, 1, 2, 3, 4], false),
    ["2026-10-04", "2026-10-05"],
  );
});
test("half-day requests must be one valid working date", () => {
  assert.deepEqual(leaveWorkingDates("2026-10-01", "2026-10-01", noHolidays, week, true), [
    "2026-10-01",
  ]);
  for (const [start, end] of [
    ["2026-10-03", "2026-10-03"],
    ["2026-10-01", "2026-10-02"],
    ["2026-02-30", "2026-02-30"],
  ])
    assert.deepEqual(leaveWorkingDates(start!, end!, noHolidays, week, true), []);
  assert.deepEqual(
    leaveWorkingDates("2026-10-01", "2026-10-01", new Set(["2026-10-01"]), week, true),
    [],
  );
});
test("partial periods conserve approved totals without consulting a changed calendar", () => {
  assert.equal(payrollLeaveDaysInPeriod(leave, september, noFallback), 2);
  assert.equal(payrollLeaveDaysInPeriod(leave, october, noFallback), 3);
  assert.equal(
    payrollLeaveDaysInPeriod(leave, { startDate: "2026-09-29", endDate: "2026-10-01" }, noFallback),
    2,
  );
  assert.equal(
    payrollLeaveDaysInPeriod(leave, { startDate: "2026-09-01", endDate: "2026-09-27" }, noFallback),
    0,
  );
});
test("legacy records use stored totals for whole periods and validated dates for partial periods", () => {
  const legacy = { ...leave, workingDates: undefined };
  assert.equal(
    payrollLeaveDaysInPeriod(
      legacy,
      { startDate: "2026-01-01", endDate: "2026-12-31" },
      noFallback,
    ),
    5,
  );
  assert.equal(
    payrollLeaveDaysInPeriod(legacy, september, () => dates),
    2,
  );
  assert.throws(
    () => payrollLeaveDaysInPeriod(legacy, september, () => dates.slice(1)),
    /Ask HR to review/,
  );
});
test("malformed or duplicate snapshots cannot silently alter deductions", () => {
  for (const workingDates of [
    null,
    "invalid",
    [],
    [...dates, dates[0]],
    ["2026-09-27", ...dates.slice(1)],
    ["2026-09-31", ...dates.slice(1)],
  ])
    assert.throws(
      () => payrollLeaveDaysInPeriod({ ...leave, workingDates }, september, noFallback),
      /Ask HR to review/,
    );
});
test("half-days, year boundaries and leap days stay in their own payroll period", () => {
  const half = {
    ...leave,
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    isHalfDay: true,
    workingDaysRequested: 0.5,
    workingDates: ["2026-10-01"],
  };
  assert.equal(payrollLeaveDaysInPeriod(half, september, noFallback), 0);
  assert.equal(payrollLeaveDaysInPeriod(half, october, noFallback), 0.5);
  const leapDates = leaveWorkingDates("2028-02-28", "2028-03-01", noHolidays, week, false);
  assert.deepEqual(leapDates, ["2028-02-28", "2028-02-29", "2028-03-01"]);
  const leap = {
    ...leave,
    startDate: "2028-02-28",
    endDate: "2028-03-01",
    workingDaysRequested: 3,
    workingDates: leapDates,
  };
  assert.equal(
    payrollLeaveDaysInPeriod(leap, { startDate: "2028-02-01", endDate: "2028-02-29" }, noFallback),
    2,
  );
  const year = {
    ...leave,
    startDate: "2026-12-31",
    endDate: "2027-01-01",
    workingDaysRequested: 2,
    workingDates: ["2026-12-31", "2027-01-01"],
  };
  assert.equal(
    payrollLeaveDaysInPeriod(year, { startDate: "2027-01-01", endDate: "2027-01-31" }, noFallback),
    1,
  );
});
