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
  policySnapshot?: {
    name?: string;
    type?: string;
    isPaid?: boolean;
    workingDates?: string[];
    specialRequest?: { unpaidByDate?: Array<{ date: string; days: number }> };
  } | null;
}

/** Count only dates explicitly approved in a snapshot when that list exists. */
export function approvedLeaveSnapshotIncludesDate(snapshot: unknown, date: string): boolean {
  const workingDates =
    snapshot && typeof snapshot === "object" && "workingDates" in snapshot
      ? snapshot.workingDates
      : undefined;
  return !Array.isArray(workingDates) || workingDates.includes(date);
}

export function approvedLeaveCoversDate(
  leave: { startDate: string; endDate: string; policySnapshot?: unknown },
  date: string,
): boolean {
  return (
    leave.startDate <= date &&
    leave.endDate >= date &&
    approvedLeaveSnapshotIncludesDate(leave.policySnapshot, date)
  );
}

/** An excluded day must not make a whole period look leave-covered. */
export function approvedLeaveIntersectsRange(
  leave: { startDate: string; endDate: string; policySnapshot?: unknown },
  startDate: string,
  endDate: string,
): boolean {
  if (leave.endDate < startDate || leave.startDate > endDate) return false;
  const snapshot = leave.policySnapshot;
  const workingDates =
    snapshot && typeof snapshot === "object" && "workingDates" in snapshot
      ? snapshot.workingDates
      : undefined;
  if (!Array.isArray(workingDates)) return true;
  return workingDates.some(
    (date) =>
      typeof date === "string" &&
      date >= startDate &&
      date <= endDate &&
      date >= leave.startDate &&
      date <= leave.endDate,
  );
}

/** Show only effective approved dates in leave reports, without implying an excluded day was leave. */
export function approvedLeaveUsageSpans(
  leave: ApprovedLeaveDates & { workingDaysRequested: number },
) {
  const workingDates = leave.policySnapshot?.workingDates;
  if (!Array.isArray(workingDates)) {
    return [
      { startDate: leave.startDate, endDate: leave.endDate, days: leave.workingDaysRequested },
    ];
  }
  const dates = [...new Set(workingDates)]
    .filter((date) => date >= leave.startDate && date <= leave.endDate)
    .sort();
  const spans: Array<{ startDate: string; endDate: string; days: number }> = [];
  for (const date of dates) {
    const last = spans.at(-1);
    const dayBefore = new Date(`${date}T12:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    if (last && last.endDate === dayBefore.toISOString().slice(0, 10)) {
      last.endDate = date;
      last.days += leave.isHalfDay ? 0.5 : 1;
    } else {
      spans.push({ startDate: date, endDate: date, days: leave.isHalfDay ? 0.5 : 1 });
    }
  }
  return spans;
}

/** Remote work and last-working-day markers record a work arrangement, not absence. */
export function isAbsenceLeave(leave: { policySnapshot?: unknown }): boolean {
  const snapshot = leave.policySnapshot;
  const type =
    snapshot && typeof snapshot === "object" && "type" in snapshot ? snapshot.type : undefined;
  return type !== "Remote" && type !== "Resignation";
}

export function isRemoteWorkMarker(leave: { policySnapshot?: unknown }): boolean {
  const snapshot = leave.policySnapshot;
  return Boolean(
    snapshot && typeof snapshot === "object" && "type" in snapshot && snapshot.type === "Remote",
  );
}

export function isApprovedRemoteWork(leave: ApprovedLeaveDates, date: string): boolean {
  return (
    isRemoteWorkMarker(leave) &&
    (!leave.status || isEffectiveLeave({ status: leave.status })) &&
    approvedLeaveCoversDate(leave, date)
  );
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
          isAbsenceLeave(leave) &&
          (!leave.status || isEffectiveLeave({ status: leave.status })) &&
          approvedLeaveCoversDate(leave, date),
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
    if (input.leave.some((leave) => isApprovedRemoteWork(leave, date))) {
      const key = "automatic-remote-work";
      const entry = entries.get(key) ?? {
        id: key,
        projectId: "REMOTE_WORK",
        costCentreId: "REMOTE_WORK",
        activityCodeId: "REMOTE_WORK",
        locationCodeId: "REMOTE_WORK",
        hours: {},
        total: 0,
        isRemoteWork: true,
        notes: "Remote work",
      };
      // Remote work is scheduled work, not leave. Rest days and public
      // holidays remain visible without adding work time.
      const workingDay = input.workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
      const remoteFraction = Math.max(
        ...input.leave
          .filter((leave) => isApprovedRemoteWork(leave, date))
          .map((leave) => (leave.isHalfDay ? 0.5 : 1)),
      );
      const availableFraction = Math.max(0, 1 - approvedLeaveFraction(input.leave, date));
      const hours =
        workingDay && !input.holidays.has(date)
          ? input.dailyHours * Math.min(remoteFraction, availableFraction)
          : 0;
      entry.hours[date] = hours;
      entry.total += hours;
      entries.set(key, entry);
    }
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
      const specialUnpaid = leave.policySnapshot?.specialRequest?.unpaidByDate?.find(
        (item) => item.date === date,
      )?.days;
      const unpaid = leave.policySnapshot?.specialRequest
        ? Math.min(credited, Math.max(0, specialUnpaid ?? 0))
        : leave.policySnapshot?.isPaid === false
          ? credited
          : 0;
      for (const [part, isUnpaidLeave] of [
        [credited - unpaid, false],
        [unpaid, true],
      ] as const) {
        if (part <= 0) continue;
        const key = `automatic-${isUnpaidLeave ? "unpaid-" : ""}leave-${label}`;
        const entry = entries.get(key) ?? {
          id: key,
          projectId: "LEAVE",
          costCentreId: "LEAVE",
          activityCodeId: "LEAVE",
          locationCodeId: "LEAVE",
          hours: {},
          total: 0,
          isLeave: true,
          isUnpaidLeave,
          notes: isUnpaidLeave ? `${label} (unpaid)` : label,
        };
        const hours = input.dailyHours * part;
        entry.hours[date] = (entry.hours[date] ?? 0) + hours;
        entry.total += hours;
        entries.set(key, entry);
      }
    }
    expectedWorkHours += input.dailyHours * (1 - fraction);
  }
  return { dailyHours: input.dailyHours, expectedWorkHours, entries: [...entries.values()] };
}
