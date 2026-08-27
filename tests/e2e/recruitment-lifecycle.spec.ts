import { expect, test } from "@playwright/test";

test("public application progresses through shortlist, interview, offer and onboarding", async ({
  page,
}) => {
  const unique = Date.now().toString();
  const candidateEmail = `browser.candidate.${unique}@example.com`;
  await page.goto("/jobs/log-ops-lead");
  await expect(page.getByText("Apply for this role")).toBeVisible();

  const fields = {
    firstName: "Browser",
    lastName: "Candidate",
    email: candidateEmail,
    phone: `+97150${unique.slice(-7)}`,
    location: "Dubai",
    yearsOfExperience: "8",
    noticePeriod: "30 days",
    currentCompany: "Global Freight",
    currentTitle: "Logistics Manager",
    salaryExpectation: "18000",
  };
  for (const [name, value] of Object.entries(fields)) {
    await page.locator(`input[name="${name}"]`).fill(value);
  }
  const textareas = page.locator("textarea");
  for (let index = 0; index < (await textareas.count()); index += 1) {
    await textareas.nth(index).fill("Yes, with evidence from regional logistics operations.");
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "Browser-Candidate.docx",
    mimeType: "",
    buffer: Buffer.from(
      "Browser Candidate logistics CargoWise leadership 8 years experience Dubai",
    ),
  });
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Submit Application" }).click();
  await expect(page.getByText("Application Received")).toBeVisible();
  await expect(page.getByText(/^APP-\d{2}-/)).toBeVisible();

  const intake = await page.evaluate(async (email) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const read = <T>(name: string): T[] => {
      const raw = localStorage.getItem(`via_hr:collection:${name}`);
      return raw ? (JSON.parse(raw).items as T[]) : [];
    };
    const candidate = read<{ id: string; email: string; skills?: string[] }>("candidates").find(
      (item) => item.email === email,
    )!;
    const application = read<{ id: string; candidateId: string; cvFileId: string }>(
      "applications",
    ).find((item) => item.candidateId === candidate.id)!;
    const cv = read<{
      id: string;
      candidateId: string;
      processingStatus: string;
      extractedFields: { skills?: string[] };
    }>("candidate_cv_records").find((item) => item.candidateId === candidate.id)!;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("via_hr_files", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<{
      metadata: { owner: { entityType: string; entityId: string } };
    }>((resolve, reject) => {
      const request = database
        .transaction("files", "readonly")
        .objectStore("files")
        .get(application.cvFileId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return { candidate, cv, fileOwner: stored.metadata.owner };
  }, candidateEmail);
  expect(intake.candidate.skills ?? []).toEqual([]);
  expect(intake.cv.processingStatus).toBe("Awaiting HR Review");
  expect(intake.cv.extractedFields.skills).toContain("logistics");
  expect(intake.fileOwner).toEqual({ entityType: "candidate-cv", entityId: intake.cv.id });

  await page.goto("/staff/vacancies");
  await page.getByText("Logistics Operations Lead", { exact: true }).click();
  await page.getByRole("tab", { name: "Scoring & Shortlist" }).click();
  await page
    .getByText("People to assess", { exact: true })
    .locator("..")
    .locator("input")
    .fill("1");
  await page.getByRole("button", { name: "Choose Assessment Group" }).click();
  await expect(page.getByText("Detailed assessment group")).toBeVisible();
  await page.getByRole("button", { name: "Run Detailed Assessment" }).click();
  await page.getByRole("button", { name: "Review Shortlist" }).click();
  await page.getByRole("button", { name: "Finalize..." }).click();
  await expect(page.getByText("Finalize Shortlist")).toBeVisible();
  await page.getByRole("button", { name: "Finalize & Update Stages" }).click();
  await expect(page.getByText("Shortlist Finalized")).toBeVisible();

  await page.getByText("Browser Candidate", { exact: true }).last().click();
  await expect(page.getByText("Canonical Details")).toBeVisible();
  await page.getByRole("tab", { name: /^Interviews/ }).click();
  await page.getByRole("button", { name: "Schedule Interview" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule Interview" });
  const templateSelect = dialog
    .getByText("Scorecard Template", { exact: false })
    .locator("..")
    .getByRole("combobox");
  await templateSelect.click();
  await page.getByRole("option", { name: "HR Screening" }).click();
  await dialog.getByRole("button", { name: "Simulate Availability" }).click();
  await dialog
    .getByText("Select a confirmed slot")
    .locator("..")
    .locator("div.cursor-pointer")
    .first()
    .click();
  await dialog.getByRole("button", { name: "Schedule Interview" }).click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

  const completion = await page.evaluate(
    async ({ email }) => {
      const actor = {
        actor: {
          userId: "user-rana",
          employeeId: "employee-rana",
          displayName: "Rana Nair",
          roles: ["Employee", "HR"],
          activeRole: "HR",
        },
      };
      const read = <T>(name: string): T[] => {
        const raw = localStorage.getItem(`via_hr:collection:${name}`);
        return raw ? (JSON.parse(raw).items as T[]) : [];
      };
      const candidate = read<{ id: string; email: string }>("candidates").find(
        (item) => item.email === email,
      )!;
      const interview = read<{
        id: string;
        candidateId: string;
        templateId: string;
        panelUserIds: string[];
      }>("interview_events").find((item) => item.candidateId === candidate.id)!;
      const { ScorecardService } = await import("/src/lib/data/scorecard-service.ts");
      const { InterviewService } = await import("/src/lib/data/interview-service.ts");
      const { OfferService } = await import("/src/lib/data/offer-service.ts");
      const scorecards = new ScorecardService();
      const template = scorecards.getTemplateById(interview.templateId)!;
      const scorecard = scorecards.getOrCreateScorecard(interview.id, "user-rana", actor);
      const scores = template.criteria.map((criterion: { id: string }) => ({
        criterionId: criterion.id,
        score: 5,
        evidence: "Strong evidence demonstrated during the interview.",
      }));
      scorecards.submitScorecard(scorecard.id, scores, "Strong Yes", actor);
      new InterviewService().changeStatus(
        interview.id,
        "Completed",
        "All required panel scorecards were submitted",
        actor,
      );
      const offers = new OfferService();
      offers.finalizeDecision("log-ops-lead", candidate.id, undefined, undefined, actor);
      const offer = offers.createOffer(
        {
          candidateId: candidate.id,
          vacancyId: "log-ops-lead",
          template: "VIA Standard Employment Offer",
          position: "Logistics Operations Lead",
          grade: "G6",
          salary: 18000,
          currency: "AED",
          allowances: "As per VIA policy",
          benefits: "Medical insurance and annual travel allowance",
          startDate: "2026-10-01",
          probation: "6 months",
          location: "Dubai, UAE",
          conditions: "Subject to verified employment documents",
          responseDeadline: "2026-09-15",
        },
        actor,
      );
      offers.updateOfferStatus(offer.id, "Pending Approval", undefined, actor);
      offers.updateOfferStatus(offer.id, "Approved", undefined, actor);
      offers.updateOfferStatus(offer.id, "Ready to Send", undefined, actor);
      await offers.transitionOffer(offer.id, "Sent", undefined, actor);
      await offers.transitionOffer(offer.id, "Accepted", "Accepted in browser journey", actor);
      return { candidateId: candidate.id, offerId: offer.id };
    },
    { email: candidateEmail },
  );

  expect(completion.candidateId).toBeTruthy();
  await page.getByRole("link", { name: "Offers", exact: true }).click();
  await expect(page.getByText("Browser Candidate", { exact: true })).toBeVisible();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Onboarding", exact: true }).click();
  await expect(page.getByText("Browser Candidate", { exact: true })).toBeVisible();
});
