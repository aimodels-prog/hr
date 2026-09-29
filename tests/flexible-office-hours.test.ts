import assert from "node:assert/strict";
import { test } from "node:test";
import { flexibleOfficeSchedule } from "../src/lib/data/office-schedule.ts";

test("flexible arrivals produce eight-hour working days excluding lunch", () => {
  for (const [arrival, departure] of [
    ["07:30", "16:30"],
    ["08:30", "17:30"],
    ["09:00", "18:00"],
    ["10:00", "19:00"],
  ]) {
    const day = flexibleOfficeSchedule(arrival!, departure!);
    assert.equal(day.expectedOut, departure);
    assert.equal(day.calculatedHours, 8);
    assert.equal(day.breakMinutes, 60);
    assert.equal(day.isEarlyDeparture, false);
    assert.equal(day.isLate, false);
    assert.equal(day.elapsedMinutes, 540);
  }
});
test("short days remain short and extra presence is preserved without overtime authorisation", () => {
  assert.equal(flexibleOfficeSchedule("07:30", "16:00").isEarlyDeparture, true);
  assert.equal(flexibleOfficeSchedule("07:30", "16:00").calculatedHours, 7.5);
  assert.equal(flexibleOfficeSchedule("07:30", "18:30").calculatedHours, 10);
  assert.equal(flexibleOfficeSchedule("07:30").isEarlyDeparture, false);
});
test("lunch applies only when it overlaps the working interval", () => {
  assert.equal(flexibleOfficeSchedule("04:00", "12:00").expectedOut, "12:00");
  assert.equal(flexibleOfficeSchedule("14:00", "22:00").breakMinutes, 0);
  assert.equal(flexibleOfficeSchedule("13:30", "22:00").calculatedHours, 8);
  assert.equal(flexibleOfficeSchedule("13:30").expectedOut, "22:00");
});
test("overnight completion and invalid times are handled explicitly", () => {
  const day = flexibleOfficeSchedule("20:00", "04:00");
  assert.equal(day.departureDayOffset, 1);
  assert.equal(day.expectedOut, "04:00");
  assert.equal(day.calculatedHours, 8);
  assert.equal(day.isEarlyDeparture, false);
  assert.throws(() => flexibleOfficeSchedule("25:00"));
  assert.throws(() => flexibleOfficeSchedule("07:30", null, 0));
});
