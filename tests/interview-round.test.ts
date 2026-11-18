import assert from "node:assert/strict";
import { test } from "node:test";

import { validateInterviewRound } from "../src/lib/recruitment/interview-round.ts";

test("both shortlist rounds require a dated conversation or an explicitly waived interview", () => {
  assert.deepEqual(
    validateInterviewRound(
      "first",
      { method: "Phone", remark: "Suitable for next round", date: "2026-11-18" },
      "2026-11-18",
    ),
    { method: "Phone", remark: "Suitable for next round", date: "2026-11-18" },
  );
  assert.deepEqual(
    validateInterviewRound(
      "second",
      { method: "Waived", remark: "Panel review provides sufficient evidence" },
      "2026-11-18",
    ),
    { method: "Waived", remark: "Panel review provides sufficient evidence" },
  );
  assert.deepEqual(
    validateInterviewRound(
      "second",
      { method: "Scheduled", remark: "Completed interview supports moving to offer" },
      "2026-11-18",
    ),
    { method: "Scheduled", remark: "Completed interview supports moving to offer" },
  );
  assert.throws(
    () => validateInterviewRound("first", { method: "Waived", remark: "" }, "2026-11-18"),
    /remark/,
  );
  assert.throws(
    () =>
      validateInterviewRound("second", { method: "Phone", remark: "Good candidate" }, "2026-11-18"),
    /conversation date/,
  );
  assert.throws(
    () =>
      validateInterviewRound(
        "first",
        { method: "Phone", remark: "Good candidate", date: "2026-02-31" },
        "2026-11-18",
      ),
    /conversation date/,
  );
  assert.throws(
    () =>
      validateInterviewRound(
        "first",
        { method: "Waived", remark: "Candidate too old" },
        "2026-11-18",
      ),
    /job requirements/,
  );
});
