import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

async function signIn(page: Page, userId: string, activeRole: string, path: string) {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System is loading.", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.evaluate(
    (state) => localStorage.setItem("via_hr:dev_preview_state", JSON.stringify(state)),
    { userId, activeRole },
  );
  await page.goto(path);
}

test("employee contacts save immediately, persist on reload and do not create HR approvals", async ({
  page,
}) => {
  const sql = postgres(process.env["VIA_HR_TEST_DATABASE_URL"]!, { max: 1, prepare: false });
  const [before] =
    await sql`SELECT id,organisation_id,phone,whatsapp_number FROM employees WHERE work_email='omar.rahman@via-int.com'`;
  const [requestsBefore] =
    await sql`SELECT count(*)::int AS n FROM profile_change_requests WHERE employee_id=${before!.id}`;
  const [notificationsBefore] =
    await sql`SELECT count(*)::int AS n FROM notifications WHERE organisation_id=${before!.organisation_id} AND type='profile.review-requested'`;
  try {
    await signIn(page, "user-omar", "Employee", "/staff/me/profile#personal");
    await page.getByRole("button", { name: "Edit details", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Personal Details", exact: true });
    await expect(dialog.getByLabel("Date of Birth", { exact: true })).toHaveJSProperty(
      "readOnly",
      true,
    );
    await expect(dialog.getByLabel("Nationality", { exact: true })).toHaveJSProperty(
      "readOnly",
      true,
    );
    await expect(dialog.getByRole("button", { name: "Send to HR for review" })).toHaveCount(0);
    await dialog.getByLabel("Personal Phone", { exact: true }).fill("+968 9000 7100");
    await dialog.getByLabel("WhatsApp number", { exact: true }).fill("+968 9000 7200");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("+968 9000 7200", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("+968 9000 7200", { exact: true })).toBeVisible();
    const [after] = await sql`SELECT phone,whatsapp_number FROM employees WHERE id=${before!.id}`;
    expect(after!.phone).toBe("+968 9000 7100");
    expect(after!.whatsapp_number).toBe("+968 9000 7200");
    const [requestsAfter] =
      await sql`SELECT count(*)::int AS n FROM profile_change_requests WHERE employee_id=${before!.id}`;
    const [notificationsAfter] =
      await sql`SELECT count(*)::int AS n FROM notifications WHERE organisation_id=${before!.organisation_id} AND type='profile.review-requested'`;
    expect(requestsAfter!.n).toBe(requestsBefore!.n);
    expect(notificationsAfter!.n).toBe(notificationsBefore!.n);
  } finally {
    await sql`UPDATE employees SET phone=${before!.phone}, whatsapp_number=${before!.whatsapp_number},record_version=record_version+1 WHERE id=${before!.id}`;
    await sql.end();
  }
});

test("HR verifies a passport and corrects profile identity in the same action", async ({
  page,
}) => {
  const sql = postgres(process.env["VIA_HR_TEST_DATABASE_URL"]!, { max: 1, prepare: false });
  const [before] =
    await sql`SELECT id,organisation_id,legal_name,date_of_birth::text,nationality FROM employees WHERE work_email='omar.rahman@via-int.com'`;
  const [hr] = await sql`SELECT id FROM users WHERE workspace_email='rana.nair@via-int.com'`;
  const [identifiers] =
    await sql`SELECT * FROM employee_sensitive_identifiers WHERE employee_id=${before!.id}`;
  const documentId = randomUUID();
  const fileId = randomUUID();
  try {
    // Seed a pending document record; file upload/storage is covered by the database suite.
    await sql`INSERT INTO file_metadata(id,organisation_id,name,mime_type,size,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES (${fileId},${before!.organisation_id},'identity-review-test.pdf','application/pdf',20,'employee-document',${documentId},${hr!.id},${hr!.id})`;
    await sql`INSERT INTO employee_documents(id,organisation_id,employee_id,type,file_id,status,visibility,created_by,updated_by) VALUES (${documentId},${before!.organisation_id},${before!.id},'passport',${fileId},'Pending Verification','Restricted',${hr!.id},${hr!.id})`;
    await signIn(
      page,
      "user-rana",
      "HR",
      `/staff/employees/employee-omar#section=documents&document=${documentId}`,
    );
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Complete and verify document", exact: true });
    await dialog.getByLabel("Document number", { exact: false }).fill("P-BROWSER-VERIFIED");
    await dialog.getByLabel("Issuing authority", { exact: false }).fill("Test Authority");
    await dialog.getByLabel("Issue date", { exact: false }).fill("2025-01-01");
    await dialog.getByLabel("Expiry date", { exact: false }).fill("2030-01-01");
    await dialog
      .getByRole("checkbox", { name: "Update profile identity from this document" })
      .check();
    await dialog.getByLabel("Legal name", { exact: true }).fill("Omar Verified Identity");
    await dialog.getByLabel("Date of birth", { exact: true }).fill("1990-04-12");
    await dialog.getByLabel("Nationality", { exact: true }).fill("Omani");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: test.info().outputPath("identity-verification-mobile.png") });
    await dialog.getByRole("button", { name: "Save and verify", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const [after] =
      await sql`SELECT legal_name,date_of_birth::text,nationality FROM employees WHERE id=${before!.id}`;
    expect(after).toMatchObject({
      legal_name: "Omar Verified Identity",
      date_of_birth: "1990-04-12",
      nationality: "Omani",
    });
    const [document] = await sql`SELECT status FROM employee_documents WHERE id=${documentId}`;
    expect(document!.status).toBe("Valid");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Omar Verified Identity", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Correct profile identity", exact: true }).click();
    const correction = page.getByRole("dialog", { name: "Correct profile identity", exact: true });
    await expect(correction.getByLabel("Document number", { exact: false })).toHaveCount(0);
    await correction.getByLabel("Legal name", { exact: true }).fill("Omar Verified Correction");
    await correction.getByRole("button", { name: "Save identity correction", exact: true }).click();
    await expect(correction).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Omar Verified Correction", exact: true }),
    ).toBeVisible();
  } finally {
    await sql`DELETE FROM notifications WHERE link->>'entityId'=${documentId}`;
    await sql`DELETE FROM document_versions WHERE document_id=${documentId}`;
    await sql`DELETE FROM employee_documents WHERE id=${documentId}`;
    await sql`DELETE FROM file_metadata WHERE id=${fileId}`;
    await sql`UPDATE employees SET legal_name=${before!.legal_name},date_of_birth=${before!.date_of_birth},nationality=${before!.nationality},record_version=record_version+1 WHERE id=${before!.id}`;
    if (identifiers)
      await sql`UPDATE employee_sensitive_identifiers SET passport_number_encrypted=${identifiers.passport_number_encrypted},record_version=record_version+1 WHERE employee_id=${before!.id}`;
    else await sql`DELETE FROM employee_sensitive_identifiers WHERE employee_id=${before!.id}`;
    await sql.end();
  }
});
