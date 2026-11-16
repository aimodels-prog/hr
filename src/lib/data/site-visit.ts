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

/** A home-origin visit may have a scheduled attendance start before the first
 * physical office punch. Only an early first office punch can establish a
 * return; a lone end-of-day punch is ambiguous and must not be guessed.
 */
export function isFirstOfficeArrivalFromHomeVisit(input: {
  origin: string;
  details: SiteVisitDetails;
  startTime: string;
  endTime: string;
  localTime: string;
  hasEarlierOfficePunch: boolean;
}): boolean {
  if (
    input.origin !== "Home" ||
    !input.details.returnPlan ||
    input.details.returnPlan === "Not returning" ||
    input.details.returnedAt ||
    input.details.finishedAt ||
    input.hasEarlierOfficePunch ||
    input.localTime <= input.startTime
  )
    return false;
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const arrival = toMinutes(input.localTime);
  const dayEnd = toMinutes(input.endTime);
  const expected = input.details.expectedReturnTime
    ? toMinutes(input.details.expectedReturnTime)
    : dayEnd - 60;
  return arrival < dayEnd && arrival <= expected + 60;
}

/** Once a return is verified, only the time before that return is visit time.
 * The rest of the day belongs to office attendance, not the visit.
 */
export function siteVisitEffectiveEndTime(input: {
  date: string;
  startTime: string;
  endTime: string;
  details?: SiteVisitDetails | null | undefined;
  timeZone: string;
}): string {
  const returnedAt = input.details?.returnedAt;
  if (!returnedAt) return input.endTime;
  const actual = siteVisitLocalNow(input.timeZone, new Date(returnedAt));
  if (actual.date !== input.date || actual.time <= input.startTime) return input.endTime;
  return actual.time < input.endTime ? actual.time : input.endTime;
}

/** An unconfirmed visit has not changed attendance, so its owner may withdraw it. */
export function canCancelSiteVisit(
  status: string,
  date: string,
  startTime: string,
  timeZone: string,
  at = new Date(),
): boolean {
  if (status === "Pending HR") return true;
  if (status !== "Approved") return false;
  const now = siteVisitLocalNow(timeZone, at);
  return `${date}T${startTime}` > `${now.date}T${now.time}`;
}

/** A daily attendance row cannot yet account for two independent visits. */
export function blocksAnotherSiteVisit(status: string): boolean {
  return !["Rejected", "Cancelled"].includes(status);
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
