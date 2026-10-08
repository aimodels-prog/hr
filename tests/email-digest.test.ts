import assert from "node:assert/strict";
import test from "node:test";
import { emailDigestTopic } from "../src/lib/data/email-digest.ts";
import { staffEmailTemplate } from "../src/lib/integrations/staff-email-template.ts";

test("employee alerts combine across modules; HR topics group documents and requests", () => {
  for (const type of ["document_expiry", "leave_submitted", "attendance.missing_clockout_reminder"])
    assert.equal(emailDigestTopic(false, type), "Your daily updates");
  assert.equal(
    emailDigestTopic(true, "document_expiry", "employee-document"),
    "Expiring documents",
  );
  assert.equal(emailDigestTopic(true, "company_document_expiry"), "Expiring documents");
  assert.equal(
    emailDigestTopic(true, "approval.reminder", "employee-document"),
    "Employee records and documents",
  );
  assert.equal(emailDigestTopic(true, "approval.reminder", "leave-request"), "Leave requests");
});

test("daily email lists every item with safe direct links, in HTML and plain text", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    title: `Document ${index}`,
    message: "<script>unsafe</script>",
    url: `https://hr.example.test/staff/employees/one#section=documents&document=${index}`,
  }));
  const content = {
    origin: "https://hr.example.test",
    heading: "Expiring documents",
    message: "10 documents need attention",
    category: "DAILY SUMMARY",
    action: "Open tasks",
    url: "https://hr.example.test/staff/my-tasks",
    items,
  };
  const result = staffEmailTemplate(content);
  for (const item of items) {
    assert.ok(result.text.includes(item.title));
    assert.ok(result.html.includes(item.title));
    assert.ok(result.text.includes(item.url));
  }
  assert.ok(!result.html.includes("<script>"));
  assert.throws(() =>
    staffEmailTemplate({ ...content, items: [{ ...items[0]!, url: "https://attacker.test/" }] }),
  );
});
