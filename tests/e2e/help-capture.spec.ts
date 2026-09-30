import { expect, test, type Locator, type Page } from "@playwright/test";

// Opt-in authoring tool. Only empty forms in a loopback test workspace are captured.
// Never run against production or submit these forms.
test("capture demo screens for visual help", async ({ page, baseURL }) => {
  test.skip(
    process.env["VIA_HR_CAPTURE_HELP"] !== "1",
    "Run explicitly when refreshing help images.",
  );
  expect(new URL(baseURL!).hostname).toBe("127.0.0.1");
  expect(new URL(process.env["VIA_HR_TEST_DATABASE_URL"]!).hostname).toBe("127.0.0.1");
  expect(new URL(process.env["VIA_HR_TEST_DATABASE_URL"]!).pathname).toMatch(/test|scratch/);
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("/staff/help");
  await expect(page.getByRole("heading", { name: "Help & Knowledge", exact: true })).toBeVisible({
    timeout: 30_000,
  });

  async function visit(role: string, userId: string, path: string) {
    await page.evaluate(
      ({ role, userId }) =>
        localStorage.setItem(
          "via_hr:dev_preview_state",
          JSON.stringify({ userId, activeRole: role }),
        ),
      { role, userId },
    );
    await page.goto(path);
    await expect(page.getByText("VIA HR System is loading.", { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });
  }
  async function capture(element: Locator, name: string) {
    await expect(element).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await element.screenshot({ path: `public/help/${name}.png`, animations: "disabled" });
  }

  await visit("Employee", "user-omar", "/staff/me/leave-balances");
  await page
    .getByRole("button", { name: /Request Leave/ })
    .first()
    .click();
  await capture(page.getByRole("dialog", { name: "Request Leave", exact: true }), "request-leave");

  await visit("Employee", "user-omar", "/staff/me/attendance?action=site-visit");
  await capture(page.getByRole("dialog", { name: "Quick visit", exact: true }), "quick-visit");

  await visit("HR", "user-rana", "/staff/leave-admin");
  await page.getByRole("button", { name: "Permit backdated sick leave" }).click();
  await capture(
    page.getByRole("dialog", { name: "Permit backdated sick leave", exact: true }),
    "sick-leave-permission",
  );

  await visit("HR", "user-rana", "/staff/company-library");
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await capture(
    page.getByRole("dialog", { name: "Upload document", exact: true }),
    "company-document",
  );

  await visit("Accounts", "user-mariam", "/staff/payslips");
  await page.getByRole("button", { name: "Manage employee payslips", exact: true }).click();
  await capture(
    page.getByRole("region", { name: "Upload payslip", exact: true }),
    "finance-payslip",
  );

  await visit("Accounts", "user-mariam", "/staff/payroll/periods");
  await page.getByRole("button", { name: "New Period", exact: true }).click();
  await capture(
    page.getByRole("dialog", { name: "Create Payroll Period", exact: true }),
    "payroll-period",
  );
});
