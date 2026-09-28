import { expect, test } from "@playwright/test";

for (const size of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(
    size.name + " loading keeps the VIA logo still and respects reduced motion",
    async ({ page }) => {
      await page.setViewportSize(size);
      let release!: () => void;
      let identityRequested = false;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Hold identity loading: this checks presentation without accessing a database.
      await page.route("**/auth/session", async (route) => {
        identityRequested = true;
        await pending;
        await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      });
      try {
        await page.goto("/staff");
        await expect.poll(() => identityRequested, { timeout: 30000 }).toBe(true);
        const status = page.getByRole("status").filter({ hasText: "VIA HR System is loading." });
        const logo = status.getByRole("img", { name: "VIA International" });
        await expect(logo).toBeVisible();
        expect(await logo.evaluate((element) => getComputedStyle(element).animationName)).toBe(
          "none",
        );
        expect(await logo.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
        const dots = status.locator('[aria-hidden="true"] > span');
        await expect(dots).toHaveCount(3);
        expect(
          await dots.first().evaluate((element) => getComputedStyle(element).animationName),
        ).toBe("pulse");
        await expect(status.locator(".sr-only")).toHaveText("VIA HR System is loading.");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({ path: test.info().outputPath("stationary-logo.png") });
        await page.emulateMedia({ reducedMotion: "reduce" });
        expect(
          await dots.first().evaluate((element) => getComputedStyle(element).animationName),
        ).toBe("none");
        release();
        await expect(status).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Your VIA Portal session could not be loaded" }),
        ).toBeVisible();
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    },
  );
}
