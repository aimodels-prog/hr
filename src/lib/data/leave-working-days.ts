/** Date-only leave arithmetic uses UTC so the browser/server timezone cannot shift a day. */
export function leaveWorkingDates(
  start: string,
  end: string,
  holidays: ReadonlySet<string>,
  workingDays: readonly number[],
  halfDay: boolean,
  includeWeekends = false,
): string[] {
  if (!validDate(start) || !validDate(end) || start > end || (halfDay && start !== end)) return [];
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const date = cursor.toISOString().slice(0, 10);
    if ((includeWeekends || workingDays.includes(cursor.getUTCDay())) && !holidays.has(date))
      dates.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export interface PayrollLeaveDates {
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  workingDaysRequested: number;
  workingDates?: unknown;
}

/** Preserve the approved total; never guess a prorated amount when historical dates are unclear. */
export function payrollLeaveDaysInPeriod(
  leave: PayrollLeaveDates,
  period: { startDate: string; endDate: string },
  legacyWorkingDates: () => string[],
): number {
  if (leave.endDate < period.startDate || leave.startDate > period.endDate) return 0;
  const approved = leave.workingDaysRequested;
  if (!Number.isFinite(approved) || approved <= 0) throw new Error("Invalid approved leave total.");
  // Older records wholly inside this period already have an authoritative approved total.
  if (
    leave.workingDates === undefined &&
    leave.startDate >= period.startDate &&
    leave.endDate <= period.endDate
  )
    return approved;
  const dates = leave.workingDates === undefined ? legacyWorkingDates() : leave.workingDates;
  const weight = leave.isHalfDay ? 0.5 : 1;
  if (
    !Array.isArray(dates) ||
    !dates.every(
      (date: unknown) =>
        typeof date === "string" &&
        validDate(date) &&
        date >= leave.startDate &&
        date <= leave.endDate,
    ) ||
    new Set(dates).size !== dates.length ||
    dates.length * weight !== approved ||
    (leave.isHalfDay && (leave.startDate !== leave.endDate || dates.length !== 1))
  )
    throw new Error(
      "Approved leave dates do not match its recorded total. Ask HR to review this leave before collecting payroll.",
    );
  return (
    dates.filter((date: string) => date >= period.startDate && date <= period.endDate).length *
    weight
  );
}
