import assert from "node:assert/strict";
import test from "node:test";
import { carryExpiryDateForYear, carryPosition } from "../src/lib/data/leave-carry.ts";

test("annual carry stays available until HR's date and new leave uses it first", () => {
  const expiryDate = carryExpiryDateForYear(
    { annualCarryExpiryDates: { "2025": "2026-12-31" }, annualCarryExpiryMonthDay: "05-31" },
    2026,
  );
  assert.equal(expiryDate, "2026-12-31");
  const requests = new Map([["request-1", "2026-11-10"]]);
  const entries = [
    { transactionType: "Approved Leave", days: -14, createdAt: "2026-10-01T10:00:00Z" },
    { transactionType: "Carry-Forward", days: 5, createdAt: "2026-10-01T10:00:01Z" },
    {
      transactionType: "Approved Leave",
      days: -3,
      referenceId: "request-1",
      createdAt: "2026-10-20T10:00:00Z",
    },
  ];
  assert.deepEqual(carryPosition(entries, requests, expiryDate), {
    granted: 5,
    remaining: 2,
    expiryAdjustment: 0,
  });
});

test("carry expiry is reversible and leave after expiry uses current-year days", () => {
  const requests = new Map([["request-after-expiry", "2026-07-01"]]);
  const entries = [
    { transactionType: "Carry-Forward", days: 5, createdAt: "2026-01-01T00:00:00Z" },
    {
      transactionType: "Approved Leave",
      days: -2,
      referenceId: "request-after-expiry",
      createdAt: "2026-03-01T00:00:00Z",
    },
    { transactionType: "Expiry", days: -5, createdAt: "2026-06-01T00:00:00Z" },
  ];
  assert.deepEqual(carryPosition(entries, requests, "2026-05-31"), {
    granted: 5,
    remaining: 0,
    expiryAdjustment: -5,
  });
  entries.push({ transactionType: "Expiry", days: 5, createdAt: "2026-06-02T00:00:00Z" });
  assert.deepEqual(carryPosition(entries, requests, "2026-12-31"), {
    granted: 5,
    remaining: 5,
    expiryAdjustment: 0,
  });
});

test("future rollover expiry follows the configured leave year", () => {
  assert.equal(
    carryExpiryDateForYear({ leaveYearStart: "07-01", annualCarryExpiryMonthDay: "05-31" }, 2026),
    "2027-05-31",
  );
});
