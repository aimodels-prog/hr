import { expect, test, type Page, type Route } from "@playwright/test";
import { configureAttendanceFixture } from "./attendance-fixture";

test.beforeAll(configureAttendanceFixture);

// Dev-mode server function IDs encode the function export. No production data or mocks are used.
function functionName(route: Route) {
  const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
  return String(JSON.parse(Buffer.from(id, "base64url").toString("utf8")).export);
}

async function identity(page: Page, role: "HR" | "Employee") {
  await page.addInitScript((activeRole) => {
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({
        userId: activeRole === "HR" ? "user-rana" : "user-omar",
        activeRole,
      }),
    );
  }, role);
}

for (const example of [
  { userId: "user-layla", role: "Line Manager", heading: "Direct Report Readiness" },
  { userId: "user-mariam", role: "Accounts", heading: "Payroll Readiness" },
]) {
  test(`${example.role} dashboard loads its own permitted data`, async ({ page }) => {
    await page.addInitScript(({ userId, role }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId, activeRole: role }),
      );
    }, example);
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: example.heading, exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  });
}

test("a direct employee page does not fetch unrelated module snapshots", async ({ page }) => {
  await identity(page, "Employee");
  const calls: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    calls.push(functionName(route));
    await route.continue();
  });
  await page.goto("/staff/me/training");
  await expect(page.getByRole("heading", { name: "My Learning", exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(calls.some((name) => name.includes("getTrainingSnapshotFn"))).toBe(true);
  for (const unrelated of [
    "getLeaveSnapshotFn",
    "getTimesheetSnapshotFn",
    "getPayrollPeriodsFn",
    "getRecruitmentSnapshotFn",
    "getTravelRequestsFn",
    "getPerformanceSnapshotFn",
  ]) {
    expect(
      calls.some((name) => name.includes(unrelated)),
      unrelated,
    ).toBe(false);
  }
});

test("HR charts and navigation remain usable while recruitment is stalled", async ({ page }) => {
  await identity(page, "HR");
  let stalled = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    if (functionName(route).includes("getRecruitmentSnapshotFn")) {
      stalled = true;
      await hold;
    }
    await route.continue();
  });
  try {
    await page.goto("/staff");
    await expect.poll(() => stalled, { timeout: 30000 }).toBe(true);
    await expect(page.getByRole("heading", { name: "Attendance trend", exact: true })).toBeVisible({
      timeout: 10000,
    });
    // Navigate within the app, keeping the in-flight recruitment request pending.
    await page.getByRole("button", { name: "Approvals", exact: true }).click();
    await page
      .getByRole("link", { name: "Requests & approvals", exact: true })
      .click({ timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: "Requests & approvals", exact: true }),
    ).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Organisation data is unavailable", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("a module failure stays inside the page and can be retried", async ({ page }) => {
  await identity(page, "Employee");
  let fail = true;
  await page.route("**/_serverFn/**", async (route) => {
    if (fail && functionName(route).includes("getLeaveSnapshotFn")) {
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Test leave service unavailable",
      });
    } else await route.continue();
  });
  await page.goto("/staff/me/leave-balances");
  const failure = page.locator('main [role="alert"]');
  await expect(failure.getByRole("button", { name: "Try again", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: "Toggle Sidebar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My Leave", exact: true })).toHaveCount(0);
  fail = false;
  await failure.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Leave", exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(failure).toHaveCount(0);
});

test("employee dashboard charts load before a delayed training snapshot", async ({ page }) => {
  await identity(page, "Employee");
  await page.setViewportSize({ width: 390, height: 844 });
  let stalled = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    if (functionName(route).includes("getTrainingSnapshotFn")) {
      stalled = true;
      await hold;
    }
    await route.continue();
  });
  try {
    await page.goto("/staff");
    await expect.poll(() => stalled, { timeout: 30000 }).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Worked hours vs expected hours", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    release();
    await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible({
      timeout: 10000,
    });
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
