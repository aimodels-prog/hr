import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksAnotherSiteVisit,
  canCancelSiteVisit,
  siteVisitReturnLabel,
  validateSiteVisitPlan,
} from "../src/lib/data/site-visit.ts";

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

test("unconfirmed visits can be withdrawn after their planned start, but started approved visits cannot", () => {
  const at = new Date("2026-10-18T09:30:00.000Z");
  assert.equal(canCancelSiteVisit("Pending HR", "2026-10-18", "08:00", "Asia/Muscat", at), true);
  assert.equal(canCancelSiteVisit("Approved", "2026-10-18", "08:00", "Asia/Muscat", at), false);
  assert.equal(canCancelSiteVisit("Approved", "2026-10-19", "08:00", "Asia/Muscat", at), true);
  assert.equal(canCancelSiteVisit("Completed", "2026-10-19", "08:00", "Asia/Muscat", at), false);
});

test("a completed visit still blocks another quick visit on the same day", () => {
  for (const status of ["Pending HR", "Approved", "Completed"])
    assert.equal(blocksAnotherSiteVisit(status), true);
  for (const status of ["Rejected", "Cancelled"])
    assert.equal(blocksAnotherSiteVisit(status), false);
});
