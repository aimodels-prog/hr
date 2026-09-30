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

export type OfficeBreakPolicy = {
  breakStart?: string | undefined;
  defaultBreakMinutes?: number | undefined;
};

export function officeBreakWindow(policy?: OfficeBreakPolicy | null) {
  const start = policy?.breakStart ?? VIA_OFFICE_SCHEDULE.breakStart;
  const duration = policy?.defaultBreakMinutes ?? VIA_OFFICE_SCHEDULE.breakMinutes;
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !Number.isInteger(duration) ||
    duration < 0 ||
    duration > 1439
  )
    throw new Error("Enter a valid break start time and duration.");
  const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  const endMinutes = startMinutes + duration;
  if (endMinutes >= 1440) throw new Error("The break must finish before midnight.");
  return {
    start,
    end: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`,
    startMinutes,
    endMinutes,
    duration,
  };
}

/** Working hours from actual arrival, excluding the configured daily break. */
export function flexibleOfficeSchedule(
  clockIn: string,
  clockOut?: string | null,
  dailyHours = 8,
  policy?: OfficeBreakPolicy | null,
) {
  const lunch = officeBreakWindow(policy);
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
    const lunchStart = day + lunch.startMinutes;
    const lunchEnd = day + lunch.endMinutes;
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
      Math.min(end, day * 1440 + lunch.endMinutes) -
        Math.max(start, day * 1440 + lunch.startMinutes),
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
