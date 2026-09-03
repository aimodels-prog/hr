import { expect, test, type Page } from "@playwright/test";

type PreviewRole = "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin";

async function previewAs(page: Page, userId: string, activeRole: PreviewRole, path: string) {
  await page.evaluate(
    ({ selectedUser, selectedRole }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: selectedUser, activeRole: selectedRole }),
      );
    },
    { selectedUser: userId, selectedRole: activeRole },
  );
  await page.goto(path);
  await expect(page.getByText("Loading your VIA profile and permissions")).toHaveCount(0, {
    timeout: 30_000,
  });
}

test("sensitive direct URLs enforce the active VIA role", async ({ page }) => {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();

  const denied: Array<{
    userId: string;
    role: PreviewRole;
    path: string;
    resource: string;
  }> = [
    {
      userId: "user-omar",
      role: "Employee",
      path: "/staff/users",
      resource: "User Management",
    },
    {
      userId: "user-omar",
      role: "Employee",
      path: "/staff/candidates",
      resource: "Candidate Database & Scoring",
    },
    {
      userId: "user-layla",
      role: "Line Manager",
      path: "/staff/audit",
      resource: "Audit History",
    },
    {
      userId: "user-rana",
      role: "HR",
      path: "/staff/payroll/overtime",
      resource: "Overtime Payroll Ledger",
    },
    {
      userId: "user-mariam",
      role: "Accounts",
      path: "/staff/leave-admin",
      resource: "Leave Administration",
    },
  ];

  for (const example of denied) {
    await previewAs(page, example.userId, example.role, example.path);
    await expect(
      page.getByText(`You do not have permission to view ${example.resource}.`),
    ).toBeVisible();
  }

  await previewAs(page, "user-super-admin", "Super Admin", "/staff/users");
  await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
});

test("employee essentials remain usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff");
  await previewAs(page, "user-omar", "Employee", "/staff");

  const routes = [
    { path: "/staff", landmark: /Welcome back/i },
    { path: "/staff/me/profile", landmark: "Omar Rahman" },
    { path: "/staff/my-tasks", landmark: "My Tasks" },
    { path: "/staff/me/leave-balances", landmark: "My Leave" },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByText(route.landmark, { exact: typeof route.landmark === "string" }).last(),
    ).toBeVisible({
      timeout: 30_000,
    });
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      unnamedButtons: [...document.querySelectorAll("button")].filter((button) => {
        const text = button.textContent?.trim();
        return !text && !button.getAttribute("aria-label") && !button.getAttribute("title");
      }).length,
    }));
    expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
    expect(viewport.unnamedButtons).toBe(0);
  }

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).not.toHaveCount(0);
});

test("HR recruitment detail routes wait for the hydrated preview identity", async ({ page }) => {
  await page.goto("/staff");

  await previewAs(page, "user-rana", "HR", "/staff/recommendations");
  await expect(page.getByRole("heading", { name: "Recommendations & Sources" })).toBeVisible();

  await page.goto("/staff/vacancies/log-ops-lead");
  await expect(page.getByText("Logistics Operations Lead", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });

  await page.goto("/staff/recommendations/not-found%40example.test");
  await expect(page.getByText("Recommendation source not found", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("staff bootstrap recovers from one interrupted organisation-data request", async ({
  page,
}) => {
  let interrupted = false;
  await page.route("**/_serverFn/**", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await page.goto("/staff");
  await expect(page.getByText(/Welcome back/i)).toBeVisible({ timeout: 30_000 });
  expect(interrupted).toBe(true);
  await expect(page.getByText("Organisation data is unavailable", { exact: true })).toHaveCount(0);
});
