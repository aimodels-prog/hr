import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { parse as parseCsv } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";

import type { SheetPreview } from "../../data/import-service.ts";
import { getDatabaseClient } from "../client.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 10_000;
const MAX_COLUMNS = 200;
const MAX_CELL_LENGTH = 10_000;

function requireRecruiter(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can preview candidate imports.");
  if (!actor.userId) throw new Error("A verified VIA user is required.");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (text.length > MAX_CELL_LENGTH)
    throw new Error("A spreadsheet cell exceeds the 10,000-character safety limit.");
  // A leading formula marker is retained as text but neutralised so later CSV exports cannot
  // execute it in a spreadsheet application.
  return /^[=+@]/.test(text) || /^-[A-Za-z]/.test(text) ? `'${text}` : text;
}

function detectHeader(matrix: string[][]): number {
  const terms = [
    "name",
    "email",
    "contact",
    "phone",
    "position",
    "company",
    "experience",
    "nationality",
    "project",
    "status",
  ];
  return (
    matrix
      .slice(0, 12)
      .map((row, index) => ({
        index,
        score: row.filter((cell) => {
          const normalized = cell.toLowerCase().replace(/[^a-z0-9]/g, "");
          return terms.some((term) => normalized.includes(term));
        }).length,
      }))
      .sort((a, b) => b.score - a.score)[0]?.index ?? 0
  );
}

function preview(name: string, rawMatrix: unknown[][]): SheetPreview {
  if (rawMatrix.length > MAX_ROWS_PER_SHEET + 12)
    throw new Error(`“${name}” exceeds the ${MAX_ROWS_PER_SHEET.toLocaleString()}-row limit.`);
  if (rawMatrix.some((row) => row.length > MAX_COLUMNS))
    throw new Error(`“${name}” exceeds the ${MAX_COLUMNS}-column limit.`);
  const matrix = rawMatrix.map((row) => row.map(cellText));
  const headerIndex = detectHeader(matrix);
  const headers = (matrix[headerIndex] ?? []).map((cell, index) => {
    const value = cell.trim();
    return value || `Unlabelled Column ${index + 1}`;
  });
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length)
    throw new Error(
      `“${name}” contains duplicate column headings: ${[...new Set(duplicates)].join(", ")}.`,
    );
  const rows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  return { name, headers, rows, headerRowNumber: headerIndex + 1 };
}

export async function parseCandidateSpreadsheetInDatabase(
  organisationId: string,
  input: { fileName: string; mimeType: string; bytes: Uint8Array },
  actor: AuditActorContext,
): Promise<SheetPreview[]> {
  requireRecruiter(actor);
  if (!input.bytes.byteLength || input.bytes.byteLength > MAX_IMPORT_BYTES)
    throw new Error("Candidate import files must be no larger than 10 MB.");
  const extension = input.fileName.toLowerCase().match(/\.(xlsx|csv)$/)?.[1];
  if (!extension) throw new Error("Upload an XLSX or CSV candidate file.");

  const buffer = Buffer.from(input.bytes);
  let previews: SheetPreview[];
  if (extension === "xlsx") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      throw new Error("The uploaded file is not a valid XLSX workbook.");
    const workbook = await readXlsxFile(buffer);
    if (!workbook.length) throw new Error("The workbook contains no sheets.");
    if (workbook.length > MAX_SHEETS)
      throw new Error(`A workbook can contain at most ${MAX_SHEETS} sheets.`);
    previews = workbook.map((sheet) => preview(sheet.sheet, sheet.data));
  } else {
    const records = parseCsv(buffer, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
      max_record_size: MAX_CELL_LENGTH * MAX_COLUMNS,
    }) as unknown[][];
    previews = [preview(input.fileName.replace(/\.csv$/i, "") || "Candidates", records)];
  }

  const db = getDatabaseClient();
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId!,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    action: "preview-import",
    module: "recruitment",
    entityType: "candidate-import",
    entityId: randomUUID(),
    reason: "HR reviewed a candidate spreadsheet before import",
    afterSummary: {
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.bytes.byteLength,
      sheetCount: previews.length,
      rowCount: previews.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    },
    riskLevel: "High",
    occurredAt: new Date().toISOString(),
  });
  return previews;
}
