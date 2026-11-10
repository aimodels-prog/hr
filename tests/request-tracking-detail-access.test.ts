import assert from "node:assert/strict";
import test from "node:test";

import { reviewedEmployeeCurrentDetailsPolicy } from "../src/lib/data/request-tracking-detail-access.ts";

test("historical Employee reviewers need a current exact assignment for private details", () => {
  assert.deepEqual(reviewedEmployeeCurrentDetailsPolicy("employee_documents"), {
    kind: "assigned",
    module: "Document",
  });
  assert.deepEqual(reviewedEmployeeCurrentDetailsPolicy("training_records"), {
    kind: "assigned",
    module: "Training Certificate",
  });
  assert.deepEqual(reviewedEmployeeCurrentDetailsPolicy("employees"), {
    kind: "assigned",
    module: "Employment Confirmation",
  });
  assert.deepEqual(reviewedEmployeeCurrentDetailsPolicy("profile_change_requests"), {
    kind: "omit",
  });
  assert.deepEqual(reviewedEmployeeCurrentDetailsPolicy("leave_requests"), { kind: "normal" });
});
