import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isAssignedIndependentReviewer,
  isNewEmploymentReviewCycle,
  mustPreserveSpecialLeaveChain,
} from "../src/lib/data/hr-independent-review.ts";

test("only the assigned reviewer identity can decide an HR employee's request", () => {
  const reviewer = { employeeId: "riccardo-employee", userId: "riccardo-user" };
  assert.equal(
    isAssignedIndependentReviewer(
      { employeeId: reviewer.employeeId, userId: reviewer.userId, activeRole: "Employee" },
      "roshana-employee",
      reviewer,
    ),
    true,
  );
  assert.equal(
    isAssignedIndependentReviewer(
      { employeeId: reviewer.employeeId, userId: reviewer.userId, activeRole: "Super Admin" },
      "roshana-employee",
      reviewer,
    ),
    false,
  );
  assert.equal(
    isAssignedIndependentReviewer(
      { employeeId: "roshana-employee", userId: "roshana-user", activeRole: "HR" },
      "roshana-employee",
      reviewer,
    ),
    false,
  );
  assert.equal(
    isAssignedIndependentReviewer(
      { employeeId: reviewer.employeeId, userId: "different-user", activeRole: "Employee" },
      "roshana-employee",
      reviewer,
    ),
    false,
  );
  assert.equal(
    isAssignedIndependentReviewer(
      { employeeId: reviewer.employeeId, userId: reviewer.userId, activeRole: "Employee" },
      reviewer.employeeId,
      reviewer,
    ),
    false,
  );
  assert.equal(
    isAssignedIndependentReviewer(
      { employeeId: reviewer.employeeId, userId: reviewer.userId, activeRole: "Employee" },
      "roshana-employee",
      null,
    ),
    false,
  );
});

test("bulk independent assignment preserves special leave approval stages", () => {
  assert.equal(mustPreserveSpecialLeaveChain(null, null), false);
  assert.equal(mustPreserveSpecialLeaveChain({}, [{ role: "HR", status: "Pending" }]), false);
  assert.equal(mustPreserveSpecialLeaveChain({ specialRequest: { reason: "Urgent" } }, []), true);
  assert.equal(mustPreserveSpecialLeaveChain({ noticeException: true }, []), true);
  assert.equal(
    mustPreserveSpecialLeaveChain(null, [
      { role: "Country Manager", status: "Pending" },
      { role: "HR", status: "Pending" },
    ]),
    true,
  );
  assert.equal(
    mustPreserveSpecialLeaveChain(null, [
      { role: "Country Manager", status: "Approved" },
      { role: "HR", status: "Pending" },
    ]),
    false,
  );
});

test("a returned employment proposal keeps its reviewer, but a new cycle snapshots policy", () => {
  assert.equal(isNewEmploymentReviewCycle("Changes Requested"), false);
  assert.equal(isNewEmploymentReviewCycle("Pending HR Review"), false);
  assert.equal(isNewEmploymentReviewCycle("Confirmed"), true);
});
