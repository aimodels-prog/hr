import assert from "node:assert/strict";
import test from "node:test";
import { objectivesReadyForAppraisal } from "../src/lib/data/performance-objectives.ts";

test("appraisal needs a complete approved objective set, not just one approved goal", () => {
  assert.equal(objectivesReadyForAppraisal([]), false);
  for (const status of ["Draft", "Changes Requested", "Pending Approval"]) {
    assert.equal(objectivesReadyForAppraisal([{ status, weight: 100 }]), false);
    assert.equal(
      objectivesReadyForAppraisal([
        { status: "Active", weight: 60 },
        { status, weight: 40 },
      ]),
      false,
    );
  }
  for (const weight of [0, 50, 101, NaN, 99.5])
    assert.equal(objectivesReadyForAppraisal([{ status: "Active", weight }]), false);
  assert.equal(
    objectivesReadyForAppraisal([
      { status: "Active", weight: 50 },
      { status: "Completed", weight: 50 },
    ]),
    true,
  );
  assert.equal(
    objectivesReadyForAppraisal([
      { status: "Active", weight: 60 },
      { status: "Completion Pending", weight: 40 },
    ]),
    true,
  );
  assert.equal(
    objectivesReadyForAppraisal([
      { status: "Active", weight: 100 },
      { status: "Cancelled", weight: 100 },
    ]),
    true,
  );
  assert.equal(
    objectivesReadyForAppraisal([{ status: "Active", weight: 100, archivedAt: "2026-09-01" }]),
    false,
  );
});
