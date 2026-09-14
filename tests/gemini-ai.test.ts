import assert from "node:assert/strict";
import test from "node:test";

import {
  GeminiAiService,
  type GeminiGenerationRequest,
} from "../src/lib/integrations/gemini-ai.server.ts";

const facts = {
  title: "Logistics Manager",
  department: "Operations",
  location: "Dubai",
  employmentType: "Full-time",
  education: "Bachelor's degree or equivalent experience",
  minimumExperience: "Five years",
  skills: { required: ["Freight operations"], preferred: ["CargoWise"] },
  languages: ["English"],
  mandatoryCriteria: ["Valid UAE driving licence"],
};

const vacancyDetails = {
  education: facts.education,
  requiredSkills: facts.skills.required,
  preferredSkills: facts.skills.preferred,
  certifications: [],
  languages: facts.languages,
  mandatoryCriteria: facts.mandatoryCriteria,
  screeningQuestions: ["Describe your relevant freight experience."],
  compensationWording: "Compensation will be discussed based on role scope and experience.",
};

test("Full vacancy generation accepts an empty criteria brief and returns editable structured suggestions", async () => {
  const details = {
    education: "Relevant qualification or equivalent experience",
    requiredSkills: ["Freight planning"],
    preferredSkills: ["CargoWise"],
    certifications: [],
    languages: [],
    mandatoryCriteria: ["Five years of relevant experience"],
    screeningQuestions: ["Describe a freight operation you managed."],
    compensationWording: "Compensation will be discussed based on role scope and experience.",
  };
  const service = new GeminiAiService({
    apiKey: "test-key",
    generate: async (request) => {
      assert.match(request.contents, /Oman/);
      assert.match(request.config.systemInstruction, /Never invent a statutory licence/);
      assert.match(request.config.systemInstruction, /Do not add HR-verification flags/);
      return {
        text: JSON.stringify({
          summary: "Lead freight operations and deliver reliable customer outcomes in Oman.",
          responsibilities: [
            "Plan freight operations.",
            "Coordinate delivery partners.",
            "Measure service quality.",
          ],
          requirements: [
            "Five years of relevant experience",
            "Freight planning capability",
            "Clear stakeholder communication",
          ],
          vacancyDetails: details,
        }),
      };
    },
  });
  const result = await service.generateJobDescription({
    ...facts,
    location: "Oman",
    mandatoryCriteria: [],
    education: "",
  });
  assert.deepEqual(result.vacancyDetails, details);
  assert.equal("salaryMin" in (result.vacancyDetails ?? {}), false);
});

test("Gemini job generation uses server-side structured output and bounded settings", async () => {
  let captured: GeminiGenerationRequest | undefined;
  const service = new GeminiAiService({
    apiKey: "test-key-that-is-long-enough",
    model: "gemini-test",
    generate: async (request) => {
      captured = request;
      return {
        text: JSON.stringify({
          summary: "Lead VIA International logistics operations and deliver reliable outcomes.",
          vacancyDetails,
          responsibilities: [
            "Lead daily freight operations.",
            "Coordinate internal stakeholders.",
            "Monitor operational performance.",
          ],
          requirements: [
            "Five years of relevant experience.",
            "Freight operations capability.",
            "Valid UAE driving licence",
          ],
        }),
      };
    },
  });
  const result = await service.generateJobDescription(facts);
  assert.equal(result.responsibilities.length, 3);
  assert.equal(captured?.model, "gemini-test");
  assert.equal(captured?.config.responseMimeType, "application/json");
  assert.equal(captured?.config.temperature, 0.1);
  assert.doesNotMatch(captured?.contents ?? "", /test-key-that-is-long-enough/);
  assert.match(captured?.config.systemInstruction ?? "", /untrusted data/i);
});

test("Gemini detailed assessment excludes identity data and recalculates the overall score", async () => {
  let prompt = "";
  const service = new GeminiAiService({
    apiKey: "test-key-that-is-long-enough",
    generate: async (request) => {
      prompt = request.contents;
      return {
        text: JSON.stringify({
          experienceScore: 80,
          locationScore: 60,
          profileScore: 70,
          strengths: ["Relevant freight experience is confirmed."],
          risks: ["One preferred system is not confirmed."],
          missingData: ["Certification date is not available."],
          evidence: "The prepared profile confirms relevant experience and one required skill.",
        }),
      };
    },
  });
  const result = await service.assessCandidate({
    vacancy: {
      title: facts.title,
      location: facts.location,
      education: facts.education,
      minimumExperience: facts.minimumExperience,
      requiredSkills: facts.skills.required,
      preferredSkills: facts.skills.preferred,
      certifications: [],
      languages: facts.languages,
      mandatoryCriteria: facts.mandatoryCriteria,
    },
    candidate: {
      currentTitle: "Freight Supervisor",
      location: "Abu Dhabi",
      yearsOfExperience: 7,
      skills: ["Freight operations"],
      education: ["Bachelor of Logistics"],
      certifications: [],
      languages: ["English"],
      workEligibility: "Confirmed by candidate",
    },
    application: { screeningAnswers: [{ question: "Can you travel?", answer: "Yes" }] },
    preparation: {
      preliminaryScore: 74,
      band: "Potential Match",
      compulsoryChecks: [{ criterion: "Valid UAE driving licence", status: "Not Confirmed" }],
      matchedSkills: ["Freight operations"],
      missingRequiredSkills: [],
      evidence: ["Seven years recorded experience."],
      warnings: [],
    },
  });
  assert.equal(result.overallScore, 73);
  assert.deepEqual(result.categoryScores, { Experience: 80, Location: 60, Profile: 70 });
  assert.doesNotMatch(prompt, /email|phone|marital|recommender/i);
  assert.match(result.modelRulesVersion, /^gemini:/);
});

test("Gemini retries transient failures but rejects invalid structured output", async () => {
  let attempts = 0;
  const retrying = new GeminiAiService({
    apiKey: "test-key-that-is-long-enough",
    maxRetries: 1,
    generate: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("Rate limited"), { status: 429 });
      return {
        text: JSON.stringify({
          summary: "Lead VIA International logistics operations and deliver reliable outcomes.",
          vacancyDetails,
          responsibilities: ["Lead operations.", "Coordinate teams.", "Monitor outcomes."],
          requirements: ["Five years experience.", "Freight capability.", "Driving licence."],
        }),
      };
    },
  });
  await retrying.generateJobDescription(facts);
  assert.equal(attempts, 2);

  const invalid = new GeminiAiService({
    apiKey: "test-key-that-is-long-enough",
    maxRetries: 0,
    generate: async () => ({ text: "not-json" }),
  });
  await assert.rejects(() => invalid.generateJobDescription(facts), /invalid structured response/i);
});

test("Gemini configuration refuses a missing or placeholder key", () => {
  assert.throws(() => new GeminiAiService({ apiKey: "" }), /not configured/i);
  assert.throws(
    () => new GeminiAiService({ apiKey: "PASTE_REAL_GEMINI_KEY_HERE" }),
    /not configured/i,
  );
});
