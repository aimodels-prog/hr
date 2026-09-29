import { test } from "node:test";
import assert from "node:assert/strict";
import { workedMinutes, formatWorkedMinutes } from "../src/lib/data/live-attendance.ts";

test("07:00 clock-in reaches 23 minutes and survives a fresh calculation", () => {
  const record = { clockInAt: "2026-09-29T07:00:00+04:00", clockOutAt: null, breakMinutes: 0 };
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T07:23:00+04:00")), 23);
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T08:05:00+04:00")), 65);
});
test("clock-out freezes the total and recorded breaks are deducted", () => {
  const record = {
    clockInAt: "2026-09-29T03:00:00Z",
    clockOutAt: "2026-09-29T05:00:00Z",
    breakMinutes: 30,
  };
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T09:00:00Z")), 90);
});
test("future, missing and invalid punches never produce negative or invalid minutes", () => {
  assert.equal(workedMinutes(null, Date.now()), 0);
  assert.equal(
    workedMinutes({ clockInAt: "invalid", clockOutAt: null, breakMinutes: 0 }, Date.now()),
    0,
  );
  assert.equal(
    workedMinutes(
      { clockInAt: "2026-09-29T07:00:00Z", clockOutAt: null, breakMinutes: 60 },
      Date.parse("2026-09-29T06:00:00Z"),
    ),
    0,
  );
});
test("elapsed time is not rounded up and durations stay readable", () => {
  assert.equal(formatWorkedMinutes(23), "23 min");
  assert.equal(formatWorkedMinutes(65), "1 hr 5 min");
});
