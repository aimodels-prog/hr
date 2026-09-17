export interface LeaveChartRow {
  name: string;
  used: number;
  booked: number;
  remaining: number;
  carry: number;
}

export function expiryBuckets(today: string, dates: string[]) {
  const buckets = ["Overdue", "Due in 0–30 days", "Due in 31–60 days", "Due in 61–90 days"].map(
    (name) => ({ name, count: 0 }),
  );
  for (const date of dates) {
    const days = Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000,
    );
    const index = days < 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : -1;
    if (index >= 0) buckets[index]!.count++;
  }
  return buckets;
}

/** Only approved dates count. Today and future dates are booked, not already used. */
export function splitLeaveDays(input: {
  startDate: string;
  endDate: string;
  yearStart: string;
  nextYearStart: string;
  today: string;
  halfDay: boolean;
  workingDays: number[];
  holidays: Set<string>;
}) {
  let used = 0,
    booked = 0;
  const start = input.startDate > input.yearStart ? input.startDate : input.yearStart;
  for (const day = new Date(`${start}T12:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (date > input.endDate || date >= input.nextYearStart) break;
    if (!input.workingDays.includes(day.getUTCDay()) || input.holidays.has(date)) continue;
    const amount = input.halfDay ? 0.5 : 1;
    if (date < input.today) used += amount;
    else booked += amount;
  }
  return { used, booked };
}
