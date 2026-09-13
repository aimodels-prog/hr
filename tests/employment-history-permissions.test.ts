import assert from "node:assert/strict";
import test from "node:test";
import { canReadEmploymentHistory } from "../src/lib/auth/employment-history.ts";

test("employment history is not a colleague-directory field", () => {
  for (const activeRole of ["Employee", "IT", "Accounts", "Line Manager"] as const)
    assert.equal(
      canReadEmploymentHistory("status", "colleague", "other-manager", {
        employeeId: "me",
        activeRole,
      }),
      false,
    );
  assert.equal(
    canReadEmploymentHistory("status", "report", "me", {
      employeeId: "me",
      activeRole: "Line Manager",
    }),
    true,
  );
  assert.equal(
    canReadEmploymentHistory("salary", "report", "me", {
      employeeId: "me",
      activeRole: "Line Manager",
    }),
    false,
  );
  assert.equal(
    canReadEmploymentHistory("salary", "report", "other", { employeeId: "me", activeRole: "HR" }),
    false,
  );
  assert.equal(
    canReadEmploymentHistory("salary", "report", "other", {
      employeeId: "me",
      activeRole: "Accounts",
    }),
    true,
  );
  assert.equal(
    canReadEmploymentHistory("status", "report", "other", { employeeId: "me", activeRole: "HR" }),
    true,
  );
});
test("all employee roles can read their own history, including compensation", () => {
  for (const activeRole of [
    "Employee",
    "IT",
    "Accounts",
    "Line Manager",
    "HR",
    "Super Admin",
  ] as const)
    for (const field of ["salary", "status", "position"])
      assert.equal(
        canReadEmploymentHistory(field, "me", undefined, { employeeId: "me", activeRole }),
        true,
      );
});
