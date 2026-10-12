import type { AppSettings } from "./types.ts";

export function carryExpiryDateForYear(
  settings: Pick<AppSettings, "annualCarryExpiryDates" | "annualCarryExpiryMonthDay"> &
    Partial<Pick<AppSettings, "leaveYearStart">>,
  leaveYear: number,
): string | null {
  const originYear = String(leaveYear - 1);
  if (Object.hasOwn(settings.annualCarryExpiryDates ?? {}, originYear))
    return settings.annualCarryExpiryDates?.[originYear] ?? null;
  const monthDay = settings.annualCarryExpiryMonthDay;
  if (!monthDay) return null;
  return `${monthDay >= (settings.leaveYearStart ?? "01-01") ? leaveYear : leaveYear + 1}-${monthDay}`;
}

type CarryEntry = {
  transactionType: string;
  days: number | string;
  createdAt: string | Date;
  referenceId?: string | null;
};

/** Carry is spent first while it is usable. Expiry entries preserve an audit trail. */
export function carryPosition(
  entries: CarryEntry[],
  requestStartDates: Map<string, string>,
  expiryDate: string | null,
): { granted: number; remaining: number; expiryAdjustment: number } {
  const ordered = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let granted = 0;
  let remaining = 0;
  let expiryAdjustment = 0;
  for (const entry of ordered) {
    const days = Number(entry.days);
    if (entry.transactionType === "Carry-Forward") {
      granted += days;
      remaining += days;
    } else if (entry.transactionType === "Expiry") {
      expiryAdjustment += days;
      remaining = Math.max(0, Math.min(granted, remaining + days));
    } else if (
      ["Approved Leave", "Leave Amendment", "Cancellation Restoration"].includes(
        entry.transactionType,
      ) &&
      granted > 0 &&
      expiryAdjustment >= 0 &&
      (!expiryDate ||
        !entry.referenceId ||
        (requestStartDates.get(entry.referenceId) ?? "") <= expiryDate)
    ) {
      remaining = Math.max(0, Math.min(granted, remaining + days));
    }
  }
  return { granted, remaining, expiryAdjustment };
}
