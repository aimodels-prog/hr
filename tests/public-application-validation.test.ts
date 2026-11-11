import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { submitPublicApplicationToDatabase } from "../src/lib/db/repositories/public-application.repository.server.ts";
import { PublicApplicationSchema } from "../src/lib/recruitment/public-application-validation.server.ts";
import { resolvePublicRecruitmentRequest } from "../src/lib/recruitment/public-recruitment-http.server.ts";

function validApplication() {
  return {
    vacancyId: randomUUID(),
    firstName: "Portal",
    lastName: "Applicant",
    email: "portal.applicant@example.test",
    phone: "+968 9000 0000",
    location: "Muscat",
    currentCompany: "Not currently employed",
    currentTitle: "Job seeker",
    yearsOfExperience: 5,
    noticePeriod: "Available immediately",
    workEligibility: "Need employer sponsorship",
    currentSalary: "0",
    salaryExpectation: "OMR 1,800–2,000 monthly",
    screeningAnswers: [],
    consent: true as const,
    fileName: "candidate.pdf",
    mimeType: "application/pdf",
    fileBase64: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64"),
  };
}

test("server accepts a monthly salary range and unemployment descriptions", () => {
  const parsed = PublicApplicationSchema.parse(validApplication());
  assert.equal(parsed.currentCompany, "Not currently employed");
  assert.equal(parsed.currentTitle, "Job seeker");
  assert.equal(parsed.currentSalary, "0");
  assert.equal(parsed.salaryExpectation, "OMR 1,800–2,000 monthly");
});

test("public application endpoint rejects missing or whitespace-only compulsory fields", async () => {
  for (const field of [
    "currentCompany",
    "currentTitle",
    "workEligibility",
    "currentSalary",
    "salaryExpectation",
  ] as const) {
    for (const value of [undefined, "   "]) {
      const payload: Record<string, unknown> = { ...validApplication() };
      if (value === undefined) delete payload[field];
      else payload[field] = value;
      const response = await resolvePublicRecruitmentRequest(
        new Request("https://careers.via-int.com/api/public/applications", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      assert.equal(response?.status, 400, `${field}=${String(value)} should be rejected`);
      assert.deepEqual(await response?.json(), {
        error: "Application information is incomplete or invalid.",
      });
    }
  }
});

test("visa type is required only for candidates who already hold an Oman work visa", () => {
  assert.equal(
    PublicApplicationSchema.safeParse({
      ...validApplication(),
      workEligibility: "Valid Oman work visa",
    }).success,
    false,
  );
  assert.equal(
    PublicApplicationSchema.safeParse({
      ...validApplication(),
      workEligibility: "Valid Oman work visa",
      visaStatus: "Own Visa",
    }).success,
    true,
  );
});

test("persistence guard rejects blank compulsory fields before touching the database", async () => {
  const base = validApplication();
  for (const field of ["currentCompany", "currentTitle", "salaryExpectation"] as const) {
    await assert.rejects(
      submitPublicApplicationToDatabase(randomUUID(), {
        ...base,
        [field]: "  ",
        fileBytes: Buffer.from("%PDF-1.4\n%%EOF\n"),
      }),
      /Current company, current title and monthly salary expectation are required/,
      `${field} should be rejected before persistence`,
    );
  }
  for (const value of ["", "   ", "not disclosed", "-10"]) {
    await assert.rejects(
      submitPublicApplicationToDatabase(randomUUID(), {
        ...base,
        currentSalary: value,
        fileBytes: Buffer.from("%PDF-1.4\n%%EOF\n"),
      }),
      /current monthly salary in OMR/,
      `currentSalary=${JSON.stringify(value)} should be rejected before persistence`,
    );
  }
});
