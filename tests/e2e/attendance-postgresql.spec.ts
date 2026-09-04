import { createHash, createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

type PreviewRole = "Employee" | "HR";

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
  await previewAs(page, "user-omar", "Employee", "/staff/me/attendance");

  await page.getByRole("button", { name: "Request Site Visit" }).click();
  const requestDialog = page.getByRole("dialog");
  await requestDialog.getByLabel("Date").fill(visitDate);
  await requestDialog.getByLabel("Start Time").fill("09:00");
  await requestDialog.getByLabel("End Time").fill("12:00");
  await requestDialog.getByLabel("Site / Destination").fill(destination);
  await requestDialog
    .getByLabel("Business Purpose")
    .fill("Verify the PostgreSQL-backed attendance browser workflow.");
  await requestDialog.getByRole("button", { name: "Send to HR" }).click();
  await expect(requestDialog).toBeHidden();
  await expect(page.getByText("Site visit sent to HR for approval.")).toBeVisible();

  await previewAs(page, "user-rana", "HR", "/staff/attendance");
  await page.getByRole("tab", { name: /Site Visits/ }).click();
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
  await page.getByRole("tab", { name: /Site Visits/ }).click();
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
  await page.getByRole("tab", { name: /Door Terminals/ }).click();
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
