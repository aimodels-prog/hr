import { expect, test, type Page } from "@playwright/test";

type PreviewRole = "Employee" | "HR" | "Accounts" | "Super Admin";

async function previewAs(page: Page, userId: string, activeRole: PreviewRole) {
  await page.evaluate(
    ({ selectedUser, selectedRole }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: selectedUser, activeRole: selectedRole }),
      );
    },
    { selectedUser: userId, selectedRole: activeRole },
  );
  await page.goto("/staff/reports");
  await expect(page.getByText("Loading your VIA profile and permissions")).toHaveCount(0, {
    timeout: 30_000,
  });
}

test("reports are role scoped and loaded from PostgreSQL", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();

  await previewAs(page, "user-omar", "Employee");
  await expect(page.getByText("You do not have permission to view Reports.")).toBeVisible();

  await previewAs(page, "user-rana", "HR");
  await expect(page.getByRole("heading", { name: "Reports Centre" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Headcount & Diversity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Payroll Inputs Summary" })).toHaveCount(0);
  await page.getByRole("button", { name: "Headcount & Diversity" }).click();
  await expect(page.getByText("Report unavailable")).toHaveCount(0);
  await expect(page.getByText("Matching Records")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Base Salary" })).toHaveCount(0);

  await previewAs(page, "user-mariam", "Accounts");
  await expect(page.getByRole("button", { name: "Travel Variance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Payroll Inputs Summary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Headcount & Diversity" })).toHaveCount(0);

  await previewAs(page, "user-super-admin", "Super Admin");
  await page.getByRole("button", { name: "Payroll Inputs Summary" }).click();
  await expect(page.getByText("Report unavailable")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Payroll Period" })).toBeVisible();
});
