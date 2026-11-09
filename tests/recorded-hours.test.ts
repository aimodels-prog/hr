import test from "node:test";
import assert from "node:assert/strict";
import {
  recordedAttendanceHours,
  recordedDailyHours,
  recordedWorkingHours,
} from "../src/lib/data/recorded-hours.ts";
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
  assert.equal(recordedWorkingHours(record, 8), 8);
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

test("timesheet work uses stored net hours while attendance retains elapsed presence", () => {
  const full = {
    clockInAt: "2026-10-01T08:30:00+04:00",
    clockOutAt: "2026-10-01T17:30:00+04:00",
    calculatedHours: "8",
    breakMinutes: 60,
  };
  const short = {
    ...full,
    clockOutAt: "2026-10-01T16:30:00+04:00",
    calculatedHours: "7",
  };
  assert.equal(recordedAttendanceHours(full), 9);
  assert.equal(recordedWorkingHours(full, 8), 8);
  assert.equal(recordedAttendanceHours(short), 8);
  assert.equal(recordedWorkingHours(short, 8), 7);
  assert.equal(recordedWorkingHours({ ...short, calculatedHours: null }, 8), 7);
  assert.equal(recordedWorkingHours({ creditedHours: 9, calculatedHours: "9" }, 8), 8);
  assert.equal(recordedWorkingHours({ calculatedHours: "7.5" }, 7.5), 7.5);
  assert.equal(recordedWorkingHours({ calculatedHours: "10" }), 10);
  assert.equal(recordedWorkingHours({ calculatedHours: "10" }, 8), 8);
});
