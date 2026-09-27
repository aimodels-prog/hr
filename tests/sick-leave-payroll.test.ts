import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sickLeavePayrollReductions,
  validateSickPayTiers,
  type SickPayrollRequest,
} from "../src/lib/data/sick-leave-payroll.ts";

const tiers = [
  { fromDay: 1, toDay: 2, payPercentage: 100 },
  { fromDay: 3, toDay: 4, payPercentage: 50 },
  { fromDay: 5, toDay: 10, payPercentage: 25 },
];
function request(id: string, dates: string[], half = false): SickPayrollRequest {
  return {
    id,
    employeeId: "employee",
    startDate: dates[0]!,
    endDate: dates.at(-1)!,
    isHalfDay: half,
    workingDaysRequested: dates.length * (half ? 0.5 : 1),
    workingDates: dates,
    isPaid: true,
    payTiers: tiers,
  };
}
const september = { startDate: "2026-09-01", endDate: "2026-09-30" };
const october = { startDate: "2026-10-01", endDate: "2026-10-31" };
const noCalendar = (): string[] => {
  throw new Error("Snapshot must not use today's calendar");
};
test("sick payroll splits month boundaries using chronological approved history", () => {
  const previous = request("old", ["2026-09-24", "2026-09-25"]);
  const current = request("current", [
    "2026-09-28",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-05",
  ]);
  assert.equal(
    sickLeavePayrollReductions([current, previous], september, "01-01", noCalendar).get("employee"),
    1,
  );
  assert.equal(
    sickLeavePayrollReductions([current, previous], october, "01-01", noCalendar).get("employee"),
    2.25,
  );
});
test("fractional days can straddle tier boundaries without losing a fraction", () => {
  const requests = [
    request("a", ["2026-09-01"]),
    request("b", ["2026-09-02"], true),
    request("c", ["2026-09-03"]),
  ];
  assert.equal(
    sickLeavePayrollReductions(requests, september, "01-01", noCalendar).get("employee"),
    0.25,
  );
});
test("configured entitlement-year boundaries reset consumption", () => {
  const requests = [request("a", ["2026-09-29", "2026-09-30"]), request("b", ["2026-10-01"])];
  assert.equal(
    sickLeavePayrollReductions(requests, october, "10-01", noCalendar).get("employee"),
    0,
  );
});
test("invalid, exhausted, duplicate or inconsistent history blocks payroll", () => {
  for (const value of [
    null,
    [{ fromDay: 2, toDay: 5, payPercentage: 100 }],
    [{ fromDay: 1, toDay: 2, payPercentage: 101 }],
  ])
    assert.throws(() => validateSickPayTiers(value), /review/);
  const one = request("one", ["2026-09-01"]);
  assert.throws(
    () => sickLeavePayrollReductions([one, { ...one, id: "two" }], september, "01-01", noCalendar),
    /overlap/,
  );
  assert.throws(
    () =>
      sickLeavePayrollReductions(
        [{ ...one, workingDaysRequested: 2 }],
        september,
        "01-01",
        noCalendar,
      ),
    /recorded total/,
  );
  assert.throws(
    () =>
      sickLeavePayrollReductions(
        [
          request("a", ["2026-09-01", "2026-09-02"]),
          { ...request("b", ["2026-09-03"]), payTiers: [tiers[0]] },
        ],
        september,
        "01-01",
        noCalendar,
      ),
    /exceeds/,
  );
});
test("fully unpaid sick leave consumes allowance but is not deducted twice", () => {
  const requests = [
    { ...request("a", ["2026-09-01", "2026-09-02"]), isPaid: false },
    request("b", ["2026-09-03"]),
  ];
  assert.equal(
    sickLeavePayrollReductions(requests, september, "01-01", noCalendar).get("employee"),
    0.5,
  );
});
test("rounding fractional reductions across months preserves the combined total", () => {
  const rules = [{ fromDay: 1, toDay: 10, payPercentage: 75 }];
  const requests = [
    { ...request("a", ["2026-09-30"], true), payTiers: rules },
    { ...request("b", ["2026-10-01"], true), payTiers: rules },
  ];
  const first = sickLeavePayrollReductions(requests, september, "01-01", noCalendar).get(
    "employee",
  )!;
  const second = sickLeavePayrollReductions(requests, october, "01-01", noCalendar).get(
    "employee",
  )!;
  assert.equal(first, 0.13);
  assert.equal(second, 0.12);
  assert.equal(first + second, 0.25);
});
