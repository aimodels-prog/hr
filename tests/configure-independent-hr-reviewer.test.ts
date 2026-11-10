import assert from "node:assert/strict";
import test from "node:test";

import { parseOptions } from "../scripts/configure-independent-hr-reviewer.ts";

test("reviewer setup defaults to dry run and requires an explicit identity", () => {
  assert.deepEqual(
    parseOptions(["--reviewer-email=R.Centonze@via-int.com", "--expected-name=Riccardo Centonze"]),
    {
      reviewerEmail: "r.centonze@via-int.com",
      expectedName: "Riccardo Centonze",
      organisationId: undefined,
      apply: false,
    },
  );
  assert.throws(() => parseOptions([]), /Usage/);
  assert.throws(
    () => parseOptions(["--reviewer-email=invalid", "--expected-name=Riccardo Centonze"]),
    /Usage/,
  );
});

test("reviewer setup rejects conflicting modes and malformed organisation IDs", () => {
  const identity = ["--reviewer-email=r.centonze@via-int.com", "--expected-name=Riccardo Centonze"];
  assert.throws(() => parseOptions([...identity, "--dry-run", "--apply"]), /Usage/);
  assert.throws(() => parseOptions([...identity, "--reviewer-email=other@via-int.com"]), /Usage/);
  assert.throws(() => parseOptions([...identity, "--organisation-id=not-a-uuid"]), /Usage/);
  assert.equal(parseOptions([...identity, "--apply"]).apply, true);
});
