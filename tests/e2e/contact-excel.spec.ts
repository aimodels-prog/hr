import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import readExcelFile from "read-excel-file/node";

async function asHR(page: Page, path: string) {
  await page.goto("/staff");
  await expect(page.getByText("VIA HR System is loading.", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.evaluate(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
    ),
  );
  await page.goto(path);
}

test("HR saves a separate WhatsApp number from the employee's profile", async ({ page }) => {
  const url = process.env["VIA_HR_TEST_DATABASE_URL"];
  expect(url).toBeTruthy();
  expect(new URL(url!).pathname).toMatch(/test|scratch/);
  const sql = postgres(url!, { max: 1 });
  const [before] =
    await sql`SELECT id,phone,whatsapp_number FROM employees WHERE work_email='omar.rahman@via-int.com'`;
  expect(before).toBeTruthy();
  try {
    await asHR(page, "/staff/employees/employee-omar#section=personal");
    await page.getByRole("button", { name: "Edit details", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Personal Details", exact: true });
    await dialog.getByLabel("WhatsApp number", { exact: true }).fill("+968 9000 4321");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("+968 9000 4321", { exact: true })).toBeVisible();
    const [after] = await sql`SELECT phone,whatsapp_number FROM employees WHERE id=${before!.id}`;
    expect(after!.phone).toBe(before!.phone);
    expect(after!.whatsapp_number).toBe("+968 9000 4321");
    await page.reload();
    await expect(page.getByText("+968 9000 4321", { exact: true })).toBeVisible();
  } finally {
    await sql`UPDATE employees SET whatsapp_number=${before!.whatsapp_number}, record_version=record_version+1 WHERE id=${before!.id}`;
    await sql.end();
  }
});

test("Reports downloads a real Excel workbook with the applied employee filter", async ({
  page,
}) => {
  await asHR(page, "/staff/reports");
  await page.getByRole("link", { name: "Headcount & Diversity", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByPlaceholder("Filter results...").fill("Omar");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Omar Rahman", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Excel (.xlsx)", exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(/^via-headcount-.*\.xlsx$/);
  const sheets = await readExcelFile((await file.path())!);
  expect(sheets[0]!.data).toHaveLength(2);
  expect(sheets[0]!.data[0]![0]).toBe("Employee ID");
  expect(sheets[0]!.data[1]![1]).toBe("Omar Rahman");
});
