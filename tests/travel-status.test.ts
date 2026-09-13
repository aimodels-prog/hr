import assert from "node:assert/strict";
import { test } from "node:test";
import { travelStatusLabel } from "../src/lib/data/travel-status.ts";

test("travel labels name only outstanding approvers", () => {
  const request = {
    status: "Pending HR and Accounts",
    managerApprovalStatus: "Pending",
    hrApprovalStatus: "Approved",
    accountsApprovalStatus: "Pending",
  } as const;
  assert.equal(travelStatusLabel(request), "Awaiting Manager / Finance approval");
  assert.equal(
    travelStatusLabel({ ...request, accountsApprovalStatus: "Approved" }),
    "Awaiting Manager approval",
  );
  assert.equal(
    travelStatusLabel({ ...request, status: "Pending Super Admin Closure" }),
    "Awaiting Finance reimbursement closure",
  );
});
