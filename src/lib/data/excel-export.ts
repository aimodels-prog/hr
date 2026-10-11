import type { Cell, SheetData } from "write-excel-file/universal";

export type ExportFormat = "xlsx" | "csv";
export type SpreadsheetValue = string | number | boolean | null | undefined;
export interface SpreadsheetTable {
  headers: string[];
  rows: SpreadsheetValue[][];
}

/** Explicit string cells preserve phone numbers, IDs and text that resembles a formula. */
export async function createExcelFile(
  table: SpreadsheetTable,
  sheetName = "Records",
): Promise<Blob> {
  if (!table.headers.length) throw new Error("The export has no columns.");
  if (table.headers.length > 16384 || table.rows.length > 1048575)
    throw new Error("Too many records for one Excel sheet. Select a smaller date range.");
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  const header: Cell[] = table.headers.map((value) => ({
    value,
    type: String,
    fontWeight: "bold",
    backgroundColor: "#0A559B",
    textColor: "#FFFFFF",
    wrap: true,
  }));
  const data: SheetData = [
    header,
    ...table.rows.map((row) =>
      table.headers.map((_, index): Cell => {
        const value = row[index];
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") {
          if (!Number.isFinite(value)) throw new Error("An exported number is invalid.");
          return { value, type: Number, format: "0.########" };
        }
        if (typeof value === "boolean") return { value, type: Boolean };
        return { value, type: String, wrap: true };
      }),
    ),
  ];
  return writeExcelFile(data, {
    sheet:
      sheetName
        .replace(/[\\/*?:[\]]/g, " ")
        .replace(/^'+|'+$/g, "")
        .trim()
        .slice(0, 31) || "Records",
    stickyRowsCount: 1,
    columns: table.headers.map((heading, index) => ({
      width: Math.min(
        45,
        Math.max(
          16,
          heading.length + 2,
          ...table.rows.slice(0, 100).map((row) => String(row[index] ?? "").length + 2),
        ),
      ),
    })),
  }).toBlob();
}

export function downloadExportFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Let the browser start reading the object URL before releasing it (also on phones).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadExcel(table: SpreadsheetTable, fileName: string, sheetName?: string) {
  downloadExportFile(
    await createExcelFile(table, sheetName),
    fileName.replace(/\.(csv|xlsx)$/i, "") + ".xlsx",
  );
}

/** Reuse an existing authorised CSV export without widening the selected records. */
export async function downloadCsvExport(
  csv: string,
  fileName: string,
  format: ExportFormat,
  numericColumns: string[] = [],
) {
  if (format === "csv") {
    downloadExportFile(
      new Blob(["\uFEFF", csv.replace(/^\uFEFF/, "")], { type: "text/csv;charset=utf-8" }),
      fileName,
    );
    return;
  }
  await downloadExcel(await csvExportTable(csv, numericColumns), fileName);
}

export async function csvExportTable(
  csv: string,
  numericColumns: string[] = [],
): Promise<SpreadsheetTable> {
  const { parse } = await import("csv-parse/browser/esm/sync");
  const [headers, ...rows] = parse(csv, { bom: true, skip_empty_lines: true }) as string[][];
  const numeric = new Set(numericColumns);
  return {
    headers: headers ?? [],
    rows: rows.map((row) =>
      row.map((value, index) =>
        numeric.has(headers![index]!) && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value,
      ),
    ),
  };
}
