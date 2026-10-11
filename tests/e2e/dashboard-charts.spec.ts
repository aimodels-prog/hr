import { expect, test, type Page } from "@playwright/test";
import type { WorkforceAnalytics } from "../../src/lib/data/workforce-analytics";
import postgres from "postgres";

async function preview(page: Page, role: "HR" | "Employee") {
  await page.evaluate(
    (role) =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: "user-rana", activeRole: role }),
      ),
    role,
  );
  await page.goto("/staff");
}
async function figures(
  page: Page,
  scope: "hr" | "self",
  days: 7 | 30,
): Promise<WorkforceAnalytics> {
  return page.evaluate(
    async ({ scope, days }) => {
      const path = "/src/lib/server-functions/workforce-analytics.server.ts";
      const { getWorkforceAnalyticsFn } = await import(/* @vite-ignore */ path);
      return getWorkforceAnalyticsFn({
        data: {
          actorId: "user-rana",
          actorEmail: "rana.nair@via-int.com",
          activeRole: scope === "hr" ? "HR" : "Employee",
          scope,
          days,
        },
      });
    },
    { scope, days },
  );
}
const shown = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });

test("HR opens daily clock-ins from the dashboard and can review another date", async ({
  page,
}) => {
  const url = process.env["VIA_HR_TEST_DATABASE_URL"];
  expect(url).toBeTruthy();
  expect(new URL(url!).pathname).toMatch(/test|scratch/i);
  const sql = postgres(url!, { max: 1 });
  let recordId: string | undefined;
  let futureDate: string | undefined;
  let office: { id: string; name: string; organisation_id: string } | undefined;
  let originalTracking: postgres.JSONValue | undefined;
  try {
    [office] = await sql<{ id: string; name: string; organisation_id: string }[]>`
      SELECT l.id,l.name,e.organisation_id FROM employees e
      JOIN locations l ON l.id=e.location_id
      WHERE lower(e.work_email)='omar.rahman@via-int.com' AND e.archived_at IS NULL`;
    expect(office).toBeTruthy();
    const [settings] = await sql`
      SELECT additional_settings->'attendanceTracking' AS tracking
      FROM app_settings WHERE organisation_id=${office!.organisation_id}`;
    originalTracking = settings!.tracking;
    // Reproduce a real organisation with no tracking policy and an explicit Head Office location.
    await sql`UPDATE locations SET name='Head Office' WHERE id=${office!.id}`;
    await sql`UPDATE app_settings SET additional_settings=additional_settings-'attendanceTracking'
      WHERE organisation_id=${office!.organisation_id}`;
    await page.goto("/staff");
    await preview(page, "HR");
    const data = await figures(page, "hr", 30);
    const shortcut = page.getByRole("link", { name: "Today's attendance", exact: true });
    await expect(shortcut).toBeVisible();
    const [record] = await sql`INSERT INTO attendance_records
      (organisation_id,employee_id,date,clock_in_at,source,status,created_by,updated_by)
      SELECT e.organisation_id,e.id,d::date,
        (d::date + time '08:30') AT TIME ZONE s.timezone,'Hardware Terminal','Present',u.id,u.id
      FROM employees e JOIN users u ON u.employee_id=e.id
      JOIN app_settings s ON s.organisation_id=e.organisation_id
      CROSS JOIN generate_series(${data.today.date}::date+2,${data.today.date}::date+40,interval '1 day') d
      WHERE lower(e.work_email)='omar.rahman@via-int.com'
        AND NOT EXISTS (SELECT 1 FROM attendance_records r WHERE r.employee_id=e.id AND r.date=d::date)
      LIMIT 1 RETURNING id,date::text`;
    expect(record).toBeTruthy();
    recordId = record!.id;
    futureDate = record!.date;
    await shortcut.click();
    await expect(
      page.getByRole("heading", { name: "Manage attendance", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Attendance date", { exact: true })).toHaveValue(data.today.date);
    await expect(page.getByRole("combobox", { name: "Attendance status", exact: true })).toHaveText(
      "Clocked in",
    );
    await expect(page.getByLabel("Filter location", { exact: true })).toHaveValue("Head Office");
    await page.getByLabel("Attendance date", { exact: true }).fill(futureDate!);
    const rows = page.locator("[data-section-content] tbody").first();
    await expect(rows.getByRole("row").filter({ hasText: "Omar" })).toBeVisible({
      timeout: 30_000,
    });
    const omar = rows.getByRole("row").filter({ hasText: "Omar" });
    await expect(omar.getByRole("cell").nth(2)).toHaveText("08:30");
    await expect(omar.getByRole("cell").nth(3)).toHaveText("—");
    await expect(rows).not.toContainText("Not tracked");
    await page.getByRole("combobox", { name: "Attendance status", exact: true }).click();
    await page.getByRole("option", { name: "All", exact: true }).click();
    await expect.poll(() => rows.getByRole("row").count()).toBeGreaterThan(1);
    await page.reload();
    await expect(page.getByLabel("Attendance date", { exact: true })).toHaveValue(futureDate!);
    await expect(page.getByRole("combobox", { name: "Attendance status", exact: true })).toHaveText(
      "All",
    );
    await expect(page.getByLabel("Filter location", { exact: true })).toHaveValue("Head Office");
    await page.getByLabel("Filter location", { exact: true }).selectOption("Salalah, Oman");
    await expect(rows).not.toContainText("Omar");
    await page.reload();
    await expect(page.getByLabel("Filter location", { exact: true })).toHaveValue("Salalah, Oman");
    await page.getByLabel("Filter location", { exact: true }).selectOption("all");
    await expect(omar).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Filter location", { exact: true })).toHaveValue("all");
    await page.goto(`/staff/attendance?date=${futureDate}&status=All`);
    await expect(page.getByLabel("Filter location", { exact: true })).toHaveValue("Head Office");
    await page.goto("/staff");
    await preview(page, "Employee");
    await expect(page.getByRole("region", { name: "My working hours", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Today's attendance", exact: true })).toHaveCount(
      0,
    );
  } finally {
    if (recordId) await sql`DELETE FROM attendance_records WHERE id=${recordId}`;
    if (office) {
      await sql`UPDATE locations SET name=${office.name} WHERE id=${office.id}`;
      if (originalTracking != null)
        await sql`UPDATE app_settings SET additional_settings=additional_settings ||
          ${sql.json({ attendanceTracking: originalTracking })}::jsonb
          WHERE organisation_id=${office.organisation_id}`;
    }
    await sql.end();
  }
});

test("HR switches to her own employee dashboard and back without carrying an employee filter", async ({
  page,
}) => {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  await preview(page, "HR");
  await page.goto("/staff?employeeId=employee-omar");
  const switchRole = async (role: "HR" | "Employee") => {
    await page.getByRole("button").filter({ hasText: "Rana" }).first().click();
    await page.getByRole("button", { name: role, exact: true }).click();
    await expect(page.locator(`[data-dashboard-role="${role}"]`)).toBeVisible();
    expect(new URL(page.url()).searchParams.has("employeeId")).toBe(false);
  };
  await switchRole("Employee");
  await expect(page.getByRole("heading", { name: "Welcome back, Rana" })).toBeVisible();
  await expect(page.getByRole("region", { name: "My working hours", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "HR insights", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Needs My Approval/ })).not.toBeVisible();
  await switchRole("HR");
  await expect(page.getByRole("region", { name: "HR insights", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "People overview" })).toBeVisible();
});

test("dashboard chart figures match server data for HR and employee across periods and mobile", async ({
  page,
}) => {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  for (const role of ["HR", "Employee"] as const) {
    await preview(page, role);
    const scope = role === "HR" ? "hr" : "self";
    const insights = page.getByRole("region", {
      name: role === "HR" ? "HR insights" : "My working hours",
      exact: true,
    });
    await expect(insights.getByTestId("primary-dashboard-charts")).toBeVisible({ timeout: 30_000 });
    for (const period of [7, 30] as const) {
      await insights.getByLabel("Chart period").selectOption(String(period));
      const data = await figures(page, scope, period);
      expect(data.endDate).toBe(data.today.date);
      expect(data.days.at(-1)?.date).toBe(data.today.date);
      expect(data.days.at(-1)?.missing).toBe(0);
      expect(data.days.at(-1)?.review).toBe(0);
      await expect(insights.locator(".recharts-xAxis").getByText(/Today/).first()).toBeVisible();
      const details = insights
        .locator("details")
        .filter({ has: page.getByText("Daily figures and calculation notes", { exact: true }) });
      await details.locator("summary").click();
      const rows = details.locator("tbody tr");
      await expect(rows).toHaveCount(period);
      for (const [index, day] of data.days.entries()) {
        await expect(rows.nth(index).locator("td")).toHaveText(
          [day.worked, day.expected, day.recorded, day.review, day.missing, day.leaveDays].map(
            shown,
          ),
        );
      }
      await details.locator("summary").click();
      const leave = insights.getByRole("region", {
        name: role === "HR" ? "Leave usage and carryover" : "My annual leave balance",
        exact: true,
      });
      if (data.priorities.annualLeave.length) {
        await leave.getByText("View leave figures", { exact: true }).click();
        for (const row of data.priorities.annualLeave)
          await expect(
            leave
              .getByRole("row")
              .filter({ has: page.getByRole("rowheader", { name: row.name, exact: true }) })
              .locator("td"),
          ).toHaveText([row.used, row.booked, row.remaining, row.carry].map(shown));
        await leave.getByText("View leave figures", { exact: true }).click();
      }
      if (role === "HR") {
        for (const [title, values] of [
          ["Approvals waiting", data.priorities.approvals],
          ["Recruitment pipeline", data.recruitment],
          ["Upcoming document expiries", data.priorities.expiries],
        ] as const) {
          const panel = insights.getByRole("region", { name: title, exact: true });
          await expect(panel).toBeVisible();
          if (!values.length) {
            await expect(panel.getByText("No records to display.")).toBeVisible();
            continue;
          }
          await panel.getByText("View chart data", { exact: true }).click();
          for (const item of values)
            await expect(
              panel
                .getByRole("row")
                .filter({ has: page.getByRole("rowheader", { name: item.name, exact: true }) })
                .getByRole("cell"),
            ).toHaveText(String(item.count));
          await panel.getByText("View chart data", { exact: true }).click();
        }
        const distribution = insights.getByRole("region", {
          name: "Workforce distribution",
          exact: true,
        });
        for (const grouping of ["department", "office"]) {
          await distribution.getByLabel("Workforce grouping").selectOption(grouping);
          await expect(distribution.locator(".recharts-pie")).toHaveCount(1);
          await expect(distribution.locator("svg tspan").first()).toHaveText(
            shown(data.workforceHeadcount!),
          );
        }
      } else {
        for (const name of [
          "Approvals waiting",
          "Recruitment pipeline",
          "Upcoming document expiries",
          "Workforce distribution",
        ])
          await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await insights.screenshot({ path: test.info().outputPath(`${scope}-charts-mobile.png`) });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});
