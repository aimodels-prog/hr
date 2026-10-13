import { expect, test } from "@playwright/test";

test("careers links use readable references and keep old job links usable", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/public/vacancies");
  expect(response.ok()).toBeTruthy();
  const vacancies = (await response.json()) as Array<{
    id: string;
    publicSlug: string;
    title: string;
  }>;
  expect(vacancies.length).toBeGreaterThan(0);
  const vacancy = vacancies[0]!;
  expect(vacancy.publicSlug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  await page.goto("/");
  const link = page.locator(`a[href="/jobs/${vacancy.publicSlug}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${vacancy.publicSlug}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: vacancy.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Apply for this position", exact: true }),
  ).toBeVisible();
  await page.locator('input[name="firstName"]').fill("Readable link applicant");
  // No title-based application IDs and no production application is submitted here.
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  const desktopPicker = page.waitForEvent("filechooser");
  await page.getByLabel("Upload resume or CV").click();
  await (
    await desktopPicker
  ).setFiles({
    name: "applicant-cv.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(page.getByText("applicant-cv.pdf")).toBeVisible();
  await page.locator('input[name="lastName"]').fill("Test");
  await page.locator('input[name="email"]').fill("applicant@example.com");
  await page.locator('input[name="phone"]').fill("+968 9000 0000");
  await page.locator('input[name="location"]').fill("Muscat");
  await page.locator('input[name="yearsOfExperience"]').fill("15");
  await page.locator('input[name="noticePeriod"]').fill("30 days");
  const screeningAnswers = page.locator('textarea[name^="screeningAnswers."]');
  for (let index = 0; index < (await screeningAnswers.count()); index += 1) {
    await screeningAnswers.nth(index).fill("Relevant experience");
  }
  await page.getByRole("checkbox").check();
  await page.route("**/api/public/applications", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ referenceId: "APP-26-TEST1234" }),
    }),
  );
  const applicationRequest = page.waitForRequest("**/api/public/applications");
  await page.getByRole("button", { name: "Submit Application" }).click();
  const submittedApplication = (await applicationRequest).postDataJSON() as {
    fileName: string;
    fileBase64: string;
  };
  expect(submittedApplication.fileName).toBe("applicant-cv.pdf");
  expect(submittedApplication.fileBase64).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Application received" })).toBeVisible();

  await page.goto(`/jobs/${vacancy.id}?source=shared#application`);
  await expect(page).toHaveURL(
    new RegExp(`/jobs/${vacancy.publicSlug}\\?source=shared#application$`),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: vacancy.title, exact: true }),
  ).toBeVisible();
  await page.goto(`/jobs/${vacancy.publicSlug}`);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Apply for this position", exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/jobs/${vacancy.publicSlug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: vacancy.title, exact: true }),
  ).toBeVisible();
  const mobilePicker = page.waitForEvent("filechooser");
  await page.getByLabel("Upload resume or CV").click();
  await (
    await mobilePicker
  ).setFiles({
    name: "mobile-applicant-cv.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(page.getByText("mobile-applicant-cv.pdf")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  // Every published vacancy uses the same application path. Exercise the whole form for
  // additional roles too, including any role-specific screening questions added later.
  await page.setViewportSize({ width: 1280, height: 844 });
  for (const otherVacancy of vacancies.slice(1)) {
    await page.goto(`/jobs/${otherVacancy.publicSlug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: otherVacancy.title, exact: true }),
    ).toBeVisible();
    const picker = page.waitForEvent("filechooser");
    await page.getByLabel("Upload resume or CV").click();
    await (
      await picker
    ).setFiles({
      name: "future-role-cv.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await page.locator('input[name="firstName"]').fill("Future");
    await page.locator('input[name="lastName"]').fill("Applicant");
    await page.locator('input[name="email"]').fill("future.applicant@example.com");
    await page.locator('input[name="phone"]').fill("+968 9000 0001");
    await page.locator('input[name="location"]').fill("Muscat");
    await page.locator('input[name="yearsOfExperience"]').fill("10");
    await page.locator('input[name="noticePeriod"]').fill("30 days");
    const questions = page.locator('textarea[name^="screeningAnswers."]');
    for (let index = 0; index < (await questions.count()); index += 1) {
      await questions.nth(index).fill("Relevant experience");
    }
    await page.getByRole("checkbox").check();
    const requestForVacancy = page.waitForRequest("**/api/public/applications");
    await page.getByRole("button", { name: "Submit Application" }).click();
    const payload = (await requestForVacancy).postDataJSON() as {
      vacancyId: string;
      fileName: string;
      fileBase64: string;
    };
    expect(payload.vacancyId).toBe(otherVacancy.id);
    expect(payload.fileName).toBe("future-role-cv.pdf");
    expect(payload.fileBase64).toBeTruthy();
    await expect(page.getByRole("heading", { name: "Application received" })).toBeVisible();
  }

  await page.goto("/jobs/not-a-published-role");
  await expect(
    page.getByRole("heading", { name: "This position is no longer available" }),
  ).toBeVisible();
  await page.goto("/jobs/applied?ref=APP-26-TEST1234");
  await expect(
    page.getByRole("heading", { name: "Application received", exact: true }),
  ).toBeVisible();
});
