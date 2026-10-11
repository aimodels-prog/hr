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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto("/jobs/not-a-published-role");
  await expect(
    page.getByRole("heading", { name: "This position is no longer available" }),
  ).toBeVisible();
  await page.goto("/jobs/applied?ref=APP-26-TEST1234");
  await expect(
    page.getByRole("heading", { name: "Application received", exact: true }),
  ).toBeVisible();
});
