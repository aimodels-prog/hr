import assert from "node:assert/strict";
import test from "node:test";
import {
  countTimesheetRemoteWorkDays,
  formatSignedHours,
  isTimesheetWeekend,
  meetsTimesheetDailyTarget,
  meetsTimesheetWorkTarget,
  timesheetCalendarDayLabel,
} from "../src/lib/data/timesheet-day-display.ts";

test("the configured eight-hour target turns green at eight and preserves ten actual hours", () => {
  const day = (workedHours: number) =>
    meetsTimesheetDailyTarget({
      workedHours,
      paidLeaveHours: 0,
      holidayHours: 0,
      targetHours: 8,
      workingDay: true,
    });
  assert.equal(day(7.99), false);
  assert.equal(day(7), false);
  assert.equal(day(8), true);
  assert.equal(day(10), true);
  assert.equal(meetsTimesheetWorkTarget(10, 8), true);
  assert.equal(meetsTimesheetWorkTarget(8, 8), true);
  assert.equal(meetsTimesheetWorkTarget(7, 8), false);
});

test("signed work gaps explain direction without calling extra time overtime", () => {
  assert.equal(formatSignedHours(2), "+2 h");
  assert.equal(formatSignedHours(-2), "-2 h");
  assert.equal(formatSignedHours(0), "0 h");
});

test("paid leave completes a workday, while a weekend turns green only for actual eight-hour work", () => {
  const input = {
    workedHours: 4,
    paidLeaveHours: 4,
    holidayHours: 0,
    targetHours: 8,
    workingDay: true,
  };
  assert.equal(meetsTimesheetDailyTarget(input), true);
  assert.equal(meetsTimesheetDailyTarget({ ...input, paidLeaveHours: 0 }), false);
  assert.equal(meetsTimesheetDailyTarget({ ...input, workingDay: false }), false);
  assert.equal(
    meetsTimesheetDailyTarget({ ...input, workedHours: 8, paidLeaveHours: 0, workingDay: false }),
    true,
  );
  assert.equal(meetsTimesheetWorkTarget(0, 0), false);
});

test("weekend follows configured working days rather than fixed Saturday and Sunday", () => {
  const friday = new Date(2026, 9, 30);
  const sunday = new Date(2026, 10, 1);
  assert.equal(isTimesheetWeekend(friday, [0, 1, 2, 3, 4]), true);
  assert.equal(isTimesheetWeekend(sunday, [0, 1, 2, 3, 4]), false);
  assert.equal(isTimesheetWeekend(sunday, [1, 2, 3, 4, 5]), true);
});

test("calendar labels weekends even when leave or remote work also appears", () => {
  const base = { weekend: true, holiday: false, unpaid: false, remoteWork: false };
  assert.equal(timesheetCalendarDayLabel(base), "Weekend");
  assert.equal(timesheetCalendarDayLabel({ ...base, attendanceStatus: "Rest Day" }), "Weekend");
  assert.equal(
    timesheetCalendarDayLabel({ ...base, leaveName: "Annual Leave" }),
    "Annual Leave · Weekend",
  );
  assert.equal(timesheetCalendarDayLabel({ ...base, remoteWork: true }), "Remote Work · Weekend");
  assert.equal(
    timesheetCalendarDayLabel({ ...base, holiday: true, remoteWork: true }),
    "Public holiday · Weekend",
  );
  assert.equal(
    timesheetCalendarDayLabel({ ...base, attendanceStatus: "Present" }),
    "Present · Weekend",
  );
  assert.equal(
    timesheetCalendarDayLabel({ ...base, weekend: false, remoteWork: true }),
    "Remote Work",
  );
});

test("October 2026 remote-work weekdays remain distinct from Oman weekends", () => {
  const omanWorkingDays = [0, 1, 2, 3, 4];
  const remoteSunday = new Date(2026, 9, 18);
  const friday = new Date(2026, 9, 23);
  assert.equal(isTimesheetWeekend(remoteSunday, omanWorkingDays), false);
  assert.equal(isTimesheetWeekend(friday, omanWorkingDays), true);
  assert.equal(
    timesheetCalendarDayLabel({
      weekend: isTimesheetWeekend(remoteSunday, omanWorkingDays),
      remoteWork: true,
      holiday: false,
      unpaid: false,
    }),
    "Remote Work",
  );
  assert.equal(
    timesheetCalendarDayLabel({
      weekend: isTimesheetWeekend(friday, omanWorkingDays),
      remoteWork: false,
      holiday: false,
      unpaid: false,
    }),
    "Weekend",
  );
});

test("monthly summary counts approved October remote-work weekdays without double counting markers", () => {
  const leaveRequests = [
    {
      startDate: "2026-10-18",
      endDate: "2026-10-22",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { type: "Remote", name: "Remote Work" },
    },
    {
      startDate: "2026-10-25",
      endDate: "2026-10-29",
      isHalfDay: false,
      status: "Taken",
      policySnapshot: { type: "Remote", name: "Remote Work" },
    },
    {
      startDate: "2026-10-30",
      endDate: "2026-10-31",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { type: "Remote", name: "Remote Work" },
    },
  ];
  const input = {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    workingDays: [0, 1, 2, 3, 4],
    leaveRequests,
    entries: [{ isRemoteWork: true, hours: { "2026-10-18": 0 } }],
  };
  assert.equal(countTimesheetRemoteWorkDays(input), 10);
  assert.equal(countTimesheetRemoteWorkDays({ ...input, leaveRequests: [] }), 1);
  assert.equal(
    countTimesheetRemoteWorkDays({
      ...input,
      leaveRequests: leaveRequests.map((request) => ({ ...request, status: "Pending HR" })),
      entries: [],
    }),
    0,
  );
});
