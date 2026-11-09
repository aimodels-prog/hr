import assert from "node:assert/strict";
import test from "node:test";

import { extractDays } from "../scripts/leave-history-data.mjs";
import { groupRemoteMarkers, verifiedRemoteMarkers } from "../scripts/remote-work-history-data.mjs";

const sourceFile = "Leave tracker 2025 to 2026 (1).xlsx";
const sourceSha256 = "a".repeat(64);

function octoberWorkbook() {
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
  const october = sheets.find((sheet) => sheet.sheet === "Oct")!;
  october.data = Array.from({ length: 35 }, () => []);
  october.data[34]![2] = "Emmanuel Gregory Essiet ";
  for (let day = 1; day <= 31; day++) {
    const column = day + 2;
    october.data[7]![column] = new Date(`2026-10-${String(day).padStart(2, "0")}T00:00:00Z`);
    if ((day >= 18 && day <= 22) || (day >= 25 && day <= 29)) october.data[34]![column] = "RM";
    if (day >= 8 && day <= 15) october.data[34]![column] = "A/L";
  }
  return sheets;
}

test("October tracker extracts Emmanuel's two five-day remote-work periods", () => {
  const extracted = extractDays(octoberWorkbook(), {
    file: sourceFile,
    sha256: sourceSha256,
  });
  const prepared = { ...extracted, file: sourceFile, sha256: sourceSha256 };
  const remote = verifiedRemoteMarkers(prepared, extracted, sourceFile, sourceSha256);
  assert.deepEqual(
    remote.map((day) => day.date),
    [18, 19, 20, 21, 22, 25, 26, 27, 28, 29].map((day) => `2026-10-${day}`),
  );
  assert.deepEqual(
    groupRemoteMarkers(remote, "test-employee").map((group) => [
      group.startDate,
      group.endDate,
      group.days.length,
    ]),
    [
      ["2026-10-18", "2026-10-22", 5],
      ["2026-10-25", "2026-10-29", 5],
    ],
  );
  assert.equal(extracted.days.filter((day) => day.code === "A/L").length, 8);
});

test("remote-work import refuses a mismatched hash or edited prepared dates", () => {
  const extracted = extractDays(octoberWorkbook(), {
    file: sourceFile,
    sha256: sourceSha256,
  });
  const prepared = { ...extracted, file: sourceFile, sha256: sourceSha256 };
  assert.throws(
    () => verifiedRemoteMarkers(prepared, extracted, sourceFile, "b".repeat(64)),
    /does not match/,
  );
  assert.throws(
    () =>
      verifiedRemoteMarkers(
        { ...prepared, excluded: prepared.excluded.slice(1) },
        extracted,
        sourceFile,
        sourceSha256,
      ),
    /differ/,
  );
});
