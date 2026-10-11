export const ATTENDANCE_LIST_FILTERS = [
  "All",
  "Clocked in",
  "Exceptions",
  "Present",
  "Late",
  "Absent",
  "Missing Punch",
  "Correction Pending",
  "Corrected",
  "On Leave",
  "Half-day Leave",
  "Not tracked",
  "Holiday",
  "Rest Day",
] as const;

/** Never let a missing policy accidentally select the first (unrelated) location. */
export function defaultAttendanceLocation(
  locations: { id: string; databaseId?: string; name: string; isActive: boolean }[],
  headOfficeLocationId?: string,
): string | undefined {
  const active = locations.filter((location) => location.isActive);
  const configured = headOfficeLocationId
    ? active.find(
        (location) =>
          location.id === headOfficeLocationId || location.databaseId === headOfficeLocationId,
      )
    : undefined;
  return (
    configured ??
    active.find(
      (location) => location.name.trim().replace(/\s+/g, " ").toLowerCase() === "head office",
    )
  )?.name;
}

export function attendanceListSearch(search: Record<string, unknown>): {
  date?: string | undefined;
  status?: string | undefined;
} {
  const date = typeof search["date"] === "string" ? search["date"] : undefined;
  return {
    date:
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) &&
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
        ? date
        : undefined,
    status:
      typeof search["status"] === "string" &&
      ATTENDANCE_LIST_FILTERS.some((filter) => filter === search["status"])
        ? search["status"]
        : undefined,
  };
}

/** A saved clock-in remains visible even if its clock-out needs correction. */
export function matchesAttendanceListFilter(
  row: { status: string; clockIn?: string | undefined; clockInAt?: string | undefined },
  filter: string,
) {
  if (filter === "All") return true;
  if (filter === "Clocked in") return Boolean(row.clockInAt || row.clockIn);
  if (filter === "Exceptions")
    return ["Late", "Absent", "Missing Punch", "Correction Pending"].includes(row.status);
  return row.status === filter;
}
