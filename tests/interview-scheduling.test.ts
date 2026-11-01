import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInterviewWorkingDay,
  calendarDateInZone,
  interviewSlotFromLocalTime,
  suggestWorkingInterviewSlots,
} from "../src/lib/data/interview-scheduling.ts";

test("interview suggestions skip Friday and Saturday using VIA's configured working days", () => {
  const slots = suggestWorkingInterviewSlots({
    startDate: new Date("2026-10-30T00:00:00Z"),
    endDate: new Date("2026-11-06T23:00:00Z"),
    durationMinutes: 30,
    timezone: "Asia/Muscat",
    workingDays: [0, 1, 2, 3, 4],
    now: new Date("2026-10-29T00:00:00Z"),
  });
  assert.equal(slots.length, 9);
  assert.equal(calendarDateInZone(new Date(slots[0]!.startTime), "Asia/Muscat"), "2026-11-01");
  assert.equal(slots[0]!.startTime, "2026-11-01T06:00:00.000Z");
  assert.ok(
    slots.every((slot) =>
      [0, 1, 2, 3, 4].includes(
        new Date(
          `${calendarDateInZone(new Date(slot.startTime), "Asia/Muscat")}T12:00:00Z`,
        ).getUTCDay(),
      ),
    ),
  );
});

test("a manually chosen time uses the organisation timezone and cannot land on a rest day", () => {
  const now = new Date("2026-10-29T00:00:00Z");
  const sunday = interviewSlotFromLocalTime("2026-11-01", "10:30", 45, "Asia/Muscat");
  assert.equal(sunday.startTime, "2026-11-01T06:30:00.000Z");
  assert.equal(sunday.endTime, "2026-11-01T07:15:00.000Z");
  assert.doesNotThrow(() => assertInterviewWorkingDay(sunday, [0, 1, 2, 3, 4], "Asia/Muscat", now));

  const friday = interviewSlotFromLocalTime("2026-10-30", "10:00", 30, "Asia/Muscat");
  assert.throws(
    () => assertInterviewWorkingDay(friday, [0, 1, 2, 3, 4], "Asia/Muscat", now),
    /working days/,
  );
  assert.doesNotThrow(() => assertInterviewWorkingDay(friday, [1, 2, 3, 4, 5], "Asia/Muscat", now));
});

test("manual interview times reject impossible dates, past times and cross-midnight slots", () => {
  assert.throws(
    () => interviewSlotFromLocalTime("2026-02-30", "10:00", 30, "Asia/Muscat"),
    /valid interview date/,
  );
  const past = interviewSlotFromLocalTime("2026-11-01", "09:00", 30, "Asia/Muscat");
  assert.throws(
    () =>
      assertInterviewWorkingDay(
        past,
        [0, 1, 2, 3, 4],
        "Asia/Muscat",
        new Date("2026-11-01T07:00:00Z"),
      ),
    /future interview time/,
  );
  const overnight = interviewSlotFromLocalTime("2026-11-01", "23:45", 30, "Asia/Muscat");
  assert.throws(
    () =>
      assertInterviewWorkingDay(
        overnight,
        [0, 1, 2, 3, 4],
        "Asia/Muscat",
        new Date("2026-10-29T00:00:00Z"),
      ),
    /same working day/,
  );
});
