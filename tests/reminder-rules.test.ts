import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REMINDER_RULES,
  ReminderRulesSchema,
  reminderRulesFromSettings,
  trainingReminderThreshold,
} from "../src/lib/data/reminder-rules.ts";
import { leaveReminderStage } from "../src/lib/data/leave-reminders.ts";
test("reminder defaults retain existing company timings and reject invalid rules", () => {
  assert.deepEqual(reminderRulesFromSettings({}), DEFAULT_REMINDER_RULES);
  for (const change of [
    { travelAfterHours: 0 },
    { trainingExpiryDays: [7, 7] },
    { carryDeadline: "02-30" },
    { missingClockoutStart: "17:00" },
    { missingClockoutEnd: "08:00" },
    { annualEveryMonths: 0 },
  ])
    assert.equal(
      ReminderRulesSchema.safeParse({ ...DEFAULT_REMINDER_RULES, ...change }).success,
      false,
    );
});
test("custom carry deadline and intervals respect non-calendar leave years", () => {
  const rules = {
    ...DEFAULT_REMINDER_RULES,
    carryDeadline: "06-30",
    carryExtraDays: [10, 2],
    annualEveryMonths: 3,
  };
  assert.equal(leaveReminderStage("2027-06-21", 2026, 4, rules, "07-01").deadline, "2027-06-30");
  assert.equal(leaveReminderStage("2027-06-21", 2026, 4, rules, "07-01").key, "2027-06-20");
  assert.equal(leaveReminderStage("2027-05-10", 2027, 0, rules).key, "2027-04");
  assert.equal(trainingReminderThreshold(6, [30, 7, 0]), 7);
  assert.equal(trainingReminderThreshold(0, [30, 7, 0]), 0);
  assert.equal(trainingReminderThreshold(40, [30, 7, 0]), undefined);
});
