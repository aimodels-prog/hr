export interface RequestDecisionSnapshot {
  heading: string;
  fields: Array<{ label: string; value: string }>;
  days?: Array<{ date: string; summary: string }>;
  sections?: Array<{
    heading: string;
    count: number;
    rows: Array<{ title: string; detail: string }>;
  }>;
  note?: string;
}

// The repository applies a source-specific decision regex after this coarse SQL prefilter.
export const TRACKED_AUDIT_ACTION_PATTERN =
  "^(submit|request|confirm|request-changes|approve|reject|decline|return|verify|moderate|lock|close|manager|reopen|time-away|extension)(-|$)";

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const value = (source: Record<string, unknown>, key: string): string | null => {
  const item = source[key];
  return typeof item === "string" && item.trim() ? item.trim().slice(0, 180) : null;
};

const hours = (source: Record<string, unknown>, key: string): string | null => {
  const item = source[key];
  return typeof item === "number" && Number.isFinite(item) && item >= 0
    ? `${Math.round(item * 100) / 100} h`
    : null;
};

const datedHours = (source: unknown): string => {
  const saved = record(source);
  if (!saved) return "Hours by date were not saved";
  const values = Object.entries(saved)
    .filter(
      ([date, amount]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        typeof amount === "number" &&
        Number.isFinite(amount) &&
        amount >= 0,
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 62)
    .map(([date, amount]) => `${date}: ${Math.round((amount as number) * 100) / 100} h`);
  return values.length ? values.join(" · ") : "No hours recorded";
};

const snapshotRows = (
  items: unknown,
  format: (item: Record<string, unknown>) => { title: string; detail: string },
  limit: number,
): Array<{ title: string; detail: string }> =>
  Array.isArray(items)
    ? items.slice(0, limit).flatMap((item) => {
        const saved = record(item);
        return saved ? [format(saved)] : [];
      })
    : [];

/** Only the named person, an actual decision-maker, or HR can read sensitive decision snapshots. */
export function canViewRequestDecisionSnapshot(input: {
  subjectEmployeeId: string | null;
  viewerEmployeeId: string | null | undefined;
  viewerUserId: string;
  viewerRole: string | null | undefined;
  actualReviewerUserIds: ReadonlySet<string>;
}): boolean {
  return (
    input.viewerRole === "HR" ||
    (!!input.subjectEmployeeId && input.subjectEmployeeId === input.viewerEmployeeId) ||
    input.actualReviewerUserIds.has(input.viewerUserId)
  );
}

export function parseRequestDecisionSnapshot(
  module: string,
  afterSummary: unknown,
): RequestDecisionSnapshot | null {
  const after = record(afterSummary);
  if (!after) return null;
  if (module === "Profile updates") {
    const snapshot = record(after["decisionSnapshot"]);
    const employment =
      snapshot?.["kind"] === "Employment Confirmation"
        ? record(snapshot["employment"])
        : record(after["submittedDetails"]);
    if (!employment) return null;
    const fields: RequestDecisionSnapshot["fields"] = [];
    const add = (label: string, key: string) => {
      const text = value(employment, key);
      if (text) fields.push({ label, value: text });
    };
    add("Employee", "legalName");
    add("Preferred name", "preferredName");
    add("Entry type", "staffEntryType");
    add("Start date", "startDate");
    if (snapshot?.["kind"] === "Employment Confirmation") {
      add("Department", "departmentName");
      add("Position", "positionName");
      add("Work location", "locationName");
      add("Employment type", "employmentTypeName");
      add("Supervisor", "supervisorName");
      add("Supervisor email", "supervisorEmail");
    } else {
      add("Supervisor email", "lineManagerEmail");
    }
    if (typeof employment["visaRequired"] === "boolean")
      fields.push({
        label: "Visa required",
        value: employment["visaRequired"] ? "Yes" : "No",
      });
    if (!fields.length) return null;
    return {
      heading: "Employment details at this decision",
      fields,
      ...(snapshot?.["kind"] === "Employment Confirmation"
        ? {}
        : {
            note: "Department, position, location and employment type names were not saved with this earlier decision.",
          }),
    };
  }
  if (module === "Timesheets") {
    const snapshot = record(after["decisionSnapshot"]);
    if (!snapshot || snapshot["version"] !== 1) return null;
    const period = record(snapshot["period"]);
    const totals = record(snapshot["totals"]);
    if (!period || !totals) return null;
    const start = value(period, "startDate");
    const end = value(period, "endDate");
    const fields: RequestDecisionSnapshot["fields"] = [];
    if (start && end) fields.push({ label: "Period", value: `${start} to ${end}` });
    for (const [key, label] of [
      ["expectedHours", "Expected hours"],
      ["workedHours", "Worked hours"],
      ["attendanceHours", "Attendance hours"],
      ["leaveHours", "Leave hours"],
      ["holidayHours", "Holiday hours"],
    ] as const) {
      const text = hours(totals, key);
      if (text) fields.push({ label, value: text });
    }
    const days = Array.isArray(snapshot["days"])
      ? snapshot["days"].slice(0, 62).flatMap((item) => {
          const day = record(item);
          const date = day && value(day, "date");
          if (!day || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
          const parts = [
            hours(day, "workedHours") && `${hours(day, "workedHours")} worked`,
            hours(day, "leaveHours") && `${hours(day, "leaveHours")} leave`,
            hours(day, "holidayHours") && `${hours(day, "holidayHours")} holiday`,
            value(day, "status"),
          ].filter(Boolean);
          return [{ date, summary: parts.join(" · ") || "No hours recorded" }];
        })
      : [];
    const workRows = snapshotRows(
      snapshot["workEntries"],
      (entry) => ({
        title: value(entry, "projectName") ?? "Project name not saved",
        detail: [
          value(entry, "costCentreName") && `Cost centre: ${value(entry, "costCentreName")}`,
          value(entry, "activityName") && `Activity: ${value(entry, "activityName")}`,
          value(entry, "locationName") && `Location: ${value(entry, "locationName")}`,
          datedHours(entry["hours"]),
          value(entry, "notes") && `Notes: ${value(entry, "notes")}`,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
      200,
    );
    const absenceRows = snapshotRows(
      snapshot["absences"],
      (entry) => ({
        title: `${value(entry, "type") ?? "Absence type not saved"}${entry["isUnpaid"] === true ? " (unpaid)" : ""}`,
        detail: datedHours(entry["hours"]),
      }),
      40,
    );
    if (!fields.length && !days.length) return null;
    const counts = record(snapshot["counts"]);
    const count = (key: string, fallback: number) => {
      const number = counts?.[key];
      return typeof number === "number" && Number.isInteger(number) && number >= fallback
        ? number
        : fallback;
    };
    return {
      heading: "Timesheet at this decision",
      fields,
      ...(days.length ? { days } : {}),
      sections: [
        {
          heading: "Work allocations",
          count: count("workEntries", workRows.length),
          rows: workRows,
        },
        {
          heading: "Leave and other absences",
          count: count("absences", absenceRows.length),
          rows: absenceRows,
        },
      ],
      ...(snapshot["truncated"] === true
        ? { note: "This decision snapshot was shortened because the record was unusually large." }
        : {}),
    };
  }
  return null;
}
