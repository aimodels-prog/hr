import { expect, test } from "@playwright/test";

test("contextual help: footer, page guide, persistent tips and mobile controls", async ({
  page,
}) => {
  await page.goto("/staff/help");
  await expect(page.getByRole("heading", { name: "Help & Knowledge", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-omar", activeRole: "Employee" }),
    );
    for (const key of Object.keys(localStorage))
      if (key.startsWith("via_hr:help-tips:")) localStorage.removeItem(key);
  });
  await page.goto("/staff/me/attendance");
  const tip = page.getByRole("complementary", { name: "Page tip" });
  await expect(tip).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Help & Knowledge" }),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-sidebar="footer"]').getByRole("link", { name: "Help & Knowledge" }),
  ).toBeVisible();
  await tip.getByRole("button", { name: "Dismiss tip" }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Help for this page" }).click();
  await expect(page.getByRole("link", { name: "Guide for this page" })).toBeVisible();
  await expect(tip).toHaveCount(0);
  await page.getByRole("button", { name: "Show dismissed tips again" }).click();
  await expect(tip).toBeVisible();
  await page.getByLabel("Show page tips", { exact: true }).uncheck();
  await expect(tip).toHaveCount(0);
  await page.getByRole("link", { name: "Guide for this page" }).click();
  await expect(page).toHaveURL(/\/staff\/help\?.*article=/);
  await expect(page.getByRole("complementary", { name: "Page tip" })).toHaveCount(0);
  await page.goto("/staff/me/attendance");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Help for this page" }).click();
  await expect(page.getByLabel("Show page tips", { exact: true })).not.toBeChecked();
  await page.getByLabel("Show page tips", { exact: true }).check();
  await expect(tip).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("help-shortcut-mobile.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-mariam", activeRole: "Accounts" }),
    ),
  );
  await page.goto("/staff/payroll/periods");
  await expect(tip).toBeVisible();
  await page.getByRole("button", { name: "Help for this page" }).click();
  await page.getByRole("link", { name: "Guide for this page" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Prepare, approve and export a payroll period",
      exact: true,
    }),
  ).toBeVisible();
});
