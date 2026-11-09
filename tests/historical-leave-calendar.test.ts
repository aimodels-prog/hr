import assert from "node:assert/strict";
import test from "node:test";
import {
  historicalLeaveMonths,
  type HistoricalLeaveSource,
} from "../src/lib/data/historical-leave-calendar.ts";

function leave(
  startDate: string,
  endDate: string,
  name: string,
  type = "Annual",
  status = "Approved",
  isHalfDay = false,
): HistoricalLeaveSource {
  return {
    startDate,
    endDate,
    isHalfDay,
    status,
    policySnapshot: { name, type },
  };
}

test("historical calendar keeps approved dates and original leave types, with remote separate", () => {
  const months = historicalLeaveMonths({
    leaveRequests: [
      leave("2025-10-13", "2025-10-13", "Annual Leave - imported history"),
      leave("2025-10-14", "2025-10-14", "Sick Leave", "Sick", "Taken", true),
      leave("2025-10-15", "2025-10-15", "Remote Work Day", "Remote"),
      leave("2025-10-16", "2025-10-16", "Cancelled", "Annual", "Cancelled"),
      leave("2025-10-17", "2025-10-17", "Waiting", "Annual", "Pending HR"),
      leave("2026-12-01", "2026-12-01", "Future leave"),
    ],
    periods: [],
    asOfDate: "2026-11-09",
  });
  assert.deepEqual(
    months.map((month) => month.month),
    ["2025-10"],
  );
  const days = new Map(months[0]!.days.map((day) => [day.date, day]));
  assert.deepEqual(days.get("2025-10-13")!.events, [
    { label: "Annual Leave", kind: "Leave", halfDay: false },
  ]);
  assert.deepEqual(days.get("2025-10-14")!.events, [
    { label: "Sick Leave", kind: "Leave", halfDay: true },
  ]);
  assert.deepEqual(days.get("2025-10-15")!.events, [
    { label: "Remote Work", kind: "Remote Work", halfDay: false },
  ]);
  assert.deepEqual(days.get("2025-10-16")!.events, []);
  assert.deepEqual(days.get("2025-10-17")!.events, []);
  assert.equal(months[0]!.days.length, 31);
});

test("historical calendar excludes dates already represented by generated timesheet periods", () => {
  const months = historicalLeaveMonths({
    leaveRequests: [leave("2026-09-10", "2026-10-20", "Annual Leave")],
    periods: [
      { startDate: "2026-09-01", endDate: "2026-09-30" },
      { startDate: "2026-10-01", endDate: "2026-10-15" },
    ],
    asOfDate: "2026-11-09",
  });
  assert.deepEqual(
    months.map((month) => month.month),
    ["2026-10"],
  );
  const days = new Map(months[0]!.days.map((day) => [day.date, day]));
  assert.equal(days.get("2026-10-15")!.coveredByTimesheet, true);
  assert.deepEqual(days.get("2026-10-15")!.events, []);
  assert.equal(days.get("2026-10-16")!.coveredByTimesheet, false);
  assert.equal(days.get("2026-10-16")!.events[0]!.label, "Annual Leave");
  assert.equal(days.get("2026-10-20")!.events[0]!.label, "Annual Leave");
});

test("historical calendar splits leave at year boundaries without moving dates", () => {
  const months = historicalLeaveMonths({
    leaveRequests: [leave("2024-12-31", "2025-01-02", "Special Leave")],
    periods: [],
    asOfDate: "2026-11-09",
  });
  assert.deepEqual(
    months.map((month) => month.month),
    ["2025-01", "2024-12"],
  );
  assert.equal(months[0]!.days.find((day) => day.date === "2025-01-01")!.events.length, 1);
  assert.equal(months[1]!.days.find((day) => day.date === "2024-12-31")!.events.length, 1);
});

test("recorded working dates exclude intervening days from an approved date range", () => {
  const request = leave("2026-10-17", "2026-10-21", "Annual Leave");
  request.policySnapshot!.workingDates = ["2026-10-17", "2026-10-19", "2026-10-21"];
  const months = historicalLeaveMonths({
    leaveRequests: [request],
    periods: [],
    asOfDate: "2026-11-09",
  });
  const days = new Map(months[0]!.days.map((day) => [day.date, day]));
  assert.equal(days.get("2026-10-17")!.events.length, 1);
  assert.equal(days.get("2026-10-18")!.events.length, 0);
  assert.equal(days.get("2026-10-19")!.events.length, 1);
  assert.equal(days.get("2026-10-20")!.events.length, 0);
  assert.equal(days.get("2026-10-21")!.events.length, 1);
});

test("ongoing current-month leave is visible only through today", () => {
  const months = historicalLeaveMonths({
    leaveRequests: [
      leave("2026-11-05", "2026-11-12", "Annual Leave"),
      leave("2026-11-02", "2026-11-02", "Pending", "Annual", "Pending HR"),
      leave("2026-11-03", "2026-11-03", "Original leave", "Annual", "Cancellation Pending"),
      leave("2026-11-04", "2026-11-04", "Original leave", "Annual", "Amendment Pending HR"),
    ],
    periods: [],
    asOfDate: "2026-11-09",
  });
  assert.deepEqual(
    months.map((month) => month.month),
    ["2026-11"],
  );
  const days = new Map(months[0]!.days.map((day) => [day.date, day]));
  assert.equal(days.get("2026-11-05")!.events.length, 1);
  assert.equal(days.get("2026-11-09")!.events.length, 1);
  assert.equal(days.get("2026-11-10")!.events.length, 0);
  assert.equal(days.get("2026-11-02")!.events.length, 0);
  assert.equal(days.get("2026-11-03")!.events[0]!.label, "Original leave");
  assert.equal(days.get("2026-11-04")!.events[0]!.label, "Original leave");
});

test("pending amendments and cancellations keep original approved dates visible", () => {
  const months = historicalLeaveMonths({
    leaveRequests: [
      leave("2026-10-01", "2026-10-01", "Annual Leave", "Annual", "Amendment Pending Line Manager"),
      leave("2026-10-02", "2026-10-02", "Annual Leave", "Annual", "Amendment Pending HR"),
      leave("2026-10-03", "2026-10-03", "Annual Leave", "Annual", "Cancellation Pending"),
      leave("2026-10-04", "2026-10-04", "Annual Leave", "Annual", "Cancellation Approved"),
    ],
    periods: [],
    asOfDate: "2026-11-09",
  });
  const days = new Map(months[0]!.days.map((day) => [day.date, day]));
  assert.equal(days.get("2026-10-01")!.events[0]!.label, "Annual Leave");
  assert.equal(days.get("2026-10-02")!.events[0]!.label, "Annual Leave");
  assert.equal(days.get("2026-10-03")!.events[0]!.label, "Annual Leave");
  assert.deepEqual(days.get("2026-10-04")!.events, []);
});
