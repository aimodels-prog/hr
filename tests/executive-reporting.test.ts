import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCeoPosition,
  isSupervisorOptionalPosition,
  validateCeoSupervisor,
} from "../src/lib/data/executive-reporting.ts";

test("CEO has no supervisor, while the Country Manager may have none", () => {
  for (const title of ["CEO", " ceo ", "Chief Executive Officer", "Chief  Executive Officer"])
    assert.equal(isCeoPosition(title), true);
  for (const title of [
    "Country Manager",
    "CFO",
    "Executive Assistant",
    "Assistant to CEO",
    "HR",
    "",
  ])
    assert.equal(isCeoPosition(title), false);
  assert.doesNotThrow(() => validateCeoSupervisor("CEO", null));
  assert.throws(() => validateCeoSupervisor("CEO", "manager-id"), /CEO has no supervisor/);
  assert.doesNotThrow(() => validateCeoSupervisor("Country Manager", "ceo-id"));
  assert.equal(isSupervisorOptionalPosition("Country Manager"), true);
  assert.equal(isSupervisorOptionalPosition("Country Manager Oman"), true);
  assert.equal(isSupervisorOptionalPosition("CEO"), true);
  assert.equal(isSupervisorOptionalPosition("CFO"), false);
});
