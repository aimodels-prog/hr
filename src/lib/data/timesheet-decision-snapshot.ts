/** The data a reviewer saw at a timesheet decision, copied into its immutable audit event. */
export interface TimesheetDecisionSnapshotInput {
  period: { startDate: string; endDate: string };
  expectedHours: number;
  reconciliation: {
    timesheetWorkHours: number;
    attendanceHours: number;
    days: readonly {
      date: string;
      timesheetWorkHours: number;
      attendanceHours: number;
      projectHours: number;
      leaveHours: number;
      holidayHours: number;
      status: string;
    }[];
  };
  workEntries: readonly unknown[];
  absenceEntries: readonly unknown[];
  names?: {
    projects?: Readonly<Record<string, string>>;
    costCentres?: Readonly<Record<string, string>>;
    activities?: Readonly<Record<string, string>>;
    locations?: Readonly<Record<string, string>>;
  };
}

// Keep an audit row small even if a malformed or unusually large sheet is reviewed.
// A partial snapshot is marked explicitly; daily totals remain complete.
const MAX_DAYS = 62;
const MAX_WORK_ENTRIES = 200;
const MAX_ABSENCES = 40;
const MAX_HOUR_DATES = 62;
const MAX_NOTE_LENGTH = 240;
const MAX_LABEL_LENGTH = 120;
const MAX_ID_LENGTH = 80;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hours(value: unknown, period: { startDate: string; endDate: string }) {
  const source = record(value);
  if (!source) return { values: {}, truncated: false };
  const entries = Object.entries(source)
    .filter(
      ([date, amount]) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        date >= period.startDate &&
        date <= period.endDate &&
        Number.isFinite(Number(amount)),
    )
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    values: Object.fromEntries(
      entries.slice(0, MAX_HOUR_DATES).map(([date, amount]) => [date, Number(amount)]),
    ),
    truncated: entries.length > MAX_HOUR_DATES || Object.keys(source).length > entries.length,
  };
}

export function timesheetDecisionSnapshot(input: TimesheetDecisionSnapshotInput) {
  const allDays = input.reconciliation.days.map((day) => ({
    date: day.date,
    workedHours: day.timesheetWorkHours,
    attendanceHours: day.attendanceHours,
    projectHours: day.projectHours,
    leaveHours: day.leaveHours,
    holidayHours: day.holidayHours,
    status: day.status,
  }));
  const days = allDays.slice(0, MAX_DAYS);
  let truncated =
    allDays.length > MAX_DAYS ||
    input.workEntries.length > MAX_WORK_ENTRIES ||
    input.absenceEntries.length > MAX_ABSENCES;
  const workEntries = input.workEntries.slice(0, MAX_WORK_ENTRIES).flatMap((value) => {
    const entry = record(value);
    if (!entry) return [];
    const projectId = text(entry["projectId"]);
    const costCentreId = text(entry["costCentreId"]);
    const activityCodeId = text(entry["activityCodeId"]);
    const locationId = text(entry["locationId"]) ?? text(entry["locationCodeId"]);
    const idTruncated = [projectId, costCentreId, activityCodeId, locationId].some(
      (id) => id && id.length > MAX_ID_LENGTH,
    );
    const projectName = projectId ? input.names?.projects?.[projectId] : undefined;
    const costCentreName = costCentreId ? input.names?.costCentres?.[costCentreId] : undefined;
    const activityName = activityCodeId ? input.names?.activities?.[activityCodeId] : undefined;
    const locationName = locationId ? input.names?.locations?.[locationId] : undefined;
    const entryHours = hours(entry["hours"], input.period);
    const fullNote = text(entry["notes"]);
    const noteTruncated = Boolean(fullNote && fullNote.length > MAX_NOTE_LENGTH);
    const labelTruncated = [projectName, costCentreName, activityName, locationName].some(
      (name) => name && name.length > MAX_LABEL_LENGTH,
    );
    truncated ||= entryHours.truncated || noteTruncated || labelTruncated || idTruncated;
    return [
      {
        ...(projectId
          ? {
              projectId: projectId.slice(0, MAX_ID_LENGTH),
              projectName: projectName?.slice(0, MAX_LABEL_LENGTH),
            }
          : {}),
        ...(costCentreId
          ? {
              costCentreId: costCentreId.slice(0, MAX_ID_LENGTH),
              costCentreName: costCentreName?.slice(0, MAX_LABEL_LENGTH),
            }
          : {}),
        ...(activityCodeId
          ? {
              activityCodeId: activityCodeId.slice(0, MAX_ID_LENGTH),
              activityName: activityName?.slice(0, MAX_LABEL_LENGTH),
            }
          : {}),
        ...(locationId
          ? {
              locationId: locationId.slice(0, MAX_ID_LENGTH),
              locationName: locationName?.slice(0, MAX_LABEL_LENGTH),
            }
          : {}),
        hours: entryHours.values,
        ...(fullNote ? { notes: fullNote.slice(0, MAX_NOTE_LENGTH) } : {}),
        ...(entryHours.truncated || noteTruncated || labelTruncated || idTruncated
          ? { truncated: true }
          : {}),
      },
    ];
  });
  const absences = input.absenceEntries.slice(0, MAX_ABSENCES).flatMap((value) => {
    const entry = record(value);
    if (!entry) return [];
    const entryHours = hours(entry["hours"], input.period);
    const fullType = text(entry["notes"]);
    const typeTruncated = Boolean(fullType && fullType.length > MAX_NOTE_LENGTH);
    truncated ||= entryHours.truncated || typeTruncated;
    return [
      {
        type:
          fullType?.slice(0, MAX_NOTE_LENGTH) ??
          (entry["isRemoteWork"] ? "Remote work" : entry["isHoliday"] ? "Public holiday" : "Leave"),
        isUnpaid: entry["isUnpaidLeave"] === true,
        hours: entryHours.values,
        ...(entryHours.truncated || typeTruncated ? { truncated: true } : {}),
      },
    ];
  });
  return {
    version: 1 as const,
    period: { startDate: input.period.startDate, endDate: input.period.endDate },
    totals: {
      expectedHours: input.expectedHours,
      workedHours: input.reconciliation.timesheetWorkHours,
      attendanceHours: input.reconciliation.attendanceHours,
      leaveHours: Number(allDays.reduce((sum, day) => sum + day.leaveHours, 0).toFixed(2)),
      holidayHours: Number(allDays.reduce((sum, day) => sum + day.holidayHours, 0).toFixed(2)),
    },
    truncated,
    counts: {
      days: allDays.length,
      workEntries: input.workEntries.length,
      absences: input.absenceEntries.length,
    },
    days,
    workEntries,
    absences,
  };
}
