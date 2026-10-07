import { test, expect } from "@playwright/test";

test("shared-trip colleague search works on a phone", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-omar", activeRole: "Employee" }),
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/travel/new");
  await page
    .getByText("Add colleagues travelling with you", { exact: true })
    .click({ timeout: 45000 });
  await expect(page.getByRole("searchbox", { name: "Search colleagues" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search colleagues" }).fill("Rana");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await expect(page.getByText(/1 selected/)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test("Finance has a booking desk without changing its employee workspace", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-mariam", activeRole: "Accounts" }),
    ),
  );
  await page.goto("/staff/travel");
  await expect(page.getByText("Booking desk", { exact: true }).last()).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByRole("button", { name: "New Travel Request" })).toBeVisible();
});
