import type { InterviewSlot } from "./types.ts";

function wallClockParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

export function calendarDateInZone(value: Date, timezone: string): string {
  const { year, month, day } = wallClockParts(value, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isWorkingCalendarDate(date: string, workingDays: readonly number[]): boolean {
  return workingDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
}

export function interviewSlotFromLocalTime(
  date: string,
  time: string,
  durationMinutes: number,
  timezone: string,
): InterviewSlot {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch || !Number.isInteger(durationMinutes) || durationMinutes < 1)
    throw new Error("Choose a valid interview date, time and duration.");
  const [year, month, day, hour, minute] = [
    Number(dateMatch[1]),
    Number(dateMatch[2]),
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  ];
  if (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date ||
    hour > 23 ||
    minute > 59
  )
    throw new Error("Choose a valid interview date and time.");

  const requestedWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let instant = requestedWallClock;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = wallClockParts(new Date(instant), timezone);
    const shownWallClock = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
    );
    if (shownWallClock === requestedWallClock) break;
    instant -= shownWallClock - requestedWallClock;
  }
  const shown = wallClockParts(new Date(instant), timezone);
  if (
    Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute) !==
    requestedWallClock
  )
    throw new Error("This local time does not exist in the selected timezone.");
  return {
    startTime: new Date(instant).toISOString(),
    endTime: new Date(instant + durationMinutes * 60_000).toISOString(),
    timezone,
  };
}

export function assertInterviewWorkingDay(
  slot: InterviewSlot,
  workingDays: readonly number[],
  timezone: string,
  now = new Date(),
): void {
  if (slot.timezone !== timezone) throw new Error("Use the organisation's interview timezone.");
  const start = new Date(slot.startTime);
  const end = new Date(slot.endTime);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start <= now ||
    end <= start
  )
    throw new Error("Choose a future interview time.");
  const date = calendarDateInZone(start, timezone);
  if (!isWorkingCalendarDate(date, workingDays))
    throw new Error("Choose one of the organisation's working days.");
  if (calendarDateInZone(end, timezone) !== date)
    throw new Error("The interview must finish on the same working day.");
}

export function suggestWorkingInterviewSlots(input: {
  startDate: Date;
  endDate: Date;
  durationMinutes: number;
  timezone: string;
  workingDays: readonly number[];
  now?: Date;
}): InterviewSlot[] {
  const now = input.now ?? new Date();
  const first = calendarDateInZone(input.startDate > now ? input.startDate : now, input.timezone);
  const last = calendarDateInZone(input.endDate, input.timezone);
  const slots: InterviewSlot[] = [];
  let workingDates = 0;
  for (
    let cursor = new Date(`${first}T12:00:00Z`);
    cursor.toISOString().slice(0, 10) <= last && workingDates < 3;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    if (!isWorkingCalendarDate(date, input.workingDays)) continue;
    workingDates += 1;
    for (const time of ["10:00", "13:00", "15:00"]) {
      const slot = interviewSlotFromLocalTime(date, time, input.durationMinutes, input.timezone);
      if (new Date(slot.startTime) > now && new Date(slot.endTime) <= input.endDate)
        slots.push(slot);
    }
  }
  return slots;
}
