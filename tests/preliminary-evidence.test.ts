import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessPreliminaryCriterion,
  candidateScreeningFacts,
  currentPreliminaryRules,
  PRELIMINARY_RULES_VERSION,
} from "../src/lib/recruitment/preliminary-evidence.ts";
import { LocalCvExtractionProvider } from "../src/lib/integrations/cv-extraction.ts";

const today = "2026-09-24";
const criterion = "Valid Oman driving licence";

for (const text of [
  "No valid Oman driving licence",
  "I do not hold a valid Oman driving licence",
  "Without a valid Oman driving licence",
  "Valid Oman driving licence expired",
  "Valid Oman driving licence suspended",
  "Valid Oman driving licence application pending",
  "Valid Oman driving licence renewal in progress",
  "Willing to obtain a valid Oman driving licence",
  "Valid Oman driving licence required for this role",
  "Oman driving licence valid until 2024-01-01",
  "Oman driving licence valid until 2026-02-30",
  "Oman driving licence valid until 10/11/2026",
  "Valid Oman driving licence (expiry date unknown)",
  "Valid Oman driving licence; expired",
  "Valid Oman driving licence\nExpiry: 2024-01-01",
]) {
  test(`qualification is not confirmed: ${text}`, () => {
    const result = assessPreliminaryCriterion(criterion, [{ source: "CV certifications", text }], {
      today,
    });
    assert.equal(result.status, "Needs Review");
    assert.ok(result.evidence.includes("Oman driving licence"));
  });
}

test("positive statements have traceable supporting evidence", () => {
  const result = assessPreliminaryCriterion(
    `${criterion}.`,
    [{ source: "CV certifications", text: criterion }],
    { today },
  );
  assert.equal(result.status, "Confirmed");
  assert.equal(result.evidence, `CV certifications: ${criterion}`);
});

test("checked ISO validity dates can support a current licence", () => {
  const result = assessPreliminaryCriterion(
    criterion,
    [{ source: "CV", text: "Oman driving license valid until 2027-06-30" }],
    { today },
  );
  assert.equal(result.status, "Confirmed");
});

test("a negative CV statement overrides a positive extracted keyword", () => {
  const result = assessPreliminaryCriterion(
    criterion,
    [{ source: "Extracted keyword", text: criterion }],
    { today, cvText: "My Oman driving licence expired last year." },
  );
  assert.equal(result.status, "Needs Review");
  assert.match(result.evidence, /CV text: My Oman driving licence expired/);
});

test("a generic negative statement does not need to repeat the licence jurisdiction", () => {
  for (const cvText of [
    "No driving licence",
    "I do not hold a licence",
    "Licence expired last year",
  ]) {
    assert.equal(
      assessPreliminaryCriterion(
        criterion,
        [{ source: "Candidate certifications", text: criterion }],
        { today, cvText },
      ).status,
      "Needs Review",
    );
  }
});

test("qualifiers cannot be stitched together from separate facts or sentences", () => {
  for (const facts of [
    [{ source: "CV", text: "Valid UAE driving licence. Worked in Oman" }],
    [
      { source: "CV", text: "Valid UAE driving licence" },
      { source: "CV", text: "Oman operations" },
    ],
    candidateScreeningFacts(
      { certifications: ["Valid UAE driving licence"] },
      { location: "Oman" },
    ),
  ]) {
    assert.equal(assessPreliminaryCriterion(criterion, facts, { today }).status, "Needs Review");
  }
});

test("a synonym cannot erase a mandatory certificate or its validity", () => {
  for (const text of ["Occupational safety", "Occupational safety certificate"]) {
    assert.equal(
      assessPreliminaryCriterion("Valid HSE certificate", [{ source: "CV", text }], { today })
        .status,
      "Needs Review",
    );
  }
  assert.equal(
    assessPreliminaryCriterion(
      "Valid HSE certificate",
      [{ source: "CV", text: "Valid occupational safety certificate" }],
      { today },
    ).status,
    "Confirmed",
  );
});

test("unrelated negative qualifications do not invalidate positive evidence", () => {
  assert.equal(
    assessPreliminaryCriterion(
      criterion,
      [
        { source: "CV", text: criterion },
        { source: "CV", text: "No marine licence" },
      ],
      { today },
    ).status,
    "Confirmed",
  );
});

test("quantified criteria are reviewed instead of confirmed by keyword overlap", () => {
  for (const [requirement, text] of [
    ["At least 5 years of experience", "3 years of experience"],
    ["10 years of experience", "1 year of experience"],
    ["No sponsorship required", "Sponsorship required"],
  ]) {
    assert.equal(
      assessPreliminaryCriterion(requirement!, [{ source: "CV", text: text! }], { today }).status,
      "Needs Review",
    );
  }
});

test("matching a skill does not require exact case or synonymous wording", () => {
  assert.equal(
    assessPreliminaryCriterion("Customs clearance", [{ source: "CV", text: "CUSTOMS BROKERAGE" }])
      .status,
    "Confirmed",
  );
});

test("a substring inside another word is not evidence of a skill", () => {
  assert.equal(
    assessPreliminaryCriterion("Java", [{ source: "CV", text: "JavaScript" }]).status,
    "Needs Review",
  );
});

test("preview keyword extraction keeps negative source context for screening", async () => {
  const extraction = await new LocalCvExtractionProvider().extract({
    file: new Blob(["No experience in customs clearance."], { type: "text/plain" }),
    fileName: "applicant.txt",
  });
  assert.ok(extraction.fields.skills?.includes("customs clearance"));
  assert.equal(
    assessPreliminaryCriterion(
      "Customs clearance",
      candidateScreeningFacts({}, extraction.fields as Record<string, unknown>),
      { cvText: extraction.semanticText },
    ).status,
    "Needs Review",
  );
});

test("old rules are not considered a reusable current screening result", () => {
  assert.equal(currentPreliminaryRules(undefined), false);
  assert.equal(currentPreliminaryRules("structured matching"), false);
  assert.equal(currentPreliminaryRules(`${PRELIMINARY_RULES_VERSION} | structured matching`), true);
});
