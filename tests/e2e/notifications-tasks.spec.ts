import { expect, test, type Page } from "@playwright/test";

type PreviewRole = "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin";

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
  await page.goto("/staff/my-tasks");
  await expect(page.getByRole("heading", { name: "My Tasks" })).toBeVisible();
  await expect(page.getByText("Tasks could not be loaded")).toHaveCount(0);
}

test("PostgreSQL task inbox and notifications load for every VIA role", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();

  await previewAs(page, "user-omar", "Employee");
  await expect(page.getByPlaceholder("Search my tasks")).toBeVisible();

  for (const [userId, role] of [
    ["user-layla", "Line Manager"],
    ["user-rana", "HR"],
    ["user-mariam", "Accounts"],
    ["user-super-admin", "Super Admin"],
  ] as const) {
    await previewAs(page, userId, role);
    await expect(page.getByPlaceholder("Search tasks or employee names")).toBeVisible();
  }

  await page.getByRole("button", { name: "Open notifications" }).click();
  await expect(page.getByText("Loading notifications…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
});
