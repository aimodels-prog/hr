import assert from "node:assert/strict";
import test from "node:test";
import { canReadLeaveAttachment } from "../src/lib/data/leave-attachment-access.ts";

const request = {
  requesterEmployeeId: "requester",
  actorEmployeeId: "other",
  actorRole: "Employee",
  assignedReviewerEmployeeId: "riccardo",
  currentLineManagerEmployeeId: "manager",
  specialReviewerEmployeeId: "country-manager",
  pendingHrReview: false,
  actorMadeDecision: false,
};

test("leave evidence stays private to the requester and actual reviewers", () => {
  assert.equal(canReadLeaveAttachment(request), false);
  assert.equal(canReadLeaveAttachment({ ...request, actorEmployeeId: "requester" }), true);
  assert.equal(canReadLeaveAttachment({ ...request, actorEmployeeId: "riccardo" }), true);
  assert.equal(canReadLeaveAttachment({ ...request, actorMadeDecision: true }), true);
  assert.equal(
    canReadLeaveAttachment({ ...request, actorEmployeeId: "manager", actorRole: "Line Manager" }),
    true,
  );
});

test("a special reviewer only sees evidence during their pending review unless they decided", () => {
  const special = { ...request, actorEmployeeId: "country-manager" };
  assert.equal(canReadLeaveAttachment(special), false);
  assert.equal(canReadLeaveAttachment({ ...special, pendingHrReview: true }), true);
  assert.equal(canReadLeaveAttachment({ ...special, actorMadeDecision: true }), true);
});

test("HR and Super Admin may view evidence but do not gain approval rights", () => {
  assert.equal(canReadLeaveAttachment({ ...request, actorRole: "HR" }), true);
  assert.equal(canReadLeaveAttachment({ ...request, actorRole: "Super Admin" }), true);
});
