import assert from "node:assert/strict";
import test from "node:test";
import { googleConnectionResult } from "../src/lib/integrations/google-connection-result.ts";

test("Google callback failures show immediate guidance without loading the HR workspace", async () => {
  const response = googleConnectionResult("calendar-permission-missing");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /Calendar permission was not granted/);
  assert.match(html, /Reference: calendar-permission-missing/);
  assert.doesNotMatch(html, /<script|Loading VIA|http-equiv="refresh"/);
});

test("Google result messages do not reflect arbitrary provider errors or URL content", async () => {
  const html = await googleConnectionResult("<script>secret-token</script>").text();
  assert.doesNotMatch(html, /secret-token|<script/);
  assert.match(html, /Reference: connection-failed/);
});

test("Successful Google connection is shown immediately", async () => {
  const html = await googleConnectionResult("connected").text();
  assert.match(html, /Google connected/);
  assert.doesNotMatch(html, /Reference:/);
});
