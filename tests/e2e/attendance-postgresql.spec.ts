import { createHash, createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

type PreviewRole = "Employee" | "HR" | "Accounts";

test("terminal refresh survives identity updates and recovers from a stalled request", async ({
  page,
}) => {
  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff/attendance#section=terminals");
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toBeEnabled({ timeout: 30000 });
  let sessionReads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/session")) sessionReads++;
  });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("via_hr:data_changed")));
  await expect(refresh).toBeEnabled();
  // Force a stalled device read, then let the following retry use the real server.
  await page.evaluate(async () => {
    const modulePath = "/src/lib/data/attendance-service.ts";
    const { AttendanceService } = await import(/* @vite-ignore */ modulePath);
    const original = AttendanceService.prototype.listDeviceAdministrationAsync;
    AttendanceService.prototype.listDeviceAdministrationAsync = function () {
      AttendanceService.prototype.listDeviceAdministrationAsync = original;
      return new Promise(() => {});
    };
  });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(page.getByText("No door terminal has been registered yet.")).toHaveCount(0);
  await expect(page.getByText(/Loading terminals timed out/)).toBeVisible({ timeout: 25000 });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(page.getByText(/Loading terminals timed out/)).toHaveCount(0);
  await expect(refresh).toBeEnabled({ timeout: 30000 });
  expect(sessionReads).toBeLessThan(5);
});

test("HR work areas consistently expose section menus instead of tab rows", async ({ page }) => {
  await page.goto("/staff");
  for (const path of [
    "/staff/leave-admin",
    "/staff/onboarding",
    "/staff/training",
    "/staff/leave-approvals",
    "/staff/attendance/corrections",
    "/staff/overtime-approvals",
    "/staff/document-expiry",
    "/staff/company-library",
  ]) {
    await previewAs(page, "user-rana", "HR", path);
    const nav = page.getByRole("navigation", { name: "Page sections", exact: true });
    await expect(nav).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("tablist")).toHaveCount(0);
    const last = nav.getByRole("link").last();
    await last.click();
    await expect(last).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-section-content]").first()).toBeVisible();
  }
});

test("HR page sections work as side navigation on desktop and a menu on phones", async ({
  page,
}) => {
  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff/attendance");
  const navigation = page.getByRole("navigation", { name: "Page sections", exact: true });
  const daily = navigation.getByRole("link", { name: "Today's attendance" });
  await expect(daily).toHaveAttribute("aria-current", "page", { timeout: 30000 });
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const navBox = await navigation.boundingBox();
  const panel = page.locator("[data-section-content]");
  const panelBox = await panel.boundingBox();
  expect(panelBox!.x).toBeGreaterThan(navBox!.x + navBox!.width);
  await navigation.getByRole("link", { name: /Site Visits/ }).click();
  await expect(page).toHaveURL(/#section=site-visits/);
  await expect(navigation.getByRole("link", { name: /Site Visits/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.reload();
  await expect(navigation.getByRole("link", { name: /Site Visits/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(daily).toHaveAttribute("aria-current", "page");
  await page.screenshot({
    path: test.info().outputPath("hr-sections-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.locator("details[data-section-menu]");
  await menu.locator("summary").click();
  await menu.getByRole("link", { name: /Office Setup/ }).click();
  await expect(menu).not.toHaveAttribute("open");
  await expect(menu.locator("summary")).toContainText("Office Setup");
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: test.info().outputPath("hr-sections-mobile.png"), fullPage: true });
  await previewAs(page, "user-rana", "HR", "/staff/leave-admin");
  await expect(page.locator("details[data-section-menu] summary")).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
});

test("employee profile hides pending HR fields and shows confirmed details read-only on mobile", async ({
  page,
}) => {
  const url = process.env["DATABASE_URL"];
  test.skip(
    !url || !/(test|scratch)/i.test(new URL(url!).pathname),
    "Requires isolated PostgreSQL",
  );
  const sql = postgres(url!, { max: 1 });
  const [employee] =
    await sql`SELECT id, employment_confirmation_status FROM employees WHERE organisation_id='aa98aa96-b498-5ca8-8d0d-da19cd34c176' AND preferred_name='Omar' LIMIT 1`;
  expect(employee).toBeTruthy();
  try {
    await sql`UPDATE employees SET employment_confirmation_status='Pending HR Review' WHERE id=${employee.id}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff");
    await previewAs(page, "user-omar", "Employee", "/staff/me/profile");
    await expect(
      page.getByText(
        "HR will add your employment details. You can complete your personal information and documents while you wait.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Profile section").click();
    await page.getByRole("option", { name: "Employment", exact: true }).click();
    await expect(
      page.getByText(
        "HR will add your employment details. You can continue completing your personal information.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Start Date", { exact: true })).toHaveCount(0);
    await sql`UPDATE employees SET employment_confirmation_status='Confirmed' WHERE id=${employee.id}`;
    await page.reload();
    await page.getByLabel("Profile section").click();
    await page.getByRole("option", { name: "Employment", exact: true }).click();
    await expect(page.getByText("Start Date", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Employment", exact: false })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  } finally {
    await sql`UPDATE employees SET employment_confirmation_status=${employee.employment_confirmation_status} WHERE id=${employee.id}`;
    await sql.end();
  }
});

test("HR publishes a policy and staff can read it without seeing restricted company documents", async ({
  page,
}) => {
  test.skip(!process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"], "Requires isolated object storage");
  const title = `SOP browser ${Date.now()}`;
  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff/company-library");
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "Upload document", exact: true });
  await upload.getByLabel("Document name").fill(title);
  await upload.getByLabel("Original PDF").setInputFiles({
    name: "sop.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
  });
  await upload.getByRole("button", { name: "Save draft" }).click();
  await expect(upload).toBeHidden();
  const doc = page.locator("article").filter({ hasText: title });
  await doc.getByRole("button", { name: "Review page text" }).click();
  const review = page.getByRole("dialog", { name: "Review policy text" });
  await review
    .getByLabel("PDF page 1")
    .fill("Notify your supervisor as soon as practical when you are unwell.");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Confirm & publish" }).click();
  await expect(review).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await previewAs(page, "user-omar", "Employee", "/staff/company-library");
  await expect(page.locator("article").filter({ hasText: title })).toContainText("Published");
  await expect(page.getByRole("button", { name: "Upload document", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Company register", exact: true })).toHaveCount(0);
  await page.locator("details[data-section-menu] summary").click();
  await page.getByRole("link", { name: "Ask VIA Policies", exact: true }).click();
  await expect(page.getByLabel("Your question")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test("Finance shares a protected payslip and the employee downloads it on mobile", async ({
  page,
}) => {
  test.skip(!process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"], "Requires isolated object storage");
  const month = `${4000 + Number(String(Date.now()).slice(-3))}-09`;
  await page.goto("/staff");
  await previewAs(page, "user-mariam", "Accounts", "/staff/payslips");
  await page.getByRole("button", { name: "Manage employee payslips" }).click();
  const employee = page.getByLabel("Employee", { exact: true });
  const option = await employee
    .locator("option")
    .filter({ hasText: /Omar/ })
    .first()
    .getAttribute("value");
  await employee.selectOption(option!);
  await page.getByLabel("Pay month", { exact: true }).fill(month);
  await page.getByLabel("Payslip PDF (maximum 10 MB)").setInputFiles({
    name: "private-payslip.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"),
  });
  await page.getByRole("button", { name: "Upload & share" }).click();
  await expect(page.getByText("Payslip shared with the employee.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await previewAs(page, "user-omar", "Employee", "/staff/payslips");
  const slip = page.locator("article").filter({ hasText: month });
  await expect(slip).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage employee payslips" })).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await slip.getByRole("button", { name: "Download PDF" }).click();
  expect((await downloaded).suggestedFilename()).toBe("private-payslip.pdf");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await previewAs(page, "user-rana", "HR", "/staff/payslips");
  await expect(page.getByText("No payslips have been shared yet.")).toBeVisible();
});

test("HR grants date-specific sick leave permission from a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff/leave-admin");
  await page.getByRole("button", { name: "Permit backdated sick leave" }).click();
  const dialog = page.getByRole("dialog", { name: "Permit backdated sick leave" });
  const employee = dialog.getByLabel("Employee", { exact: true });
  const option = await employee
    .locator("option")
    .filter({ hasText: /Omar/ })
    .first()
    .getAttribute("value");
  expect(option).toBeTruthy();
  await employee.selectOption(option!);
  const date = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel("First sick day").fill(date);
  await dialog.getByLabel("Last sick day").fill(date);
  await dialog
    .getByLabel("Reason for allowing late submission")
    .fill("Test: too unwell to apply at the time");
  await dialog.getByRole("button", { name: "Grant permission" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Permission granted. The employee has 14 days/)).toBeVisible();
});

test("workforce charts load real data for HR and personal attendance on mobile", async ({
  page,
}) => {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  await previewAs(page, "user-rana", "HR", "/staff");
  const insights = page.getByRole("region", { name: "HR insights", exact: true });
  await expect(insights).toBeVisible({ timeout: 30_000 });
  await expect(
    insights.getByRole("heading", { name: "Worked hours vs expected hours" }),
  ).toBeVisible();
  await expect(insights.getByRole("heading", { name: "Recruitment pipeline" })).toBeVisible();
  await insights.getByLabel("Chart period").selectOption("7");
  await expect(
    insights.getByRole("heading", { name: "Worked hours vs expected hours" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await previewAs(page, "user-omar", "Employee", "/staff/me/attendance");
  const personal = page.getByRole("region", { name: "My working hours", exact: true });
  await expect(personal).toBeVisible({ timeout: 30_000 });
  await expect(
    personal.getByRole("heading", { name: "Worked hours vs expected hours" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recruitment pipeline" })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await personal.screenshot({ path: test.info().outputPath("personal-hours-mobile.png") });
});

async function previewAs(page: Page, userId: string, activeRole: PreviewRole, path: string) {
  await page.evaluate(
    ({ selectedUser, selectedRole }) => {
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId: selectedUser, activeRole: selectedRole }),
      );
    },
    { selectedUser: userId, selectedRole: activeRole },
  );
  await page.goto(path);
}

test("employee site visit persists to PostgreSQL and HR approval survives a role change", async ({
  page,
}) => {
  const suffix = Date.now().toString();
  const destination = `PostgreSQL browser visit ${suffix}`;
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 3650 + (Number(suffix.slice(-5)) % 5000));
  const visitDate = future.toISOString().slice(0, 10);

  await page.goto("/staff");
  await expect(page.getByText("VIA HR System").first()).toBeVisible();
  await previewAs(page, "user-omar", "Employee", "/staff");
  await page.getByRole("link", { name: "Quick visit", exact: true }).click();
  await expect(page).toHaveURL(/action=site-visit/);
  const requestDialog = page.getByRole("dialog");
  await requestDialog.getByText("Change time, return or add details (optional)").click();
  await requestDialog.getByLabel("Date").fill(visitDate);
  await requestDialog.getByLabel("Start Time").fill("09:00");
  await expect(requestDialog.getByRole("combobox", { name: "Expected return" })).toContainText(
    "Not sure",
  );
  await requestDialog.getByLabel("Site / Destination").fill(destination);
  await requestDialog.getByRole("button", { name: "Ministry visit", exact: true }).click();
  // No purpose essay is required: the selected visit type is saved as the purpose.
  await requestDialog.getByRole("button", { name: "Send to HR" }).click();
  await expect(requestDialog).toBeHidden();
  await expect(page.getByText(/Site visit recorded. HR and your supervisor/)).toBeVisible();

  await previewAs(page, "user-rana", "HR", "/staff/attendance");
  await page.getByRole("link", { name: /Site Visits/ }).click();
  const reviewRow = page.getByRole("row").filter({ hasText: destination });
  await expect(reviewRow).toContainText("Pending HR");
  await reviewRow.getByRole("button", { name: "Review" }).click();
  const reviewDialog = page.getByRole("dialog", { name: "Review Site Visit" });
  await reviewDialog
    .getByPlaceholder("Required HR decision notes")
    .fill("Visit details and operational need confirmed.");
  await reviewDialog.getByRole("button", { name: "Approve" }).click();
  await page.waitForTimeout(500);
  const decisionMessages = await page.locator("[data-sonner-toast]").allTextContents();
  if (decisionMessages.some((message) => /not|could|cannot|error|failed/i.test(message)))
    throw new Error(`Approval feedback: ${decisionMessages.join(" | ")}`);
  await expect(reviewDialog).toBeHidden();
  await expect(reviewRow).toContainText("Approved");

  await previewAs(page, "user-omar", "Employee", "/staff/me/attendance");
  await page.getByRole("tab", { name: /^Visits/ }).click();
  const employeeRow = page.getByRole("row").filter({ hasText: destination });
  await expect(employeeRow).toContainText("Approved");
  await employeeRow.getByRole("button", { name: "Cancel visit" }).click();
  const cancelDialog = page.getByRole("alertdialog");
  await cancelDialog
    .getByLabel("Cancellation reason")
    .fill("Browser workflow verification is now complete.");
  await cancelDialog.getByRole("button", { name: "Cancel visit" }).click();
  await expect(cancelDialog).toBeHidden();
  await expect(employeeRow).toContainText("Cancelled");
});

test("HR can open their own site visit from the dashboard on mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff");
  await page.getByRole("link", { name: "Quick visit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Quick visit" });
  await dialog.getByRole("button", { name: "Ministry visit", exact: true }).click();
  await dialog.getByLabel("Site / Destination").fill("Ministry of Labour");
  await expect(dialog.getByLabel("Date", { exact: true })).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Send to HR" })).toBeEnabled();
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(844 * 0.91);
  expect(bounds!.width).toBeLessThan(390);
  await page.screenshot({ path: testInfo.outputPath("site-visit-mobile.png") });
  await dialog.getByText("Change time, return or add details (optional)").click();
  await expect(dialog.getByRole("combobox", { name: "Expected return" })).toContainText("Not sure");
  await dialog.getByRole("combobox", { name: "Expected return" }).click();
  await page.getByRole("option", { name: "Not returning today" }).click();
  await expect(dialog.getByRole("combobox", { name: "Expected return" })).toContainText(
    "Not returning today",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/action=site-visit/);
});

test("HR creates a one-time code for an office attendance connector", async ({ page }) => {
  const suffix = Date.now().toString();
  const deviceCode = `pair-door-${suffix.slice(-10)}`;
  const deviceName = `Pairing Door ${suffix.slice(-6)}`;

  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff/attendance");
  await page.getByRole("link", { name: /Door Terminals/ }).click();
  await page.getByRole("button", { name: "Register Terminal" }).click();
  const terminalDialog = page.getByRole("dialog", { name: "Register Door Terminal" });
  await terminalDialog.getByLabel("Terminal code").fill(deviceCode);
  await terminalDialog.getByLabel("Terminal name").fill(deviceName);
  await terminalDialog.getByLabel("Office").click();
  await page.getByRole("option").first().click();
  await terminalDialog
    .getByLabel("Reason")
    .fill("Connect the office terminal through the guided installer.");
  await terminalDialog.getByRole("button", { name: "Save Terminal" }).click();
  await expect(terminalDialog).toBeHidden();

  const terminalRow = page.getByRole("row").filter({ hasText: deviceName });
  await terminalRow.getByRole("button", { name: "Connect" }).click();
  const pairingDialog = page.getByRole("dialog", { name: `Connect ${deviceName}` });
  await expect(pairingDialog.getByText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)).toBeVisible();
  await expect(pairingDialog).toContainText("It can be used only once");
  await pairingDialog.getByRole("button", { name: "Done" }).click();
  await expect(pairingDialog).toBeHidden();
});

test("HR registers a door terminal and recovers a signed unmatched punch", async ({
  page,
  request,
}) => {
  const secret = process.env["VIA_HR_ZKTECO_INGEST_SECRET"];
  test.skip(!secret, "A dedicated ZKTeco test secret is required.");
  const suffix = Date.now().toString();
  const deviceCode = `e2e-door-${suffix.slice(-10)}`;
  const deviceName = `E2E Door ${suffix.slice(-6)}`;
  const deviceUserId = `unmatched-${suffix}`;
  const deviceUserName = `Terminal User ${suffix.slice(-4)}`;
  const serialNumber = `E2E-${suffix}`;

  await page.goto("/staff");
  await previewAs(page, "user-rana", "HR", "/staff/attendance");
  await page.getByRole("link", { name: /Door Terminals/ }).click();
  await page.getByRole("button", { name: "Register Terminal" }).click();
  const terminalDialog = page.getByRole("dialog", { name: "Register Door Terminal" });
  await terminalDialog.getByLabel("Terminal code").fill(deviceCode);
  await terminalDialog.getByLabel("Terminal name").fill(deviceName);
  await terminalDialog.getByLabel("Office").click();
  await page.getByRole("option").first().click();
  await terminalDialog.getByLabel("Serial number").fill(serialNumber);
  await terminalDialog
    .getByLabel("Reason")
    .fill("Browser acceptance for the office door terminal.");
  await terminalDialog.getByRole("button", { name: "Save Terminal" }).click();
  await expect(terminalDialog).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: deviceName })).toBeVisible();

  const body = JSON.stringify({
    serialNumber,
    punches: [
      {
        externalEventId: createHash("sha256").update(`${deviceCode}:${suffix}`).digest("hex"),
        deviceUserId,
        deviceUserName,
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        status: 0,
        punchMethod: 1,
      },
    ],
  });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret!)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  const response = await request.post("/api/integrations/zkteco/punches", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-via-device-id": deviceCode,
      "x-via-timestamp": timestamp,
      "x-via-signature": `sha256=${signature}`,
    },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ unmatched: 1, rejected: 0 });

  await page.getByRole("button", { name: "Refresh" }).click();
  const unmatchedRow = page.getByRole("row").filter({ hasText: deviceUserId });
  await expect(unmatchedRow).toBeVisible();
  await expect(unmatchedRow).toContainText(deviceUserName);
  await unmatchedRow.getByRole("button", { name: "Match Employee" }).click();
  const mappingDialog = page.getByRole("dialog", { name: "Match Terminal User" });
  await expect(mappingDialog).toContainText(deviceUserName);
  await mappingDialog.getByLabel("Employee").click();
  await page.getByRole("option").first().click();
  await mappingDialog
    .getByLabel("Reason")
    .fill("HR verified the terminal identity against the employee register.");
  await mappingDialog.getByRole("button", { name: "Confirm Match" }).click();
  await expect(mappingDialog).toBeHidden();
  await expect(page.getByText("Every received terminal user is matched.")).toBeVisible();
});
