import { ReportData } from "@/lib/data/report-service";

export function exportToCsv(report: ReportData) {
  // 1. Build headers
  const headers = report.columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(",");
  
  // 2. Build rows
  const csvRows = report.rows.map(row => {
    return report.columns.map(col => {
      let val = row[col.key];
      if (val === null || val === undefined) {
        val = "";
      }
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",");
  });

  // 3. Combine
  const csvContent = [headers, ...csvRows].join("\n");
  
  // 4. Trigger download
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${report.name.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
