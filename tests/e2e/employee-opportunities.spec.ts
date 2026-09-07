import { expect, test } from "@playwright/test";

test("an employee applies and recommends someone from the staff dashboard", async ({ page }) => {
  const unique = Date.now().toString();
  await page.goto("/staff");
  await page.evaluate(() => {
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-omar", activeRole: "Employee" }),
    );
  });
  await page.goto("/staff");
  await expect(page.getByText("Loading your VIA profile and permissions")).toHaveCount(0, {
    timeout: 30_000,
  });

  await page.getByRole("link", { name: /Apply for a position/ }).click();
  const applicationDialog = page.getByRole("dialog", { name: "Apply for a position" });
  await expect(applicationDialog).toBeVisible();
  await applicationDialog.getByRole("combobox").click();
  await page.getByRole("option").first().click();
  await applicationDialog
    .getByLabel("Availability or notice period")
    .fill("Available after four weeks");
  const applicationTextareas = applicationDialog.locator("textarea");
  for (let index = 0; index < (await applicationTextareas.count()); index += 1) {
    await applicationTextareas
      .nth(index)
      .fill("I have relevant VIA experience and would like to be considered for this role.");
  }
  await applicationDialog.locator('input[type="file"]').setInputFiles({
    name: `omar-internal-${unique}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nOmar Rahman internal application\n%%EOF"),
  });
  await applicationDialog.getByRole("button", { name: "Submit application" }).click();
  await expect(applicationDialog).toBeHidden({ timeout: 20_000 });
  await page.getByRole("tab", { name: /My Applications/ }).click();
  await expect(page.getByText(/^INT-\d{2}-/)).toBeVisible();

  await page.getByRole("button", { name: "Recommend someone" }).first().click();
  const referralDialog = page.getByRole("dialog", { name: "Recommend someone" });
  await referralDialog.getByLabel("First name").fill("Browser");
  await referralDialog.getByLabel("Last name").fill("Referral");
  await referralDialog.getByLabel("Email").fill(`browser.referral.${unique}@example.test`);
  await referralDialog.getByLabel("Phone").fill(`+97150${unique.slice(-7)}`);
  await referralDialog.getByLabel("Current location").fill("Dubai");
  await referralDialog.getByLabel("How do you know them?").fill("Former colleague");
  await referralDialog
    .getByLabel("Why do you recommend them?")
    .fill("A reliable professional with directly relevant logistics experience.");
  await referralDialog.locator('input[type="file"]').setInputFiles({
    name: `employee-referral-${unique}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nEmployee referral logistics experience\n%%EOF"),
  });
  await referralDialog
    .getByLabel("The candidate knows I am sharing their CV with VIA for recruitment.")
    .click();
  await referralDialog.getByRole("button", { name: "Send recommendation" }).click();
  await expect(referralDialog).toBeHidden({ timeout: 20_000 });
  await page.getByRole("tab", { name: /My Referrals/ }).click();
  await expect(page.getByText("Browser Referral", { exact: true })).toBeVisible();
});
