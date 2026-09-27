import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageEmploymentFields,
  employmentCalendarDate,
  sameEmploymentValue,
  validateEmploymentEffectiveDate,
} from "../src/lib/data/employment-change-policy.ts";

test("effective dates are calendar dates, not merely date-shaped strings", () => {
  for (const value of ["2028-02-29", "2026-12-31", "2027-01-01"])
    assert.doesNotThrow(() => validateEmploymentEffectiveDate(value));
  for (const value of [
    "",
    "2026-02-29",
    "2026-09-31",
    "2026-13-01",
    "2026-1-01",
    "tomorrow",
    "2026-10-01T00:00:00Z",
  ]) {
    assert.throws(() => validateEmploymentEffectiveDate(value), /valid effective date/);
  }
});

test("employment scheduling uses the organisation date, including midnight and year boundaries", () => {
  assert.equal(
    employmentCalendarDate("Asia/Muscat", new Date("2026-09-30T19:59:59Z")),
    "2026-09-30",
  );
  assert.equal(
    employmentCalendarDate("Asia/Muscat", new Date("2026-09-30T20:00:00Z")),
    "2026-10-01",
  );
  assert.equal(
    employmentCalendarDate("America/New_York", new Date("2027-01-01T00:30:00Z")),
    "2026-12-31",
  );
  assert.equal(
    employmentCalendarDate("Asia/Muscat", new Date("2026-12-31T20:00:00Z")),
    "2027-01-01",
  );
});

test("scheduled changes retain HR and Finance boundaries for reading and cancellation", () => {
  assert.equal(canManageEmploymentFields("HR", ["position", "department"]), true);
  assert.equal(canManageEmploymentFields("Accounts", ["salary"]), true);
  assert.equal(canManageEmploymentFields("HR", ["salary"]), false);
  assert.equal(canManageEmploymentFields("HR", ["position", "salary"]), false);
  assert.equal(canManageEmploymentFields("Accounts", ["position"]), false);
  assert.equal(canManageEmploymentFields("Super Admin", ["position", "salary"]), true);
  for (const role of ["Employee", "Line Manager", "IT"] as const)
    assert.equal(canManageEmploymentFields(role, ["position"]), false);
  assert.equal(canManageEmploymentFields("Super Admin", ["status"]), false);
  assert.equal(canManageEmploymentFields("Super Admin", []), false);
});

test("conflict checks compare compensation by value and do not confuse empty optional fields", () => {
  assert.equal(
    sameEmploymentValue(
      { baseMonthly: 2500, currency: "OMR" },
      { currency: "OMR", baseMonthly: 2500 },
    ),
    true,
  );
  assert.equal(
    sameEmploymentValue(
      { baseMonthly: 2500, currency: "OMR" },
      { currency: "OMR", baseMonthly: 2600 },
    ),
    false,
  );
  assert.equal(sameEmploymentValue(undefined, null), true);
  assert.equal(sameEmploymentValue("", null), true);
  assert.equal(sameEmploymentValue(false, null), false);
  assert.equal(sameEmploymentValue(0, null), false);
});
