import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Banknote,
  CalendarCheck2,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { OvertimeService } from "@/lib/data/overtime-service";
import type {
  PayrollOvertimeLedgerRow,
  PayrollOvertimeLedgerView,
} from "@/lib/data/overtime-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/staff/payroll/overtime")({
  component: PayrollOvertimeRoute,
});

const PAGE_SIZE = 10;

function PayrollOvertimeRoute() {
  return (
    <RequirePermission permission="payroll:view" resourceName="Overtime Payroll Ledger">
      <OvertimeLedgerContent />
    </RequirePermission>
  );
}

function OvertimeLedgerContent() {
  const currentUser = useCurrentUser();
  const overtimeService = useMemo(() => new OvertimeService(), []);
  const actorContext = currentUser.getActorContext();
  const [ledger, setLedger] = useState<PayrollOvertimeLedgerRow[]>([]);
  const [view, setView] = useState<PayrollOvertimeLedgerView>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [payrollPeriodId, setPayrollPeriodId] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<PayrollOvertimeLedgerRow | null>(null);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => setPage(1), [view, search, dateFrom, dateTo, payrollPeriodId]);

  const payrollPeriods = useMemo(
    () =>
      [
        ...new Map(
          ledger
            .filter((row) => row.payrollPeriodId && row.payrollPeriodName)
            .map((row) => [row.payrollPeriodId!, row.payrollPeriodName!]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [ledger],
  );

  const counts = useMemo(
    () => ({
      ready: ledger.filter((row) => row.state === "Ready for Payroll").length,
      included: ledger.filter((row) => row.state === "Included in Payroll").length,
      timeOff: ledger.filter((row) => row.compensationType === "TOIL").length,
      exceptions: ledger.filter(
        (row) => row.state === "Review Needed" || row.crossCheckWarnings.length > 0,
      ).length,
    }),
    [ledger],
  );

  const totals = useMemo(
    () => ({
      readyHours: ledger
        .filter((row) => row.state === "Ready for Payroll")
        .reduce((total, row) => total + row.hours, 0),
      includedHours: ledger
        .filter((row) => row.state === "Included in Payroll")
        .reduce((total, row) => total + row.hours, 0),
      timeOffHours: ledger
        .filter((row) => row.compensationType === "TOIL")
        .reduce((total, row) => total + row.hours, 0),
    }),
    [ledger],
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ledger.filter((row) => {
      if (dateFrom && row.date < dateFrom) return false;
      if (dateTo && row.date > dateTo) return false;
      if (payrollPeriodId === "unassigned" && row.payrollPeriodId) return false;
      if (
        payrollPeriodId !== "all" &&
        payrollPeriodId !== "unassigned" &&
        row.payrollPeriodId !== payrollPeriodId
      ) {
        return false;
      }
      if (view === "ready" && row.state !== "Ready for Payroll") return false;
      if (view === "included" && row.state !== "Included in Payroll") return false;
      if (view === "time-off" && row.compensationType !== "TOIL") return false;
      if (
        view === "exceptions" &&
        row.state !== "Review Needed" &&
        row.crossCheckWarnings.length === 0
      ) {
        return false;
      }
      if (!query) return true;
      return [
        row.employeeName,
        row.employeeNumber,
        row.projectName,
        row.costCentreName,
        row.activityName,
        row.locationName,
        row.reason,
        row.payrollPeriodName,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [dateFrom, dateTo, ledger, payrollPeriodId, search, view]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const refresh = async (showSuccess = true) => {
    setIsRefreshing(true);
    try {
      setLedger(await overtimeService.getPayrollOvertimeLedgerAsync(actorContext));
      if (showSuccess) toast.success("Overtime ledger refreshed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The overtime ledger could not be refreshed.",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh(false);
    // The active actor changes by remount through the staff preview context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = async () => {
    setIsExporting(true);
    try {
      const csv = await overtimeService.exportPayrollOvertimeLedgerCsvAsync(actorContext, {
        ...(search.trim() ? { search: search.trim() } : {}),
        view,
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(payrollPeriodId !== "all" ? { payrollPeriodId } : {}),
      });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `via-overtime-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `${filteredRows.length} overtime record${filteredRows.length === 1 ? "" : "s"} exported.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The overtime ledger could not be exported.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const openEvidence = async (claimId: string) => {
    setOpeningEvidenceId(claimId);
    try {
      const { blob, fileName } = await overtimeService.getEvidenceBlob(claimId, actorContext);
      const url = URL.createObjectURL(blob);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The supporting document could not be opened.",
      );
    } finally {
      setOpeningEvidenceId(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6 pb-10">
      <PageHeader
        title="Overtime Payroll Ledger"
        description="Review approved paid overtime, see what has entered each payroll period, and reconcile time taken in lieu separately."
        breadcrumbs={[{ label: "Finance" }, { label: "Overtime Ledger" }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={exportCsv} disabled={isExporting || filteredRows.length === 0}>
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export CSV
            </Button>
          </div>
        }
      />

      <Alert className="border-blue-200 bg-blue-50/70 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Payroll hours only</AlertTitle>
        <AlertDescription>
          Only approved claims marked for payment enter payroll. Time off in lieu is shown for
          reconciliation and never counted as payable overtime.
        </AlertDescription>
      </Alert>

      <section
        aria-label="Overtime ledger summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryCard
          label="Ready for payroll"
          value={`${formatHours(totals.readyHours)}h`}
          detail={`${counts.ready} approved claim${counts.ready === 1 ? "" : "s"}`}
          icon={Banknote}
          tone="blue"
        />
        <SummaryCard
          label="Already included"
          value={`${formatHours(totals.includedHours)}h`}
          detail={`${counts.included} processed claim${counts.included === 1 ? "" : "s"}`}
          icon={CalendarCheck2}
          tone="green"
        />
        <SummaryCard
          label="Time off in lieu"
          value={`${formatHours(totals.timeOffHours)}h`}
          detail={`${counts.timeOff} non-payable claim${counts.timeOff === 1 ? "" : "s"}`}
          icon={Clock3}
          tone="violet"
        />
        <SummaryCard
          label="Needs attention"
          value={String(counts.exceptions)}
          detail="Cross-checks and legacy assignments"
          icon={TriangleAlert}
          tone={counts.exceptions > 0 ? "amber" : "slate"}
        />
      </section>

      <Card>
        <CardContent className="space-y-5 p-4 sm:p-5">
          <Tabs value={view} onValueChange={(value) => setView(value as PayrollOvertimeLedgerView)}>
            <TabsList className="h-auto w-full justify-start overflow-x-auto bg-muted/60 p-1">
              <TabsTrigger value="all">All ({ledger.length})</TabsTrigger>
              <TabsTrigger value="ready">Ready ({counts.ready})</TabsTrigger>
              <TabsTrigger value="included">Included ({counts.included})</TabsTrigger>
              <TabsTrigger value="time-off">Time Off ({counts.timeOff})</TabsTrigger>
              <TabsTrigger value="exceptions">Needs Attention ({counts.exceptions})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_170px_170px_190px_auto]">
            <label className="relative block self-end">
              <span className="sr-only">Search overtime ledger</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee, project or cost centre"
                className="pl-9"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">From</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">To</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Payroll period</span>
              <Select value={payrollPeriodId} onValueChange={setPayrollPeriodId}>
                <SelectTrigger aria-label="Filter by payroll period">
                  <SelectValue placeholder="All periods" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All periods</SelectItem>
                  <SelectItem value="unassigned">Not yet included</SelectItem>
                  {payrollPeriods.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button
              variant="ghost"
              className="self-end"
              disabled={!search && !dateFrom && !dateTo && payrollPeriodId === "all"}
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setPayrollPeriodId("all");
              }}
            >
              Clear filters
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Compensation</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Allocation</TableHead>
                    <TableHead>Payroll status</TableHead>
                    <TableHead className="text-right">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.claimId}>
                      <TableCell>
                        <div className="min-w-40">
                          <p className="font-medium text-foreground">{row.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{row.employeeNumber}</p>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={row.compensationType === "Payment" ? "default" : "secondary"}
                        >
                          {row.compensationType === "Payment" ? "Payment" : "Time off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatHours(row.hours)}h
                      </TableCell>
                      <TableCell>
                        <p className="max-w-56 truncate text-sm" title={row.reason}>
                          {row.reason}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-52 space-y-0.5 text-sm">
                          <p className="font-medium">{row.projectName}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.costCentreName} · {row.activityName} · {row.locationName}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <LedgerStateBadge row={row} />
                        {row.payrollPeriodName && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.payrollPeriodName} · {row.payrollPeriodStatus}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {row.hasEvidence && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Open evidence for ${row.employeeName}`}
                              onClick={() => void openEvidence(row.claimId)}
                              disabled={openingEvidenceId === row.claimId}
                            >
                              {openingEvidenceId === row.claimId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Paperclip className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => setSelectedRow(row)}>
                            <Eye className="mr-1.5 h-4 w-4" /> Details
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-44 text-center">
                        <FileCheck2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                        <p className="font-medium">No overtime records match this view</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Try another tab or clear the search and date filters.
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {filteredRows.length > 0 && (
            <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </Button>
                <span className="min-w-20 text-center text-xs">
                  Page {safePage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedRow)} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Overtime Record</DialogTitle>
            <DialogDescription>
              Approval, allocation and payroll information for this overtime claim.
            </DialogDescription>
          </DialogHeader>
          {selectedRow && (
            <div className="space-y-5 text-sm">
              <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2">
                <Detail
                  label="Employee"
                  value={`${selectedRow.employeeName} · ${selectedRow.employeeNumber}`}
                />
                <Detail label="Overtime date" value={formatDate(selectedRow.date)} />
                <Detail label="Hours" value={`${formatHours(selectedRow.hours)} hours`} />
                <Detail
                  label="Compensation"
                  value={
                    selectedRow.compensationType === "Payment" ? "Payment" : "Time off in lieu"
                  }
                />
                <Detail label="Approved" value={formatDateTime(selectedRow.approvedAt)} />
                <Detail
                  label="Payroll status"
                  value={
                    selectedRow.payrollPeriodName
                      ? `${selectedRow.state} · ${selectedRow.payrollPeriodName}`
                      : selectedRow.state
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Project" value={selectedRow.projectName} />
                <Detail label="Cost centre" value={selectedRow.costCentreName} />
                <Detail label="Activity" value={selectedRow.activityName} />
                <Detail label="Work location" value={selectedRow.locationName} />
              </div>
              <Detail label="Employee explanation" value={selectedRow.reason} />
              {selectedRow.managerNotes && (
                <Detail label="Supervisor notes" value={selectedRow.managerNotes} />
              )}
              {selectedRow.hrNotes && <Detail label="HR notes" value={selectedRow.hrNotes} />}
              {selectedRow.crossCheckWarnings.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium">Cross-checks requiring attention</p>
                  {selectedRow.crossCheckWarnings.map((warning) => (
                    <Alert key={warning} className="border-amber-200 bg-amber-50/70 text-amber-950">
                      <TriangleAlert className="h-4 w-4" />
                      <AlertDescription>{warning}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
              {selectedRow.hasEvidence && (
                <Button
                  variant="outline"
                  onClick={() => void openEvidence(selectedRow.claimId)}
                  disabled={openingEvidenceId === selectedRow.claimId}
                >
                  {openingEvidenceId === selectedRow.claimId ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="mr-2 h-4 w-4" />
                  )}
                  Open supporting document
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Banknote;
  tone: "blue" | "green" | "violet" | "amber" | "slate";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
  };
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function LedgerStateBadge({ row }: { row: PayrollOvertimeLedgerRow }) {
  if (row.state === "Review Needed") return <Badge variant="destructive">Review needed</Badge>;
  if (row.state === "Ready for Payroll") return <Badge>Ready for payroll</Badge>;
  if (row.state === "Included in Payroll") {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Included</Badge>;
  }
  if (row.state === "Time Off Pending") {
    return (
      <Badge variant="outline" className="border-amber-300 text-amber-700">
        Time off pending
      </Badge>
    );
  }
  return <Badge variant="secondary">Time off credited</Badge>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 leading-6 text-foreground">{value}</p>
    </div>
  );
}

function formatHours(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDate(value: string): string {
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

function formatDateTime(value: string): string {
  try {
    return format(parseISO(value), "dd MMM yyyy, HH:mm");
  } catch {
    return value;
  }
}
