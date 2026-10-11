import assert from "node:assert/strict";
import test from "node:test";
import {
  validateVerifiedProfileIdentity,
  verifiedProfileIdentitySchema,
} from "../src/lib/data/profile-edit-policy.ts";

test("identity corrections require employee passport/ID verification, never a rejection or family document", () => {
  const identity = {
    legalName: "Correct Legal Name",
    dateOfBirth: "1990-04-12",
    nationality: "Omani",
  };
  for (const type of ["passport", "national_id"])
    assert.deepEqual(validateVerifiedProfileIdentity(identity, { type }, "verify"), identity);
  for (const type of ["visa", "contract", "bank_evidence", "other"])
    assert.throws(
      () => validateVerifiedProfileIdentity(identity, { type }, "verify"),
      /only while verifying/i,
    );
  assert.throws(
    () =>
      validateVerifiedProfileIdentity(
        identity,
        { type: "passport", dependantId: "family" },
        "verify",
      ),
    /only while verifying/i,
  );
  assert.throws(
    () => validateVerifiedProfileIdentity(identity, { type: "passport" }, "reject"),
    /only while verifying/i,
  );
  assert.equal(validateVerifiedProfileIdentity(undefined, { type: "other" }, "verify"), undefined);
});

test("identity confirmation rejects invalid dates, blank fields and unrelated changes", () => {
  for (const value of [
    {},
    { legalName: " " },
    { nationality: " " },
    { dateOfBirth: "1990-02-30" },
    { dateOfBirth: "2099-01-01" },
    { salary: { baseMonthly: 5000 } },
    { legalName: "Valid Name", lineManagerId: "other" },
  ]) {
    assert.equal(verifiedProfileIdentitySchema.safeParse(value).success, false);
  }
});
