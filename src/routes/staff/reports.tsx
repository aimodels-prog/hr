import { useState, useMemo, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccessDenied, useCurrentUser } from "@/lib/auth";
import { ReportService, type ReportData, type ReportSavedView } from "@/lib/data/report-service";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bookmark,
  Download,
  Printer,
  Filter,
  ChevronRight,
  BarChart3,
  Trash2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SettingsService } from "@/lib/data/settings-service";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/reports")({
  component: ReportsRoute,
  head: () => ({
    meta: [{ title: "Reports Centre — VIA HR System" }],
  }),
});

function ReportsRoute() {
  const { activeRole } = useCurrentUser();
  const hasAccess = ["HR", "Accounts", "Super Admin"].includes(activeRole);

  if (!hasAccess) {
    return <AccessDenied resourceName="Reports" requiredPermission="system:audit_view" />;
  }

  return <ReportsDashboard />;
}

function ReportsDashboard() {
  const { currentEmployee, activeRole, id: currentUserId } = useCurrentUser();

  const reportService = useMemo(
    () => new ReportService(currentUserId, activeRole, currentEmployee || null),
    [currentUserId, activeRole, currentEmployee],
  );

  const [availableReports, setAvailableReports] = useState<
    { id: string; name: string; category: string }[]
  >([]);

  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [savedViews, setSavedViews] = useState<ReportSavedView[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [currency, setCurrency] = useState(
    () => new SettingsService().getAppSettingsSync().baseCurrency,
  );

  useEffect(() => {
    new SettingsService()
      .getAppSettings()
      .then((s) => setCurrency(s.baseCurrency))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    reportService
      .getAvailableReportsFromDatabase()
      .then((reports) => {
        if (active) setAvailableReports([...reports]);
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Reports could not be loaded.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reportService]);

  const currentFilters = useCallback(
    () => ({
      search: filterQuery,
      dateFrom,
      dateTo,
      department: departmentFilter,
      status: statusFilter,
    }),
    [dateFrom, dateTo, departmentFilter, filterQuery, statusFilter],
  );

  const loadReport = async (
    id: string,
    filters = { search: "", dateFrom: "", dateTo: "", department: "all", status: "all" },
  ) => {
    try {
      setIsLoading(true);
      setLoadError("");
      setActiveReportId(id);
      const [data, views] = await Promise.all([
        reportService.generateReportFromDatabase(id, filters),
        reportService.getSavedViewsFromDatabase(id),
      ]);
      setReportData(data);
      setSavedViews(views);
    } catch (error) {
      setReportData(null);
      setLoadError(error instanceof Error ? error.message : "The report could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  };

  const applySavedView = async (view: ReportSavedView) => {
    setFilterQuery(view.filters.search);
    setDateFrom(view.filters.dateFrom);
    setDateTo(view.filters.dateTo);
    setDepartmentFilter(view.filters.department);
    setStatusFilter(view.filters.status);
    await loadReport(view.reportId, view.filters);
  };

  const saveCurrentView = async () => {
    if (!activeReportId) return;
    try {
      await reportService.saveViewToDatabase(activeReportId, viewName, currentFilters());
      setSavedViews(await reportService.getSavedViewsFromDatabase(activeReportId));
      setSaveDialogOpen(false);
      setViewName("");
      toast.success("Report view saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The view could not be saved.");
    }
  };

  const deleteView = async (view: ReportSavedView) => {
    try {
      await reportService.deleteSavedViewFromDatabase(view.id);
      setSavedViews((current) => current.filter((item) => item.id !== view.id));
      toast.success("Saved view removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The view could not be removed.");
    }
  };

  const handleExport = async () => {
    if (!reportData || !activeReportId) return;
    try {
      setIsExporting(true);
      const exported = await reportService.exportReportFromDatabase(
        activeReportId,
        currentFilters(),
      );
      const url = URL.createObjectURL(new Blob([exported.csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`${exported.rowCount} records exported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The report could not be exported.");
    } finally {
      setIsExporting(false);
    }
  };

  const filteredRows = useMemo(() => reportData?.rows ?? [], [reportData]);

  const statuses = useMemo(
    () =>
      Array.from(new Set((reportData?.rows ?? []).map((row) => String(row["status"] ?? ""))))
        .filter(Boolean)
        .sort(),
    [reportData],
  );
  const departments = useMemo(
    () =>
      Array.from(new Set((reportData?.rows ?? []).map((row) => String(row["department"] ?? ""))))
        .filter(Boolean)
        .sort(),
    [reportData],
  );
  const attentionCount = useMemo(
    () =>
      filteredRows.filter((row) =>
        /pending|missing|expired|returned|rejected|exception|overdue/i.test(
          String(row["status"] ?? row["warnings"] ?? ""),
        ),
      ).length,
    [filteredRows],
  );

  // Group reports by category
  const categories = useMemo(() => {
    const cats: Record<string, typeof availableReports> = {};
    availableReports.forEach((r) => {
      const bucket = cats[r.category] ?? (cats[r.category] = []);
      bucket.push(r);
    });
    return cats;
  }, [availableReports]);

  const selectReport = async (id: string) => {
    setFilterQuery("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
    setDepartmentFilter("all");
    await loadReport(id);
  };

  const clearFilters = async () => {
    if (!activeReportId) return;
    setFilterQuery("");
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
    setDepartmentFilter("all");
    await loadReport(activeReportId);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-semibold">Reports Centre</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View, filter, and export operational metrics across the system. Data is automatically
          scoped to your role.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[250px_1fr]">
        {/* Sidebar Nav */}
        <div className="space-y-6">
          {Object.entries(categories).map(([category, reports]) => (
            <div key={category}>
              <h3 className="font-medium text-sm text-muted-foreground mb-2 px-2 uppercase tracking-wider">
                {category}
              </h3>
              <div className="space-y-1">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectReport(r.id)}
                    disabled={isLoading}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center justify-between group transition-colors ${
                      activeReportId === r.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-foreground"
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
          {loadError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Report unavailable</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}
          {reportData ? (
            <Card className="border-t-4 border-t-primary shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-muted-foreground" />
                      {reportData.name}
                    </CardTitle>
                    <CardDescription className="mt-1.5 text-sm">
                      {reportData.description}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)}>
                      <Bookmark className="w-4 h-4 mr-2" /> Save View
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.print()}>
                      <Printer className="w-4 h-4 mr-2" /> Print
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleExport}
                      disabled={isExporting || isLoading}
                    >
                      {isExporting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Export CSV
                    </Button>
                  </div>
                </div>

                {savedViews.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Saved views:</span>
                    {savedViews.map((view) => (
                      <div key={view.id} className="inline-flex rounded-md border bg-background">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-r-none"
                          onClick={() => applySavedView(view)}
                        >
                          {view.name}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-l-none text-muted-foreground hover:text-destructive"
                          aria-label={`Remove saved view ${view.name}`}
                          onClick={() => deleteView(view)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Matching Records
                    </p>
                    <p className="mt-1 text-2xl font-semibold">{filteredRows.length}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Recorded Statuses
                    </p>
                    <p className="mt-1 text-2xl font-semibold">{statuses.length}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Needs Attention
                    </p>
                    <p className="mt-1 text-2xl font-semibold">{attentionCount}</p>
                  </div>
                </div>
                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <div className="relative w-full">
                    <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Filter results..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  <Input
                    type="date"
                    aria-label="From date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                  />
                  <Input
                    type="date"
                    aria-label="To date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                  />
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger aria-label="Department filter">
                      <SelectValue placeholder="All departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {departments.map((department) => (
                        <SelectItem key={department} value={department}>
                          {department}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger aria-label="Status filter">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {statuses.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mb-4 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={clearFilters} disabled={isLoading}>
                    Clear filters
                  </Button>
                  <Button
                    onClick={() => activeReportId && loadReport(activeReportId, currentFilters())}
                    disabled={isLoading || !activeReportId}
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Apply filters
                  </Button>
                </div>

                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        {reportData.columns.map((col) => (
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
                            {reportData.columns.map((col) => {
                              let val = row[col.key];
                              if (col.type === "currency" && typeof val === "number") {
                                val = `${val.toLocaleString()} ${currency}`;
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
                          <TableCell
                            colSpan={reportData.columns.length}
                            className="h-24 text-center text-muted-foreground"
                          >
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
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this report view</DialogTitle>
            <DialogDescription>
              Save the current search, date, department and status filters for your own use.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            placeholder="For example: Monthly exceptions"
            maxLength={60}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCurrentView} disabled={viewName.trim().length < 2}>
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
