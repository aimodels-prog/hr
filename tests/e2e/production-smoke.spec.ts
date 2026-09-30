import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import postgres from "postgres";
import { textPdf } from "./pdf-fixture";
import { configureAttendanceFixture } from "./attendance-fixture";

test.beforeAll(configureAttendanceFixture);

type ProductionRole = "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin";

const portalSecret = process.env["PORTAL_SSO_SECRET"] ?? "";

test("production release smoke saves working hours and HR reminder settings", async ({ page }) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO",
  );
  const url = process.env["DATABASE_URL"]!;
  expect(new URL(url).pathname).toMatch(/test|scratch/);
  const sql = postgres(url, { max: 1 });
  const [user] =
    await sql`SELECT organisation_id FROM users WHERE workspace_email='rana.nair@via-int.com' LIMIT 1`;
  const org = user!.organisation_id;
  const [company] = await sql`SELECT * FROM app_settings WHERE organisation_id=${org}`;
  const [policy] = await sql`SELECT * FROM attendance_policies WHERE organisation_id=${org}`;
  const [timesheet] = await sql`SELECT * FROM timesheet_settings WHERE organisation_id=${org}`;
  try {
    await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff/settings?section=reminders");
    await page.getByLabel("Remind after waiting (hours)").fill("72");
    await page.getByLabel("Days before expiry", { exact: true }).fill("30, 3, 0");
    await page.getByRole("button", { name: "Save reminder settings", exact: true }).click();
    await expect(page.getByText("Reminder settings saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Remind after waiting (hours)")).toHaveValue("72", {
      timeout: 30000,
    });
    await expect(page.getByLabel("Days before expiry", { exact: true })).toHaveValue("30, 3, 0");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("reminder-settings-mobile.png"),
      fullPage: true,
    });
    await page.goto("/staff/attendance#section=setup");
    await expect(
      page.getByRole("button", { name: "Save Attendance Policy", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await page.getByLabel("Standard hours", { exact: true }).fill("7.5");
    await page.getByLabel("Default break minutes", { exact: true }).fill("30");
    await page.getByLabel("Break starts at", { exact: true }).fill("12:00");
    await page.getByText("Advanced location and network settings", { exact: true }).click();
    await page.getByLabel("Approved office networks", { exact: true }).fill("127.0.0.1/32");
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Verify configurable working day");
    await page.getByRole("button", { name: "Save Attendance Policy", exact: true }).click();
    await expect(page.getByText("Attendance policy updated.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Save Attendance Policy", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await expect(page.getByLabel("Standard hours", { exact: true })).toHaveValue("7.5");
    await expect(page.getByLabel("Break starts at", { exact: true })).toHaveValue("12:00");
    const rows =
      await sql`SELECT standard_daily_hours FROM app_settings WHERE organisation_id=${org} UNION ALL SELECT standard_daily_hours FROM timesheet_settings WHERE organisation_id=${org}`;
    expect(rows.map((row) => Number(row.standard_daily_hours))).toEqual([7.5, 7.5]);
  } finally {
    if (company)
      await sql`UPDATE app_settings SET standard_daily_hours=${company.standard_daily_hours},additional_settings=${sql.json(company.additional_settings)} WHERE organisation_id=${org}`;
    if (policy)
      await sql`UPDATE attendance_policies SET standard_daily_hours=${policy.standard_daily_hours},break_start=${policy.break_start},default_break_minutes=${policy.default_break_minutes},approved_network_cidrs=${policy.approved_network_cidrs} WHERE organisation_id=${org}`;
    if (timesheet)
      await sql`UPDATE timesheet_settings SET standard_daily_hours=${timesheet.standard_daily_hours} WHERE organisation_id=${org}`;
    await sql.end();
  }
});

test("production release smoke recovers charts after a transient request failure", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  let attempts = 0;
  let unavailable = true;
  await page.route("**/_serverFn/**", async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (route.request().method() === "GET" && url.includes('"scope"') && url.includes('"days"')) {
      attempts += 1;
      if (unavailable) {
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Temporarily unavailable",
        });
        return;
      }
    }
    await route.continue();
  });
  await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff");
  await expect(page.getByText("Charts are temporarily unavailable.", { exact: false })).toBeVisible(
    { timeout: 30_000 },
  );
  expect(attempts).toBeGreaterThanOrEqual(3);
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recruitment pipeline" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Charts are temporarily unavailable.", { exact: false })).toHaveCount(
    0,
  );
});

test("production release smoke loads HR and employee charts through portal SSO", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff");
  await expect(page.getByRole("heading", { name: "Attendance trend" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Recruitment pipeline" })).toBeVisible();
  await expect(
    page.getByTestId("primary-dashboard-charts").locator(":scope > section"),
  ).toHaveCount(6);
  for (const name of [
    "Attendance trend",
    "Approvals waiting",
    "Leave usage and carryover",
    "Upcoming document expiries",
  ])
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Workforce distribution", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Workforce grouping").selectOption("office");
  await expect(
    page
      .getByRole("region", { name: "Workforce distribution", exact: true })
      .locator(".recharts-pie"),
  ).toHaveCount(1);
  await expect(page.getByRole("img", { name: "Current employees by office" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("hr-clean-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByTestId("primary-dashboard-charts")
    .screenshot({ path: test.info().outputPath("hr-priority-charts-mobile.png") });
  await page.getByLabel("Find an employee", { exact: true }).fill("rana.nair@via-int.com");
  await page.getByRole("list", { name: "Matching employees" }).getByRole("button").click();
  await expect(page.getByRole("status").filter({ hasText: /^Rana/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Employee insights", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recruitment pipeline" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Employees by office" })).toHaveCount(0);
  await page.getByLabel("Chart period", { exact: true }).selectOption("7");
  await expect(page).toHaveURL(/days=7/);
  await page
    .getByRole("region", { name: "Worked hours vs expected hours", exact: true })
    .getByRole("link", { name: "View details" })
    .click();
  await expect(page).toHaveURL(/days=7.*#attendance/);
  await expect(page.getByText(/Dashboard period:/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("status").filter({ hasText: /^Rana/ })).toBeVisible();
  await page.getByRole("button", { name: "Clear employee filter" }).click();
  await expect(page.getByRole("heading", { name: "Recruitment pipeline" })).toBeVisible();
  await page.goto("/staff/me/attendance");
  await expect(page.getByRole("heading", { name: "Worked hours vs expected hours" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "My attendance summary" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My annual leave balance" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "My annual leave balance", exact: true })
      .locator(".recharts-pie"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("primary-dashboard-charts").locator(":scope > section"),
  ).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Approvals waiting" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByTestId("primary-dashboard-charts")
    .screenshot({ path: test.info().outputPath("personal-priority-charts-mobile.png") });
});

test("production release smoke retains employee filters across HR modules", async ({ page }) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/staff/attendance",
    "/staff/leave-admin",
    "/staff/timesheet-monitoring",
    "/staff/files",
    "/staff/travel-hr-approvals",
    "/staff/training",
    "/staff/performance/team",
  ]) {
    await page.goto(path);
    const filter = page.getByRole("region", { name: "Filter by employee", exact: true });
    await expect(filter).toBeVisible({ timeout: 30_000 });
    await filter.getByRole("searchbox").fill("rana.nair@via-int.com");
    await filter.getByRole("button", { name: /Rana/ }).click();
    await expect(filter.getByText(/Viewing: Rana/)).toBeVisible();
    await expect(page).toHaveURL(/employeeId=/);
    await page.reload();
    await expect(filter.getByText(/Viewing: Rana/)).toBeVisible({ timeout: 30_000 });
    await filter.getByRole("button", { name: "Clear employee filter" }).click();
    await expect(filter.getByText("Viewing: All employees")).toBeVisible();
  }
});

test("production release smoke preserves employee charts when a refresh fails", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff/me/attendance");
  const chart = page.getByRole("heading", { name: "Worked hours vs expected hours" });
  await expect(chart).toBeVisible({ timeout: 30_000 });
  let unavailable = true;
  await page.route("**/_serverFn/**", async (route) => {
    const url = decodeURIComponent(route.request().url());
    if (
      unavailable &&
      route.request().method() === "GET" &&
      url.includes('"scope"') &&
      url.includes('"days"')
    ) {
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Temporarily unavailable",
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Refresh My working hours", exact: true }).click();
  await expect(page.getByText(/The latest refresh did not complete/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(chart).toBeVisible();
  await expect(page.getByText(/Charts are temporarily unavailable/)).toHaveCount(0);
  unavailable = false;
  await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByText(/The latest refresh did not complete/)).toHaveCount(0);
  await expect(chart).toBeVisible();
});

test("production release smoke signs out without a blocked cross-origin form redirect", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  const securityErrors: string[] = [];
  page.on("console", (message) => {
    if (/form-action|Content Security Policy/i.test(message.text()))
      securityErrors.push(message.text());
  });
  await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff");
  // Keep this regression test independent of the external portal service.
  await page.route("https://portal.via-int.com/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>VIA Portal</h1>" }),
  );
  await page.getByRole("button", { name: /Rana Nair,/ }).click();
  await page.getByRole("button", { name: "Sign out of VIA HR" }).click();
  await expect(page).toHaveURL("https://portal.via-int.com/");
  await expect(page.getByRole("heading", { name: "VIA Portal" })).toBeVisible();
  expect(
    (await page.context().cookies()).some((cookie) => cookie.name === "__Host-via_hr_session"),
  ).toBe(false);
  expect((await page.request.get("/auth/session")).status()).toBe(401);
  expect(securityErrors).toEqual([]);
});

async function signInAs(page: Page, email: string, name: string, path: string) {
  const token = await new SignJWT({ appSlug: "via-hr", email, name, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("via-portal")
    .setAudience("via-hr")
    .setExpirationTime("120s")
    .sign(new TextEncoder().encode(portalSecret));
  await page.goto(`/auth/portal/callback?portal_token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/staff$/);
  await page.goto(path);
  await expect(page.getByText("VIA HR System is loading.", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
}

test("production release smoke keeps employee dashboard concise on desktop and phone", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  await signInAs(page, "omar.rahman@via-int.com", "Omar Rahman", "/staff");
  await expect(page.getByRole("heading", { name: "Worked hours vs expected hours" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("primary-dashboard-charts").locator(":scope > section"),
  ).toHaveCount(2);
  await expect(page.getByText("Viewing: All employees", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "About Expected hours", exact: true }).click();
  await expect(
    page.getByText("Working calendar adjusted for leave", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: test.info().outputPath("employee-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("employee-mobile.png"), fullPage: true });
});

test("production release smoke shows six charts for Super Admin on desktop and phone", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  await signInAs(page, "yusuf.balushi@via-int.com", "Yusuf Al Balushi", "/staff");
  await expect(page.getByRole("heading", { name: "People overview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance trend", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByTestId("primary-dashboard-charts").locator(":scope > section"),
  ).toHaveCount(6);
  await expect(page.getByText("Attendance recorded today", { exact: true })).toBeVisible();
  const recruitmentMenu = page.getByRole("button", { name: "Recruitment", exact: true });
  await expect(recruitmentMenu).toHaveAttribute("aria-expanded", "false");
  await recruitmentMenu.click();
  await expect(page.getByRole("link", { name: "Vacancies", exact: true })).toBeVisible();
  await recruitmentMenu.click();
  await page.screenshot({
    path: test.info().outputPath("super-admin-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("super-admin-mobile.png"), fullPage: true });
});

test("production release smoke covers health, secure CV intake and all five roles", async ({
  page,
  request,
}) => {
  test.skip(
    process.env["VIA_HR_RUN_PRODUCTION_SMOKE"] !== "true",
    "Run against the deployed production stack with its worker and SSO secret.",
  );
  test.setTimeout(180_000);

  for (const [path, expected] of [
    ["/health/live", "ok"],
    ["/health/ready", "ready"],
    ["/health/worker", "healthy"],
  ] as const) {
    const response = await request.get(path);
    expect(response.ok(), `${path} should be healthy`).toBe(true);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["status"]).toBe(expected);
  }

  const unique = Date.now().toString();
  await page.goto("/");
  await page.getByRole("link", { name: /Logistics Operations Lead/i }).click();
  await expect(page.getByRole("heading", { name: "Apply for this position" })).toBeVisible();
  for (const [name, value] of Object.entries({
    firstName: "Production",
    lastName: "Smoke",
    email: `production.smoke.${unique}@example.test`,
    phone: `+97150${unique.slice(-7)}`,
    location: "Dubai",
    yearsOfExperience: "8",
    noticePeriod: "30 days",
    currentCompany: "VIA Release Test",
    currentTitle: "Logistics Manager",
    salaryExpectation: "18000",
  })) {
    await page.locator(`input[name="${name}"]`).fill(value);
  }
  const textareas = page.locator("textarea");
  for (let index = 0; index < (await textareas.count()); index += 1) {
    await textareas.nth(index).fill("Confirmed with evidence from international logistics work.");
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "Production-Smoke-CV.pdf",
    mimeType: "application/pdf",
    buffer: textPdf(
      "Production release candidate. Logistics operations and leadership. Eight years of experience in supply chain, customs clearance and regional freight operations. Bachelor of Business Administration. Languages: English.",
    ),
  });
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Submit Application" }).click();
  await expect(page.getByText("Application Received")).toBeVisible({ timeout: 30_000 });

  const rolePages: Array<{
    email: string;
    name: string;
    role: ProductionRole;
    path: string;
    heading: string | RegExp;
  }> = [
    {
      email: "omar.rahman@via-int.com",
      name: "Omar Rahman",
      role: "Employee",
      path: "/staff",
      heading: /Welcome back/i,
    },
    {
      email: "layla.harthy@via-int.com",
      name: "Layla Al Harthy",
      role: "Line Manager",
      path: "/staff/performance/team",
      heading: "Team Performance",
    },
    {
      email: "rana.nair@via-int.com",
      name: "Rana Nair",
      role: "HR",
      path: "/staff/candidates",
      heading: "Candidate Pool",
    },
    {
      email: "mariam.said@via-int.com",
      name: "Mariam Said",
      role: "Accounts",
      path: "/staff/payroll/overtime",
      heading: "Overtime Payroll Ledger",
    },
    {
      email: "yusuf.balushi@via-int.com",
      name: "Yusuf Al Balushi",
      role: "Super Admin",
      path: "/staff/users",
      heading: "User Management",
    },
  ];
  for (const rolePage of rolePages) {
    await signInAs(page, rolePage.email, rolePage.name, rolePage.path);
    await expect(page.getByRole("heading", { name: rolePage.heading }).first()).toBeVisible({
      timeout: 30_000,
    });
  }
});
test("production release smoke request centre loads HR tracking and personal approval inbox", async ({
  page,
}) => {
  test.skip(
    !portalSecret || process.env["PORTAL_SSO_ENABLED"] !== "true",
    "Requires isolated portal SSO configuration",
  );
  await signInAs(page, "rana.nair@via-int.com", "Rana Nair", "/staff/requests?view=organisation");
  await expect(
    page.getByRole("heading", { name: "Organisation Tracker", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Loading requests…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/Requests could not be refreshed/)).toHaveCount(0);
  await page
    .getByRole("link", { name: /^Needs My Approval/ })
    .last()
    .click();
  await expect(page.getByRole("heading", { name: "Needs My Approval", exact: true })).toBeVisible();
  await expect(page.getByText("Loading requests…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/Requests could not be refreshed/)).toHaveCount(0);
  await signInAs(page, "omar.rahman@via-int.com", "Omar Rahman", "/staff/requests?view=my");
  await expect(page.getByRole("heading", { name: "My Requests", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Loading requests…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/Requests could not be refreshed/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Organisation Tracker", exact: true })).toHaveCount(
    0,
  );
});
