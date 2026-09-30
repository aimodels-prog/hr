import { expect, test, type Page } from "@playwright/test";

test("help guide: real form images enlarge on mobile and Finance gets its own first steps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await helpAs(page, "Employee", "/staff/help?article=leave");
  const picture = page.locator('img[src="/help/request-leave.png"]').first();
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: /Enlarge screen example/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await helpAs(page, "Accounts", "/staff/help");
  await expect(
    page.getByRole("heading", { name: "Finance and employee help", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Upload or replace an employee payslip/ })
    .first()
    .click();
  await expect(page.locator('img[src="/help/finance-payslip.png"]').first()).toBeVisible();
  await helpAs(page, "HR", "/staff/help?guide=hr&article=hr-payslip");
  await expect(page.locator('img[src="/help/finance-payslip.png"]')).toHaveCount(0);
});

async function helpAs(page: Page, role: "Employee" | "HR" | "Accounts", path: string) {
  await page.goto("/staff/help");
  await expect(page.getByRole("heading", { name: "Help & Knowledge", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(
    ({ role, id }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: id, activeRole: role }),
      );
    },
    { role, id: role === "HR" ? "user-rana" : role === "Accounts" ? "user-mariam" : "user-omar" },
  );
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Help & Knowledge", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test("help guide: employee search, bookmarked article and history", async ({ page }) => {
  await helpAs(page, "Employee", "/staff/help");
  await expect(page.getByLabel("Choose your guide")).toHaveCount(0);
  await page.getByLabel("Search help articles").fill("forgot clock out");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: /Forgot to clock out yesterday/ }).click();
  await expect(
    page.getByRole("heading", { name: "Forgot to clock out yesterday?", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Step by step", exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Forgot to clock out yesterday?", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Results for “forgot clock out”" })).toBeVisible();
  await page.getByLabel("Search help articles").fill("unfindablezzzz");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let’s try another search" })).toBeVisible();
});

test("help guide: employee cannot open HR guide through a direct link", async ({ page }) => {
  await helpAs(page, "Employee", "/staff/help?guide=hr&article=setup-departments");
  await expect(page.getByRole("heading", { name: "Employee help", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add departments", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Choose your guide")).toHaveCount(0);
});

test("help guide: HR cannot search or open Finance instructions", async ({ page }) => {
  await helpAs(page, "HR", "/staff/help?guide=hr&article=hr-finance");
  await expect(
    page.getByText("This article is not available in your selected guide.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Prepare, approve and export a payroll period" }),
  ).toHaveCount(0);
  await page.getByLabel("Search help articles").fill("payroll");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: /Prepare, approve and export|Upload or replace an employee payslip|Use the approved overtime ledger/,
    }),
  ).toHaveCount(0);
  await page.goto("/staff/help?guide=hr&article=payslips");
  await expect(
    page.getByRole("heading", { name: "View or download your payslip", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
});

test("help guide: HR gets employee help and protected setup instructions on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await helpAs(page, "HR", "/staff/help?guide=hr");
  await expect(page.getByRole("heading", { name: "HR and employee help" })).toBeVisible();
  await page.getByLabel("Search help articles").fill("add departments");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: /Add departments/ }).click();
  await expect(page.getByRole("heading", { name: "Add departments", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in VIA HR" })).toHaveCount(0);
  await expect(
    page.getByText("The responsible role must open this page.", { exact: false }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "playwright-report/help-mobile.png", fullPage: true });
  await page.getByLabel("Choose your guide").selectOption("employee");
  await expect(page.getByRole("heading", { name: "Employee help", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Choose your guide").selectOption("hr");
  await expect(page.getByRole("heading", { name: "HR and employee help" })).toBeVisible();
  await page.screenshot({ path: "playwright-report/help-desktop.png", fullPage: true });
});
