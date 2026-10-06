import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import postgres from "postgres";

test("HR can search matched employees and preview a correction on a phone", async ({ page }) => {
  const url = process.env["VIA_HR_TEST_DATABASE_URL"];
  test.skip(!url, "Requires the isolated PostgreSQL browser seed");
  expect(new URL(url!).pathname).toMatch(/test|scratch/);
  const sql = postgres(url!, { max: 1 });
  const deviceId = randomUUID();
  const mappingId = randomUUID();
  try {
    const [person] = await sql`SELECT e.id, e.organisation_id, e.location_id, u.id AS user_id
      FROM employees e JOIN users u ON u.employee_id=e.id WHERE lower(e.work_email)='omar.rahman@via-int.com' AND e.archived_at IS NULL`;
    expect(person).toBeTruthy();
    await sql`INSERT INTO attendance_devices (id, organisation_id, code, name, location_id, is_active, created_by, updated_by)
      VALUES (${deviceId}, ${person.organisation_id}, ${`rematch-${deviceId}`}, 'Rematch test terminal', ${person.location_id}, true, ${person.user_id}, ${person.user_id})`;
    await sql`INSERT INTO attendance_device_employee_mappings (id, organisation_id, device_id, device_user_id, employee_id, created_by, updated_by)
      VALUES (${mappingId}, ${person.organisation_id}, ${deviceId}, 'rematch-test-user', ${person.id}, ${person.user_id}, ${person.user_id})`;
    await page.addInitScript(() =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
      ),
    );
    await page.goto("/staff/attendance#section=terminals");
    await expect(page.getByLabel("Search matched employees")).toBeVisible({ timeout: 45000 });
    await page.getByLabel("Search matched employees").fill("rematch-test-user");
    const row = page.getByRole("row").filter({ hasText: "rematch-test-user" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Change employee" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = page.getByRole("dialog", { name: "Change matched employee" });
    await dialog.getByRole("combobox", { name: "Correct employee" }).click();
    await page.getByRole("option").filter({ hasText: "rana.nair@via-int.com" }).click();
    await dialog.getByRole("button", { name: "Review affected attendance" }).click();
    await expect(dialog.getByRole("button", { name: "Confirm correction" })).toBeEnabled();
    await expect(dialog).toContainText("0 punches");
    await expect(dialog).toContainText("Original punch times and fingerprints stay unchanged");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: test.info().outputPath("biometric-rematch-mobile.png") });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const [match] =
      await sql`SELECT employee_id FROM attendance_device_employee_mappings WHERE id=${mappingId}`;
    expect(match.employee_id).toBe(person.id);
    await row.getByRole("button", { name: "Remove match", exact: true }).click();
    const removal = page.getByRole("dialog", { name: "Remove employee match" });
    await expect(
      removal.getByRole("radio", { name: "Keep existing attendance (recommended)" }),
    ).toBeChecked();
    await removal.getByRole("button", { name: "Review removal" }).click();
    await expect(removal.getByRole("button", { name: "Confirm removal" })).toBeEnabled();
    await expect(removal).toContainText("Existing attendance will stay unchanged");
    await removal.getByRole("radio", { name: /The match was wrong/ }).check();
    await expect(removal.getByRole("button", { name: "Review removal" })).toBeVisible();
    await removal.getByRole("button", { name: "Review removal" }).click();
    await expect(removal).toContainText("0 punches across 0 days");
    await page.screenshot({ path: test.info().outputPath("remove-match-mobile.png") });
    await removal.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await sql`DELETE FROM attendance_device_employee_mappings WHERE id=${mappingId}`;
    await sql`DELETE FROM attendance_devices WHERE id=${deviceId}`;
    await sql.end();
  }
});
