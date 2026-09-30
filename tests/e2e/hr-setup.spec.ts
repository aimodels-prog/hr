import { expect, test } from "@playwright/test";

test("HR dashboard setup: connections, retry, shortcuts and mobile", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
    ),
  );
  let failed = false;
  let configured = true;
  let connected = false;
  let emailEnabled = false;
  await page.route("**/api/integrations/google-calendar", async (route) => {
    await route.fulfill({
      status: failed ? 503 : 200,
      json: { configured, connected, emailEnabled, accountEmail: "hr@via-int.com" },
    });
  });
  await page.goto("/staff");
  const setup = page.getByRole("region", { name: "HR setup", exact: true });
  const toggle = setup.getByRole("button", { name: /^HR setup/ });
  await expect(setup.getByRole("button", { name: "Enable emails", exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    setup.locator('form[action="/api/integrations/google-calendar?email=enable"]'),
  ).toBeVisible();
  await expect(setup.getByRole("button", { name: "Connect calendar", exact: true })).toBeEnabled();
  await expect(setup.getByRole("link", { name: "Office & working hours" })).toHaveAttribute(
    "href",
    /#section=setup$/,
  );
  await expect(setup.getByRole("link", { name: "Company setup" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("hr-setup-mobile.png") });
  await toggle.click();
  await expect(setup.getByRole("button", { name: "Enable emails", exact: true })).toHaveCount(0);

  connected = true;
  emailEnabled = true;
  await page.reload();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(setup.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(setup.getByText("Connected", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button", { name: "Enable emails", exact: true })).toHaveCount(0);

  failed = true;
  await page.reload();
  await expect(setup.getByText("Connection status is unavailable.")).toBeVisible();
  failed = false;
  configured = false;
  connected = false;
  emailEnabled = false;
  await setup.getByRole("button", { name: "Try again" }).click();
  await expect(setup.getByRole("button", { name: "Enable emails", exact: true })).toBeDisabled();
  await expect(setup.getByText(/administrator needs to finish Google setup/)).toBeVisible();
  await setup.getByRole("link", { name: "Office & working hours" }).click();
  await expect(page).toHaveURL(/#section=setup$/);
  await expect(
    page.getByRole("heading", { name: "Head Office attendance", exact: true }),
  ).toBeVisible();
});

test("HR dashboard setup is absent from the employee dashboard", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-omar", activeRole: "Employee" }),
    ),
  );
  let requests = 0;
  await page.route("**/api/integrations/google-calendar", (route) => {
    requests++;
    return route.fulfill({ status: 403, json: {} });
  });
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("region", { name: "HR setup", exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});
