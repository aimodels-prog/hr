import type { ReportData } from "@/lib/data/report-service";

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function exportToCsv(report: ReportData) {
  const headers = report.columns.map((column) => csvCell(column.label)).join(",");
  const csvRows = report.rows.map((row) =>
    report.columns.map((column) => csvCell(row[column.key])).join(","),
  );
  const csvContent = `\uFEFF${[headers, ...csvRows].join("\r\n")}`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.name.replace(/[^a-z0-9]+/gi, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
