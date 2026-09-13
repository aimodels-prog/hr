import assert from "node:assert/strict";
import test from "node:test";
import { latestPreparationPerCandidate } from "../src/lib/data/current-preparation.ts";
const old = {
  id: "a",
  candidateId: "candidate",
  createdAt: new Date("2026-01-01"),
  status: "Ready",
  preliminaryScore: 99,
};
test("newer lower scoring preparation replaces an older high score", () => {
  const current = { ...old, id: "b", createdAt: new Date("2026-02-01"), preliminaryScore: 20 };
  assert.equal(latestPreparationPerCandidate([old, current]).get("candidate")?.id, "b");
});
test("failed or pending current preparation does not resurrect an old success", () => {
  for (const status of ["Pending", "Failed"])
    assert.equal(
      latestPreparationPerCandidate([
        old,
        { ...old, id: "b", createdAt: new Date("2026-02-01"), status },
      ]).size,
      0,
    );
});
