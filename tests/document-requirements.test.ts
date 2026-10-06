import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDocumentRequirements,
  documentRequirementSchema,
  requirementApplies,
  validateDocumentAnswers,
} from "../src/lib/data/document-requirements.ts";
test("all default document definitions validate, CV asks only for a file", () => {
  const definitions = defaultDocumentRequirements();
  for (const r of definitions) assert.ok(documentRequirementSchema.safeParse(r).success, r.name);
  assert.equal(definitions.find((r) => r.id === "cv")!.fields.length, 0);
  assert.deepEqual(
    definitions.find((r) => r.id === "education_certificate")!.fields.map((f) => f.key),
    ["qualification", "institution", "graduationYear"],
  );
});
test("applicability respects employee, department, position, location and inactive requirements", () => {
  const r = defaultDocumentRequirements()[0]!;
  const employee = { id: "e", departmentId: "d", positionId: "p", locationId: "l" };
  for (const [audience, id] of [
    ["Employee", "e"],
    ["Department", "d"],
    ["Position", "p"],
    ["Location", "l"],
  ] as const) {
    assert.equal(requirementApplies({ ...r, audience, audienceIds: [id] }, employee), true);
    assert.equal(requirementApplies({ ...r, audience, audienceIds: ["other"] }, employee), false);
  }
  assert.equal(requirementApplies({ ...r, enabled: false }, employee), false);
});
test("employee cannot write HR fields; HR must complete required details before approval", () => {
  const visa = defaultDocumentRequirements().find((r) => r.id === "visa")!;
  assert.deepEqual(validateDocumentAnswers(visa, {}, false), {});
  assert.throws(() => validateDocumentAnswers(visa, { documentNumber: "x" }, false), /cannot edit/);
  assert.throws(() => validateDocumentAnswers(visa, {}, true, true), /required/);
  assert.throws(() => validateDocumentAnswers(visa, { fakeField: "x" }, true), /cannot edit/);
});
test("education validation requires meaningful field values and valid years", () => {
  const education = defaultDocumentRequirements().find((r) => r.id === "education_certificate")!;
  assert.throws(() => validateDocumentAnswers(education, {}, false), /required/);
  assert.throws(
    () =>
      validateDocumentAnswers(
        education,
        { qualification: "BEng", institution: "College", graduationYear: "abc" },
        false,
      ),
    /year/,
  );
  assert.equal(
    validateDocumentAnswers(
      education,
      { qualification: " BEng ", institution: "College", graduationYear: "2020" },
      false,
    )["qualification"],
    "BEng",
  );
});
test("dates reject impossible calendar dates and reversed expiry", () => {
  const r = {
    ...defaultDocumentRequirements()[0]!,
    fields: [
      {
        key: "issueDate",
        label: "Issue date",
        kind: "date" as const,
        required: true,
        owner: "Employee" as const,
      },
      {
        key: "expiryDate",
        label: "Expiry date",
        kind: "date" as const,
        required: true,
        owner: "Employee" as const,
      },
    ],
  };
  assert.throws(
    () => validateDocumentAnswers(r, { issueDate: "2026-02-30", expiryDate: "2027-01-01" }, false),
    /valid date/,
  );
  assert.throws(
    () => validateDocumentAnswers(r, { issueDate: "2026-02-28", expiryDate: "2025-01-01" }, false),
    /before/,
  );
});
test("HR cannot accidentally make visa fields employee-editable or remove HR-only upload protections", () => {
  const r = defaultDocumentRequirements().find((r) => r.id === "visa")!;
  assert.equal(
    documentRequirementSchema.safeParse({
      ...r,
      fields: r.fields.map((f) => ({ ...f, owner: "Employee" })),
    }).success,
    false,
  );
  assert.equal(
    documentRequirementSchema.safeParse({ ...r, type: "work_permit", uploadBy: "Employee" })
      .success,
    false,
  );
});
