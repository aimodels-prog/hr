import { expect, test, type Page } from "@playwright/test";

type PreviewRole = "Employee" | "Line Manager" | "HR" | "Super Admin";

async function previewAs(page: Page, userId: string, activeRole: PreviewRole, path: string) {
  await page.evaluate(
    ({ userId: selectedUserId, activeRole: selectedRole }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: selectedUserId, activeRole: selectedRole }),
      );
    },
    { userId, activeRole },
  );
  await page.goto(path);
}

test("objectives, appraisal, acknowledgement and certification complete across roles", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString().slice(-6);
  const cycleName = `Browser Annual Review ${suffix}`;
  const firstObjective = `Improve shipment accuracy ${suffix}`;
  const secondObjective = `Improve customer updates ${suffix}`;
  const certificateTitle = `Browser Safety Certificate ${suffix}`;

  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  await expect(page.getByText("VIA HR System").first()).toBeVisible();

  const reviewId = await page.evaluate(
    async ({ cycleName, firstObjective, secondObjective }) => {
      const { initializeApplicationData } = await import("/src/lib/data/application-data.ts");
      const { PerformanceService } = await import("/src/lib/data/performance-service.ts");
      const { GoalService } = await import("/src/lib/data/goal-service.ts");
      const { MasterDataService } = await import("/src/lib/data/master-data.ts");
      const { EmployeeService } = await import("/src/lib/data/employee-service.ts");
      initializeApplicationData();
      const hr = {
        actor: {
          userId: "user-rana",
          employeeId: "employee-rana",
          displayName: "Rana Nair",
          workspaceEmail: "rana.nair@via.example",
          activeRole: "HR" as const,
          roles: ["Employee" as const, "HR" as const],
        },
      };
      const employee = {
        actor: {
          userId: "user-omar",
          employeeId: "employee-omar",
          displayName: "Omar Rahman",
          workspaceEmail: "omar.rahman@via.example",
          activeRole: "Employee" as const,
          roles: ["Employee" as const],
        },
      };
      const manager = {
        actor: {
          userId: "user-layla",
          employeeId: "employee-layla",
          displayName: "Layla Al Harthy",
          workspaceEmail: "layla.harthy@via.example",
          activeRole: "Line Manager" as const,
          roles: ["Employee" as const, "Line Manager" as const],
        },
      };
      await new EmployeeService().hydrateCompatibilityCache(hr);
      const masterData = new MasterDataService();
      await masterData.hydrateCompatibilityCache();
      const performance = new PerformanceService();
      await performance.hydrateCompatibilityCache(hr);
      const template = performance.getTemplates(hr)[0]!;
      const department = masterData
        .list("departments", false)
        .find((item) => item.name === "Operations")!;
      const cycles = await performance.createCycleAsync(
        {
          name: cycleName,
          templateId: template.id,
          status: "Active",
          departments: [department.id],
          employmentTypes: [],
          objectiveSettingDeadline: "2026-09-30",
          selfAssessmentDeadline: "2026-10-31",
          managerReviewDeadline: "2026-11-30",
          discussionDeadline: "2026-12-20",
          requiresModeration: true,
          employeeCanSeeManagerRatings: true,
        },
        hr,
      );
      const cycle = cycles.find((item) => item.name === cycleName)!;
      const goals = new GoalService();
      const goalOne = (
        await goals.createGoalAsync(
          {
            employeeId: "employee-omar",
            cycleId: cycle.id,
            title: firstObjective,
            description: "Reduce preventable processing errors in assigned shipments.",
            successMeasure: "Monthly shipment audit",
            targetValue: "At least 98% accuracy",
            startDate: "2026-09-01",
            dueDate: "2026-10-15",
            weight: 60,
          },
          employee,
        )
      ).find((item) => item.title === firstObjective)!;
      const goalTwo = (
        await goals.createGoalAsync(
          {
            employeeId: "employee-omar",
            cycleId: cycle.id,
            title: secondObjective,
            description: "Provide accurate milestone updates to assigned customers.",
            successMeasure: "Updates delivered on schedule",
            targetValue: "At least 96% on-time updates",
            startDate: "2026-09-01",
            dueDate: "2026-10-15",
            weight: 40,
          },
          employee,
        )
      ).find((item) => item.title === secondObjective)!;
      await goals.submitCycleGoalsForApprovalAsync("employee-omar", cycle.id, employee);
      await goals.decideGoalAsync(goalOne.id, "approve", undefined, manager);
      await goals.decideGoalAsync(goalTwo.id, "approve", undefined, manager);
      return performance
        .getReviewsForEmployee("employee-omar", employee)
        .find((review) => review.cycleId === cycle.id)!.id;
    },
    { cycleName, firstObjective, secondObjective },
  );

  await previewAs(page, "user-omar", "Employee", "/staff/me/performance");
  await expect(page.getByRole("tab", { name: "Objectives" })).toBeVisible();
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: cycleName, exact: true }).click();
  await expect(page.getByText(firstObjective, { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Reviews" }).click();
  await expect(page.getByText(cycleName, { exact: true })).toBeVisible();
  await page
    .getByRole("row", { name: new RegExp(cycleName) })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  const selfRatings = page.locator('input[type="number"]:not([disabled])');
  const selfComments = page.locator("textarea:not([disabled])");
  await expect(selfRatings.first()).toBeVisible();
  for (let index = 0; index < (await selfRatings.count()); index += 1)
    await selfRatings.nth(index).fill("4");
  for (let index = 0; index < (await selfComments.count()); index += 1)
    await selfComments
      .nth(index)
      .fill("Delivered the expected result with clear supporting evidence.");
  await page.getByRole("button", { name: "Submit self-assessment" }).click();
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Self-assessment sent to your supervisor",
  );
  await expect(page.getByText("Manager Review Pending", { exact: true })).toBeVisible();

  await previewAs(page, "user-layla", "Line Manager", "/staff/performance/team");
  await page.getByRole("tab", { name: "Performance reviews" }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Omar" })
    .filter({ hasText: cycleName })
    .getByRole("button", { name: "Open" })
    .click();
  const managerRatings = page.locator('input[type="number"]:not([disabled])');
  const managerComments = page.locator(
    'textarea[placeholder="Give specific, constructive feedback"]:not([disabled])',
  );
  await expect(managerRatings.first()).toBeVisible();
  for (let index = 0; index < (await managerRatings.count()); index += 1)
    await managerRatings.nth(index).fill("4");
  for (let index = 0; index < (await managerComments.count()); index += 1)
    await managerComments
      .nth(index)
      .fill("Consistent delivery supported by specific work results.");
  await page
    .getByPlaceholder("Summarise performance, strengths and priorities")
    .fill("Omar delivered consistently and supported team priorities throughout the period.");
  await page
    .getByPlaceholder("Record development actions, support and expected timing")
    .fill("Complete advanced operations training and lead one improvement project next quarter.");
  await page.getByRole("button", { name: "Submit supervisor assessment" }).click();
  await expect(page.getByText("Moderation Pending", { exact: true })).toBeVisible();

  await previewAs(page, "user-rana", "HR", "/staff/performance/cycles");
  await page
    .getByRole("row", { name: new RegExp(cycleName) })
    .getByRole("button", { name: "Open review" })
    .click();
  await page
    .getByPlaceholder("Moderation outcome and any calibration decision")
    .fill("Ratings are consistent with the evidence and with comparable roles.");
  await page.getByRole("button", { name: "Complete moderation" }).click();
  await expect(page.getByText("Discussion Pending", { exact: true })).toBeVisible();

  await previewAs(page, "user-layla", "Line Manager", `/staff/performance/reviews/${reviewId}`);
  await page.getByLabel("Discussion date").fill("2026-08-29");
  await page
    .getByLabel("Discussion notes")
    .fill("Discussed achievements, expectations and the agreed development priorities.");
  await page.getByRole("button", { name: "Record discussion" }).click();
  await expect(page.getByText("Acknowledgement Pending", { exact: true })).toBeVisible();

  await previewAs(page, "user-omar", "Employee", `/staff/performance/reviews/${reviewId}`);
  await page.getByText("I do not agree with the review").click();
  await page
    .getByPlaceholder("Explain your concern")
    .fill("I acknowledge receipt but would like one rating discussed again.");
  await page.getByRole("button", { name: "Submit acknowledgement" }).click();
  await expect(page.getByText("Acknowledged", { exact: true }).first()).toBeVisible();

  await previewAs(page, "user-rana", "HR", "/staff/performance/cycles");
  await page
    .getByRole("row", { name: new RegExp(cycleName) })
    .getByRole("button", { name: "Open review" })
    .click();
  await page.getByRole("button", { name: "Finalise and lock" }).click();
  await expect(page.getByText("Locked", { exact: true }).first()).toBeVisible();

  await previewAs(page, "user-omar", "Employee", "/staff/me/training");
  await page.getByRole("tab", { name: "Certifications" }).click();
  await page.getByRole("button", { name: "Add certification" }).click();
  await page.getByLabel("Training title").fill(certificateTitle);
  await page.getByLabel("Provider or institution").fill("VIA Academy");
  await page.getByLabel("Completion date").fill("2026-08-20");
  await page.getByLabel(/Certificate \(PDF/).setInputFiles({
    name: "certificate.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\ncertificate evidence"),
  });
  await page.getByRole("button", { name: "Save certification" }).click();
  await expect(page.getByText(certificateTitle, { exact: true })).toBeVisible();

  await previewAs(page, "user-rana", "HR", "/staff/training");
  await page.getByRole("tab", { name: "Certificates" }).click();
  await expect(page.getByText(certificateTitle, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
});

test("Team Performance and Training Records open for every intended role", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  await previewAs(page, "user-rana", "HR", "/staff/performance/team");
  await expect(page.getByRole("heading", { name: "Team Performance" })).toBeVisible();
  await expect(page.getByText("This page didn't load.")).toHaveCount(0);

  await previewAs(page, "user-super-admin", "Super Admin", "/staff/performance/team");
  await expect(page.getByRole("heading", { name: "Team Performance" })).toBeVisible();
  await expect(page.getByText("This page didn't load.")).toHaveCount(0);

  await previewAs(page, "user-layla", "Line Manager", "/staff/training");
  await expect(page.getByRole("heading", { name: "Team Training" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign training" })).toBeVisible();
});
