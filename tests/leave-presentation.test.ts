import assert from "node:assert/strict";
import test from "node:test";
import { leaveDisplayReason, newestLeaveFirst } from "../src/lib/data/leave-presentation.ts";

test("hide generated spreadsheet notes without losing real reasons or stored provenance", () => {
  const note =
    "Previously approved spreadsheet record (A/L). Original approval date/approver not supplied. Balance reconciliation pending.";
  assert.equal(leaveDisplayReason(note), "");
  assert.equal(leaveDisplayReason(note + " Family visit."), "Family visit.");
  assert.equal(leaveDisplayReason("Medical appointment"), "Medical appointment");
  assert.equal(leaveDisplayReason(""), "");
  assert.ok(note.includes("Balance reconciliation pending"));
});

test("leave history sorts dates across years, not import creation dates", () => {
  const requests = [
    { id: "a", startDate: "2026-10-08", endDate: "2026-10-15", createdAt: "2026-10-06" },
    { id: "b", startDate: "2025-12-20", endDate: "2026-01-02", createdAt: "2026-10-06" },
    { id: "c", startDate: "2026-11-01", endDate: "2026-11-05", createdAt: "2026-10-06" },
    { id: "d", startDate: "2026-01-05", endDate: "2026-01-06", createdAt: "2026-01-01" },
  ];
  assert.deepEqual(
    [...requests].sort(newestLeaveFirst).map((r) => r.id),
    ["c", "a", "d", "b"],
  );
  assert.deepEqual(
    requests
      .slice(0, 1)
      .concat(requests.slice(2, 3))
      .sort((a, b) => -newestLeaveFirst(a, b))
      .map((r) => r.id),
    ["a", "c"],
  );
});
