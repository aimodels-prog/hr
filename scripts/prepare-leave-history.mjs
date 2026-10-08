import read from "read-excel-file/node";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { extractDays } from "./leave-history-data.mjs";
const [output, ...files] = process.argv.slice(2);
if (!output || files.length !== 2)
  throw new Error("Usage: output.json workbook2025.xlsx workbook2026.xlsx");
const workbooks = [];
for (const file of files) {
  const hash = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  workbooks.push({
    ...extractDays(await read(file), { file: basename(file), sha256: hash }),
    sha256: hash,
    file: basename(file),
  });
}
await writeFile(
  output,
  JSON.stringify({ version: 1, preparedAt: new Date().toISOString(), workbooks }, null, 2),
);
console.log(
  JSON.stringify(
    workbooks.map((w) => ({
      file: w.file,
      year: w.year,
      days: w.days.length,
      leaveDays: w.days.reduce((a, b) => a + b.days, 0),
      excludedMarkers: w.excluded.length,
      issues: w.issues,
    })),
    null,
    2,
  ),
);
