import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccessDenied, useCurrentUser } from "@/lib/auth";
import { ReportService, ReportData } from "@/lib/data/report-service";
import { exportToCsv } from "@/components/reports/report-exporter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Printer, Filter, ChevronRight, BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/staff/reports")({
  component: ReportsRoute,
  head: () => ({
    meta: [{ title: "Reports Centre — VIA HR System" }],
  }),
});

function ReportsRoute() {
  const { canAny } = useCurrentUser();

  // HR/Super Admin reach the full Reports Centre via system:audit_view.
  // Accounts reaches a payroll-scoped subset via payroll:view - ReportService
  // restricts what data Accounts can actually see/list once inside (see
  // ReportService.getScopedEmployees and getAvailableReports).
  const hasAccess = canAny(["system:audit_view", "payroll:view"]);

  if (!hasAccess) {
    return <AccessDenied resourceName="Reports" requiredPermission="system:audit_view" />;
  }

  return <ReportsDashboard />;
}

function ReportsDashboard() {
  const { currentEmployee, activeRole, id: currentUserId } = useCurrentUser();
  
  const reportService = useMemo(() => new ReportService(currentUserId, activeRole, currentEmployee || null), [currentUserId, activeRole, currentEmployee]);
  
  const availableReports = useMemo(() => reportService.getAvailableReports(), [reportService]);
  
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [filterQuery, setFilterQuery] = useState("");

  const loadReport = (id: string) => {
    setActiveReportId(id);
    const data = reportService.generateReport(id);
    setReportData(data);
    setFilterQuery(""); // Reset filter on new report load
  };

  const handleExport = () => {
    if (reportData && activeReportId) {
      exportToCsv(reportData);
      reportService.logReportExport(activeReportId, "CSV");
    }
  };

  const filteredRows = useMemo(() => {
    if (!reportData) return [];
    if (!filterQuery) return reportData.rows;
    const q = filterQuery.toLowerCase();
    return reportData.rows.filter(row => 
      Object.values(row).some(val => String(val).toLowerCase().includes(q))
    );
  }, [reportData, filterQuery]);

  // Group reports by category
  const categories = useMemo(() => {
    const cats: Record<string, typeof availableReports> = {};
    availableReports.forEach(r => {
      const bucket = cats[r.category] ?? (cats[r.category] = []);
      bucket.push(r);
    });
    return cats;
  }, [availableReports]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-semibold">Reports Centre</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View, filter, and export operational metrics across the system. 
          Data is automatically scoped to your role.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[250px_1fr]">
        {/* Sidebar Nav */}
        <div className="space-y-6">
          {Object.entries(categories).map(([category, reports]) => (
            <div key={category}>
              <h3 className="font-medium text-sm text-muted-foreground mb-2 px-2 uppercase tracking-wider">{category}</h3>
              <div className="space-y-1">
                {reports.map(r => (
                  <button
                    key={r.id}
                    onClick={() => loadReport(r.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center justify-between group transition-colors ${
                      activeReportId === r.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
                    }`}
                  >
                    {r.name}
                    {activeReportId === r.id && <ChevronRight className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Report Content area */}
        <div>
          {reportData ? (
            <Card className="border-t-4 border-t-primary shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                       <BarChart3 className="w-5 h-5 text-muted-foreground" /> 
                       {reportData.name}
                    </CardTitle>
                    <CardDescription className="mt-1.5 text-sm">{reportData.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="w-4 h-4 mr-2" /> Print
                    </Button>
                    <Button variant="default" size="sm" onClick={handleExport}>
                      <Download className="w-4 h-4 mr-2" /> Export CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex items-center max-w-sm">
                  <div className="relative w-full">
                    <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter results..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        {reportData.columns.map(col => (
                          <TableHead key={col.key} className="whitespace-nowrap font-medium">
                            {col.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.length > 0 ? (
                        filteredRows.map((row, idx) => (
                          <TableRow key={idx}>
                            {reportData.columns.map(col => {
                              let val = row[col.key];
                              if (col.type === 'currency' && typeof val === 'number') {
                                val = val.toLocaleString() + ' OMR';
                              }
                              return (
                                <TableCell key={col.key} className="whitespace-nowrap">
                                  {val}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={reportData.columns.length} className="h-24 text-center text-muted-foreground">
                            No matching records found.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-4 text-xs text-muted-foreground flex justify-between">
                   <span>Showing {filteredRows.length} records.</span>
                   {reportData.containsPersonalData && (
                     <span className="text-amber-600 flex items-center">
                       Note: Exporting this report will be recorded in the system audit log.
                     </span>
                   )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center border-2 border-dashed rounded-xl text-muted-foreground bg-muted/20">
               <BarChart3 className="w-12 h-12 mb-4 text-muted-foreground/50" />
               <p className="text-lg font-medium">Select a report</p>
               <p className="text-sm">Choose a category from the left menu to view metrics.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
