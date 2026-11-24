import assert from "node:assert/strict";
import test from "node:test";
import { weeklyGoalMessage } from "../src/lib/data/weekly-goal-message.ts";
import type { AnalyticsDay } from "../src/lib/data/workforce-analytics.ts";

function day(date: string, patch: Partial<AnalyticsDay> = {}): AnalyticsDay {
  return {
    date,
    worked: 0,
    expected: 0,
    attendanceCredit: 0,
    attendanceTarget: 0,
    recorded: 0,
    review: 0,
    missing: 0,
    leaveDays: 0,
    ...patch,
  };
}

const base = {
  today: "2026-11-24",
  goalHours: 40,
  weekStartDay: 1,
  employeeId: "employee-1",
};

test("weekly goal counts actual office presence above the daily target", () => {
  const result = weeklyGoalMessage({
    ...base,
    days: [day("2026-11-23", { worked: 10, attendanceCredit: 8, attendanceTarget: 8 })],
  });
  assert.equal(result.creditedHours, 10);
  assert.equal(result.workedHours, 10);
  assert.equal(result.remainingHours, 30);
});

test("approved paid time counts without calling it worked time", () => {
  const result = weeklyGoalMessage({
    ...base,
    days: [day("2026-11-23", { worked: 0, attendanceCredit: 8, attendanceTarget: 8 })],
  });
  assert.equal(result.creditedHours, 8);
  assert.equal(result.workedHours, 0);
  assert.equal(result.state, "approved-time");
});

test("a review gap makes the result provisional before any shortfall verdict", () => {
  const result = weeklyGoalMessage({
    ...base,
    days: [day("2026-11-23", { attendanceTarget: 8, review: 1 })],
  });
  assert.equal(result.state, "needs-review");
  assert.equal(result.provisional, true);
  assert.equal(result.problemDate, "2026-11-23");
});

test("zero hours after an expected workday is not described as a fresh week", () => {
  const result = weeklyGoalMessage({
    ...base,
    workingDays: [1, 2, 3, 4, 5],
    dailyHours: 9,
    days: [day("2026-11-23", { attendanceTarget: 8 })],
  });
  assert.equal(result.state, "behind");
  assert.equal(result.remainingScheduledDays, 3);
  assert.match(result.paceGuidance ?? "", /about 13h 20m per day/);
  assert.match(result.paceGuidance ?? "", /check your records with HR/);
});

test("the weekly goal is configurable and copy changes on consecutive days", () => {
  const days = [day("2026-11-23", { worked: 8, attendanceCredit: 8, attendanceTarget: 8 })];
  const monday = weeklyGoalMessage({ ...base, today: "2026-11-23", goalHours: 32, days });
  const tuesday = weeklyGoalMessage({ ...base, today: "2026-11-24", goalHours: 32, days });
  assert.equal(tuesday.goalHours, 32);
  assert.notEqual(monday.headline + monday.detail, tuesday.headline + tuesday.detail);
});

test("the same employee does not see the same on-track wording within 30 days", () => {
  const messages = new Set<string>();
  for (let index = 0; index < 30; index += 1) {
    const date = new Date("2026-11-01T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    const today = date.toISOString().slice(0, 10);
    const result = weeklyGoalMessage({
      ...base,
      today,
      days: [day(today, { worked: 8, attendanceCredit: 8, attendanceTarget: 8 })],
    });
    assert.equal(result.state, "on-track");
    messages.add(`${result.headline} ${result.detail}`);
  }
  assert.equal(messages.size, 30);
});

test("a completed goal earns the trophy wording, but extra hours are not called overtime", () => {
  const result = weeklyGoalMessage({
    ...base,
    days: [
      day("2026-11-23", { worked: 22, attendanceCredit: 8, attendanceTarget: 8 }),
      day("2026-11-24", { worked: 21, attendanceCredit: 8, attendanceTarget: 8 }),
    ],
  });
  assert.equal(result.state, "above-goal");
  assert.equal(result.creditedHours, 43);
  assert.equal(result.remainingHours, 0);
});
