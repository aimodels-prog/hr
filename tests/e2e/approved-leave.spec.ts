import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { format, parseISO } from "date-fns";
import postgres from "postgres";

test("approved leave appears on the employee dashboard and direct attendance page, including its first day", async ({
  page,
}) => {
  const url = process.env["VIA_HR_TEST_DATABASE_URL"];
  expect(url).toBeTruthy();
  expect(new URL(url!).pathname).toMatch(/test|scratch/);
  const sql = postgres(url!, { max: 1 });
  const id = randomUUID();
  try {
    const [person] =
      await sql`SELECT e.id, e.organisation_id, u.id AS user_id, s.timezone FROM employees e JOIN users u ON u.employee_id=e.id JOIN app_settings s ON s.organisation_id=e.organisation_id WHERE lower(e.work_email)='rana.nair@via-int.com' AND e.archived_at IS NULL`;
    expect(person).toBeTruthy();
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: person!.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const [punch] =
      await sql`SELECT id FROM attendance_records WHERE employee_id=${person!.id} AND date=${date} AND (clock_in_at IS NOT NULL OR clock_out_at IS NOT NULL) AND archived_at IS NULL`;
    expect(punch, "the isolated test employee must have no real punches today").toBeUndefined();
    await sql`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,working_days_requested,reason,status,policy_snapshot,created_by,updated_by)
      SELECT ${id},${person!.organisation_id},${person!.id},p.id,${date},${date},false,1,'Approved absence','Approved',${sql.json({ name: "Annual Leave" })},${person!.user_id},${person!.user_id}
      FROM leave_policies p WHERE p.organisation_id=${person!.organisation_id} AND p.archived_at IS NULL ORDER BY p.created_at LIMIT 1`;
    await page.goto("/staff");
    await page.evaluate(() =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: "user-rana", activeRole: "Employee" }),
      ),
    );
    await page.goto("/staff");
    const todayCard = page.getByRole("region", { name: "Today's attendance", exact: true });
    await expect(todayCard.getByText("On leave", { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(todayCard).toContainText("Annual Leave");
    await expect(todayCard.getByText("Worked today", { exact: true })).toHaveCount(0);
    await page.goto("/staff/me/attendance");
    await expect(page.getByText("On leave today", { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("button", { name: "Clock In", exact: true })).toHaveCount(0);
    const row = page
      .getByRole("row")
      .filter({ has: page.getByText(format(parseISO(date), "dd MMM"), { exact: true }) });
    await expect(row.getByText("On Leave", { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(row.getByRole("button", { name: /Correct/ })).toHaveCount(0);
    const [createdPunch] =
      await sql`SELECT id FROM attendance_records WHERE employee_id=${person!.id} AND date=${date}`;
    expect(createdPunch).toBeUndefined();
  } finally {
    await sql`DELETE FROM leave_requests WHERE id=${id}`;
    await sql.end();
  }
});
