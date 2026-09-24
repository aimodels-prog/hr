import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";

type ProductionRole = "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin";

const portalSecret = process.env["PORTAL_SSO_SECRET"] ?? "";

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
  await expect(page.getByText(/Viewing: Rana.*Individual overview/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Employee insights" })).toBeVisible();
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
  await expect(page.getByText(/Viewing: Rana.*Individual overview/)).toBeVisible();
  await page.getByRole("button", { name: "Clear employee filter" }).click();
  await expect(page.getByRole("heading", { name: "Recruitment pipeline" })).toBeVisible();
  await page.goto("/staff/me/attendance");
  await expect(page.getByRole("heading", { name: "Worked hours vs expected hours" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "My attendance summary" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My annual leave balance" })).toBeVisible();
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
  await page.getByRole("button", { name: /Rana Nair,/ }).click();
  await page.getByRole("button", { name: "Sign out of VIA HR" }).click();
  await expect(page).toHaveURL(/\/auth\/signed-out$/);
  await expect(page.getByRole("heading", { name: "You are signed out of VIA HR" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue to VIA Portal" })).toHaveAttribute(
    "href",
    "https://portal.via-int.com/",
  );
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
  await expect(page.getByText("Loading your VIA profile and permissions")).toHaveCount(0, {
    timeout: 30_000,
  });
}

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
  const recruitmentMenu = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^Recruitment$/ }) });
  await expect(recruitmentMenu).not.toHaveAttribute("open", "");
  await recruitmentMenu.locator("summary").click();
  await expect(recruitmentMenu.getByRole("link", { name: "Vacancies", exact: true })).toBeVisible();
  await recruitmentMenu.locator("summary").click();
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
    buffer: Buffer.from(
      "%PDF-1.4\nProduction release candidate logistics operations leadership\n%%EOF",
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
test("request centre loads HR tracking and personal approval inbox", async ({ page }) => {
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
