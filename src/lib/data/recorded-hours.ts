/** Recorded presence includes breaks; it never grants overtime or changes punches. */
export function recordedAttendanceHours(
  record:
    | {
        clockInAt?: string | Date | null | undefined;
        clockOutAt?: string | Date | null | undefined;
        clockIn?: string | undefined;
        clockOut?: string | undefined;
      }
    | null
    | undefined,
): number {
  if (!record) return 0;
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
