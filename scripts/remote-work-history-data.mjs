import { groupDays, normaliseName } from "./leave-history-data.mjs";

const remoteMarkers = (workbook) => {
  if (!Array.isArray(workbook?.excluded))
    throw new Error("Prepared workbook has no excluded markers");
  return workbook.excluded
    .filter((day) => day.code === "RM")
    .map((day) => ({
      name: String(day.name ?? "").trim(),
      date: day.date,
      code: day.code,
      days: day.days,
      year: day.year,
    }))
    .sort((left, right) =>
      `${normaliseName(left.name)}:${left.date}`.localeCompare(
        `${normaliseName(right.name)}:${right.date}`,
      ),
    );
};

/** Never trust a prepared JSON file without re-reading the exact signed-off workbook. */
export function verifiedRemoteMarkers(preparedWorkbook, extractedWorkbook, file, sha256) {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Invalid workbook SHA-256");
  if (
    preparedWorkbook?.file !== file ||
    preparedWorkbook.sha256?.toLowerCase() !== sha256.toLowerCase() ||
    preparedWorkbook.year !== extractedWorkbook.year
  )
    throw new Error("Prepared workbook does not match the selected source file and hash");
  const prepared = remoteMarkers(preparedWorkbook);
  const actual = remoteMarkers(extractedWorkbook);
  if (JSON.stringify(prepared) !== JSON.stringify(actual))
    throw new Error("Prepared remote-work days differ from the source workbook");
  for (const day of actual) {
    if (
      !day.name ||
      !/^20\d\d-\d\d-\d\d$/.test(day.date) ||
      day.days !== 1 ||
      Number(day.date.slice(0, 4)) !== day.year
    )
      throw new Error("Invalid remote-work marker in source workbook");
  }
  return actual;
}

export function groupRemoteMarkers(days, employeeId) {
  return groupDays(days.map((day) => ({ ...day, employeeId })));
}
