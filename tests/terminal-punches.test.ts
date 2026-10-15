import assert from "node:assert/strict";
import { test } from "node:test";

import { effectiveTerminalPunchTimes } from "../src/lib/data/terminal-punches.ts";

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
