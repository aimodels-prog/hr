import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveYearForDate } from "../src/lib/data/leave-year.ts";

test("leave years follow the configured boundary, not the calendar year", () => {
  assert.equal(leaveYearForDate("2026-03-31", "04-01"), 2025);
  assert.equal(leaveYearForDate("2026-04-01", "04-01"), 2026);
  assert.equal(leaveYearForDate("2027-01-01", "04-01"), 2026);
  assert.equal(leaveYearForDate("2026-01-01", "01-01"), 2026);
  assert.throws(() => leaveYearForDate("invalid", "04-01"));
});
