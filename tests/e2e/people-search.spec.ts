import { expect, test, type Page } from "@playwright/test";

test("people search: 150 names, stable IDs, clearing, disabled people and multiple selections", async ({
  page,
}) => {
  await page.goto("/staff/help");
  await expect(page.getByRole("heading", { name: "Help & Knowledge", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(async () => {
    for (const child of Array.from(document.body.children)) child.setAttribute("hidden", "");
    const root = document.createElement("div");
    root.id = "test-root";
    document.body.append(root);
    // Vite serves this test-only module; no fixture is imported by a production route.
    const fixture = "/tests/e2e/fixtures/people-picker.tsx";
    await import(/* @vite-ignore */ fixture);
  });
  const trigger = page.getByLabel("Employee", { exact: true });
  await trigger.click();
  const search = page.getByRole("combobox", { name: "Type a name to search…", exact: true });
  await expect(page.getByRole("option")).toHaveCount(151);
  await search.fill("alex148@example.test");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByLabel("Selected ID")).toHaveText("id-148");
  await trigger.click();
  await search.fill("via-149");
  await expect(page.getByRole("option")).toHaveAttribute("aria-disabled", "true");
  await search.press("Enter");
  await expect(page.getByLabel("Selected ID")).toHaveText("id-148");
  await search.fill("No person");
  await page.getByRole("option").click();
  await expect(page.getByLabel("Selected ID")).toHaveText("empty");
  const multi = page.getByRole("searchbox", { name: "Search interviewers" });
  await multi.fill("alex120@example.test");
  await page.getByRole("checkbox").check();
  await multi.fill("alex121@example.test");
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("status").filter({ hasText: "2 selected" })).toBeVisible();
  await multi.fill("no-results-zz");
  await expect(page.getByText("No matching people found.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Alex Smith · VIA-120", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 selected" })).toBeVisible();
});

async function asRole(page: Page, role: "Employee" | "HR" | "Accounts", path: string) {
  await page.goto("/staff/help");
  await expect(page.getByRole("heading", { name: "Help & Knowledge", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(
    ({ role, userId }) =>
      localStorage.setItem(
        "via_hr:dev_preview_state",
        JSON.stringify({ userId, activeRole: role }),
      ),
    {
      role,
      userId: role === "HR" ? "user-rana" : role === "Accounts" ? "user-mariam" : "user-omar",
    },
  );
  await page.goto(path);
}

test("people search: covering colleague supports keyboard, no results and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asRole(page, "Employee", "/staff/me/leave-balances");
  await page
    .getByRole("button", { name: /Request Leave/ })
    .first()
    .click();
  const trigger = page.getByRole("combobox", { name: "Covering Colleague", exact: true });
  await trigger.click();
  const search = page.getByRole("combobox", { name: "Type a name to search…", exact: true });
  await expect(search).toBeFocused();
  const target = (
    await page
      .getByRole("option")
      .filter({ hasNotText: "No covering colleague" })
      .first()
      .innerText()
  ).trim();
  await search.fill(target);
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(trigger).toContainText(target);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.fill("not-a-real-colleague-zzzz");
  await expect(page.getByText("No matches found.", { exact: true })).toBeVisible();
  await search.press("Escape");
  await expect(trigger).toContainText(target);
  await expect(page.getByRole("dialog", { name: "Request Leave", exact: true })).toBeVisible();
  await trigger.click();
  await expect(search).toHaveValue("");
  const box = await page.getByRole("listbox").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "playwright-report/people-search-mobile.png",
    animations: "disabled",
  });
});

test("people search: HR late sick leave and Finance payslip keep their selected employee", async ({
  page,
}) => {
  await asRole(page, "HR", "/staff/leave-admin");
  await page.getByRole("button", { name: "Permit backdated sick leave" }).click();
  await page.getByLabel("Employee", { exact: true }).click();
  const search = page.getByRole("combobox", { name: "Type a name to search…", exact: true });
  const name = (await page.getByRole("option").first().innerText()).trim();
  await search.fill(name);
  await page.getByRole("option").first().click();
  await expect(page.getByLabel("Employee", { exact: true })).toContainText(name);
  await asRole(page, "Accounts", "/staff/payslips");
  await page.getByRole("button", { name: "Manage employee payslips", exact: true }).click();
  await page.getByLabel("Employee", { exact: true }).click();
  const employee = (await page.getByRole("option").first().innerText()).trim();
  const email = employee.split(" — ").at(-1)!;
  await search.fill(email);
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option").click();
  await expect(page.getByLabel("Employee", { exact: true })).toContainText(employee);
});
