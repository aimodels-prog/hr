import { expect, test, type Page } from "@playwright/test";

async function asRole(page: Page, userId: string, activeRole: string, path = "/staff") {
  await page.addInitScript(
    (identity) => {
      localStorage.setItem("via_hr:dev_preview_state", JSON.stringify(identity));
    },
    { userId, activeRole },
  );
  await page.goto(path);
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })).toBeVisible({
    timeout: 30000,
  });
}

test("HR navigation is grouped, searchable and has one home for each page", async ({ page }) => {
  await asRole(page, "user-rana", "HR");
  const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
  for (const group of [
    "My Workspace",
    "Approvals",
    "Employees",
    "Time & Leave",
    "Recruitment",
    "Performance & Training",
    "Documents",
    "HR Settings",
  ]) {
    await expect(nav.getByRole("button", { name: group, exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }
  await nav.getByRole("button", { name: "Recruitment", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Offers", exact: true })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Offer approvals", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search menu" }).fill("visa");
  await expect(nav.getByRole("link", { name: "Document Expiry", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Document Expiry", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search menu" })).toHaveValue("");
  await expect(nav.getByRole("button", { name: "Recruitment", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(nav.getByRole("button", { name: "Documents", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(nav.getByRole("navigation", { name: "Page sections" })).toBeVisible();
  await expect(page.locator("main").getByRole("navigation", { name: "Page sections" })).toHaveCount(
    0,
  );
  await page.screenshot({ path: test.info().outputPath("hr-navigation.png"), fullPage: true });
});

test("employee search never exposes HR, payroll or system controls", async ({ page }) => {
  await asRole(page, "user-omar", "Employee", "/staff/me/training");
  const search = page.getByRole("textbox", { name: "Search menu" });
  await search.fill("payroll");
  await expect(page.getByRole("status").filter({ hasText: "No matching pages." })).toBeVisible();
  await search.fill("My Payslips");
  await expect(page.getByRole("link", { name: "My Payslips", exact: true })).toBeVisible();
  await search.fill("audit");
  await expect(page.getByRole("status").filter({ hasText: "No matching pages." })).toBeVisible();
});

test("company setup sections use the main sidebar and preserve direct links", async ({ page }) => {
  await asRole(page, "user-super-admin", "Super Admin", "/staff/settings?section=departments");
  const sections = page.getByRole("navigation", { name: "Page sections", exact: true });
  await expect(sections.getByRole("link", { name: "Departments", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await sections.getByRole("link", { name: "Positions", exact: true }).click();
  await expect(page).toHaveURL(/section=positions/);
  await page.reload();
  await expect(sections.getByRole("link", { name: "Positions", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("main aside")).toHaveCount(0);
});

test("phone navigation closes after selecting a module or nested section", async ({ page }) => {
  await asRole(page, "user-rana", "HR", "/staff/leave-admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const sections = drawer.getByRole("navigation", { name: "Page sections", exact: true });
  const last = sections.getByRole("link").last();
  const destination = await last.getAttribute("href");
  await last.click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(destination!.replace(/[.*+?^$()|[\]\\]/g, "\\$&") + "$"));
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("textbox", { name: "Search menu" }).fill("directory");
  await drawer.getByRole("link", { name: "Employee Directory", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/staff\/employees(?:\?|$)/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
