import { expect, test } from "@playwright/test";

test("HR returns and reassigns equipment on mobile while preserving the employee history", async ({
  page,
}) => {
  const tag = `REUSE-${Date.now()}`;
  await page.addInitScript(() => {
    if (!localStorage.getItem("via_hr:dev_preview_state")) {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
      );
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/employees/employee-omar#equipment");
  const assignButton = page.getByRole("button", { name: "Assign Asset", exact: true });
  await expect(assignButton).toBeEnabled({ timeout: 30000 });
  await assignButton.click();
  const dialog = page.getByRole("dialog", { name: "Assign Equipment", exact: true });
  await dialog.getByLabel("Description", { exact: true }).fill("Reusable test laptop");
  await dialog.getByLabel("Asset Tag / Serial Number").fill(tag);
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole("row").filter({ hasText: tag });
  await expect(row).toContainText("Assigned");
  await row.getByRole("button", { name: "Return", exact: true }).click();
  const returnDialog = page.getByRole("dialog", { name: "Record Asset Return", exact: true });
  await returnDialog.getByLabel("Notes", { exact: true }).fill("Returned in working order");
  await returnDialog.getByRole("button", { name: "Confirm Return", exact: true }).click();
  await expect(returnDialog).toBeHidden();
  await expect(row).toContainText("Returned");
  await expect(row).toContainText("Good");

  await page.goto("/staff/employees/employee-tariq#equipment");
  await expect(assignButton).toBeEnabled({ timeout: 30000 });
  await assignButton.click();
  const picker = dialog.getByLabel("Equipment", { exact: true });
  const option = picker.locator("option").filter({ hasText: tag });
  await expect(option).toHaveCount(1);
  await picker.selectOption((await option.getAttribute("value"))!);
  await expect(dialog).toContainText("Laptop · Good");
  await expect(dialog.getByLabel("Asset Tag / Serial Number")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Assigned");
  await assignButton.click();
  await expect(dialog.getByText("Loading available equipment…")).toBeHidden();
  await expect(picker.locator("option").filter({ hasText: tag })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();

  await page.goto("/staff/employees/employee-omar#equipment");
  await expect(row).toContainText("Returned");
  await expect(row.getByRole("button", { name: "Return", exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-omar", activeRole: "Employee" }),
    ),
  );
  await page.reload();
  await expect(row).toContainText("Returned");
  await expect(assignButton).toHaveCount(0);
  await expect(row).toHaveCount(1);
});
