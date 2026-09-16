import assert from "node:assert/strict";
import test from "node:test";
import { withRequestTimeout } from "../src/lib/data/request-timeout.ts";

test("request timeout preserves successful results and errors", async () => {
  assert.deepEqual(await withRequestTimeout(Promise.resolve(["terminal"]), "timeout"), [
    "terminal",
  ]);
  await assert.rejects(
    withRequestTimeout(Promise.reject(new Error("offline")), "timeout"),
    /offline/,
  );
});

test("a stalled terminal read times out and does not block a subsequent retry", async () => {
  let finish!: (value: string[]) => void;
  const stalled = new Promise<string[]>((resolve) => {
    finish = resolve;
  });
  await assert.rejects(withRequestTimeout(stalled, "Please refresh", 5), /Please refresh/);
  assert.deepEqual(await withRequestTimeout(Promise.resolve(["new result"]), "timeout"), [
    "new result",
  ]);
  finish(["obsolete result"]);
});
