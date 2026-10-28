/** Pure payroll allocation for an HR-approved special request. */
export function allocateSpecialUnpaidDates(
  workingDates: readonly string[],
  isHalfDay: boolean,
  requestedDays: number,
  allocatedDays: number,
  remainingPay: "Paid" | "Unpaid",
  unpaidAllocatedDays = 0,
): Array<{ date: string; days: number }> {
  const daySize = isHalfDay ? 0.5 : 1;
  if (
    !Number.isFinite(requestedDays) ||
    requestedDays !== workingDates.length * daySize ||
    !Number.isFinite(allocatedDays) ||
    allocatedDays < 0 ||
    allocatedDays > requestedDays ||
    (allocatedDays * 2) % 1 !== 0 ||
    !Number.isFinite(unpaidAllocatedDays) ||
    unpaidAllocatedDays < 0 ||
    unpaidAllocatedDays > allocatedDays
  )
    throw new Error("Special leave days do not match the approved dates and allocations.");
  let unpaid =
    unpaidAllocatedDays + (remainingPay === "Unpaid" ? requestedDays - allocatedDays : 0);
  const result: Array<{ date: string; days: number }> = [];
  for (const date of [...workingDates].reverse()) {
    if (unpaid <= 0) break;
    const days = Math.min(daySize, unpaid);
    result.push({ date, days });
    unpaid -= days;
  }
  return result.sort((left, right) => left.date.localeCompare(right.date));
}

export function specialUnpaidDaysInPeriod(
  entries: readonly { date: string; days: number }[],
  startDate: string,
  endDate: string,
): number {
  return entries.reduce(
    (sum, entry) => sum + (entry.date >= startDate && entry.date <= endDate ? entry.days : 0),
    0,
  );
}
