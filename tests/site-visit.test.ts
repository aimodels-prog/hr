import assert from "node:assert/strict";
import test from "node:test";
import { attendanceDayCredit } from "../src/lib/data/attendance-day-credit.ts";
import {
  blocksAnotherSiteVisit,
  canCancelSiteVisit,
  isFirstOfficeArrivalFromHomeVisit,
  siteVisitEffectiveEndTime,
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

test("a first office thumb after a home-origin visit is arrival, not clock-out", () => {
  const visit = {
    origin: "Home",
    details: { returnPlan: "Time" as const, expectedReturnTime: "10:00" },
    startTime: "07:00",
    endTime: "17:00",
    localTime: "10:00",
    hasEarlierOfficePunch: false,
  };
  assert.equal(isFirstOfficeArrivalFromHomeVisit(visit), true);
  assert.equal(isFirstOfficeArrivalFromHomeVisit({ ...visit, localTime: "17:00" }), false);
  assert.equal(isFirstOfficeArrivalFromHomeVisit({ ...visit, hasEarlierOfficePunch: true }), false);
  assert.equal(isFirstOfficeArrivalFromHomeVisit({ ...visit, origin: "Office" }), false);
  assert.equal(
    isFirstOfficeArrivalFromHomeVisit({
      ...visit,
      details: { returnPlan: "Not returning" },
    }),
    false,
  );
});

test("verified return ends the visit interval before office work begins", () => {
  const day = {
    date: "2026-11-16",
    startTime: "07:00",
    endTime: "17:00",
    timeZone: "Asia/Muscat",
  };
  assert.equal(siteVisitEffectiveEndTime(day), "17:00");
  assert.equal(
    siteVisitEffectiveEndTime({
      ...day,
      details: { returnedAt: "2026-11-16T06:00:00Z" },
    }),
    "10:00",
  );
  const credited = attendanceDayCredit({
    actualWorkHours: 9,
    standardDailyHours: 8,
    clockIn: "07:00",
    clockOut: "17:00",
    approvedIntervals: [
      {
        startTime: "07:00",
        endTime: siteVisitEffectiveEndTime({
          ...day,
          details: { returnedAt: "2026-11-16T06:00:00Z" },
        }),
      },
    ],
  });
  assert.equal(credited.approvedActivityHours, 3);
  assert.equal(credited.officeWorkHours, 6);
  assert.equal(credited.creditedHours, 9);
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
