import assert from "node:assert/strict";
import test from "node:test";
import { leaveDisplayType } from "../src/lib/data/leave-presentation.ts";

test("historical leave keeps its recorded type even without an active policy", () => {
  for (const name of [
    "Annual Leave",
    "Sick Leave",
    "Half-day Leave",
    "Annual Leave (2024 entitlement)",
  ]) {
    assert.equal(
      leaveDisplayType({ policySnapshot: { name: `${name} — imported history` } }),
      name,
    );
  }
});

test("recorded names take precedence over renamed policies with safe legacy fallback", () => {
  assert.equal(
    leaveDisplayType({ policySnapshot: { name: "Sick Leave" } }, { name: "New name" }),
    "Sick Leave",
  );
  assert.equal(leaveDisplayType({}, { name: "Annual Leave" }), "Annual Leave");
  assert.equal(leaveDisplayType({}), "Leave");
});

test("dashboard, history and report labels hide provenance without changing the source", () => {
  for (const suffix of [" — imported history", " – IMPORTED HISTORY", " - imported history  "]) {
    const name = `Annual Leave (2025 entitlement)${suffix}`;
    const request = { policySnapshot: { name } };
    assert.equal(leaveDisplayType(request), "Annual Leave (2025 entitlement)");
    assert.equal(leaveDisplayType({}, { name }), "Annual Leave (2025 entitlement)");
    assert.equal(request.policySnapshot.name, name);
  }
  assert.equal(
    leaveDisplayType({ policySnapshot: { name: "Important family leave" } }),
    "Important family leave",
  );
});
