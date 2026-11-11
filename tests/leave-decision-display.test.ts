import assert from "node:assert/strict";
import test from "node:test";
import { leaveDecisionSummary } from "../src/lib/data/leave-decision-display.ts";
import type { LeaveRequest } from "../src/lib/data/leave-types.ts";

function request(patch: Partial<LeaveRequest>): LeaveRequest {
  return {
    status: "Pending Line Manager",
    chainApprovals: [{ role: "Line Manager", status: "Pending" }],
    ...patch,
  } as LeaveRequest;
}

test("pending leave names the assigned line manager", () => {
  assert.equal(
    leaveDecisionSummary(request({ lineManagerName: "Roshana Ahmed" })),
    "Waiting for Roshana Ahmed",
  );
});

test("a partially approved request names the reviewer and the next stage", () => {
  assert.equal(
    leaveDecisionSummary(
      request({
        status: "Pending HR",
        chainApprovals: [
          { role: "Line Manager", status: "Approved", approverName: "Roshana Ahmed" },
          { role: "HR", status: "Pending" },
        ],
      }),
    ),
    "Roshana Ahmed approved · Waiting for HR team",
  );
});

test("declined and approved leave names the actual actor, never a raw user ID", () => {
  const declined = request({
    status: "Declined",
    chainApprovals: [
      {
        role: "Line Manager",
        status: "Declined",
        approvedBy: "user-123",
        approverName: "Riccardo Centonze",
      },
    ],
  });
  assert.equal(leaveDecisionSummary(declined), "Declined by Riccardo Centonze");
  assert.equal(
    leaveDecisionSummary(
      request({
        status: "Approved",
        chainApprovals: [
          { role: "Line Manager", status: "Approved", approverName: "Riccardo Centonze" },
          { role: "HR", status: "Approved", approverName: "Roshana Ahmed" },
        ],
      }),
    ),
    "Approved by Roshana Ahmed",
  );
  assert.equal(
    leaveDecisionSummary(request({ status: "Declined", chainApprovals: [] })),
    "Decision-maker not recorded",
  );
});

test("missing decision actors are omitted rather than invented", () => {
  assert.equal(
    leaveDecisionSummary(request({ status: "Declined", chainApprovals: [] }), { staffView: true }),
    null,
  );
  assert.equal(
    leaveDecisionSummary(request({ status: "Approved", chainApprovals: [] }), { staffView: true }),
    null,
  );
  assert.equal(
    leaveDecisionSummary(request({ status: "Taken", chainApprovals: [] }), { staffView: true }),
    null,
  );
  assert.equal(
    leaveDecisionSummary(request({ status: "Automatically Refused", chainApprovals: [] }), {
      staffView: true,
    }),
    null,
  );
});

test("an active request without a named manager still shows the review stage", () => {
  assert.equal(
    leaveDecisionSummary(request({ lineManagerName: undefined }), { staffView: true }),
    "Manager review pending · Ask HR to confirm the reviewer",
  );
});

test("legacy super admin review is shown to staff as HR review", () => {
  assert.equal(
    leaveDecisionSummary(
      request({
        status: "Pending Super Admin",
        chainApprovals: [{ role: "Super Admin", status: "Pending" }],
      }),
      { staffView: true },
    ),
    "Waiting for HR review",
  );
});
