export type TimesheetFrequency = "Monthly" | "Weekly";
export type PeriodDates = { startDate: string; endDate: string };

function parseDate(value: string): Date {
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error("Enter a valid timesheet date.");
  return date;
}

/** Date-only calendar boundaries: independent of the browser/server timezone. */
export function timesheetPeriodDates(
  date: string,
  frequency: TimesheetFrequency = "Monthly",
  weekStart = 1,
): PeriodDates {
  const start = parseDate(date);
  const end = new Date(start);
  if (frequency === "Monthly") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  } else {
    if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6)
      throw new Error("Select a valid weekly period start day.");
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() - weekStart + 7) % 7));
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function timesheetPeriodsInRange(
  start: string,
  end: string,
  frequency: TimesheetFrequency = "Monthly",
  weekStart = 1,
): PeriodDates[] {
  parseDate(end);
  if (end < start) throw new Error("End date must be on or after start date.");
  const periods: PeriodDates[] = [];
  let period = timesheetPeriodDates(start, frequency, weekStart);
  while (period.startDate <= end) {
    periods.push(period);
    const next = parseDate(period.endDate);
    next.setUTCDate(next.getUTCDate() + 1);
    period = timesheetPeriodDates(next.toISOString().slice(0, 10), frequency, weekStart);
  }
  return periods;
}

export function isConfiguredTimesheetPeriod(
  period: PeriodDates,
  frequency: TimesheetFrequency = "Monthly",
  weekStart = 1,
): boolean {
  const expected = timesheetPeriodDates(period.startDate, frequency, weekStart);
  return period.startDate === expected.startDate && period.endDate === expected.endDate;
}

export function timesheetPeriodLabel(period: PeriodDates): string {
  return isConfiguredTimesheetPeriod(period)
    ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
        parseDate(period.startDate),
      )
    : `${period.startDate} to ${period.endDate}`;
}
