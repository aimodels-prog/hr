import { expect, test, type Page } from "@playwright/test";

async function previewAs(page: Page, userId: string, activeRole: "Employee" | "Super Admin") {
  await page.evaluate(
    ({ selectedUser, selectedRole }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: selectedUser, activeRole: selectedRole }),
      );
    },
    { selectedUser: userId, selectedRole: activeRole },
  );
  await page.goto("/staff/audit");
  await expect(page.getByText("Loading your VIA profile and permissions")).toHaveCount(0, {
    timeout: 30_000,
  });
}

test("audit history is PostgreSQL-backed, restricted and server exported", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();

  await previewAs(page, "user-omar", "Employee");
  await expect(page.getByText("You do not have permission to view Audit History.")).toBeVisible();

  await previewAs(page, "user-super-admin", "Super Admin");
  await expect(page.getByRole("heading", { name: "Audit History" })).toBeVisible();
  await expect(page.getByText("Audit history unavailable")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Loading activity…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Recorded activity")).toBeVisible();
  await expect(page.getByLabel("Filter by person")).toBeVisible();
  await expect(page.getByLabel("Filter by role")).toBeVisible();
  await expect(page.getByLabel("Filter by area")).toBeVisible();
  await expect(page.getByLabel("Filter by recorded action")).toBeVisible();
  await expect(page.getByLabel("Filter by record type")).toBeVisible();
  await expect(page.getByLabel("Filter by attention level")).toBeVisible();

  await page.getByRole("button", { name: "Export CSV" }).click();
  await expect(page.getByText("Download the complete audit history?")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^via-audit-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(page.getByText(/audit records downloaded/i)).toBeVisible();
});
