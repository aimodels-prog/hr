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
