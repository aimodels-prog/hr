import { expect, test } from "@playwright/test";

test("public application progresses through shortlist, interview, offer and onboarding", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const unique = Date.now().toString();
  const candidateEmail = `browser.candidate.${unique}@example.com`;
  await page.goto("/jobs/log-ops-lead");
  await expect(page.getByText("Apply for this role")).toBeVisible({ timeout: 20_000 });

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
    name: "Browser-Candidate.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(
      "%PDF-1.4\nBrowser Candidate logistics CargoWise leadership 8 years experience Dubai\n%%EOF",
    ),
  });
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Submit Application" }).click();
  await expect(page.getByText("Application Received")).toBeVisible();
  await expect(page.getByText(/^APP-\d{2}-/)).toBeVisible();

  await page.goto("/staff/candidates");
  await expect(page.getByText("Browser Candidate", { exact: true }).first()).toBeVisible();
  await expect
    .poll(
      async () =>
        page.evaluate(async (email) => {
          const actor = {
            actor: {
              userId: "user-rana",
              employeeId: "employee-rana",
              displayName: "Rana Nair",
              workspaceEmail: "rana.nair@via.example",
              roles: ["Employee", "HR"],
              activeRole: "HR",
            },
          };
          const { initializeApplicationData, getApplicationDataServices } =
            await import("/src/lib/data/application-data.ts");
          const { CandidateService } = await import("/src/lib/data/candidate-service.ts");
          initializeApplicationData();
          await new CandidateService().hydrateCompatibilityCache(actor);
          const storage = getApplicationDataServices().storage;
          const candidates = storage.readCollection<{ id: string; email: string }>("candidates");
          const candidate = candidates.find((item) => item.email === email);
          if (!candidate) return "Candidate missing";
          const cvs = storage.readCollection<{
            candidateId: string;
            processingStatus: string;
          }>("candidate_cv_records");
          return cvs.find((item) => item.candidateId === candidate.id)?.processingStatus;
        }, candidateEmail),
      { timeout: 15_000 },
    )
    .toBe("Awaiting HR Review");
  const intake = await page.evaluate(async (email) => {
    const actor = {
      actor: {
        userId: "user-rana",
        employeeId: "employee-rana",
        displayName: "Rana Nair",
        workspaceEmail: "rana.nair@via.example",
        roles: ["Employee", "HR"],
        activeRole: "HR",
      },
    };
    const { initializeApplicationData, getApplicationDataServices } =
      await import("/src/lib/data/application-data.ts");
    const { CandidateService } = await import("/src/lib/data/candidate-service.ts");
    initializeApplicationData();
    await new CandidateService().hydrateCompatibilityCache(actor);
    const read = <T>(name: string): T[] =>
      getApplicationDataServices().storage.readCollection<T>(name);
    const candidate = read<{ id: string; email: string; skills?: string[] }>("candidates").find(
      (item) => item.email === email,
    )!;
    const application = read<{
      id: string;
      candidateId: string;
      cvFileId: string;
      preparationStatus?: string;
    }>("applications").find((item) => item.candidateId === candidate.id)!;
    const cv = read<{
      id: string;
      candidateId: string;
      processingStatus: string;
      extractedFields: { skills?: string[] };
    }>("candidate_cv_records").find((item) => item.candidateId === candidate.id)!;
    return { candidate, application, cv };
  }, candidateEmail);
  expect(intake.candidate.skills ?? []).toEqual([]);
  expect(intake.cv.processingStatus).toBe("Awaiting HR Review");
  expect(intake.cv.extractedFields.skills).toContain("logistics");
  expect(["Ready", "Needs Review"]).toContain(intake.application.preparationStatus);

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
  const templateName = await page.evaluate(async (suffix) => {
    const actor = {
      actor: {
        userId: "user-rana",
        employeeId: "employee-rana",
        displayName: "Rana Nair",
        workspaceEmail: "rana.nair@via.example",
        roles: ["Employee", "HR"],
        activeRole: "HR",
      },
    };
    const { initializeApplicationData } = await import("/src/lib/data/application-data.ts");
    const { ScorecardService } = await import("/src/lib/data/scorecard-service.ts");
    initializeApplicationData();
    const name = `Browser HR Screening ${suffix}`;
    await new ScorecardService().saveTemplateAsync(
      {
        name,
        blindScoring: true,
        criteria: [
          {
            id: `browser-role-knowledge-${suffix}`,
            name: "Role knowledge",
            description: "Evidence of practical logistics knowledge",
            requiresEvidence: true,
            weight: 100,
            minimumScore: 3,
            isCritical: true,
          },
        ],
        aiDecisionWeight: 40,
        interviewDecisionWeight: 60,
      },
      actor,
    );
    return name;
  }, unique);
  await page.reload();
  await expect(page.getByText("Canonical Details")).toBeVisible();
  await page.getByRole("tab", { name: /^Interviews/ }).click();
  await page.getByRole("button", { name: "Schedule Interview" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule Interview" });
  const templateSelect = dialog
    .getByText("Scorecard Template", { exact: false })
    .locator("..")
    .getByRole("combobox");
  await templateSelect.click();
  await page.getByRole("option", { name: templateName }).click();
  await dialog.getByRole("button", { name: "Simulate Availability" }).click();
  await dialog
    .getByText("Select a confirmed slot")
    .locator("..")
    .locator("div.cursor-pointer")
    .first()
    .click();
  await dialog.getByRole("button", { name: "Schedule Interview" }).click();
  await page.getByRole("tab", { name: /^Interviews/ }).click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

  const completion = await page.evaluate(
    async ({ email }) => {
      const actor = {
        actor: {
          userId: "user-rana",
          employeeId: "employee-rana",
          displayName: "Rana Nair",
          workspaceEmail: "rana.nair@via.example",
          roles: ["Employee", "HR"],
          activeRole: "HR",
        },
      };
      const { initializeApplicationData, getApplicationDataServices } =
        await import("/src/lib/data/application-data.ts");
      const { CandidateService } = await import("/src/lib/data/candidate-service.ts");
      initializeApplicationData();
      await new CandidateService().hydrateCompatibilityCache(actor);
      const read = <T>(name: string): T[] =>
        getApplicationDataServices().storage.readCollection<T>(name);
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
      await scorecards.saveScorecardAsync(scorecard.id, scores, "Strong Yes", true, actor);
      await new InterviewService().updateWorkflowAsync(
        interview.id,
        {
          action: "change-status",
          status: "Completed",
          reason: "All required panel scorecards were submitted",
        },
        actor,
      );
      const offers = new OfferService();
      await offers.finalizeDecisionAsync("log-ops-lead", candidate.id, undefined, undefined, actor);
      const offer = await offers.saveOfferAsync(
        {
          candidateId: candidate.id,
          vacancyId: "log-ops-lead",
          template: "VIA Standard Employment Offer",
          position: "Operations Lead",
          grade: "G6",
          salary: 18000,
          currency: "AED",
          allowances: "As per VIA policy",
          benefits: "Medical insurance and annual travel allowance",
          startDate: "2030-10-01",
          probation: "6 months",
          location: "Dubai, UAE",
          conditions: "Subject to verified employment documents",
          responseDeadline: "2030-09-15T12:00:00.000Z",
        },
        actor,
      );
      await offers.transitionOfferAsync(offer.id, "Pending Approval", undefined, actor);
      await offers.transitionOfferAsync(offer.id, "Approved", undefined, actor);
      await offers.transitionOfferAsync(offer.id, "Ready to Send", undefined, actor);
      await offers.transitionOfferAsync(offer.id, "Sent", undefined, actor);
      await offers.transitionOfferAsync(offer.id, "Accepted", "Accepted in browser journey", actor);
      return { candidateId: candidate.id, offerId: offer.id };
    },
    { email: candidateEmail },
  );

  expect(completion.candidateId).toBeTruthy();
  await page.getByRole("link", { name: "Offers", exact: true }).click();
  await expect(page.getByText("Browser Candidate", { exact: true })).toBeVisible();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Directory", exact: true }).click();
  await expect(page.getByText("Browser Candidate", { exact: true }).first()).toBeVisible();
});
