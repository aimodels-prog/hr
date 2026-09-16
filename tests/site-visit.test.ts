import assert from "node:assert/strict";
import test from "node:test";
import { siteVisitReturnLabel, validateSiteVisitPlan } from "../src/lib/data/site-visit.ts";

test("uncertain return and all-day duty do not require an invented return time", () => {
  validateSiteVisitPlan("08:00", { returnPlan: "Unknown" });
  validateSiteVisitPlan("08:00", { returnPlan: "Not returning" });
  assert.equal(siteVisitReturnLabel({ returnPlan: "Unknown" }), "Return time not sure");
  assert.equal(
    siteVisitReturnLabel({ returnPlan: "Time", expectedReturnTime: "14:00" }),
    "Expected back 14:00",
  );
});
test("return estimates must be valid and duty starting after 5 PM requires HR handling", () => {
  for (const expectedReturnTime of [undefined, "07:00", "25:00"]) {
    assert.throws(
      () =>
        validateSiteVisitPlan("08:00", {
          returnPlan: "Time",
          ...(expectedReturnTime ? { expectedReturnTime } : {}),
        }),
      /Expected return/,
    );
  }
  assert.throws(() => validateSiteVisitPlan("18:00", { returnPlan: "Unknown" }), /after 5 PM/);
  validateSiteVisitPlan("18:00", {}); // No change to existing approved schedules.
});
