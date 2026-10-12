import assert from "node:assert/strict";
import { test } from "node:test";

import { displayedLeaveDays } from "../scripts/leave-history-data.mjs";

test("HR workbook balances use the whole days shown in Excel", () => {
  assert.equal(displayedLeaveDays(30.416666666666664), 30);
  assert.equal(displayedLeaveDays(0.4166666666666643), 0);
  assert.equal(displayedLeaveDays(-17.583333333333336), -18);
  assert.equal(displayedLeaveDays(0.5), 1);
  assert.equal(displayedLeaveDays(-0.5), -1);
});
