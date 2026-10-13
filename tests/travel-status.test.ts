import assert from "node:assert/strict";
import { test } from "node:test";
import { travelStatusLabel } from "../src/lib/data/travel-status.ts";
import { resolveTravelDatabaseId } from "../src/lib/data/travel-service.ts";

test("travel labels show the current approval stage", () => {
  const request = {
    status: "Pending HR and Accounts",
    managerApprovalStatus: "Pending",
    hrApprovalStatus: "Approved",
    accountsApprovalStatus: "Pending",
  } as const;
  assert.equal(travelStatusLabel(request), "Awaiting supervisor approval");
  assert.equal(
    travelStatusLabel({ ...request, accountsApprovalStatus: "Approved" }),
    "Awaiting supervisor approval",
  );
  assert.equal(
    travelStatusLabel({
      ...request,
      managerApprovalStatus: "Approved",
      hrApprovalStatus: "Pending",
    }),
    "Awaiting HR approval",
  );
  assert.equal(
    travelStatusLabel({ ...request, managerApprovalStatus: "Approved" }),
    "Awaiting Finance approval",
  );
  assert.equal(travelStatusLabel({ ...request, status: "Withdrawn" }), "Cancelled");
  assert.equal(
    travelStatusLabel({ ...request, status: "Pending Super Admin Closure" }),
    "Awaiting Finance reimbursement closure",
  );
});

test("travel resolves a database-backed currency selected by its code", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(resolveTravelDatabaseId([{ id, code: "OMR" }], "OMR", "currencies"), id);
  assert.equal(
    resolveTravelDatabaseId(
      [{ id: "currency-omr", databaseId: id, code: "OMR" }],
      "OMR",
      "currencies",
    ),
    id,
  );
  assert.throws(
    () => resolveTravelDatabaseId([{ id: "currency-omr", code: "OMR" }], "OMR", "currencies"),
    /currencies record is not available/,
  );
});
