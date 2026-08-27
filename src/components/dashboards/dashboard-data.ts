import type { Employee } from "@/lib/data/types";

const CURRENT_WORKFORCE_STATUSES = new Set<Employee["status"]>([
  "Onboarding",
  "Active",
  "Probation",
  "Notice",
]);

function atStartOfDay(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function isCurrentWorkforceMember(employee: Employee, asOf = new Date()): boolean {
  if (!CURRENT_WORKFORCE_STATUSES.has(employee.status)) return false;

  const day = atStartOfDay(asOf);
  if (atStartOfDay(employee.startDate) > day) return false;
  if (employee.terminationDate && atStartOfDay(employee.terminationDate) < day) return false;

  return true;
}

export function isDateRangeActiveOn(
  startDate: string,
  endDate: string,
  asOf = new Date(),
): boolean {
  const day = atStartOfDay(asOf);
  return atStartOfDay(startDate) <= day && atStartOfDay(endDate) >= day;
}

export function isDateWithinPeriod(date: string, startDate: string, endDate: string): boolean {
  const value = atStartOfDay(date);
  return value >= atStartOfDay(startDate) && value <= atStartOfDay(endDate);
}

export function sortByStartDate<T extends { startDate: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => atStartOfDay(a.startDate).getTime() - atStartOfDay(b.startDate).getTime(),
  );
}
