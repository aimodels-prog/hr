import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePolicyAnswers, selectPolicySources } from "../src/lib/data/policy-answers.ts";
const source = {
  id: "doc",
  title: "Sick leave procedure",
  version: 1,
  page: 2,
  text: "Notify your supervisor as soon as practical. Submit the required medical certificate.",
};
test("policy answers require a real source page and exact supporting quote", () => {
  const answer = {
    text: "Notify your supervisor.",
    documentId: "doc",
    page: 2,
    quote: "Notify your supervisor as soon as practical.",
  };
  assert.equal(validatePolicyAnswers([answer], [source]).length, 1);
  for (const invalid of [
    { ...answer, page: 5 },
    { ...answer, documentId: "private" },
    { ...answer, quote: "All staff receive unlimited paid leave." },
  ])
    assert.deepEqual(validatePolicyAnswers([invalid], [source]), []);
  assert.deepEqual(selectPolicySources("Explain payroll deductions", [source]), []);
  assert.equal(selectPolicySources("What is the sick leave procedure?", [source]).length, 1);
});
