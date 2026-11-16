import assert from "node:assert/strict";
import { test } from "node:test";
import { isTimeAwayMachineReturn } from "../src/lib/data/time-away-return.ts";

const planned = {
  startTime: "07:00",
  endTime: "10:00",
  hasOriginalClockIn: true,
  alreadyReturned: false,
};

test("a marked office IN near the planned return is not the final clock-out", () => {
  assert.equal(isTimeAwayMachineReturn({ ...planned, localTime: "10:00", deviceStatus: 0 }), true);
  assert.equal(isTimeAwayMachineReturn({ ...planned, localTime: "09:50", deviceStatus: 0 }), true);
});

test("with an earlier clock-in, ambiguous scans and final exit are not guessed as returns", () => {
  for (const candidate of [
    { localTime: "07:00", deviceStatus: 0 },
    { localTime: "07:30", deviceStatus: 0 },
    { localTime: "10:00", deviceStatus: 1 },
    { localTime: "10:00", deviceStatus: null },
    { localTime: "17:00", deviceStatus: 0 },
  ])
    assert.equal(isTimeAwayMachineReturn({ ...planned, ...candidate }), false);
  assert.equal(
    isTimeAwayMachineReturn({
      ...planned,
      localTime: "10:00",
      deviceStatus: 0,
      alreadyReturned: true,
    }),
    false,
  );
});

test("the first office thumb after home-origin time away confirms arrival", () => {
  for (const deviceStatus of [0, 1, null])
    assert.equal(
      isTimeAwayMachineReturn({
        ...planned,
        localTime: "10:00",
        deviceStatus,
        hasOriginalClockIn: false,
      }),
      true,
    );
  assert.equal(
    isTimeAwayMachineReturn({
      ...planned,
      localTime: "06:59",
      deviceStatus: 0,
      hasOriginalClockIn: false,
    }),
    false,
  );
});
