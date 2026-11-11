import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedLeaveCoversDate,
  approvedLeaveIntersectsRange,
  approvedLeaveSnapshotIncludesDate,
  approvedLeaveUsageSpans,
  approvedLeaveFraction,
  isApprovedRemoteWork,
  organisationDate,
  timesheetAbsences,
} from "../src/lib/data/approved-leave.ts";

const leave = {
  startDate: "2026-10-08",
  endDate: "2026-10-12",
  isHalfDay: false,
  status: "Approved",
  policySnapshot: { name: "Annual Leave — imported history" },
};
test("approved leave includes first/last dates, pending changes retain original dates, cancellations stop coverage", () => {
  for (const status of [
    "Approved",
    "Taken",
    "Cancellation Pending",
    "Amendment Pending Line Manager",
    "Amendment Pending HR",
  ]) {
    for (const date of [leave.startDate, leave.endDate])
      assert.equal(approvedLeaveFraction([{ ...leave, status }], date), 1);
  }
  for (const status of ["Pending HR", "Declined", "Cancelled", "Cancellation Approved"])
    assert.equal(approvedLeaveFraction([{ ...leave, status }], leave.startDate), 0);
  assert.equal(approvedLeaveFraction([leave], "2026-10-13"), 0);
  assert.equal(organisationDate(new Date("2026-10-07T20:30:00Z"), "Asia/Muscat"), "2026-10-08");
});

test("a recorded working-date list prevents timesheets from labelling excluded dates as leave or remote work", () => {
  const recorded = {
    ...leave,
    policySnapshot: {
      ...leave.policySnapshot,
      workingDates: ["2026-10-08", "2026-10-12"],
    },
  };
  assert.equal(approvedLeaveCoversDate(recorded, "2026-10-08"), true);
  assert.equal(approvedLeaveCoversDate(recorded, "2026-10-09"), false);
  assert.equal(approvedLeaveFraction([recorded], "2026-10-09"), 0);
  assert.equal(approvedLeaveSnapshotIncludesDate(recorded.policySnapshot, "2026-10-09"), false);
  assert.equal(approvedLeaveIntersectsRange(recorded, "2026-10-09", "2026-10-11"), false);
  assert.equal(approvedLeaveIntersectsRange(recorded, "2026-10-09", "2026-10-12"), true);
  assert.deepEqual(approvedLeaveUsageSpans({ ...recorded, workingDaysRequested: 2 }), [
    { startDate: "2026-10-08", endDate: "2026-10-08", days: 1 },
    { startDate: "2026-10-12", endDate: "2026-10-12", days: 1 },
  ]);
  assert.equal(
    isApprovedRemoteWork(
      { ...recorded, policySnapshot: { ...recorded.policySnapshot, type: "Remote" } },
      "2026-10-09",
    ),
    false,
  );
});
test("remote work counts as scheduled work, not leave or a credited absence", () => {
  const remote = { ...leave, policySnapshot: { name: "Remote Work Day", type: "Remote" } };
  const resignation = {
    ...leave,
    policySnapshot: { name: "Last working day", type: "Resignation" },
  };
  assert.equal(approvedLeaveFraction([remote, resignation], leave.startDate), 0);
  assert.equal(isApprovedRemoteWork(remote, leave.startDate), true);
  assert.equal(isApprovedRemoteWork({ ...remote, status: "Pending HR" }, leave.startDate), false);
  assert.equal(isApprovedRemoteWork(remote, "2026-10-13"), false);
  const result = timesheetAbsences({
    dates: ["2026-10-08"],
    workingDays: [4],
    dailyHours: 8,
    holidays: new Set(),
    leave: [remote],
  });
  assert.equal(result.expectedWorkHours, 8);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.isRemoteWork, true);
  assert.equal(result.entries[0]?.hours["2026-10-08"], 8);
  assert.equal(result.entries[0]?.total, 8);
});

test("approved October remote work fills scheduled hours without creating leave", () => {
  const dates = Array.from(
    { length: 31 },
    (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`,
  );
  const remote = [
    {
      startDate: "2026-10-18",
      endDate: "2026-10-22",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Remote Work Day", type: "Remote" },
    },
    {
      startDate: "2026-10-25",
      endDate: "2026-10-29",
      isHalfDay: false,
      status: "Approved",
      policySnapshot: { name: "Remote Work Day", type: "Remote" },
    },
  ];
  const result = timesheetAbsences({
    dates,
    workingDays: [0, 1, 2, 3, 4],
    dailyHours: 8,
    holidays: new Set(),
    leave: remote,
  });
  const marker = result.entries.find((entry) => entry.isRemoteWork);
  assert.equal(Object.keys(marker?.hours ?? {}).length, 10);
  assert.equal(marker?.total, 80);
  assert.equal(result.entries.filter((entry) => entry.isLeave).length, 0);
  assert.equal(result.expectedWorkHours, 168);
});

test("approved remote work stays visible on a weekend or public holiday without credit", () => {
  const result = timesheetAbsences({
    dates: ["2026-10-23", "2026-10-24"],
    workingDays: [0, 1, 2, 3, 4],
    dailyHours: 8,
    holidays: new Set(["2026-10-24"]),
    leave: [
      {
        startDate: "2026-10-23",
        endDate: "2026-10-24",
        isHalfDay: false,
        status: "Approved",
        policySnapshot: { name: "Remote Work Day", type: "Remote" },
      },
    ],
  });
  assert.equal(result.entries.find((entry) => entry.isRemoteWork)?.hours["2026-10-23"], 0);
  assert.equal(result.entries.find((entry) => entry.isRemoteWork)?.hours["2026-10-24"], 0);
  assert.equal(result.expectedWorkHours, 0);
});
test("timesheets fill leave and half days without converting them into work or double counting weekends/holidays", () => {
  const dates = [
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11",
    "2026-10-12",
    "2026-10-13",
  ];
  const result = timesheetAbsences({
    dates,
    workingDays: [1, 2, 3, 4, 5],
    dailyHours: 8,
    holidays: new Set(["2026-10-09"]),
    leave: [leave, { ...leave, startDate: "2026-10-13", endDate: "2026-10-13", isHalfDay: true }],
  });
  assert.equal(result.expectedWorkHours, 4);
  assert.equal(result.entries.find((entry) => entry.isLeave)!.total, 20);
  assert.equal(result.entries.find((entry) => entry.isHoliday)!.total, 8);
  assert.equal(result.entries.find((entry) => entry.isLeave)!.notes, "Annual Leave");
  assert.equal(result.entries.find((entry) => entry.isLeave)!.hours["2026-10-10"], undefined);
  assert.equal(result.entries.find((entry) => entry.isLeave)!.hours["2026-10-09"], undefined);
  assert.equal(approvedLeaveFraction([leave, leave], leave.startDate), 1);
  assert.equal(
    timesheetAbsences({
      dates: [leave.startDate],
      workingDays: [4],
      dailyHours: 7.5,
      holidays: new Set(),
      leave: [{ ...leave, isHalfDay: true }],
    }).expectedWorkHours,
    3.75,
  );
});

test("historical leave keeps each recorded type and half-day while remote work stays separate", () => {
  const result = timesheetAbsences({
    dates: ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"],
    workingDays: [0, 1, 2, 3, 4],
    dailyHours: 8,
    holidays: new Set(),
    leave: [
      {
        startDate: "2026-10-18",
        endDate: "2026-10-18",
        isHalfDay: false,
        status: "Approved",
        policySnapshot: { name: "Annual Leave — imported history", type: "Annual" },
      },
      {
        startDate: "2026-10-19",
        endDate: "2026-10-19",
        isHalfDay: false,
        status: "Taken",
        policySnapshot: { name: "Sick Leave — imported history", type: "Sick" },
      },
      {
        startDate: "2026-10-20",
        endDate: "2026-10-20",
        isHalfDay: true,
        status: "Approved",
        policySnapshot: { name: "Half-day Leave — imported history", type: "Other" },
      },
      {
        startDate: "2026-10-21",
        endDate: "2026-10-21",
        isHalfDay: false,
        status: "Approved",
        policySnapshot: { name: "Remote Work Day", type: "Remote" },
      },
    ],
  });
  assert.deepEqual(
    result.entries.filter((entry) => entry.isLeave).map((entry) => [entry.notes, entry.total]),
    [
      ["Annual Leave", 8],
      ["Sick Leave", 8],
      ["Half-day Leave", 4],
    ],
  );
  assert.equal(result.entries.find((entry) => entry.isRemoteWork)?.hours["2026-10-21"], 8);
  assert.equal(result.expectedWorkHours, 12);
});

test("half-day remote work is half the configured daily target", () => {
  const result = timesheetAbsences({
    dates: ["2026-10-08"],
    workingDays: [4],
    dailyHours: 7.5,
    holidays: new Set(),
    leave: [
      {
        ...leave,
        startDate: "2026-10-08",
        endDate: "2026-10-08",
        isHalfDay: true,
        policySnapshot: { name: "Remote Work", type: "Remote" },
      },
    ],
  });
  assert.equal(result.entries.find((entry) => entry.isRemoteWork)?.hours["2026-10-08"], 3.75);
  assert.equal(result.expectedWorkHours, 7.5);
});

test("remote work and paid leave on the same date share one daily target", () => {
  const result = timesheetAbsences({
    dates: ["2026-10-08"],
    workingDays: [4],
    dailyHours: 8,
    holidays: new Set(),
    leave: [
      { ...leave, startDate: "2026-10-08", endDate: "2026-10-08", isHalfDay: true },
      {
        ...leave,
        startDate: "2026-10-08",
        endDate: "2026-10-08",
        policySnapshot: { name: "Remote Work", type: "Remote" },
      },
    ],
  });
  assert.equal(result.entries.find((entry) => entry.isRemoteWork)?.hours["2026-10-08"], 4);
  assert.equal(result.entries.find((entry) => entry.isLeave)?.hours["2026-10-08"], 4);
  assert.equal(result.expectedWorkHours, 4);
});

test("unpaid leave covers the day without creating paid leave credit", () => {
  const result = timesheetAbsences({
    dates: ["2026-10-08"],
    workingDays: [4],
    dailyHours: 8,
    holidays: new Set(),
    leave: [{ ...leave, policySnapshot: { name: "Unpaid Leave", isPaid: false } }],
  });
  assert.equal(result.expectedWorkHours, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.total, 8);
  assert.equal(result.entries[0]?.isUnpaidLeave, true);
});

test("HR special-leave pay choice splits a day into paid and unpaid credit", () => {
  const result = timesheetAbsences({
    dates: ["2026-10-08"],
    workingDays: [4],
    dailyHours: 8,
    holidays: new Set(),
    leave: [
      {
        ...leave,
        policySnapshot: {
          name: "Special Leave",
          isPaid: true,
          specialRequest: { unpaidByDate: [{ date: "2026-10-08", days: 0.5 }] },
        },
      },
    ],
  });
  assert.equal(result.expectedWorkHours, 0);
  assert.equal(result.entries.find((entry) => !entry.isUnpaidLeave)?.total, 4);
  assert.equal(result.entries.find((entry) => entry.isUnpaidLeave)?.total, 4);
});
