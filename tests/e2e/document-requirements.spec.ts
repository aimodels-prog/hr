import { test, expect } from "@playwright/test";

test("HR document editor and employee upload forms adapt on mobile", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
    ),
  );
  await page.goto("/staff/settings?section=documentRequirements");
  await expect(page.getByRole("button", { name: "Save requirements", exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await page.getByRole("button", { name: "Education Degree", exact: true }).click();
  await expect(page.getByLabel("Field label", { exact: true }).first()).toHaveValue(
    "Degree / qualification",
  );
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page.getByLabel("Document name", { exact: true }).fill("Test licence");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await page.getByLabel("Field label", { exact: true }).fill("Licence details");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath("document-requirements-mobile.png"),
    fullPage: true,
  });
});

test("employee sees only document-specific fields and cannot set visibility", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-omar", activeRole: "Employee" }),
    ),
  );
  await page.goto("/staff/me/profile#documents");
  await expect(page.getByRole("button", { name: "Upload Document", exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText("Loading employee documents...")).toHaveCount(0);
  await page.getByRole("button", { name: "Upload Document", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Education Degree", exact: true }).click();
  await expect(dialog.getByLabel("Degree / qualification", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Institution", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Graduation year", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Visibility", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Issuing Authority", { exact: true })).toHaveCount(0);
  await dialog.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "Updated CV", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(dialog.getByLabel("Degree / qualification", { exact: false })).toHaveCount(0);
  await expect(dialog.getByLabel("Expiry date", { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("cv-upload-mobile.png") });
});
