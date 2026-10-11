import { expect, test } from "@playwright/test";

const emptyMessage = "There are no published positions at present.";
const noMatchesMessage = "No positions match your search.";

test("server-rendered careers page never claims the unloaded list is empty", async ({
  request,
}) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain('aria-label="Loading open positions"');
  expect(html).not.toContain(emptyMessage);
  expect(html).not.toContain("0 positions currently available");
});

test("a slow openings request shows placeholders, then vacancies, without an empty-state flash", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/public/vacancies");
  expect(response.ok()).toBeTruthy();
  const vacancies = (await response.json()) as Array<{ title: string; publicSlug: string }>;
  expect(vacancies.length).toBeGreaterThan(0);
  let releaseResponse!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/public/vacancies", async (route) => {
    await pending;
    await route.fulfill({ json: vacancies });
  });
  try {
    const requestStarted = page.waitForRequest("**/api/public/vacancies");
    await page.goto("/#openings", { waitUntil: "domcontentloaded" });
    await requestStarted;
    const loading = page.getByRole("status", { name: "Loading open positions" });
    await expect(loading).toBeVisible();
    await expect(page.getByText(emptyMessage, { exact: true })).toHaveCount(0);
    await expect(page.getByText("0 positions currently available", { exact: true })).toHaveCount(0);
    await expect(page.getByText(noMatchesMessage, { exact: true })).toHaveCount(0);
    releaseResponse();
    await expect(page.locator(`a[href="/jobs/${vacancies[0]!.publicSlug}"]`)).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expect(page.getByText(emptyMessage, { exact: true })).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Search open positions" })
      .fill("no-matching-vacancy-xyz");
    await expect(page.getByText(noMatchesMessage, { exact: true })).toBeVisible();
    await expect(page.getByText(emptyMessage, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
    await expect(page.locator(`a[href="/jobs/${vacancies[0]!.publicSlug}"]`)).toBeVisible();
  } finally {
    releaseResponse();
  }
});

test("only a successfully loaded empty list shows no published positions", async ({ page }) => {
  await page.route("**/api/public/vacancies", (route) => route.fulfill({ json: [] }));
  await page.goto("/#openings");
  await expect(page.getByText(emptyMessage, { exact: true })).toBeVisible();
  await expect(page.getByText("0 positions currently available", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading open positions" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a failed request offers a retry instead of claiming there are no vacancies", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/public/vacancies");
  expect(response.ok()).toBeTruthy();
  const vacancies = (await response.json()) as Array<{ publicSlug: string }>;
  expect(vacancies.length).toBeGreaterThan(0);
  let attempts = 0;
  let releaseRetry!: () => void;
  const retryPending = new Promise<void>((resolve) => {
    releaseRetry = resolve;
  });
  await page.route("**/api/public/vacancies", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
    } else {
      await retryPending;
      await route.fulfill({ json: vacancies });
    }
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#openings");
    await expect(page.getByRole("alert")).toContainText("Positions could not be loaded.");
    await expect(page.getByText(emptyMessage, { exact: true })).toHaveCount(0);
    await expect(page.getByText("0 positions currently available", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("status", { name: "Loading open positions" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(emptyMessage, { exact: true })).toHaveCount(0);
    releaseRetry();
    await expect(page.locator(`a[href="/jobs/${vacancies[0]!.publicSlug}"]`)).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading open positions" })).toHaveCount(0);
    expect(attempts).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    releaseRetry();
  }
});
