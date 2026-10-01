import assert from "node:assert/strict";
import { test } from "node:test";
import {
  officeLunchMinutes,
  attendanceBreakMinutes,
  ordinaryAttendanceHours,
  VIA_OFFICE_SCHEDULE,
} from "../src/lib/data/office-schedule.ts";
import { workedMinutes } from "../src/lib/data/live-attendance.ts";

test("VIA office day is eight working hours with lunch from 13:00 to 14:00", () => {
  assert.equal(ordinaryAttendanceHours(10), 8);
  assert.equal(ordinaryAttendanceHours(6), 6);
  assert.equal(VIA_OFFICE_SCHEDULE.start, "08:30");
  assert.equal(VIA_OFFICE_SCHEDULE.end, "17:30");
  assert.equal(officeLunchMinutes("08:30", "17:30"), 60);
  assert.equal((17.5 - 8.5) * 60 - officeLunchMinutes("08:30", "17:30"), 480);
});
test("partial attendance only deducts lunch actually overlapping attendance", () => {
  assert.equal(officeLunchMinutes("08:30", "12:00"), 0);
  assert.equal(officeLunchMinutes("08:30", "13:30"), 30);
  assert.equal(officeLunchMinutes("13:30", "17:30"), 30);
  assert.equal(officeLunchMinutes("14:00", "17:30"), 0);
  assert.equal(attendanceBreakMinutes("08:30", "12:00", 60, "08:30", "17:30"), 0);
  assert.equal(attendanceBreakMinutes("09:00", "12:00", 15, "09:00", "18:00"), 15);
});
test("live minutes include the lunch interval", () => {
  const record = {
    clockInAt: "2026-09-29T08:30:00+04:00",
    clockOutAt: null,
    breakMinutes: 60,
    breakStartAt: "2026-09-29T13:00:00+04:00",
    breakEndAt: "2026-09-29T14:00:00+04:00",
  };
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T08:53:00+04:00")), 23);
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T13:30:00+04:00")), 300);
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T14:00:00+04:00")), 330);
  assert.equal(workedMinutes(record, Date.parse("2026-09-29T17:30:00+04:00")), 540);
});
