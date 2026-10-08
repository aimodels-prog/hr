import assert from "node:assert/strict";
import { test } from "node:test";
import { employeeDocumentLink } from "../src/lib/data/document-links.ts";

test("document links select the document section and exact record", () => {
  const link = employeeDocumentLink("employee-one", "document-two");
  const url = new URL(link, "https://example.test");
  assert.equal(url.pathname, "/staff/employees/employee-one");
  const hash = new URLSearchParams(url.hash.slice(1));
  assert.equal(hash.get("section"), "documents");
  assert.equal(hash.get("document"), "document-two");
  assert.equal(
    new URLSearchParams(employeeDocumentLink("e", "d&section=salary").split("#")[1]).get(
      "document",
    ),
    "d&section=salary",
  );
});
