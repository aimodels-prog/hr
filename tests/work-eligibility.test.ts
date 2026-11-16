import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidWorkEligibility,
  WORK_ELIGIBILITY_OPTIONS,
} from "../src/lib/recruitment/work-eligibility.ts";

test("all vacancies use country-neutral work-authorisation choices", () => {
  assert.deepEqual(WORK_ELIGIBILITY_OPTIONS, [
    "Yes, I am authorised to work there",
    "Need employer sponsorship",
    "Not sure",
  ]);
  assert.equal(isValidWorkEligibility("Yes, I am authorised to work there"), true);
  assert.equal(isValidWorkEligibility("Valid Oman work visa"), false);
  assert.equal(isValidWorkEligibility("Authorised to work in Uganda"), false);
});
