import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { isBefore, parseISO, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/timesheet-monitoring")({
  component: TimesheetMonitoringRoute,
});

function TimesheetMonitoringRoute() {
  return (
    <RequirePermission permission="timesheet:finance_view" resourceName="Timesheet Monitoring">
      <TimesheetMonitoringContent />
    </RequirePermission>
  );
}

function TimesheetMonitoringContent() {
  const currentUser = useCurrentUser();
  const tsService = useMemo(() => new TimesheetService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const periods = tsService.getPeriods();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    tsService.getCurrentPeriod()?.id || "",
  );

  const settings = tsService.getSettings();
  const allEmployees = empService
    .getDirectoryEmployees(currentUser.getActorContext())
    .filter((e) => e.status !== "Inactive" && e.status !== "Archived");

  const [, setRefreshKey] = useState(0);
  const canLockPayroll = currentUser.can("timesheet:admin_all");

  const handleLockPayroll = (timesheetId: string) => {
    try {
      tsService.lockPayroll(timesheetId, currentUser.getActorContext());
      toast.success("Timesheet locked for payroll");
      setRefreshKey((k) => k + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to lock timesheet");
    }
  };

  const timesheets = tsService.getTimesheetsForContext(currentUser.getActorContext());
  const currentPeriodTimesheets = timesheets.filter((t) => t.periodId === selectedPeriodId);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  // Compute statistics
  const expected = allEmployees.length;
  let draft = 0;
  let pendingManager = 0;
  let pendingHr = 0;
  let returned = 0;
  let approved = 0;
  let locked = 0;
  let late = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let isPastDeadline = false;
  if (selectedPeriod) {
    const deadline = addDays(parseISO(selectedPeriod.endDate), settings.submissionDeadlineDays);
    isPastDeadline = isBefore(deadline, today);
  }

  const timesheetStatusMap = new Map<string, (typeof timesheets)[0]>();
  currentPeriodTimesheets.forEach((t) => timesheetStatusMap.set(t.employeeId, t));

  const listData = allEmployees.map((emp) => {
    const ts = timesheetStatusMap.get(emp.id);
    const status = ts?.status || "Not Started";

    if (status === "Draft") draft++;
    if (status === "Pending Manager") pendingManager++;
    if (status === "Pending HR") pendingHr++;
    if (status === "Returned") returned++;
    if (status === "Approved") approved++;
    if (status === "Payroll Locked") locked++;

    const isLate =
      isPastDeadline && (status === "Not Started" || status === "Draft" || status === "Returned");
    if (isLate) late++;

    return {
      emp,
      ts,
      status,
      isLate,
      totalHours: ts?.totalHours || 0,
    };
  });

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <PageHeader
        title="Timesheet Monitoring"
        description={
          currentUser.activeRole === "Accounts"
            ? "Read-only timesheet status for payroll preparation."
            : "Track submissions, supervisor reviews, HR approvals, and payroll locking."
        }
      />

      <div className="w-[300px] mb-2">
        <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
          <SelectTrigger>
            <SelectValue placeholder="Select Period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.startDate} to {p.endDate} {p.status === "Closed" ? "(Closed)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedPeriodId && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{expected}</div>
                <div className="text-xs text-muted-foreground uppercase">Expected</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{draft}</div>
                <div className="text-xs text-muted-foreground uppercase">Draft</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{pendingManager}</div>
                <div className="text-xs text-muted-foreground uppercase">Supervisor review</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{pendingHr}</div>
                <div className="text-xs text-muted-foreground uppercase">HR approval</div>
              </CardContent>
            </Card>
            <Card className={late > 0 ? "border-destructive" : ""}>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-destructive">{late}</div>
                <div className="text-xs text-muted-foreground uppercase">Late</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-amber-600">{returned}</div>
                <div className="text-xs text-muted-foreground uppercase">Returned</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-emerald-600">{approved}</div>
                <div className="text-xs text-muted-foreground uppercase">Approved</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-slate-600">{locked}</div>
                <div className="text-xs text-muted-foreground uppercase">Locked</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Period Compliance Details</CardTitle>
              <CardDescription>
                Every timesheet follows its employee&apos;s assigned supervisor before HR approval.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Line Manager</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Logged Hours</TableHead>
                    <TableHead>Compliance</TableHead>
                    {canLockPayroll && <TableHead className="text-right">Action</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listData.map((row) => {
                    const manager = row.emp.lineManagerId
                      ? allEmployees.find((e) => e.id === row.emp.lineManagerId)
                      : null;

                    return (
                      <TableRow key={row.emp.id}>
                        <TableCell className="font-medium">{row.emp.preferredName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {manager ? `${manager.preferredName}` : "None"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.status === "Approved" || row.status === "Payroll Locked"
                                ? "default"
                                : row.status === "Not Started"
                                  ? "outline"
                                  : row.status === "Returned"
                                    ? "destructive"
                                    : "secondary"
                            }
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{row.totalHours > 0 ? row.totalHours : "-"}</TableCell>
                        <TableCell>
                          {row.isLate ? (
                            <Badge variant="destructive">LATE</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">OK</span>
                          )}
                        </TableCell>
                        {canLockPayroll && (
                          <TableCell className="text-right">
                            {row.status === "Approved" && row.ts && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleLockPayroll(row.ts!.id)}
                              >
                                <Lock className="w-3.5 h-3.5 mr-1" /> Lock for Payroll
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
