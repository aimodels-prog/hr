import { expect, test } from "@playwright/test";

// Covers the Core HR modules that had no browser-level coverage at all: Directory, Employee
// Files, Onboarding and Offboarding. Setup (creating a fresh new-hire record) goes through
// page.evaluate() calling the real service classes directly, the same pattern the recruitment
// e2e test uses - the actual UI interactions that matter (searching the directory, starting an
// onboarding case through the real dialog, starting an offboarding case through the real dialog
// with the template/HR-owner/confidentiality fields, opening both case detail pages) are driven
// through the browser.
test("Directory, Files, Onboarding and Offboarding are usable end to end in the browser", async ({
  page,
}) => {
  const unique = Date.now().toString().slice(-6);

  await page.goto("/staff/employees");
  // Wait for the app to fully boot (seed data initialised) before reaching into its services -
  // otherwise this can race the app's own startup seeding.
  await expect(page.getByText("Employee Directory").first()).toBeVisible({ timeout: 20_000 });

  const newHire = await page.evaluate(async (suffix) => {
    const { EmployeeService } = await import("/src/lib/data/employee-service.ts");
    const actor = {
      actor: {
        userId: "user-rana",
        employeeId: "employee-rana",
        displayName: "Rana Nair",
        workspaceEmail: "rana.nair@via-int.com",
        roles: ["Employee", "HR"],
        activeRole: "HR",
      },
    };
    const service = new EmployeeService();
    const { employee } = await service.createEmployee(
      {
        employeeNumber: `VIA-E2E-${suffix}`,
        legalName: `Browser Newhire ${suffix}`,
        preferredName: `Newhire${suffix}`,
        workEmail: `browser.newhire.${suffix}@via-int.com`,
        department: "Operations",
        position: "Coordinator",
        location: "Muscat, Oman",
        employmentType: "Full-time",
        startDate: new Date().toISOString().slice(0, 10),
        status: "Onboarding",
        lineManagerId: "employee-layla",
      },
      ["Employee"],
      actor,
    );
    return {
      id: employee.id,
      legalName: employee.legalName,
      employeeNumber: employee.employeeNumber,
    };
  }, unique);

  // --- Directory ---
  await page.reload();
  await expect(page.getByText("Employee Directory").first()).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Search name or ID...").fill(newHire.employeeNumber);
  await expect(page.getByText(newHire.employeeNumber, { exact: true })).toBeVisible();

  // HR can create a missing dropdown option while editing employment details, without leaving
  // the employee workflow or opening the wider system-settings area.
  await page.goto(`/staff/employees/${newHire.id}`);
  await page.getByRole("tab", { name: /Employment/ }).click();
  await page.getByRole("button", { name: "Edit employment details" }).click();
  const employmentDialog = page.getByRole("dialog", { name: "Update Employment Records" });
  await employmentDialog.getByRole("button", { name: "Add department" }).click();
  const newDepartment = `Browser Department ${unique}`;
  await employmentDialog.getByLabel("New department").fill(newDepartment);
  await employmentDialog.getByRole("button", { name: "Add and select" }).click();
  await expect(page.getByText(`${newDepartment} added as a new department`)).toBeVisible();
  await expect(employmentDialog.getByRole("combobox").first()).toHaveText(newDepartment);
  await page.keyboard.press("Escape");

  // HR can arrange the company structure from the organisation chart itself. The update is
  // persisted through the reporting-line transaction, including the special top-level position.
  await page.goto("/staff/org-chart");
  await expect(page.getByRole("heading", { name: "Organisation Chart" })).toBeVisible();
  await page.getByLabel("Employee to arrange").click();
  await page.getByRole("option", { name: new RegExp(`Newhire${unique}`) }).click();
  await page.getByLabel("Reports to").click();
  await page.getByRole("option", { name: "Top of organisation" }).click();
  await page.getByLabel("Reason").fill("Country reporting structure confirmed by HR");
  await page.getByRole("button", { name: "Save reporting line" }).click();
  await expect(page.getByText("Reporting line updated.")).toBeVisible();

  // --- Employee Files ---
  await page.goto("/staff/files");
  await expect(page.getByText("Employee Files").first()).toBeVisible();
  await page
    .getByPlaceholder("Search by employee name, number, or document type...")
    .fill(newHire.employeeNumber);
  // No documents exist yet for a brand-new hire - the page must show its empty state rather
  // than erroring, proving the scoped read path handles "nothing matched" cleanly.
  await expect(page.getByText(/no (documents|files) found/i)).toBeVisible();

  // --- Onboarding: start a case through the real dialog ---
  await page.goto("/staff/onboarding");
  await expect(
    page.getByRole("heading", { name: "Onboarding and employee setup", exact: true }),
  ).toBeVisible();
  // The trigger and the dialog's own submit button are both labelled "Start onboarding" - the
  // dialog's copy is hidden (but present in the DOM) until opened, so .first() reliably hits
  // the trigger.
  await page.getByRole("button", { name: "Start onboarding" }).first().click();
  const onboardingDialog = page.getByRole("dialog", { name: "Start employee onboarding" });
  await expect(onboardingDialog).toBeVisible();

  const employeeSelect = onboardingDialog
    .getByText("Employee", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await employeeSelect.click();
  await page
    .getByRole("option", { name: new RegExp(`${newHire.legalName}.*${newHire.employeeNumber}`) })
    .click();

  const templateSelect = onboardingDialog
    .getByText("Checklist template", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await templateSelect.click();
  await page.getByRole("option").first().click();

  await onboardingDialog.getByRole("button", { name: "Start onboarding", exact: true }).click();
  await expect(page.getByText(newHire.legalName, { exact: true }).first()).toBeVisible();

  // --- Offboarding: start a case through the real dialog, exercising the template / HR owner /
  // confidentiality fields added this session ---
  await page.goto("/staff/offboarding");
  await expect(page.getByRole("heading", { name: "Offboarding", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start Offboarding" }).click();
  const offboardingDialog = page.getByRole("dialog", { name: "Start Offboarding Case" });
  await expect(offboardingDialog).toBeVisible();

  const offboardingEmployeeSelect = offboardingDialog
    .getByText("Employee", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await offboardingEmployeeSelect.click();
  await page.getByRole("option", { name: /Omar/ }).click();

  const offboardingTemplateSelect = offboardingDialog
    .getByText("Offboarding Template", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await offboardingTemplateSelect.click();
  await page.getByRole("option").first().click();

  const ownerSelect = offboardingDialog
    .getByText("HR Case Owner", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await ownerSelect.click();
  await page.getByRole("option", { name: /Rana Nair/ }).click();

  const confidentialitySelect = offboardingDialog
    .getByText("Confidentiality Level", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await confidentialitySelect.click();
  await page.getByRole("option", { name: /Restricted/ }).click();
  await offboardingDialog
    .locator('textarea[name="confidentialNotes"]')
    .fill("Restricted handover and access-removal instructions for the assigned HR case owner.");

  const reasonSelect = offboardingDialog
    .getByText("Reason Category", { exact: true })
    .locator("..")
    .getByRole("combobox");
  await reasonSelect.click();
  await page.getByRole("option", { name: "Resignation", exact: true }).click();

  await offboardingDialog
    .locator('input[name="noticeDate"]')
    .fill(new Date().toISOString().slice(0, 10));
  const lastWorkingDate = new Date();
  lastWorkingDate.setDate(lastWorkingDate.getDate() + 30);
  await offboardingDialog
    .locator('input[name="lastWorkingDate"]')
    .fill(lastWorkingDate.toISOString().slice(0, 10));

  await offboardingDialog.getByRole("button", { name: "Start Case" }).click();
  await expect(page.locator("[data-sonner-toast]").last()).toContainText(
    "Offboarding case started",
  );
  await expect(offboardingDialog).toBeHidden();
  const omarRow = page.getByRole("row", { name: /Omar Rahman/ });
  await expect(omarRow).toBeVisible();
  await expect(omarRow.getByText("In Progress", { exact: true })).toBeVisible();

  // Open the offboarding case detail page - this is exactly the read path that must confirm
  // access and redact confidentialNotes before the case ever lands in component state.
  await omarRow.getByRole("link", { name: "Open Case" }).click();
  await expect(page.getByText(/Offboarding: Omar/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Restricted", { exact: true })).toBeVisible();
});
