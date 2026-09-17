import assert from "node:assert/strict";
import { test } from "node:test";
import { expiryBuckets, splitLeaveDays } from "../src/lib/data/dashboard-priorities.ts";

test("expiry buckets do not double count boundaries, omit later dates and include due today", () => {
  const dates = [-1, 0, 30, 31, 60, 61, 90, 91].map((offset) =>
    new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10),
  );
  assert.deepEqual(
    expiryBuckets("2026-01-01", dates).map((row) => row.count),
    [1, 2, 2, 2],
  );
  assert.equal(expiryBuckets("2026-01-01", [])[0]!.count, 0);
});

test("annual leave separates used from booked without counting weekends or holidays", () => {
  const input = {
    startDate: "2026-09-13",
    endDate: "2026-09-18",
    yearStart: "2026-04-01",
    nextYearStart: "2027-04-01",
    today: "2026-09-16",
    halfDay: false,
    workingDays: [1, 2, 3, 4, 5],
    holidays: new Set(["2026-09-17"]),
  };
  assert.deepEqual(splitLeaveDays(input), { used: 2, booked: 2 });
  assert.deepEqual(
    splitLeaveDays({ ...input, startDate: "2026-09-16", endDate: "2026-09-16", halfDay: true }),
    { used: 0, booked: 0.5 },
  );
  assert.deepEqual(
    splitLeaveDays({
      ...input,
      startDate: "2026-03-30",
      endDate: "2026-04-02",
      today: "2026-04-02",
    }),
    { used: 1, booked: 1 },
  );
  assert.deepEqual(splitLeaveDays({ ...input, startDate: "2027-04-01", endDate: "2027-04-03" }), {
    used: 0,
    booked: 0,
  });
});
