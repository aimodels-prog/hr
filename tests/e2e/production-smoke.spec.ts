import { expect, test, type Page } from "@playwright/test";
import { SignJWT } from "jose";

type ProductionRole = "Employee" | "Line Manager" | "HR" | "Accounts" | "Super Admin";

const portalSecret = process.env["PORTAL_SSO_SECRET"] ?? "";

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

test("production release smoke covers health, secure CV intake and all five roles", async ({
  page,
  request,
}) => {
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
  await expect(page.getByText("Apply for this role")).toBeVisible();
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
