import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedLeaveFraction,
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
    dailyHours: 9,
    holidays: new Set(["2026-10-09"]),
    leave: [leave, { ...leave, startDate: "2026-10-13", endDate: "2026-10-13", isHalfDay: true }],
  });
  assert.equal(result.expectedWorkHours, 4.5);
  assert.equal(result.entries.find((entry) => entry.isLeave)!.total, 22.5);
  assert.equal(result.entries.find((entry) => entry.isHoliday)!.total, 9);
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
