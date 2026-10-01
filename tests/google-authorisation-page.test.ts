import assert from "node:assert/strict";
import test from "node:test";
import { googleAuthorisationPage } from "../src/lib/integrations/google-authorisation-page.ts";

test("Google approval completes the form locally before navigating; private state is not cached", async () => {
  const response = googleAuthorisationPage(
    "https://accounts.google.com/o/oauth2/v2/auth?state=test&scope=openid",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const html = await response.text();
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /state=test&amp;scope=openid/);
  assert.match(html, />Continue to Google<\/a>/);
});

test("Google handoff rejects other destinations", () => {
  for (const url of [
    "https://example.test/",
    "javascript:alert(1)",
    "https://accounts.google.com.evil.test/o/oauth2/v2/auth",
    "https://accounts.google.com/other",
    "https://user:password@accounts.google.com/o/oauth2/v2/auth",
  ]) {
    assert.throws(() => googleAuthorisationPage(url));
  }
});
