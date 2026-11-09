import { isAbsenceLeave, isEffectiveLeave, isRemoteWorkMarker } from "./approved-leave.ts";
import { leaveDisplayType } from "./leave-presentation.ts";
import type { TimesheetPeriod } from "./timesheet-types.ts";

export interface HistoricalLeaveSource {
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  status: string;
  policySnapshot?: { name?: string; type?: string; workingDates?: string[] } | null;
}

export interface HistoricalLeaveEvent {
  label: string;
  kind: "Leave" | "Remote Work";
  halfDay: boolean;
}

export interface HistoricalLeaveDay {
  date: string;
  coveredByTimesheet: boolean;
  events: HistoricalLeaveEvent[];
}

export interface HistoricalLeaveMonth {
  month: string;
  days: HistoricalLeaveDay[];
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysInMonth(month: string): HistoricalLeaveDay[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    coveredByTimesheet: false,
    events: [],
  }));
}

function* approvedDates(request: HistoricalLeaveSource, asOfDate: string): Generator<string> {
  const recordedDates = request.policySnapshot?.workingDates;
  if (Array.isArray(recordedDates)) {
    for (const date of recordedDates) {
      if (
        validDate(date) &&
        date >= request.startDate &&
        date <= request.endDate &&
        date <= asOfDate
      )
        yield date;
    }
    return;
  }

  const lastDate = request.endDate < asOfDate ? request.endDate : asOfDate;
  const end = new Date(`${lastDate}T12:00:00Z`);
  for (
    const day = new Date(`${request.startDate}T12:00:00Z`);
    day <= end;
    day.setUTCDate(day.getUTCDate() + 1)
  )
    yield day.toISOString().slice(0, 10);
}

/**
 * Show approved leave and remote-work history only where no generated timesheet
 * covers the date. This is a display view, not an hours or payroll calculation.
 */
export function historicalLeaveMonths({
  leaveRequests,
  periods,
  asOfDate,
}: {
  leaveRequests: readonly HistoricalLeaveSource[];
  periods: readonly Pick<TimesheetPeriod, "startDate" | "endDate">[];
  asOfDate: string;
}): HistoricalLeaveMonth[] {
  if (!validDate(asOfDate)) return [];
  const byMonth = new Map<string, Map<string, HistoricalLeaveEvent[]>>();

  for (const request of leaveRequests) {
    // Pending cancellation/amendment does not revoke the original approval.
    if (!isEffectiveLeave(request)) continue;
    if (!isAbsenceLeave(request) && !isRemoteWorkMarker(request)) continue;
    if (!validDate(request.startDate) || !validDate(request.endDate)) continue;
    if (request.endDate < request.startDate) continue;

    const remote = isRemoteWorkMarker(request);
    const event: HistoricalLeaveEvent = {
      label: remote ? "Remote Work" : leaveDisplayType(request),
      kind: remote ? "Remote Work" : "Leave",
      halfDay: request.isHalfDay,
    };
    for (const date of approvedDates(request, asOfDate)) {
      const month = date.slice(0, 7);
      if (periods.some((period) => period.startDate <= date && period.endDate >= date)) continue;
      const dates = byMonth.get(month) ?? new Map<string, HistoricalLeaveEvent[]>();
      const events = dates.get(date) ?? [];
      if (
        !events.some(
          (existing) =>
            existing.label === event.label &&
            existing.kind === event.kind &&
            existing.halfDay === event.halfDay,
        )
      )
        events.push(event);
      dates.set(date, events);
      byMonth.set(month, dates);
    }
  }

  return [...byMonth.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, dates]) => ({
      month,
      days: daysInMonth(month).map((day) => ({
        ...day,
        coveredByTimesheet: periods.some(
          (period) => period.startDate <= day.date && period.endDate >= day.date,
        ),
        events: dates.get(day.date) ?? [],
      })),
    }));
}
