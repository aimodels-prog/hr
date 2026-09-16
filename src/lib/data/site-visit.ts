export type SiteVisitReturnPlan = "Time" | "Unknown" | "Not returning";

export function siteVisitLocalNow(
  timeZone: string,
  at = new Date(),
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

/** Expected return is an estimate, never an attendance clock-out instruction. */
export interface SiteVisitDetails {
  returnPlan?: SiteVisitReturnPlan;
  expectedReturnTime?: string;
  finishedAt?: string;
  returnedAt?: string;
  attendanceClosedAt?: string;
  attendanceCloseKind?: "Automatic" | "Reported finish";
  extension?: {
    endTime: string;
    reason: string;
    status: "Pending" | "Approved" | "Rejected";
    requestedAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
  };
}

export function siteVisitReturnLabel(details?: SiteVisitDetails): string {
  if (!details?.returnPlan) return "Scheduled visit";
  if (details.returnPlan === "Time") return `Expected back ${details.expectedReturnTime}`;
  return details.returnPlan === "Unknown" ? "Return time not sure" : "Not returning today";
}

export function validateSiteVisitPlan(startTime: string, details: SiteVisitDetails): void {
  if (!details.returnPlan) return; // Existing scheduled visits retain their original contract.
  if (!["Time", "Unknown", "Not returning"].includes(details.returnPlan))
    throw new Error("Choose an expected return option.");
  if (startTime >= "17:00")
    throw new Error(
      "For duty starting after 5 PM, ask HR to record approved attendance or overtime.",
    );
  if (
    details.returnPlan === "Time" &&
    (!details.expectedReturnTime ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(details.expectedReturnTime) ||
      details.expectedReturnTime <= startTime)
  ) {
    throw new Error("Expected return must be after the visit start time.");
  }
}
