import assert from "node:assert/strict";
import test from "node:test";
import readExcelFile from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { createExcelFile, csvExportTable } from "../src/lib/data/excel-export.ts";

test("real XLSX retains Unicode, phone numbers, IDs, numeric hours and safe literal formulas", async () => {
  const headers = ["Employee Number", "Employee", "Phone", "WhatsApp", "Hours", "Text", "Active"];
  const rows = [
    [
      "00023",
      "Emmanuel / علي",
      "+968 9000 1000",
      "+968 9000 2000",
      9.125,
      '=HYPERLINK("https://invalid.example")',
      true,
    ],
  ];
  const blob = await createExcelFile({ headers, rows }, "Attendance/October [2026]");
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), "PK");
  const sheets = await readExcelFile(Buffer.from(bytes));
  assert.deepEqual(sheets[0]!.data, [headers, ...rows]);
  const zip = unzipSync(bytes);
  const xml = strFromU8(zip["xl/worksheets/sheet1.xml"]!);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.match(xml, /state="frozen"/);
  assert.match(strFromU8(zip["xl/styles.xml"]!), /0A559B/);
});

test("CSV to Excel preserves quoted commas, newlines and leading zeros; only named columns are numeric", async () => {
  const table = await csvExportTable(
    '\uFEFF"Employee Number","Phone","Working Days","Notes"\r\n"00004","+968 1234","0.5","Line 1, quoted ""text""\nLine 2"\r\n',
    ["Working Days"],
  );
  assert.deepEqual(table.rows, [["00004", "+968 1234", 0.5, 'Line 1, quoted "text"\nLine 2']]);
  const file = await createExcelFile(table);
  const sheets = await readExcelFile(Buffer.from(await file.arrayBuffer()));
  assert.deepEqual(sheets[0]!.data, [table.headers, ...table.rows]);
});

test("empty selections yield a valid header-only workbook; invalid or oversized exports fail clearly", async () => {
  const file = await createExcelFile({ headers: ["Employee", "Hours"], rows: [] });
  assert.deepEqual((await readExcelFile(Buffer.from(await file.arrayBuffer())))[0]!.data, [
    ["Employee", "Hours"],
  ]);
  await assert.rejects(createExcelFile({ headers: [], rows: [] }), /no columns/);
  await assert.rejects(createExcelFile({ headers: ["Hours"], rows: [[NaN]] }), /invalid/);
  await assert.rejects(
    createExcelFile({ headers: ["Hours"], rows: new Array(1048576) }),
    /Too many records/,
  );
});
