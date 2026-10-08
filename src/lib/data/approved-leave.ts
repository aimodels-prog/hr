import { leaveDisplayType } from "./leave-presentation.ts";
import type { TimesheetEntry } from "./timesheet-types.ts";

/** A requested cancellation/date change does not cancel the original approval. */
export const EFFECTIVE_LEAVE_STATUSES = [
  "Approved",
  "Taken",
  "Cancellation Pending",
  "Amendment Pending Line Manager",
  "Amendment Pending HR",
] as const;

export interface ApprovedLeaveDates {
  id?: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  status?: string;
  policySnapshot?: { name?: string } | null;
}

export function isEffectiveLeave(leave: { status: string }): boolean {
  return (EFFECTIVE_LEAVE_STATUSES as readonly string[]).includes(leave.status);
}

/** Date-only comparisons include both boundary dates and never depend on browser time. */
export function approvedLeaveFraction(leaves: readonly ApprovedLeaveDates[], date: string): number {
  return Math.min(
    1,
    leaves
      .filter(
        (leave) =>
          (!leave.status || isEffectiveLeave({ status: leave.status })) &&
          leave.startDate <= date &&
          leave.endDate >= date,
      )
      .reduce((sum, leave) => sum + (leave.isHalfDay ? 0.5 : 1), 0),
  );
}

export function organisationDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Approved absence is shown separately from worked/project hours, never as overtime. */
export function timesheetAbsences(input: {
  dates: readonly string[];
  workingDays: readonly number[];
  dailyHours: number;
  holidays: ReadonlySet<string>;
  leave: readonly ApprovedLeaveDates[];
}) {
  const entries = new Map<string, TimesheetEntry>();
  let expectedWorkHours = 0;
  for (const date of input.dates) {
    if (!input.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
    if (input.holidays.has(date)) {
      const holiday = entries.get("automatic-holiday") ?? {
        id: "automatic-holiday",
        projectId: "HOLIDAY",
        costCentreId: "HOLIDAY",
        activityCodeId: "HOLIDAY",
        locationCodeId: "HOLIDAY",
        hours: {},
        total: 0,
        isHoliday: true,
        notes: "Public holiday",
      };
      holiday.hours[date] = input.dailyHours;
      holiday.total += input.dailyHours;
      entries.set(holiday.id, holiday);
      continue;
    }
    let fraction = 0;
    for (const leave of input.leave) {
      const available = approvedLeaveFraction([leave], date);
      const credited = Math.min(1 - fraction, available);
      if (!credited) continue;
      fraction += credited;
      const label = leaveDisplayType(leave);
      const key = `automatic-leave-${label}`;
      const entry = entries.get(key) ?? {
        id: key,
        projectId: "LEAVE",
        costCentreId: "LEAVE",
        activityCodeId: "LEAVE",
        locationCodeId: "LEAVE",
        hours: {},
        total: 0,
        isLeave: true,
        notes: label,
      };
      const hours = input.dailyHours * credited;
      entry.hours[date] = (entry.hours[date] ?? 0) + hours;
      entry.total += hours;
      entries.set(key, entry);
    }
    expectedWorkHours += input.dailyHours * (1 - fraction);
  }
  return { dailyHours: input.dailyHours, expectedWorkHours, entries: [...entries.values()] };
}
