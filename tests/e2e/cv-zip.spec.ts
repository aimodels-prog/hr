import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { textPdf } from "./pdf-fixture";

test("CV ZIP exports portal uploads together with original bytes and protects access", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const unique = `Zip${Date.now()}`;
  const originals = [
    textPdf(`${unique} first original CV. Experience: logistics manager.`),
    textPdf(`${unique} second original CV. Experience: finance manager.`),
  ];
  await page.addInitScript(() =>
    localStorage.setItem(
      "via_hr:dev_preview_state",
      JSON.stringify({ userId: "user-rana", activeRole: "HR" }),
    ),
  );
  for (let index = 0; index < 2; index++) {
    await page.goto("/jobs/log-ops-lead");
    await expect(page.getByRole("heading", { name: "Apply for this position" })).toBeVisible({
      timeout: 30_000,
    });
    const fields = {
      firstName: "CV",
      lastName: unique,
      email: `${unique.toLowerCase()}.${index}@example.test`,
      phone: `+97150${String(Date.now()).slice(-6)}${index}`,
      location: "Dubai",
      yearsOfExperience: "8",
      noticePeriod: "30 days",
      currentCompany: "Test Company",
      currentTitle: "Manager",
      salaryExpectation: "18000",
    };
    for (const [name, value] of Object.entries(fields))
      await page.locator(`input[name="${name}"]`).fill(value);
    const areas = page.locator("textarea");
    for (let item = 0; item < (await areas.count()); item++)
      await areas.nth(item).fill("Relevant professional experience with evidence.");
    await page.locator('input[type="file"]').setInputFiles({
      name: "Original CV.pdf",
      mimeType: "application/pdf",
      buffer: originals[index]!,
    });
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Submit Application" }).click();
    await expect(page.getByText("Application Received")).toBeVisible();
  }
  await page.goto("/staff/candidates");
  await page.getByPlaceholder("Search by name, email, title...").fill(unique);
  await page.getByRole("button", { name: "Download CVs (ZIP)", exact: true }).click();
  await expect(page.getByText(/2 CV files · 2 candidates/)).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP", exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const cvs = Object.entries(files).filter(([name]) => name.endsWith("/Original CV.pdf"));
  expect(cvs).toHaveLength(2);
  for (const original of originals)
    expect(cvs.some(([, bytes]) => Buffer.from(bytes).equals(original))).toBe(true);
  expect(files["EXPORT-SUMMARY.txt"]).toBeTruthy();
  const errors = await page.evaluate(async () => {
    const path = "/src/lib/server-functions/candidate.server.ts";
    const { prepareCandidateCvZipFn } = await import(/* @vite-ignore */ path);
    const results: string[] = [];
    for (const activeRole of ["Employee", "HR"]) {
      try {
        await prepareCandidateCvZipFn({
          data: {
            actor: { actorId: "user-rana", actorEmail: "rana.nair@via-int.com", activeRole },
            candidateIds: ["00000000-0000-4000-8000-000000000001"],
            reason: "CV ZIP access test",
          },
        });
        results.push("unexpected success");
      } catch (error) {
        results.push(String(error));
      }
    }
    return results;
  });
  expect(errors[0]).toMatch(/Only HR|authoris|session/i);
  expect(errors[1]).toMatch(/no longer available/i);
});
