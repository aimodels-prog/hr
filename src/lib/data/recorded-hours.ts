/** Recorded presence includes breaks; it never grants overtime or changes punches. */
export function recordedAttendanceHours(
  record:
    | {
        clockInAt?: string | Date | null | undefined;
        creditedHours?: number | undefined;
        clockOutAt?: string | Date | null | undefined;
        clockIn?: string | undefined;
        clockOut?: string | undefined;
      }
    | null
    | undefined,
): number {
  if (!record) return 0;
  if (record.creditedHours !== undefined) return record.creditedHours;
  let minutes = 0;
  if (record.clockInAt && record.clockOutAt) {
    minutes =
      (new Date(record.clockOutAt).getTime() - new Date(record.clockInAt).getTime()) / 60_000;
  } else if (!record.clockInAt && !record.clockOutAt && record.clockIn && record.clockOut) {
    const parse = (time: string) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) return NaN;
      return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    };
    minutes = parse(record.clockOut) - parse(record.clockIn);
    if (minutes < 0) minutes += 1440;
  }
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440
    ? Number((minutes / 60).toFixed(2))
    : 0;
}

/** Net work for timesheets; attendance itself continues to show elapsed presence.
 * A limit is used only for office-policy credit, never for ordinary actual
 * work: ten worked hours remain ten, without creating an overtime claim.
 */
export function recordedWorkingHours(
  record:
    | {
        calculatedHours?: number | string | null | undefined;
        creditedHours?: number | undefined;
        breakMinutes?: number | undefined;
        clockInAt?: string | Date | null | undefined;
        clockOutAt?: string | Date | null | undefined;
        clockIn?: string | undefined;
        clockOut?: string | undefined;
      }
    | null
    | undefined,
  maximumHours?: number,
): number {
  if (
    !record ||
    (maximumHours !== undefined && (!Number.isFinite(maximumHours) || maximumHours < 0))
  )
    return 0;
  // Stored calculated hours already exclude the actual break overlap. Official-duty
  // credits can be a full presence day, so cap those to the configured workday.
  const savedValue = record.creditedHours ?? record.calculatedHours;
  const saved = savedValue == null ? Number.NaN : Number(savedValue);
  const hours =
    Number.isFinite(saved) && saved >= 0
      ? saved
      : Math.max(0, recordedAttendanceHours(record) - (record.breakMinutes ?? 0) / 60);
  const dayHours = Math.min(24, hours);
  return Number(
    (maximumHours === undefined ? dayHours : Math.min(maximumHours, dayHours)).toFixed(2),
  );
}

/** Standard work remains separate from the break; the displayed day includes both. */
export function recordedDailyHours(workingHours: number, breakMinutes: number): number {
  if (
    !Number.isFinite(workingHours) ||
    !Number.isFinite(breakMinutes) ||
    workingHours < 0 ||
    breakMinutes < 0
  )
    throw new Error("Invalid daily hours or break duration.");
  return Number(Math.min(24, workingHours + breakMinutes / 60).toFixed(2));
}
