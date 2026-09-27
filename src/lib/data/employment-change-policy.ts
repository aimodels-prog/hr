import type { EmployeeSalary, Role } from "./types.ts";

export const EMPLOYMENT_CHANGE_FIELDS = [
  "department",
  "position",
  "grade",
  "location",
  "employmentType",
  "staffEntryType",
  "visaRequired",
  "lineManagerId",
  "projectId",
  "costCentreId",
  "startDate",
  "probationEndDate",
  "weeklyHours",
  "salary",
] as const;

export function employmentCalendarDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validateEmploymentEffectiveDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Enter a valid effective date.");
  }
}

export function canManageEmploymentFields(role: Role, fields: readonly string[]): boolean {
  return (
    fields.length > 0 &&
    fields.every(
      (field) =>
        (EMPLOYMENT_CHANGE_FIELDS as readonly string[]).includes(field) &&
        (role === "Super Admin" || (field === "salary" ? role === "Accounts" : role === "HR")),
    )
  );
}

export function sameEmploymentValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (value === undefined || value === "") return null;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export interface EmploymentChangeResult {
  status: "Applied" | "Scheduled";
  effectiveDate: string;
}

export interface ScheduledEmploymentChangeView {
  id: string;
  effectiveDate: string;
  fields: string[];
  changes: Record<string, string | number | boolean | null | EmployeeSalary>;
  reason: string;
  status: "Pending" | "Needs Review";
  reviewNote: string | null;
}
