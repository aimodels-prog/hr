import { expect, test } from "@playwright/test";
import postgres from "postgres";

test("employee monthly entry stays one sheet across date windows, including on a phone; HR sees monthly settings", async ({
  page,
}) => {
  const url = process.env["VIA_HR_TEST_DATABASE_URL"];
  expect(url).toBeTruthy();
  expect(new URL(url!).pathname).toMatch(/test|scratch/);
  const sql = postgres(url!, { max: 1 });
  const [person] =
    await sql`SELECT e.id,e.organisation_id FROM employees e WHERE lower(e.work_email)='rana.nair@via-int.com'`;
  expect(person).toBeTruthy();
  const [calendar] =
    await sql`SELECT timezone FROM app_settings WHERE organisation_id=${person!.organisation_id}`;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: calendar!.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const start = `${today.slice(0, 7)}-01`;
  const label = new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${start}T12:00:00Z`));
  const before =
    await sql`SELECT t.id FROM timesheets t JOIN timesheet_periods p ON p.id=t.period_id WHERE t.employee_id=${person!.id} AND p.start_date=${start} AND t.archived_at IS NULL`;
  try {
    await page.goto("/staff");
    await page.evaluate(() =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: "user-rana", activeRole: "Employee" }),
      ),
    );
    await page.goto("/staff/me/timesheets");
    const row = page.getByRole("row").filter({ hasText: label });
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Record daily hours. Submit once per month.")).toBeVisible();
    await row.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Timesheet Entry", exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy Previous Month", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit Timesheet", exact: true }),
    ).toBeDisabled();
    const sheetUrl = page.url();
    await expect(
      page.getByText(
        "1 " + label.split(" ")[0].slice(0, 3) + " – 7 " + label.split(" ")[0].slice(0, 3),
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next dates", exact: true }).click();
    await expect(
      page.getByText(
        "8 " + label.split(" ")[0].slice(0, 3) + " – 14 " + label.split(" ")[0].slice(0, 3),
        { exact: true },
      ),
    ).toBeVisible();
    expect(page.url()).toBe(sheetUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Previous dates", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy();
    const sheets =
      await sql`SELECT t.id FROM timesheets t JOIN timesheet_periods p ON p.id=t.period_id WHERE t.employee_id=${person!.id} AND p.start_date=${start} AND t.archived_at IS NULL`;
    expect(sheets).toHaveLength(1);
    await page.evaluate(() =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
      ),
    );
    await page.goto("/staff/timesheet-settings");
    await expect(
      page.getByRole("heading", { name: "Timesheet Settings", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("combobox").first()).toHaveText("Monthly");
    await expect(page.getByText("Weekly Period Start Day", { exact: true })).toHaveCount(0);
  } finally {
    if (!before.length)
      await sql`DELETE FROM timesheets WHERE employee_id=${person!.id} AND status='Draft' AND total_hours=0 AND period_id IN (SELECT id FROM timesheet_periods WHERE organisation_id=${person!.organisation_id} AND start_date=${start})`;
    await sql.end({ timeout: 5 });
  }
});
