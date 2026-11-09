import type { SiteVisitRequest } from "./attendance-types";

export function siteVisitNeedsHrReview(visit: SiteVisitRequest): boolean {
  return visit.status === "Pending HR" || visit.details?.extension?.status === "Pending";
}

/** Put outstanding decisions first; within that queue, work from oldest visit onward. */
export function siteVisitsForReview(
  visits: SiteVisitRequest[],
  filter: "pending" | "all",
): SiteVisitRequest[] {
  return visits
    .filter((visit) => filter === "all" || siteVisitNeedsHrReview(visit))
    .sort((left, right) => {
      const leftPending = siteVisitNeedsHrReview(left);
      const rightPending = siteVisitNeedsHrReview(right);
      if (leftPending !== rightPending) return leftPending ? -1 : 1;
      return leftPending
        ? left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime)
        : right.date.localeCompare(left.date) || right.startTime.localeCompare(left.startTime);
    });
}
