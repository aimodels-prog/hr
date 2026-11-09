import assert from "node:assert/strict";
import test from "node:test";
import { siteVisitNeedsHrReview, siteVisitsForReview } from "../src/lib/data/site-visit-review.ts";
import type { SiteVisitRequest } from "../src/lib/data/attendance-types.ts";

function visit(id: string, date: string, status: SiteVisitRequest["status"]): SiteVisitRequest {
  return { id, date, startTime: "09:00", status } as SiteVisitRequest;
}

test("HR visit queue puts older pending decisions first and keeps completed visits out", () => {
  const visits = [
    visit("new", "2026-11-09", "Pending HR"),
    visit("done", "2026-11-05", "Approved"),
    visit("old", "2026-11-03", "Pending HR"),
  ];
  assert.deepEqual(
    siteVisitsForReview(visits, "pending").map((item) => item.id),
    ["old", "new"],
  );
  assert.deepEqual(
    siteVisitsForReview(visits, "all").map((item) => item.id),
    ["old", "new", "done"],
  );
  assert.deepEqual(
    visits.map((item) => item.id),
    ["new", "done", "old"],
  );
});

test("an extension awaiting HR review stays in the approval queue", () => {
  const extended = {
    ...visit("extension", "2026-11-04", "Approved"),
    details: { extension: { status: "Pending" } },
  } as SiteVisitRequest;
  assert.equal(siteVisitNeedsHrReview(extended), true);
  assert.deepEqual(
    siteVisitsForReview([extended], "pending").map((item) => item.id),
    ["extension"],
  );
});
