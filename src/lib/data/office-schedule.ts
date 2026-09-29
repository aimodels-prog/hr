/** VIA's standard office day; extra presence never authorises overtime. */
export const VIA_OFFICE_SCHEDULE = {
  start: "08:30",
  end: "17:30",
  breakStart: "13:00",
  breakEnd: "14:00",
  workingHours: 8,
  breakMinutes: 60,
} as const;

/** Extra office presence is not an overtime claim or extra ordinary timesheet entitlement. */
export function ordinaryAttendanceHours(recorded: number, dailyHours = 8): number {
  return Math.max(0, Math.min(recorded, dailyHours));
}

/** Eight working hours from the actual arrival, pausing only during 13:00–14:00. */
export function flexibleOfficeSchedule(clockIn: string, clockOut?: string | null, dailyHours = 8) {
  const parse = (value: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value))
      throw new Error("Invalid attendance time.");
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  };
  const start = parse(clockIn);
  let cursor = start;
  let remaining = Math.round(dailyHours * 60);
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 1440)
    throw new Error("Invalid working hours.");
  while (remaining > 0) {
    const day = Math.floor(cursor / 1440) * 1440;
    const lunchStart = day + 780;
    const lunchEnd = day + 840;
    if (cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
      continue;
    }
    const nextBreak = cursor < lunchStart ? lunchStart : lunchStart + 1440;
    const work = Math.min(remaining, nextBreak - cursor);
    remaining -= work;
    cursor += work;
  }
  let end = clockOut ? parse(clockOut) : start;
  if (end < start) end += 1440;
  let breakMinutes = 0;
  for (let day = 0; day <= Math.floor(end / 1440); day++) {
    breakMinutes += Math.max(
      0,
      Math.min(end, day * 1440 + 840) - Math.max(start, day * 1440 + 780),
    );
  }
  const expectedOut = `${String(Math.floor(cursor / 60) % 24).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
  return {
    expectedIn: clockIn.slice(0, 5),
    expectedOut,
    departureDayOffset: Math.floor(cursor / 1440),
    elapsedMinutes: cursor - start,
    breakMinutes,
    calculatedHours: clockOut ? Math.max(0, end - start - breakMinutes) / 60 : 0,
    isLate: false,
    isEarlyDeparture: Boolean(clockOut && end < cursor),
  };
}

/** Deduct only the part of lunch that overlaps the recorded attendance interval. */
export function officeLunchMinutes(clockIn: string, clockOut: string): number {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const start = minutes(clockIn);
  const finish = minutes(clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
  return Math.max(0, Math.min(finish, 14 * 60) - Math.max(start, 13 * 60));
}

export function attendanceBreakMinutes(
  clockIn: string,
  clockOut: string,
  configuredMinutes: number,
  expectedIn: string,
  expectedOut: string,
): number {
  return expectedIn.slice(0, 5) === VIA_OFFICE_SCHEDULE.start &&
    expectedOut.slice(0, 5) === VIA_OFFICE_SCHEDULE.end &&
    configuredMinutes === 60
    ? officeLunchMinutes(clockIn, clockOut)
    : configuredMinutes;
}
