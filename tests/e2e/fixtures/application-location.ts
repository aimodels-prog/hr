import type { Page } from "@playwright/test";

export async function selectApplicationLocation(page: Page, country: string, area: string) {
  await page.getByRole("combobox", { name: /Current country/i }).click();
  await page.getByPlaceholder("Search countries").fill(country);
  await page.getByRole("option", { name: country, exact: true }).click();
  await page.locator('input[name="locationArea"]').fill(area);
}
