import assert from "node:assert/strict";
import test from "node:test";
import { extractDays, groupDays, stableId } from "../scripts/leave-history-data.mjs";
test("history uses actual dates, half-days, and excludes remote/resignation markers", () => {
  const sheets = [{ sheet: "Summary", data: Array.from({ length: 6 }, () => []) }];
  sheets[0]!.data[5]![2] = 2026;
  for (const month of [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ])
    sheets.push({ sheet: month, data: [] });
  const jan = sheets[1]!;
  jan.data = Array.from({ length: 9 }, () => []);
  jan.data[7]![3] = new Date("2026-01-01Z");
  jan.data[7]![4] = new Date("2026-01-02Z");
  jan.data[7]![5] = new Date("2026-01-03Z");
  jan.data[8]![2] = "Person";
  jan.data[8]![3] = "HFD/ R";
  jan.data[8]![4] = "RM";
  jan.data[8]![5] = "R";
  const result = extractDays(sheets, { file: "test" });
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].days, 0.5);
  assert.equal(result.excluded.length, 2);
});
test("history grouping never turns multiple half days into a single half-day request", () => {
  const days = [
    { employeeId: "one", year: 2026, date: "2026-01-01", code: "HFD", days: 0.5 },
    { employeeId: "one", year: 2026, date: "2026-01-02", code: "HFD", days: 0.5 },
  ];
  assert.equal(groupDays(days).length, 2);
  assert.equal(groupDays(days.map((d) => ({ ...d, code: "A/L", days: 1 }))).length, 1);
  assert.equal(stableId("same-source-day"), stableId("same-source-day"));
});
