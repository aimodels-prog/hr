import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateSpecialUnpaidDates,
  specialUnpaidDaysInPeriod,
} from "../src/lib/data/special-leave.ts";

test("special leave can cross December and January with HR-selected paid and unpaid days", () => {
  const dates = ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"];
  const unpaid = allocateSpecialUnpaidDates(dates, false, 4, 2, "Unpaid");
  assert.deepEqual(unpaid, [
    { date: "2027-01-01", days: 1 },
    { date: "2027-01-02", days: 1 },
  ]);
  assert.equal(specialUnpaidDaysInPeriod(unpaid, "2026-12-01", "2026-12-31"), 0);
  assert.equal(specialUnpaidDaysInPeriod(unpaid, "2027-01-01", "2027-01-31"), 2);
});

test("HR can approve remaining special days as paid without a payroll deduction", () => {
  assert.deepEqual(allocateSpecialUnpaidDates(["2027-01-01"], false, 1, 0, "Paid"), []);
  assert.deepEqual(
    allocateSpecialUnpaidDates(["2027-01-01", "2027-01-02"], false, 2, 1, "Paid", 1),
    [{ date: "2027-01-02", days: 1 }],
  );
});

test("special half-day allocations preserve half-day payroll amounts", () => {
  assert.deepEqual(allocateSpecialUnpaidDates(["2027-01-01"], true, 0.5, 0, "Unpaid"), [
    { date: "2027-01-01", days: 0.5 },
  ]);
  assert.throws(() => allocateSpecialUnpaidDates(["2027-01-01"], true, 1, 0, "Unpaid"));
  assert.throws(() => allocateSpecialUnpaidDates(["2027-01-01"], false, 1, 1.5, "Unpaid"));
});
