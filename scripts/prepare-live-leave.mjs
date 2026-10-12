import read from "read-excel-file/node";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { normaliseName } from "./leave-history-data.mjs";

const [workbookPath, matchingPath] = process.argv.slice(2);
if (!workbookPath || !matchingPath)
  throw new Error("Usage: prepare-live-leave.mjs workbook.xlsx matching.local.json");
const matching = JSON.parse(await readFile(matchingPath, "utf8"));
const aliases = Object.fromEntries(
  Object.entries(matching.aliases ?? {}).map(([source, target]) => [
    normaliseName(source),
    normaliseName(target),
  ]),
);
const sourceHash = createHash("sha256")
  .update(await readFile(workbookPath))
  .digest("hex");
const workbook = await read(workbookPath);
const sheet = workbook.find((entry) => entry.sheet.trim() === "Annual Leave Calculations");
if (
  !sheet ||
  sheet.data[33]?.[9] !== "Remaining 2026" ||
  sheet.data[0]?.[9] !== "Remaining 2025 - 2026"
)
  throw new Error("Unexpected annual leave calculation layout");
const oldCarry = new Map();
for (const row of sheet.data.slice(1, 29)) {
  const name = normaliseName(row[1]);
  if (!name) continue;
  const key = aliases[name] ?? name;
  if (oldCarry.has(key)) throw new Error("Duplicate 2025 balance name");
  const value = row[9];
  oldCarry.set(key, typeof value === "number" ? Math.max(0, value) : 0);
}
const rows = [];
const names = new Set();
for (const row of sheet.data.slice(34)) {
  const name = String(row[1] ?? "").trim();
  if (!name) continue;
  const key = aliases[normaliseName(name)] ?? normaliseName(name);
  if (names.has(key)) throw new Error("Duplicate 2026 balance name");
  names.add(key);
  const entitlement = row[7],
    used = row[8],
    remaining = row[9];
  if (
    ![entitlement, used, remaining].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    Math.abs(entitlement - used - remaining) > 0.02
  )
    throw new Error(`Invalid annual leave calculation for ${name}`);
  rows.push({
    name,
    employeeName: key,
    entitlement: Math.round(entitlement * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    carry: Math.round((oldCarry.get(key) ?? 0) * 100) / 100,
  });
}
if (rows.length < 20) throw new Error("Too few current-year balance rows");
process.stdout.write(
  JSON.stringify({
    version: 1,
    year: 2026,
    sourceSha256: sourceHash,
    rows,
    formerEmployees: (matching.formerEmployees ?? []).map(normaliseName),
    expectedWorkspaceEmails: matching.expectedWorkspaceEmails ?? {},
  }),
);
