/** Entitlement years are named for the year in which the configured period starts. */
export function leaveYearForDate(date: string, start: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}-\d{2}$/.test(start))
    throw new Error("Invalid leave-year date or configuration.");
  const year = Number(date.slice(0, 4));
  return date < `${year}-${start}` ? year - 1 : year;
}
