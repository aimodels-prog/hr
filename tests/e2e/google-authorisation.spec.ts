import { expect, test } from "@playwright/test";
import { googleAuthorisationPage } from "../../src/lib/integrations/google-authorisation-page";
import { addSecurityHeaders } from "../../src/lib/http-security.server";

for (const email of [false, true]) {
  test(`Google ${email ? "email" : "calendar"} approval navigates without a popup or CSP violation`, async ({
    page,
  }) => {
    const origin = "https://hr.example.test";
    const action = `/api/integrations/google-calendar${email ? "?email=enable" : ""}`;
    const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    destination.searchParams.set("state", "test-state");
    destination.searchParams.set(
      "scope",
      `openid email https://www.googleapis.com/auth/calendar.events${email ? " https://www.googleapis.com/auth/gmail.send" : ""}`,
    );
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/form-action|Content Security Policy/i.test(message.text()))
        violations.push(message.text());
    });
    await page.route(`${origin}/**`, async (route) => {
      const posted = route.request().method() === "POST";
      if (posted) expect(route.request().url()).toBe(origin + action);
      const response = addSecurityHeaders(
        new Request(route.request().url()),
        posted
          ? googleAuthorisationPage(destination.toString())
          : new Response(
              `<form method="post" action="${action}"><button>Connect Google</button></form>`,
              { headers: { "content-type": "text/html" } },
            ),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    await page.route("https://accounts.google.com/**", async (route) => {
      expect(route.request().headers()["referer"]).toBeUndefined();
      await route.fulfill({ contentType: "text/html", body: "<h1>Google approval</h1>" });
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "Connect Google" }).click();
    await expect(page).toHaveURL(destination.toString());
    await expect(page.getByRole("heading", { name: "Google approval" })).toBeVisible();
    expect(violations).toEqual([]);
    expect(page.context().pages()).toHaveLength(1);
  });
}
