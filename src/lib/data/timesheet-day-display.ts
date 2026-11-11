import { isApprovedRemoteWork, type ApprovedLeaveDates } from "./approved-leave.ts";
import type { TimesheetEntry } from "./timesheet-types.ts";

/** A weekend follows the organisation's configured working days, not fixed weekdays. */
export function isTimesheetWeekend(date: Date, workingDays: readonly number[]): boolean {
  return !workingDays.includes(date.getDay());
}

/** A green day means the configured work target is covered, not overtime approval. */
export function meetsTimesheetDailyTarget({
  workedHours,
  paidLeaveHours,
  holidayHours,
  targetHours,
  workingDay,
}: {
  workedHours: number;
  paidLeaveHours: number;
  holidayHours: number;
  targetHours: number;
  workingDay: boolean;
}): boolean {
  const amounts = [workedHours, paidLeaveHours, holidayHours, targetHours];
  return (
    amounts.every((amount) => Number.isFinite(amount) && amount >= 0) &&
    targetHours > 0 &&
    (workingDay || workedHours >= targetHours) &&
    Math.round((workedHours + paidLeaveHours + holidayHours) * 100) >= Math.round(targetHours * 100)
  );
}

export function meetsTimesheetWorkTarget(workedHours: number, requiredHours: number): boolean {
  return (
    Number.isFinite(workedHours) &&
    Number.isFinite(requiredHours) &&
    requiredHours > 0 &&
    Math.round(workedHours * 100) >= Math.round(requiredHours * 100)
  );
}

/** Keep positive and negative project-allocation gaps distinct in review screens. */
export function formatSignedHours(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  const rounded = Number(hours.toFixed(2));
  return `${rounded > 0 ? "+" : ""}${rounded} h`;
}

/** Count approved remote-work dates independently of biometric attendance and paid leave. */
export function countTimesheetRemoteWorkDays({
  startDate,
  endDate,
  workingDays,
  leaveRequests,
  entries,
}: {
  startDate: string;
  endDate: string;
  workingDays: readonly number[];
  leaveRequests: readonly ApprovedLeaveDates[];
  entries: readonly Pick<TimesheetEntry, "isRemoteWork" | "hours">[];
}): number {
  const end = new Date(`${endDate}T12:00:00Z`);
  let count = 0;
  for (
    const day = new Date(`${startDate}T12:00:00Z`);
    day <= end;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (!workingDays.includes(day.getUTCDay())) continue;
    const date = day.toISOString().slice(0, 10);
    if (
      leaveRequests.some((request) => isApprovedRemoteWork(request, date)) ||
      entries.some((entry) => entry.isRemoteWork && Object.hasOwn(entry.hours, date))
    )
      count++;
  }
  return count;
}

export function timesheetCalendarDayLabel({
  weekend,
  leaveName,
  holiday,
  unpaid,
  remoteWork,
  attendanceStatus,
}: {
  weekend: boolean;
  leaveName?: string | undefined;
  holiday: boolean;
  unpaid: boolean;
  remoteWork: boolean;
  attendanceStatus?: string | undefined;
}): string {
  const activity =
    leaveName ||
    (holiday
      ? "Public holiday"
      : unpaid
        ? "Unpaid leave"
        : remoteWork
          ? "Remote Work"
          : attendanceStatus);
  if (weekend) {
    if (!activity || activity === "Rest Day") return "Weekend";
    return `${activity} · Weekend`;
  }
  return activity || "—";
}
