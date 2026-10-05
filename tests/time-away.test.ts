import assert from "node:assert/strict";
import test from "node:test";
import { timeAwayInput, timeAwayMinutes, canRecordTimeAway } from "../src/lib/data/time-away.ts";
test("time away validates same-day periods and keeps self-service available to every role", () => {
  const input = {
    employeeId: "11111111-1111-4111-8111-111111111111",
    date: "2026-10-05",
    startTime: "09:00",
    endTime: "12:00",
    category: "Medical appointment",
  };
  assert.equal(timeAwayInput.safeParse(input).success, true);
  assert.equal(timeAwayInput.safeParse({ ...input, endTime: "08:00" }).success, false);
  assert.equal(timeAwayInput.safeParse({ ...input, date: "2026-02-30" }).success, false);
  assert.equal(timeAwayInput.safeParse({ ...input, startTime: "25:00" }).success, false);
  assert.equal(timeAwayMinutes("09:00", "12:00"), 180);
  for (const role of ["Employee", "Accounts", "IT", "Line Manager", "HR", "Super Admin"])
    assert.equal(canRecordTimeAway(role, "self", "self", null), true);
  assert.equal(canRecordTimeAway("Line Manager", "manager", "staff", "manager"), true);
  assert.equal(canRecordTimeAway("Employee", "manager", "staff", "manager"), false);
  assert.equal(canRecordTimeAway("Line Manager", "manager", "staff", "other"), false);
});
