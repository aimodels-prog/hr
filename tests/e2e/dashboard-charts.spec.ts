import { expect, test, type Page } from "@playwright/test";
import type { WorkforceAnalytics } from "../../src/lib/data/workforce-analytics";

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
