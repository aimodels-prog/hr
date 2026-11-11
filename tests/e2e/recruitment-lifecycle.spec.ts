import { expect, test } from "@playwright/test";
import { textPdf } from "./pdf-fixture";

test("public application progresses through shortlist, interview, offer and onboarding", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const unique = Date.now().toString();
  const candidateLastName = `Candidate${unique
    .slice(-6)
    .split("")
    .map((digit) => "ABCDEFGHIJ"[Number(digit)])
    .join("")}`;
  const candidateName = `Browser ${candidateLastName}`;
  const candidateEmail = `browser.candidate.${unique}@example.com`;
  await page.goto("/jobs/log-ops-lead");
  await expect(page.getByRole("heading", { name: "Apply for this position" })).toBeVisible({
    timeout: 20_000,
  });

  const fields = {
    firstName: "Browser",
    lastName: candidateLastName,
    email: candidateEmail,
    phone: `+97150${unique.slice(-7)}`,
    location: "Dubai",
    yearsOfExperience: "8",
    noticePeriod: "30 days",
    currentCompany: "Global Freight",
    currentTitle: "Logistics Manager",
    currentSalary: "7000",
    salaryExpectation: "18000",
  };
  for (const [name, value] of Object.entries(fields)) {
    await page.locator(`input[name="${name}"]`).fill(value);
  }
  await page.locator('select[name="workEligibility"]').selectOption("Need employer sponsorship");
  const textareas = page.locator("textarea");
  for (let index = 0; index < (await textareas.count()); index += 1) {
    await textareas.nth(index).fill("Yes, with evidence from regional logistics operations.");
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "Browser-Candidate.pdf",
    mimeType: "application/pdf",
    buffer: textPdf(
      `${candidateName}. 8 years of experience in logistics, CargoWise and supply chain leadership in Dubai. Managed customs clearance, freight operations, transport planning and regional teams. Education: Bachelor of Business Administration. Skills: logistics, supply chain, customs clearance, leadership, CargoWise. Languages: English.`,
    ),
  });
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Submit Application" }).click();
  await expect(page.getByText("Application Received")).toBeVisible();
  await expect(page.getByText(/^APP-\d{2}-/)).toBeVisible();

  await page.goto("/staff/candidates");
  await page.getByPlaceholder("Search by name, email, title...").fill(candidateEmail);
  await expect(page.getByRole("link", { name: candidateName, exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        page.evaluate(async (email) => {
          const actor = {
            actor: {
              userId: "user-rana",
              employeeId: "employee-rana",
              displayName: "Rana Nair",
              workspaceEmail: "rana.nair@via-int.com",
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
    .toBe("Ready");
  const intake = await page.evaluate(async (email) => {
    const actor = {
      actor: {
        userId: "user-rana",
        employeeId: "employee-rana",
        displayName: "Rana Nair",
        workspaceEmail: "rana.nair@via-int.com",
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
  expect(intake.cv.processingStatus).toBe("Ready");
  expect(intake.cv.extractedFields.skills).toContain("logistics");
  expect(["Ready", "Needs Review"]).toContain(intake.application.preparationStatus);

  await page.goto(`/staff/candidates/${intake.candidate.id}`);
  await page.getByRole("link", { name: /^Applications \(/ }).click();
  await page.getByRole("button", { name: "Mark not suitable" }).click();
  await page
    .getByLabel("Private HR remark")
    .fill("Required role experience is not shown in this CV");
  await page.getByRole("dialog").getByRole("button", { name: "Mark not suitable" }).click();
  await expect(page.getByText("Not suitable", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: /^Applications \(/ }).click();
  await page.getByRole("button", { name: "Restore to review" }).click();

  await page.goto("/staff/vacancies");
  await page.getByText("Logistics Operations Lead", { exact: true }).click();
  await page
    .getByRole("navigation", { name: "Page sections" })
    .getByRole("link", { name: /^Applications \(/ })
    .click();
  await page.getByRole("link", { name: candidateName, exact: true }).click();
  await expect(page.getByRole("link", { name: "Back to applications" })).toBeVisible();
  await expect(page.getByText("Candidate 1 of 1")).toBeVisible();
  await page.getByRole("link", { name: "Back to applications" }).click();
  await expect(page.getByRole("link", { name: candidateName, exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Page sections" })
    .getByRole("link", { name: "CV analysis (optional)" })
    .click();
  await page.getByRole("textbox", { name: "Search CVs by name" }).fill(candidateName);
  await page.getByRole("button", { name: "Not suitable", exact: true }).first().click();
  await page
    .getByLabel("Private HR remark")
    .fill("Required role experience is not shown in this CV");
  await page.getByRole("button", { name: "Mark not suitable" }).click();
  await page.getByRole("combobox", { name: "Filter CV reviews" }).selectOption("not-suitable");
  await expect(page.getByText("Required role experience is not shown in this CV")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("combobox", { name: "Filter CV reviews" }).selectOption("active");
  await page
    .getByText("People to assess", { exact: true })
    .locator("..")
    .locator("input")
    .fill("1");
  await page.getByRole("button", { name: "Choose Assessment Group" }).click();
  await page.getByText("Why this score?").first().click();
  await expect(page.getByText(/Score weighting: compulsory criteria 35%/).first()).toBeVisible();
  await expect(page.getByText("Compulsory criteria", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Required skills to verify").first()).toBeVisible();
  await expect(page.getByText("How the score was reached").first()).toBeVisible();
  await expect(page.getByText("Detailed assessment group")).toBeVisible();
  await page.getByRole("button", { name: "Run Detailed Assessment" }).click();
  await page.getByRole("button", { name: "Review Shortlist" }).click();
  await page.getByRole("button", { name: "Finalize..." }).click();
  await expect(page.getByText("Finalize Shortlist")).toBeVisible();
  await page.getByRole("button", { name: "Finalize & Update Stages" }).click();
  await expect(page.getByText("Shortlist Finalized")).toBeVisible();

  await page.goto(`/staff/candidates/${intake.candidate.id}`);
  await expect(page.getByText("Candidate details")).toBeVisible();
  await expect(page.getByText("Logistics Manager at Global Freight")).toBeVisible();
  await page.getByRole("link", { name: /^Applications \(/ }).click();
  await expect(page.getByText("Submitted answers")).toBeVisible();
  await expect(page.getByText("Salary expectation")).toBeVisible();
  await expect(page.getByText("18000", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Yes, with evidence from regional logistics operations.").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview CV" }).first().click();
  await expect(page.getByRole("dialog", { name: /Browser-Candidate\.pdf/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(/Opened by .* on/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Download original" }).first()).toBeVisible();
  await page.getByRole("link", { name: /^Interviews \(/ }).click();
  const templateName = await page.evaluate(async (suffix) => {
    const actor = {
      actor: {
        userId: "user-rana",
        employeeId: "employee-rana",
        displayName: "Rana Nair",
        workspaceEmail: "rana.nair@via-int.com",
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
  await expect(page.getByText("Candidate details")).toBeVisible();
  await page.getByRole("link", { name: /^Interviews \(/ }).click();
  await page.getByRole("button", { name: "Schedule Interview" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule Interview" });
  const templateSelect = dialog
    .getByText("Scorecard template (optional)", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await templateSelect.click();
  await page.getByRole("option", { name: templateName }).click();
  await dialog
    .getByText("Interview format", { exact: true })
    .locator("..")
    .getByRole("combobox")
    .click();
  await page.getByRole("option", { name: "In person" }).click();
  await dialog.getByPlaceholder("Office or meeting room").fill("VIA Head Office");
  const workingDaysText = await dialog.getByText(/^Working days:/).textContent();
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const allowedWeekdays = new Set(
    [...(workingDaysText ?? "").matchAll(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g)].map(([day]) =>
      weekdayNames.indexOf(day),
    ),
  );
  expect(allowedWeekdays.size).toBeGreaterThan(0);
  const interviewDate = new Date();
  interviewDate.setUTCDate(interviewDate.getUTCDate() + 1);
  while (!allowedWeekdays.has(interviewDate.getUTCDay())) {
    interviewDate.setUTCDate(interviewDate.getUTCDate() + 1);
  }
  await dialog.getByLabel("Date *").fill(interviewDate.toISOString().slice(0, 10));
  await dialog.getByLabel("Time *").fill("10:00");
  await dialog.getByRole("button", { name: "Schedule Interview" }).click();
  await page.getByRole("link", { name: /^Interviews \(/ }).click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

  const completion = await page.evaluate(
    async ({ email }) => {
      const actor = {
        actor: {
          userId: "user-rana",
          employeeId: "employee-rana",
          displayName: "Rana Nair",
          workspaceEmail: "rana.nair@via-int.com",
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
      const { listOfferManagersFn } = await import("/src/lib/server-functions/offer.server.ts");
      const approvalManagers = await listOfferManagersFn({
        data: {
          actor: {
            actorId: actor.actor.userId,
            actorEmail: actor.actor.workspaceEmail,
            activeRole: "HR",
          },
        },
      });
      const approvalManager = approvalManagers[0];
      if (!approvalManager) throw new Error("Seed an independent Line Manager for offer approval.");
      // Development identities use seed IDs; approval APIs return database UUIDs.
      const managerPreview = read<{ id: string; workspaceEmail: string }>("users").find(
        (user) => user.workspaceEmail === approvalManager.email,
      );
      if (!managerPreview) throw new Error("The assigned manager must have a preview identity.");
      const offer = await offers.saveOfferAsync(
        {
          candidateId: candidate.id,
          vacancyId: "log-ops-lead",
          template: "VIA Standard Employment Offer",
          position: "Operations Lead",
          grade: "G6",
          salary: 18000,
          approverUserId: approvalManager.id,
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
      return {
        candidateId: candidate.id,
        offerId: offer.id,
        approvalManagerId: managerPreview.id,
      };
    },
    { email: candidateEmail },
  );

  expect(completion.candidateId).toBeTruthy();
  await page.evaluate(
    (userId) =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId, activeRole: "Line Manager" }),
      ),
    completion.approvalManagerId,
  );
  await page.goto("/staff/offers");
  const assignedOffer = page.locator("article").filter({ hasText: candidateName });
  await expect(assignedOffer).toBeVisible();
  await assignedOffer.getByRole("textbox").fill("Reviewed and approved the proposed offer terms.");
  await assignedOffer.getByRole("button", { name: "Approve offer", exact: true }).click();
  await expect(assignedOffer).toHaveCount(0);
  await page.evaluate(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
    ),
  );
  await page.goto("/staff/offers");
  await page.evaluate(
    async ({ offerId, email }) => {
      const { OfferService } = await import("/src/lib/data/offer-service.ts");
      const { CandidateService } = await import("/src/lib/data/candidate-service.ts");
      const actor = {
        actor: {
          userId: "user-rana",
          employeeId: "employee-rana",
          displayName: "Rana Nair",
          workspaceEmail: "rana.nair@via-int.com",
          activeRole: "HR",
          roles: ["Employee", "HR"],
        },
      };
      await new CandidateService().hydrateCompatibilityCache(actor);
      const service = new OfferService();
      await service.transitionOfferAsync(offerId, "Ready to Send", undefined, actor);
      await service.transitionOfferAsync(offerId, "Sent", undefined, actor, {
        recipientEmail: email,
        sentAt: new Date().toISOString(),
        evidenceReference: `<browser-${offerId}@example.test>`,
        confirmed: true,
      });
      await service.transitionOfferAsync(
        offerId,
        "Accepted",
        "Accepted in browser journey",
        actor,
        undefined,
        { workspaceEmail: `hire.${offerId}@via-int.com`, identityConfirmed: true },
      );
    },
    { offerId: completion.offerId, email: candidateEmail },
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Offers", exact: true })).toBeVisible();
  const acceptedOffer = page.getByRole("row").filter({ hasText: candidateName });
  await expect(acceptedOffer).toBeVisible();
  await expect(acceptedOffer.getByText("Accepted", { exact: true })).toBeVisible();
  // Core HR navigation is collapsed while working in Recruitment.
  await page.goto("/staff/employees");
  await expect(page.getByText(candidateName, { exact: true }).first()).toBeVisible();
});
