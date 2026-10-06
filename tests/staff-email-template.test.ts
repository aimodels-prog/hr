import assert from "node:assert/strict";
import { test } from "node:test";
import { staffEmailTemplate, emailBase64 } from "../src/lib/integrations/staff-email-template.ts";

const content = {
  heading: "Employee document awaiting review",
  message: "Employee: Example colleague\nReview the uploaded document.",
  category: "REVIEW NEEDED",
  action: "Review document",
  origin: "https://hr.example.com",
  url: "https://hr.example.com/staff/employees/example",
};
test("staff emails have accessible branded HTML and a matching plain-text alternative", () => {
  const { html, text } = staffEmailTemplate(content);
  for (const value of [content.heading, content.action, content.url]) {
    assert.ok(html.includes(value));
    assert.ok(text.includes(value));
  }
  assert.match(html, /alt="VIA International"/);
  assert.match(html, /role="presentation"/);
  assert.match(html, /max-width:600px/);
  assert.doesNotMatch(html, /<script|<form|tracking|font-face/i);
  assert.doesNotMatch(text, /<table|Why you received|An email is not an approval/);
});
test("notification text cannot inject HTML, attributes or external action URLs", () => {
  const { html } = staffEmailTemplate({
    ...content,
    heading: '<img src=x onerror="alert(1)">',
    message: "<script>alert('bad')</script>\nأهلاً & welcome",
    action: '"><iframe>',
    url: content.url + '?a=1&b="bad"',
  });
  assert.doesNotMatch(html, /<script|<iframe|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /أهلاً &amp; welcome/);
  assert.match(html, /a=1&amp;b=/);
  for (const url of [
    "javascript:alert(1)",
    "https://evil.example/staff",
    "https://user:pass@hr.example.com/staff/",
  ]) {
    assert.throws(() => staffEmailTemplate({ ...content, url }));
  }
});
test("MIME encoding wraps long Unicode content without altering it", () => {
  const original = "أهلاً • VIA HR\n".repeat(100);
  const encoded = emailBase64(original);
  assert.ok(encoded.split("\r\n").every((line) => line.length <= 76));
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), original);
});
