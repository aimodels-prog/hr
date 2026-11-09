import assert from "node:assert/strict";
import { test } from "node:test";

import {
  effectiveTerminalPunchTimes,
  officeLeaveReturnEvidence,
} from "../src/lib/data/terminal-punches.ts";

test("a repeated morning thumb leaves sign-out missing", () => {
  const first = new Date("2026-10-15T04:00:00Z");
  const repeated = new Date("2026-10-15T04:05:00Z");
  assert.deepEqual(effectiveTerminalPunchTimes([first, repeated], 15), [first]);
});

test("the day's last later thumb becomes sign-out after close repeats are ignored", () => {
  const first = new Date("2026-10-15T04:00:00Z");
  const repeated = new Date("2026-10-15T04:05:00Z");
  const afternoon = new Date("2026-10-15T12:00:00Z");
  const final = new Date("2026-10-15T13:00:00Z");
  assert.deepEqual(effectiveTerminalPunchTimes([first, repeated, afternoon, final], 15), [
    first,
    afternoon,
    final,
  ]);
});

test("leave return evidence needs a complete office day and explicit machine IN and OUT", () => {
  const base = {
    clockInAt: "2026-11-09T04:30:00Z",
    clockOutAt: "2026-11-09T13:30:00Z",
    workMode: "Office",
    activeSiteVisit: false,
    effectiveEvents: [
      { source: "Hardware Terminal", deviceStatus: 0 },
      { source: "Hardware Terminal", deviceStatus: 1 },
    ],
  };
  assert.deepEqual(officeLeaveReturnEvidence(base), {
    completeOfficeDay: true,
    explicitOut: true,
  });
  assert.equal(officeLeaveReturnEvidence({ ...base, clockOutAt: null }).completeOfficeDay, false);
  assert.equal(
    officeLeaveReturnEvidence({
      ...base,
      effectiveEvents: [{ source: "Hardware Terminal", deviceStatus: 0 }],
    }).explicitOut,
    false,
  );
  assert.equal(officeLeaveReturnEvidence({ ...base, workMode: "Remote" }).completeOfficeDay, false);
  assert.equal(officeLeaveReturnEvidence({ ...base, activeSiteVisit: true }).explicitOut, false);
  assert.equal(
    officeLeaveReturnEvidence({
      ...base,
      effectiveEvents: [
        { source: "Hardware Terminal", deviceStatus: 0 },
        { source: "Hardware Terminal", deviceStatus: 0 },
      ],
    }).explicitOut,
    false,
  );
  assert.equal(
    officeLeaveReturnEvidence({
      ...base,
      effectiveEvents: [
        { source: "Web", deviceStatus: null },
        { source: "Hardware Terminal", deviceStatus: 1 },
      ],
    }).explicitOut,
    false,
  );
});
