import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedSalaryCurrency,
  isValidApplicantCurrentSalary,
  isValidCurrencyQualifiedSalary,
  isValidCurrencyQualifiedExpectation,
  isValidMonthlySalaryAmount,
  isValidMonthlySalaryExpectation,
  isValidStoredMonthlySalary,
  salaryWithCurrency,
  salaryExpectationWithCurrency,
  SALARY_CURRENCY_OPTIONS,
} from "../src/lib/recruitment/salary-currency.ts";

test("salary currency choices include currencies needed for international applicants", () => {
  assert.ok(SALARY_CURRENCY_OPTIONS.length > 100);
  for (const code of ["AED", "EUR", "OMR", "USD", "UGX"])
    assert.ok(isSupportedSalaryCurrency(code));
  assert.equal(isSupportedSalaryCurrency("UNKNOWN"), false);
});

test("new salaries save a selected currency and monthly amount", () => {
  assert.equal(isValidMonthlySalaryAmount("5000000"), true);
  assert.equal(salaryWithCurrency("5000000", "UGX"), "UGX 5000000");
  assert.equal(salaryWithCurrency("0", "OMR"), "OMR 0");
  assert.equal(isValidCurrencyQualifiedSalary("UGX 5000000"), true);
  assert.equal(isValidMonthlySalaryExpectation("1800-2000"), true);
  assert.equal(salaryExpectationWithCurrency("1800-2000", "OMR"), "OMR 1800-2000");
  assert.equal(isValidCurrencyQualifiedExpectation("OMR 1800-2000"), true);
  assert.equal(isValidApplicantCurrentSalary("0"), true);
  assert.equal(isValidApplicantCurrentSalary("1500"), false);
  for (const invalid of ["5000000", "UGX", "NOT 5000000", "UGX -50", "UGX 5 million"])
    assert.equal(isValidCurrencyQualifiedSalary(invalid), false);
  assert.throws(() => salaryWithCurrency("5000000", "UNKNOWN"));
});

test("older salary values remain readable without changing stored applications", () => {
  assert.equal(isValidStoredMonthlySalary("1500"), true);
  assert.equal(isValidStoredMonthlySalary("OMR 1500"), true);
  assert.equal(isValidStoredMonthlySalary("AED 1500"), true);
});
