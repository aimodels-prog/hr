import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceMorningFollowUpEligible } from "../src/lib/data/attendance-follow-up.ts";

const eligible = {
  afterCutoff: true,
  workday: true,
  tracked: true,
  hasPunch: false,
  leaveFraction: 0,
  remote: false,
  approvedActivity: false,
  pendingActivity: false,
  specialDay: false,
  holiday: false,
  activeAccount: true,
};

test("only an unexplained missing Head Office punch after cutoff may be followed up", () => {
  assert.equal(attendanceMorningFollowUpEligible(eligible), true);
  for (const key of [
    "hasPunch",
    "remote",
    "approvedActivity",
    "pendingActivity",
    "specialDay",
    "holiday",
  ] as const)
    assert.equal(attendanceMorningFollowUpEligible({ ...eligible, [key]: true }), false, key);
  for (const key of ["afterCutoff", "workday", "tracked", "activeAccount"] as const)
    assert.equal(attendanceMorningFollowUpEligible({ ...eligible, [key]: false }), false, key);
  assert.equal(attendanceMorningFollowUpEligible({ ...eligible, leaveFraction: 0.5 }), false);
  assert.equal(attendanceMorningFollowUpEligible({ ...eligible, leaveFraction: 1 }), false);
});
