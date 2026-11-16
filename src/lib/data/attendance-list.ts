export const ATTENDANCE_LIST_FILTERS = [
  "All",
  "Clocked in",
  "Not clocked in",
  "Working remotely",
  "Site visit",
  "Time away",
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
  row: {
    status: string;
    source?: string | undefined;
    clockIn?: string | undefined;
    clockInAt?: string | undefined;
    activities?: readonly { kind: string }[];
  },
  filter: string,
) {
  if (filter === "All") return true;
  if (filter === "Clocked in")
    return row.source !== "Site Visit Auto" && Boolean(row.clockInAt || row.clockIn);
  if (filter === "On Leave") return ["On Leave", "Half-day Leave"].includes(row.status);
  if (filter === "Site visit" || filter === "Time away")
    return row.activities?.some((activity) => activity.kind === filter) ?? row.status === filter;
  if (filter === "Exceptions")
    return ["Late", "Absent", "Missing Punch", "Correction Pending"].includes(row.status);
  return row.status === filter;
}

/** A daily roster label; it does not mutate the saved attendance record. */
export function dailyAttendanceStatus(
  row: {
    status: string;
    source?: string | undefined;
    clockIn?: string | undefined;
    clockInAt?: string | undefined;
    clockOut?: string | undefined;
    clockOutAt?: string | undefined;
    officeExceptionLabel?: string | undefined;
    workMode?: string | undefined;
  },
  date: string,
  today: string,
  approvedRemoteWork = false,
  approvedVisit = false,
  approvedTimeAway = false,
): string {
  // Only a complete real in/out pair can take precedence over approved duty.
  // A lone scan must not hide approved leave, remote work or a visit.
  if (
    row.source !== "Site Visit Auto" &&
    (row.clockIn || row.clockInAt) &&
    (row.clockOut || row.clockOutAt)
  )
    return row.status;
  if (["On Leave", "Half-day Leave"].includes(row.status)) return row.status;
  if (row.officeExceptionLabel === "Approved remote work" || approvedRemoteWork)
    return "Working remotely";
  if (row.workMode === "Approved Site Visit" || approvedVisit) return "Site visit";
  if (
    approvedTimeAway &&
    date === today &&
    (row.clockIn || row.clockInAt) &&
    !row.clockOut &&
    !row.clockOutAt &&
    ["Present", "Late"].includes(row.status)
  )
    return row.status;
  if (
    approvedTimeAway &&
    date < today &&
    (row.clockIn || row.clockInAt) &&
    !row.clockOut &&
    !row.clockOutAt &&
    row.status === "Missing Punch"
  )
    return "Missing Punch";
  if (approvedTimeAway) return "Time away";
  if (
    row.status === "Absent" &&
    !row.clockIn &&
    !row.clockInAt &&
    !row.clockOut &&
    !row.clockOutAt
  ) {
    if (date === today) return "Not clocked in";
    if (date > today) return "Scheduled";
  }
  return row.status;
}
