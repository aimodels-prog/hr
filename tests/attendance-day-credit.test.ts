import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceDayCredit } from "../src/lib/data/attendance-day-credit.ts";

test("five office hours plus four approved hours show nine, without counting the clocked overlap twice", () => {
  assert.deepEqual(
    attendanceDayCredit({
      actualWorkHours: 8,
      standardDailyHours: 8,
      clockIn: "08:30",
      clockOut: "17:30",
      breakStart: "13:00",
      breakMinutes: 60,
      approvedIntervals: [{ startTime: "13:00", endTime: "17:00" }],
    }),
    {
      recordedHours: 8,
      officeWorkHours: 5,
      approvedActivityHours: 4,
      policyTopupHours: 0,
      creditedHours: 9,
      complete: true,
    },
  );
});

test("a four-hour home visit completes a standard day but still shows four actual visit hours", () => {
  const result = attendanceDayCredit({
    actualWorkHours: 4,
    standardDailyHours: 8,
    clockIn: "09:00",
    clockOut: "13:00",
    breakStart: "13:00",
    breakMinutes: 60,
    approvedIntervals: [{ startTime: "09:00", endTime: "13:00" }],
  });
  assert.equal(result.officeWorkHours, 0);
  assert.equal(result.approvedActivityHours, 4);
  assert.equal(result.policyTopupHours, 4);
  assert.equal(result.creditedHours, 8);
});

test("unpaid time away is removed from clocked work and does not add paid hours", () => {
  const result = attendanceDayCredit({
    actualWorkHours: 8,
    standardDailyHours: 8,
    clockIn: "08:30",
    clockOut: "17:30",
    breakStart: "13:00",
    breakMinutes: 60,
    unpaidIntervals: [{ startTime: "13:00", endTime: "17:00" }],
  });
  assert.equal(result.officeWorkHours, 5);
  assert.equal(result.approvedActivityHours, 0);
  assert.equal(result.creditedHours, 5);
  assert.equal(result.complete, false);
});

test("overlapping approvals are counted once and actual work above target stays visible", () => {
  const result = attendanceDayCredit({
    actualWorkHours: 5,
    standardDailyHours: 8,
    approvedIntervals: [
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "11:00", endTime: "13:00" },
    ],
  });
  assert.equal(result.approvedActivityHours, 4);
  assert.equal(result.creditedHours, 9);
});

test("half-day paid leave combines with four worked hours; remote work fills the target", () => {
  assert.equal(
    attendanceDayCredit({ actualWorkHours: 4, standardDailyHours: 8, paidLeaveFraction: 0.5 })
      .creditedHours,
    8,
  );
  assert.equal(
    attendanceDayCredit({ actualWorkHours: 0, standardDailyHours: 8, approvedRemoteWork: true })
      .creditedHours,
    8,
  );
});
