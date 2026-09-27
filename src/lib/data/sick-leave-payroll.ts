import { leaveYearForDate } from "./leave-year.ts";
import { payrollLeaveDaysInPeriod, type PayrollLeaveDates } from "./leave-working-days.ts";
import type { SickPayTier } from "./leave-types.ts";

export interface SickPayrollRequest extends PayrollLeaveDates {
  id: string;
  employeeId: string;
  isPaid: boolean;
  payTiers: unknown;
}

export function validateSickPayTiers(value: unknown): SickPayTier[] {
  if (!Array.isArray(value))
    throw new Error("Sick-pay rules are missing. Ask HR to review the policy.");
  const tiers = value.map((tier) => ({ ...tier })).sort((a, b) => a.fromDay - b.fromDay);
  let next = 1;
  for (const tier of tiers) {
    if (
      !Number.isInteger(tier.fromDay) ||
      tier.fromDay !== next ||
      !Number.isInteger(tier.toDay) ||
      tier.toDay < tier.fromDay ||
      !Number.isFinite(tier.payPercentage) ||
      tier.payPercentage < 0 ||
      tier.payPercentage > 100
    )
      throw new Error(
        "Sick-pay rules must cover consecutive days from day 1 with valid percentages. Ask HR to review the policy.",
      );
    next = tier.toDay + 1;
  }
  return tiers;
}

/** Only approved/current original dates belong here. Pending proposals must not consume pay tiers. */
export function sickLeavePayrollReductions(
  requests: SickPayrollRequest[],
  period: { startDate: string; endDate: string },
  leaveYearStart: string,
  legacyDates: (request: SickPayrollRequest) => string[],
): Map<string, number> {
  const events: Array<{
    date: string;
    request: SickPayrollRequest;
    weight: number;
    tiers: SickPayTier[];
  }> = [];
  for (const request of requests) {
    const dates = request.workingDates === undefined ? legacyDates(request) : request.workingDates;
    // Validate snapshots and reconstructed legacy calendars against the approved total.
    payrollLeaveDaysInPeriod({ ...request, workingDates: dates }, request, () => []);
    const tiers = validateSickPayTiers(request.payTiers);
    for (const date of dates as string[])
      if (date <= period.endDate)
        events.push({ date, request, weight: request.isHalfDay ? 0.5 : 1, tiers });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.request.id.localeCompare(b.request.id));
  const consumed = new Map<string, number>();
  const cumulativeUnpaid = new Map<string, number>();
  const seenDates = new Set<string>();
  const result = new Map<string, number>();
  for (const { date, request, weight, tiers } of events) {
    const dayKey = `${request.employeeId}:${date}`;
    if (seenDates.has(dayKey))
      throw new Error("Approved sick-leave dates overlap. Ask HR to review these requests.");
    seenDates.add(dayKey);
    const yearKey = `${request.employeeId}:${leaveYearForDate(date, leaveYearStart)}`;
    const used = consumed.get(yearKey) ?? 0;
    consumed.set(yearKey, used + weight);
    if (!request.isPaid || !tiers.length) continue;
    let remaining = weight,
      position = used,
      unpaid = 0;
    for (const tier of tiers) {
      const portion = Math.max(
        0,
        Math.min(position + remaining, tier.toDay) - Math.max(position, tier.fromDay - 1),
      );
      unpaid += portion * (1 - tier.payPercentage / 100);
      position += portion;
      remaining -= portion;
      if (!remaining) break;
    }
    if (remaining > 0)
      throw new Error(
        "Approved sick leave exceeds the configured pay tiers. Ask HR to review the policy.",
      );
    const before = cumulativeUnpaid.get(yearKey) ?? 0;
    cumulativeUnpaid.set(yearKey, before + unpaid);
    // Store hundredths of a day without rounding two halves up in separate months.
    const allocated = (Math.round((before + unpaid) * 100) - Math.round(before * 100)) / 100;
    if (date >= period.startDate)
      result.set(request.employeeId, (result.get(request.employeeId) ?? 0) + allocated);
  }
  return new Map([...result].map(([employee, days]) => [employee, Math.round(days * 100) / 100]));
}
