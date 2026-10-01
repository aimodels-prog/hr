import test from "node:test";
import assert from "node:assert/strict";
import { recordedAttendanceHours, recordedDailyHours } from "../src/lib/data/recorded-hours.ts";
import {
  ordinaryAttendanceHours,
  flexibleOfficeSchedule,
} from "../src/lib/data/office-schedule.ts";

test("a full VIA day displays nine hours without rewriting its eight working hours", () => {
  const record = {
    clockInAt: "2026-10-01T08:30:00+04:00",
    clockOutAt: "2026-10-01T17:30:00+04:00",
    calculatedHours: 8,
    breakMinutes: 60,
  };
  assert.equal(recordedAttendanceHours(record), 9);
  assert.equal(record.calculatedHours, 8);
  assert.equal(recordedDailyHours(8, 60), 9);
  assert.equal(flexibleOfficeSchedule("08:30", null, 8).expectedOut, "17:30");
  assert.equal(flexibleOfficeSchedule("07:30", null, 8).expectedOut, "16:30");
});

test("recorded targets use configured hours and breaks; extra presence is not ordinary entitlement", () => {
  assert.equal(recordedDailyHours(7.5, 30), 8);
  assert.equal(recordedDailyHours(8, 0), 8);
  assert.equal(ordinaryAttendanceHours(11, recordedDailyHours(8, 60)), 9);
});

test("partial, overnight and incomplete records do not gain an invented break hour", () => {
  assert.equal(recordedAttendanceHours({ clockIn: "08:30", clockOut: "12:00" }), 3.5);
  assert.equal(recordedAttendanceHours({ clockIn: "22:00", clockOut: "07:00" }), 9);
  assert.equal(recordedAttendanceHours({ clockInAt: "2026-10-01T08:30:00Z" }), 0);
  assert.equal(recordedAttendanceHours({ clockInAt: "invalid", clockOutAt: "invalid" }), 0);
  assert.equal(recordedAttendanceHours(null), 0);
});
