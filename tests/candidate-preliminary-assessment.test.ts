import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCandidatePreliminaryAssessment } from "../src/lib/db/repositories/candidate-cv-intake.repository.server.ts";
import { selectCandidateAssessmentGroup } from "../src/lib/db/repositories/recruitment-screening.repository.server.ts";

type Candidate = Parameters<typeof buildCandidatePreliminaryAssessment>[0];
type Vacancy = Parameters<typeof buildCandidatePreliminaryAssessment>[1];

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    currentTitle: "International Shipping Operations Manager",
    currentCompany: "Global Cargo",
    location: "Dubai",
    skills: ["Customs brokerage", "Logistics"],
    education: ["Bachelor of Business Administration"],
    certifications: ["Occupational Safety Certificate"],
    languages: ["English", "Arabic"],
    workEligibility: "Authorised to work in the UAE",
    yearsOfExperience: 8,
    ...overrides,
  } as Candidate;
}

function vacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    title: "Freight Forwarding Manager",
    summary: "Lead international freight and customs operations.",
    requirements: ["Strong freight forwarding experience"],
    mandatoryCriteria: ["Freight forwarding", "Customs clearance"],
    minimumExperience: "5 years",
    skills: { required: ["Freight forwarding", "Customs clearance"], preferred: [] },
    ...overrides,
  } as Vacancy;
}

test("preliminary screening recognises equivalent professional wording", () => {
  const result = buildCandidatePreliminaryAssessment(candidate(), vacancy(), {});
  assert.deepEqual(result.missingRequiredSkills, []);
  assert.ok(result.compulsoryChecks.every((check) => check.status === "Confirmed"));
  assert.equal(result.band, "Strong Match");
});

test("missing CV evidence is sent to HR review rather than treated as a rejection", () => {
  const result = buildCandidatePreliminaryAssessment(
    candidate({ skills: [], currentTitle: null, workEligibility: null }),
    vacancy({ mandatoryCriteria: ["Required marine licence"] }),
    {},
  );
  assert.equal(result.band, "Compulsory Criterion Not Confirmed");
  assert.equal(result.status, "Needs Review");
  assert.equal(result.compulsoryChecks[0]?.status, "Needs Review");
});

test("negated licence evidence cannot produce a strong compulsory match", () => {
  const result = buildCandidatePreliminaryAssessment(
    candidate({ certifications: ["No valid Oman driving licence"] }),
    vacancy({ mandatoryCriteria: ["Valid Oman driving licence"] }),
    {},
    { score: 100, model: "test" },
  );
  assert.equal(result.compulsoryChecks[0]?.status, "Needs Review");
  assert.equal(result.status, "Needs Review");
  assert.equal(result.band, "Compulsory Criterion Not Confirmed");
  assert.match(result.compulsoryChecks[0]!.evidence, /No valid Oman driving licence/);
});

test("current CV text is checked even when the parser extracts positive keywords", () => {
  const result = buildCandidatePreliminaryAssessment(
    candidate(),
    vacancy(),
    {},
    { score: 100, model: "test" },
    1,
    "I have no experience in customs clearance.",
  );
  assert.ok(result.missingRequiredSkills.includes("Customs clearance"));
  assert.equal(result.compulsoryChecks[1]?.status, "Needs Review");
  assert.equal(result.status, "Needs Review");
});

test("new lower experience supersedes the older higher number without editing candidate details", () => {
  const original = candidate({ yearsOfExperience: 15 });
  const lower = buildCandidatePreliminaryAssessment(original, vacancy(), { yearsOfExperience: 2 });
  const higher = buildCandidatePreliminaryAssessment(original, vacancy(), {
    yearsOfExperience: 15,
  });
  assert.ok(lower.preliminaryScore < higher.preliminaryScore);
  assert.equal(lower.band, "Needs HR Review");
  assert.match(lower.evidence.join(" "), /2 years.*differs/);
  assert.equal(original.yearsOfExperience, 15);
});

test("experience below the minimum requires review even with a high semantic score", () => {
  const result = buildCandidatePreliminaryAssessment(
    candidate({ yearsOfExperience: 1 }),
    vacancy(),
    { yearsOfExperience: 1 },
    { score: 100, model: "test" },
  );
  assert.equal(result.band, "Needs HR Review");
  assert.equal(result.status, "Needs Review");
});

test("HR receives the requested number in ranking order", () => {
  const result = selectCandidateAssessmentGroup(
    ["rank-1", "rank-2", "rank-3", "rank-4"],
    [],
    [],
    3,
  );
  assert.deepEqual(result.selected, ["rank-1", "rank-2", "rank-3"]);
});

test("recommended and HR-added candidates remain pinned without changing their scores", () => {
  const result = selectCandidateAssessmentGroup(
    ["rank-1", "rank-2", "recommended", "hr-added"],
    ["recommended"],
    ["hr-added"],
    3,
  );
  assert.deepEqual(result.pinned, ["recommended", "hr-added"]);
  assert.deepEqual(result.selected, ["recommended", "hr-added", "rank-1"]);
  assert.throws(
    () => selectCandidateAssessmentGroup(["rank-1", "rank-2"], [], [], 0),
    /at least one/,
  );
});

test("HR can choose twenty or more candidates when enough prepared candidates exist", () => {
  const ranked = Array.from({ length: 25 }, (_, index) => `rank-${index + 1}`);
  const result = selectCandidateAssessmentGroup(ranked, [], [], 20);
  assert.equal(result.selected.length, 20);
  assert.deepEqual(result.selected, ranked.slice(0, 20));
});
