import assert from "node:assert/strict";
import test from "node:test";

import { applicationList } from "../src/lib/recruitment/application-lists.ts";

test("shortlisted and interview-selected applications remain separate lists", () => {
  assert.equal(applicationList("New", []), "review");
  assert.equal(applicationList("Shortlisted", []), "shortlisted");
  assert.equal(applicationList("Shortlisted", ["Ready for Assessment"]), "shortlisted");
  assert.equal(applicationList("Shortlisted", ["Ready to Schedule"]), "interview");
  assert.equal(applicationList("Interviewing", ["Interview Scheduled"]), "interview");
  assert.equal(applicationList("Rejected", ["Ready to Schedule"]), "other");
  assert.equal(applicationList("Rejected", []), "other");
});
