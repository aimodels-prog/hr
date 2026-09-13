import assert from "node:assert/strict";
import test from "node:test";
import { assertIndependentOfferApprover } from "../src/lib/auth/offer-approval.ts";

const offer = {
  approverUserId: "manager",
  createdBy: "hr",
  approvalRequestedBy: "requester",
  history: [{ preparedBy: "editor" }],
};
test("only the assigned independent manager can review an offer", () => {
  assert.doesNotThrow(() => assertIndependentOfferApprover(offer, "manager"));
  for (const user of ["hr", "requester", "editor", "unassigned", "super-admin"])
    assert.throws(() => assertIndependentOfferApprover(offer, user), /assigned independent/);
});
test("assignment never overrides preparer or requester conflicts", () => {
  for (const user of ["hr", "requester", "editor"])
    assert.throws(
      () => assertIndependentOfferApprover({ ...offer, approverUserId: user }, user),
      /assigned independent/,
    );
  assert.throws(() =>
    assertIndependentOfferApprover({ ...offer, approverUserId: null }, "manager"),
  );
});
