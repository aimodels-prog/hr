import assert from "node:assert/strict";
import { test } from "node:test";

import {
  leaveNoticeAssessment,
  validateLeaveNoticeException,
} from "../src/lib/data/leave-notice.ts";

const rules = {
  enabled: true,
  shortLeaveMaxDays: 5,
  shortLeaveNoticeDays: 14,
  longLeaveNoticeDays: 60,
};

test("one-day leave keeps the 14-calendar-day rule and identifies special requests", () => {
  assert.equal(leaveNoticeAssessment(rules, 1, "2026-11-08", "2026-10-25"), null);
  assert.deepEqual(leaveNoticeAssessment(rules, 1, "2026-11-07", "2026-10-25"), {
    requiredDays: 14,
    actualDays: 13,
  });
  assert.deepEqual(leaveNoticeAssessment(rules, 1, "2026-10-25", "2026-10-25"), {
    requiredDays: 14,
    actualDays: 0,
  });
});

test("long requests use their configured notice and disabled rules do not block", () => {
  assert.deepEqual(leaveNoticeAssessment(rules, 6, "2026-11-08", "2026-10-25"), {
    requiredDays: 60,
    actualDays: 14,
  });
  assert.equal(
    leaveNoticeAssessment({ ...rules, enabled: false }, 1, "2026-10-26", "2026-10-25"),
    null,
  );
});

test("special requests require a meaningful explanation", () => {
  assert.throws(() => validateLeaveNoticeException("too short"), /at least 10 characters/);
  assert.equal(validateLeaveNoticeException("  Family emergency  "), "Family emergency");
});
