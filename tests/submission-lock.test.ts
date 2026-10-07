import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubmissionLock } from "../src/lib/submission-lock.ts";

test("rapid repeated submissions execute once and unlock after completion", async () => {
  const lock = createSubmissionLock();
  let finish!: () => void;
  let calls = 0;
  const first = lock.run(() => {
    calls++;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  for (let i = 0; i < 6; i++)
    lock.run(() => {
      calls++;
    });
  assert.equal(calls, 1);
  assert.equal(lock.pending, true);
  finish();
  await first;
  lock.run(() => {
    calls++;
  });
  assert.equal(calls, 2);
  assert.equal(lock.pending, false);
});
test("failed submissions allow a corrected retry", async () => {
  const lock = createSubmissionLock();
  await assert.rejects(
    lock.run(async () => {
      throw new Error("failed");
    })!,
    /failed/,
  );
  assert.equal(lock.pending, false);
  assert.throws(
    () =>
      lock.run(() => {
        throw new Error("sync failure");
      }),
    /sync failure/,
  );
  assert.equal(lock.pending, false);
  assert.equal(
    lock.run(() => 42),
    42,
  );
});
