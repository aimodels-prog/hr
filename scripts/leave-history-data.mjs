import { createHash } from "node:crypto";

export const normaliseName = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
export const codes = {
  "A/L": ["Annual Leave", "Annual"],
  AL24: ["Annual Leave (2024 entitlement)", "Annual"],
  AL25: ["Annual Leave (2025 entitlement)", "Annual"],
  SICK: ["Sick Leave", "Sick"],
  C: ["Compassionate Leave", "Compassionate"],
  M: ["Marriage Leave", "Marriage"],
  "C/OFF": ["Compensatory Leave", "CompensationOff"],
  P: ["Paternity Leave", "Paternity"],
  MAT: ["Maternity Leave", "Maternity"],
  EML: ["Emergency Leave", "Emergency"],
  AH: ["Accompany Patient Leave", "AccompanyPatient"],
  UPL: ["Unpaid Leave", "Unpaid"],
  H: ["Hajj Leave", "Hajj"],
  HFD: ["Half-day Leave", "Other"],
};
export function extractDays(sheets, source) {
  const summary = sheets.find((s) => s.sheet === "Summary");
  const year = Number(summary?.data[5]?.[2]);
  if (![2025, 2026].includes(year)) throw new Error("Unexpected workbook calendar year");
  const result = [];
  const excluded = [];
  const issues = [];
  const names = new Set();
  const months = [
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
  ];
  for (const [month, sheetName] of months.entries()) {
    const sheet = sheets.find((s) => s.sheet === sheetName);
    if (!sheet) throw new Error(`Missing month: ${sheetName}`);
    for (let row = 8; row < 36; row++) {
      const name = String(sheet.data[row]?.[2] ?? "").trim();
      if (!name) continue;
      names.add(name);
      for (let col = 3; col <= 33; col++) {
        const rawCode = String(sheet.data[row]?.[col] ?? "").trim();
        if (!rawCode) continue;
        const dateValue = sheet.data[7]?.[col];
        const date = dateValue instanceof Date ? dateValue : new Date(NaN);
        if (
          !Number.isFinite(date.getTime()) ||
          date.getUTCFullYear() !== year ||
          date.getUTCMonth() !== month
        ) {
          issues.push({
            name,
            source,
            sheet: sheetName,
            row: row + 1,
            column: col + 1,
            rawCode,
            reason: "Marked cell has no valid date in this month",
          });
          continue;
        }
        const code =
          rawCode.toUpperCase().replace(/\s+/g, "") === "HFD/R" ? "HFD" : rawCode.toUpperCase();
        const entry = {
          name,
          date: date.toISOString().slice(0, 10),
          code,
          rawCode,
          days: code === "HFD" ? 0.5 : 1,
          source,
          sheet: sheetName,
          row: row + 1,
          column: col + 1,
          year,
        };
        if (["R", "RM"].includes(code)) {
          excluded.push(entry);
          continue;
        }
        if (!codes[code]) throw new Error(`Unknown leave code ${rawCode}`);
        result.push(entry);
      }
    }
  }
  return { year, days: result, excluded, issues, names: [...names] };
}
export function stableId(value) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function groupDays(days) {
  const sorted = [...days].sort((a, b) =>
    `${a.employeeId}:${a.code}:${a.date}`.localeCompare(`${b.employeeId}:${b.code}:${b.date}`),
  );
  const groups = [];
  for (const day of sorted) {
    const previous = groups.at(-1);
    if (
      previous &&
      day.days === 1 &&
      previous.days.at(-1).days === 1 &&
      previous.employeeId === day.employeeId &&
      previous.code === day.code &&
      previous.year === day.year &&
      new Date(day.date) - new Date(previous.endDate) === 86400000
    ) {
      previous.endDate = day.date;
      previous.days.push(day);
    } else
      groups.push({
        employeeId: day.employeeId,
        code: day.code,
        year: day.year,
        startDate: day.date,
        endDate: day.date,
        days: [day],
      });
  }
  return groups;
}
