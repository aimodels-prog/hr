import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveReminderStage, remainingCarryForReminder } from "../src/lib/data/leave-reminders.ts";

test("carry reminders account for usage, restoration, adjustments and expiry, not new entitlement", () => {
  const rows = [
    { transactionType: "Carry-Forward", days: 10 },
    { transactionType: "Entitlement", days: 30 },
    { transactionType: "Approved Leave", days: -7 },
  ];
  assert.equal(remainingCarryForReminder(33, rows), 3);
  assert.equal(remainingCarryForReminder(0, rows), 0);
  assert.equal(remainingCarryForReminder(50, []), 0);
  assert.equal(
    remainingCarryForReminder(40, [
      ...rows,
      { transactionType: "Cancellation Restoration", days: 7 },
    ]),
    10,
  );
  assert.equal(
    remainingCarryForReminder(30, [...rows, { transactionType: "Expiry", days: -3 }]),
    0,
  );
  assert.equal(
    remainingCarryForReminder(30, [...rows, { transactionType: "Manual Adjustment", days: -3 }]),
    0,
  );
});

test("monthly leave reminders become more frequent before May without declaring forfeiture", () => {
  assert.equal(leaveReminderStage("2027-01-15", 2027, 3).kind, "carry");
  assert.equal(leaveReminderStage("2027-04-14", 2027, 3).key, "2027-04-1");
  assert.equal(leaveReminderStage("2027-04-15", 2027, 3).key, "2027-04-15");
  assert.equal(leaveReminderStage("2027-04-23", 2027, 3).key, "2027-04-23");
  assert.equal(leaveReminderStage("2027-04-30", 2027, 3).key, "2027-04-29");
  assert.equal(leaveReminderStage("2027-05-01", 2027, 3).kind, "annual");
  assert.equal(leaveReminderStage("2027-04-01", 2027, 0).kind, "annual");
  assert.equal(leaveReminderStage("2027-01-01", 2026, 3).kind, "annual");
});
