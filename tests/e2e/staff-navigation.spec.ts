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
    "Employees",
    "Time & Leave",
    "Recruitment",
    "Performance & Training",
    "Documents",
    "Settings",
  ]) {
    await expect(nav.getByRole("button", { name: group, exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }
  await expect(nav.getByRole("link", { name: "Approvals", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "My Work", exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: "Recruitment", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Offers", exact: true })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Offer approvals", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search menu" }).fill("visa");
  await expect(nav.getByRole("link", { name: "Document Expiry", exact: true })).toBeVisible();
  await nav.getByRole("link", { name: "Document Expiry", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search menu" })).toHaveValue("");
  await expect(nav.getByRole("button", { name: "Recruitment", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
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

test("HR reports use the main menu and employee status filters are easy to find", async ({
  page,
}) => {
  await asRole(page, "user-rana", "HR", "/staff/reports");
  const sections = page.getByRole("navigation", { name: "Page sections", exact: true });
  await expect(sections).toBeVisible();
  await expect(sections.locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('main aside:not([aria-label="Page tip"])')).toHaveCount(0);
  const link = sections.getByRole("link").nth(1);
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
  const bookmarkedReport = await link.getAttribute("href");
  await expect(page).toHaveURL(new RegExp(`${bookmarkedReport}$`));
  await page.reload();
  await expect(sections.locator(`a[href="${bookmarkedReport}"]`)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/staff/employees?status=former");
  await expect(page.getByRole("heading", { name: "Manage Employees", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox").filter({ hasText: "Former employees" })).toBeVisible();
  await page.getByRole("combobox").filter({ hasText: "Former employees" }).click();
  await page.getByRole("option", { name: "Current employees", exact: true }).click();
  await expect(page).toHaveURL(/status=current/);
});

test("HR can open business settings without finance privileges", async ({ page }) => {
  await asRole(page, "user-rana", "HR", "/staff/settings?section=org");
  await expect(page.getByRole("heading", { name: "Company Setup", exact: true })).toBeVisible();
  const currency = page.getByLabel("Base Currency", { exact: true });
  await expect(currency).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Save Organisation Settings", exact: true }).click();
  await expect(page.getByText("Organisation settings updated", { exact: true })).toBeVisible();
  await page.goto("/staff/settings?section=data");
  await expect(page.getByText("Access Denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /backup|restore/i })).toHaveCount(0);
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

test("sidebar headings, pages and nested sections have distinct colours", async ({ page }) => {
  await asRole(page, "user-rana", "HR", "/staff/leave-admin");
  const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
  const heading = nav.getByRole("button", { name: "Time & Leave", exact: true });
  const ordinaryPage = nav.getByRole("link", { name: "Employee Timesheets", exact: true });
  const sections = nav.getByRole("navigation", { name: "Page sections", exact: true });
  const activeSection = sections.locator('a[aria-current="page"]');
  await expect(activeSection).toHaveCount(1);
  for (const dark of [false, true]) {
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle("dark", enabled),
      dark,
    );
    const theme = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.append(probe);
      probe.style.color = "var(--sidebar-heading)";
      const heading = getComputedStyle(probe).color;
      probe.style.color = "var(--sidebar-detail)";
      const section = getComputedStyle(probe).color;
      probe.remove();
      return { heading, section };
    });
    await expect(heading).toHaveCSS("color", theme.heading);
    await expect(activeSection).toHaveCSS("color", theme.section);
    const styles = await Promise.all(
      [heading, ordinaryPage, activeSection].map((element) =>
        element.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            colour: style.color,
            background: style.backgroundColor,
            weight: style.fontWeight,
          };
        }),
      ),
    );
    expect(new Set(styles.map((style) => style.colour)).size).toBe(3);
    expect(styles[0]!.background).not.toBe(styles[1]!.background);
    expect(styles[2]!.background).not.toBe(styles[1]!.background);
    expect(Number(styles[0]!.weight)).toBeGreaterThan(Number(styles[1]!.weight));
    await page.screenshot({
      path: test.info().outputPath(`sidebar-colours-${dark ? "dark" : "light"}.png`),
      animations: "disabled",
    });
  }
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
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(sections.getByRole("link", { name: "Positions", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Contextual tips are complementary content, not a second page sidebar.
  await expect(page.locator('main aside:not([aria-label="Page tip"])')).toHaveCount(0);
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
  await drawer.getByRole("link", { name: "Manage Employees", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/staff\/employees(?:\?|$)/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("HR can maintain a department and revisit the saved PostgreSQL record", async ({ page }) => {
  await asRole(page, "user-rana", "HR", "/staff/settings?section=departments");
  const sections = page.getByRole("navigation", { name: "Page sections", exact: true });
  await expect(sections.getByRole("link", { name: "Departments", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  for (const label of ["Cost centres", "Currencies", "Employee numbering", "Data management"]) {
    await expect(sections.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
  const name = `Navigation test ${Date.now()}`;
  await page.getByRole("button", { name: "Add Departments", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: /Save|Create/, exact: false }).click();
  await expect(dialog).toBeHidden();
  let row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill(`${name} updated`);
  await dialog.getByRole("button", { name: /Save|Update/, exact: false }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  row = page.getByRole("row").filter({ hasText: `${name} updated` });
  await expect(row).toBeVisible({ timeout: 30000 });
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expect(row.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(row.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
});

test("HR and employee workspaces have separate menus and working request views", async ({
  page,
}) => {
  await asRole(page, "user-rana", "HR", "/staff/requests");
  await expect(page.getByRole("heading", { name: "Approvals", exact: true })).toBeVisible();
  const sections = page.getByRole("navigation", { name: "Page sections", exact: true });
  await sections.getByRole("link", { name: "My requests", exact: true }).click();
  await expect(page).toHaveURL(/view=my/);
  await expect(page.getByRole("heading", { name: "My Requests", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My Requests", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "My employee workspace", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
  await expect(nav.getByRole("button", { name: "My Work", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "My Details", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Recruitment", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search menu" }).fill("upload passport");
  await nav.getByRole("link", { name: "My documents", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/me\/profile#section=documents$/);
  await expect(
    page.getByRole("heading", { name: "Digital Employee File", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await page.getByRole("button", { name: "HR workspace", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Employees", exact: true })).toBeVisible();
});

test("employee personal pages use nested sections and legacy work links still reach the right module", async ({
  page,
}) => {
  await asRole(page, "user-omar", "Employee", "/staff/me/profile#section=leave");
  await expect(page).toHaveURL(/\/staff\/me\/leave-balances(?:\?|$)/);
  await page.goto("/staff/me/training");
  const sections = page.getByRole("navigation", { name: "Page sections", exact: true });
  await expect(sections).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.locator('main aside:not([aria-label="Page tip"])')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  const drawer = page.getByRole("dialog");
  await drawer
    .getByRole("navigation", { name: "Page sections", exact: true })
    .getByRole("link")
    .last()
    .click();
  await expect(drawer).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("employee-phone.png"), fullPage: true });
});
