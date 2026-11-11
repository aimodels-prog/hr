import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readCandidateReviewQueue,
  saveCandidateReviewQueue,
} from "../src/lib/recruitment/candidate-review-queue.ts";

test("vacancy review queue keeps the same candidate order and filters", () => {
  const values = new Map<string, string>();
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
  try {
    saveCandidateReviewQueue({
      vacancyId: "role-a",
      candidateIds: ["person-c", "person-a", "person-b"],
      tab: "applications",
      applicationSearch: "engineer",
      applicationSource: "Careers Portal",
      applicationView: "review",
      applicationSort: "score",
      pipelineView: "all",
      pipelineSearch: "",
      scrollY: 420,
      listScrollTop: 190,
    });
    const restored = readCandidateReviewQueue("role-a");
    assert.deepEqual(restored?.candidateIds, ["person-c", "person-a", "person-b"]);
    assert.equal(restored?.applicationSearch, "engineer");
    assert.equal(restored?.applicationSort, "score");
    assert.equal(restored?.listScrollTop, 190);
    assert.equal(readCandidateReviewQueue("role-b"), null);
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});
