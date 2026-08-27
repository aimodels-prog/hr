import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequireAnyPermission, useCurrentUser } from "@/lib/auth";
import { parseISO, format, eachDayOfInterval } from "date-fns";
import { AlertTriangle, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import { AuditViewer } from "@/components/audit-viewer";

export const Route = createFileRoute("/staff/timesheet-approvals/$timesheetId")({
  component: TimesheetApprovalDetailWrapper,
});

function TimesheetApprovalDetailWrapper() {
  return (
    <RequireAnyPermission
      permissions={["timesheet:approve_direct_reports", "timesheet:finance_view"]}
      resourceName="Timesheet Approval Detail"
    >
      <TimesheetApprovalDetailRoute />
    </RequireAnyPermission>
  );
}

function TimesheetApprovalDetailRoute() {
  const { timesheetId } = Route.useParams();
  const router = useRouter();
  const currentUser = useCurrentUser();

  const tsService = useMemo(() => new TimesheetService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const [timesheet, setTimesheet] = useState(
    tsService
      .getTimesheetsForContext(currentUser.getActorContext())
      .find((t) => t.id === timesheetId),
  );

  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!timesheet) return <div>Timesheet not found.</div>;

  const emp = empService.getEmployees().find((e) => e.id === timesheet.employeeId);
  const period = tsService.getPeriods().find((p) => p.id === timesheet.periodId);

  const isAssignedSupervisor =
    currentUser.activeRole === "Line Manager" && emp?.lineManagerId === currentUser.employeeId;
  const isHrReviewer = currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const isFinanceViewer = currentUser.activeRole === "Accounts";
  if (!isAssignedSupervisor && !isHrReviewer && !isFinanceViewer) {
    return (
      <div className="p-8 text-destructive">
        You do not have access to this employee&apos;s timesheet.
      </div>
    );
  }

  const days = eachDayOfInterval({
    start: parseISO(period!.startDate),
    end: parseISO(period!.endDate),
  });

  const handleApprove = () => {
    try {
      const updated = tsService.approveTimesheet(timesheet.id, currentUser.getActorContext());
      setTimesheet(updated);
      toast.success(
        updated.status === "Pending HR"
          ? "Supervisor review completed. The timesheet is now with HR."
          : "Timesheet approved by HR.",
      );
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Timesheet could not be approved.");
    }
  };

  const handleReturn = () => {
    try {
      const updated = tsService.returnTimesheet(
        timesheet.id,
        reason,
        currentUser.getActorContext(),
      );
      setTimesheet(updated);
      setReturnDialogOpen(false);
      toast.success("Timesheet returned to employee.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Timesheet could not be returned.");
    }
  };

  const handleReopen = () => {
    try {
      const updated = tsService.reopenTimesheet(
        timesheet.id,
        reason,
        currentUser.getActorContext(),
      );
      setTimesheet(updated);
      setReopenDialogOpen(false);
      toast.success(
        updated.status === "Corrected"
          ? "A new draft is ready in the employee's current timesheet period."
          : "Timesheet unlocked and returned.",
      );
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Timesheet could not be reopened.");
    }
  };

  // Calculations
  const dailyTotals: Record<string, number> = {};
  days.forEach((d) => (dailyTotals[format(d, "yyyy-MM-dd")] = 0));

  timesheet.entries.forEach((e) => {
    Object.entries(e.hours).forEach(([d, h]) => {
      if (dailyTotals[d] !== undefined) {
        dailyTotals[d] += h || 0;
      }
    });
  });

  const diff = timesheet.totalHours - timesheet.expectedHours;
  const reconciliation = tsService.reconcileAttendance(timesheet);

  return (
    <div className="flex flex-col gap-4 max-w-[1400px] mx-auto pb-10">
      <PageHeader
        title={`${emp?.preferredName || "Unknown"}'s Timesheet`}
        description={`Period: ${period?.startDate} to ${period?.endDate}`}
        actions={
          <Badge
            variant={
              timesheet.status === "Approved" ||
              timesheet.status === "Payroll Locked" ||
              timesheet.status === "Corrected"
                ? "default"
                : timesheet.status === "Pending Manager" || timesheet.status === "Pending HR"
                  ? "secondary"
                  : timesheet.status === "Returned"
                    ? "destructive"
                    : "outline"
            }
            className="text-sm px-3 py-1"
          >
            {timesheet.status}
          </Badge>
        }
      />

      {timesheet.managerNotes && timesheet.status === "Returned" && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-destructive">Return Reason</CardTitle>
          </CardHeader>
          <CardContent className="text-sm pb-3">{timesheet.managerNotes}</CardContent>
        </Card>
      )}

      {timesheet.status === "Corrected" && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="text-sm py-4">
            This timesheet was locked for payroll and later reopened. The original remains marked as{" "}
            <strong>Corrected</strong>, and a new draft is available in the employee&apos;s current
            timesheet period.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Expected Hours</div>
            <div className="text-2xl font-bold">{timesheet.expectedHours}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Logged Hours</div>
            <div className="text-2xl font-bold">{timesheet.totalHours}</div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Hours Difference</div>
            <div
              className={`text-2xl font-bold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}
            >
              {diff > 0 ? `+${diff}` : diff}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">Attendance Hours</div>
            <div className="text-2xl font-bold">{reconciliation.attendanceHours}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {reconciliation.unresolvedCount === 0
                ? "Hours match"
                : `${reconciliation.unresolvedCount} difference(s) need review`}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={reconciliation.unresolvedCount > 0 ? "border-amber-500/60" : undefined}>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {reconciliation.unresolvedCount > 0 && (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            Attendance and Project Hours
          </CardTitle>
          <CardDescription>
            Physical attendance is compared daily with project hours. Approved leave and holidays
            are shown separately and do not count as worked project time.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Attendance status</TableHead>
                <TableHead className="text-right">Attendance</TableHead>
                <TableHead className="text-right">Timesheet</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="min-w-[260px]">Employee explanation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliation.days.map((day) => (
                <TableRow key={day.date} className={!day.resolved ? "bg-amber-50/60" : undefined}>
                  <TableCell className="font-medium">{day.date}</TableCell>
                  <TableCell>{day.attendanceStatus}</TableCell>
                  <TableCell className="text-right">{day.attendanceHours}</TableCell>
                  <TableCell className="text-right">{day.timesheetWorkHours}</TableCell>
                  <TableCell className="text-right">{day.varianceHours}</TableCell>
                  <TableCell>
                    <Badge variant={day.resolved ? "secondary" : "destructive"}>{day.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {day.explanation || (day.requiresExplanation ? "Explanation missing" : "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Time Entries</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1200px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[150px]">Project</TableHead>
                <TableHead className="w-[150px]">Cost Centre</TableHead>
                <TableHead className="w-[150px]">Activity</TableHead>
                <TableHead className="w-[150px]">Location</TableHead>
                {days.map((d) => (
                  <TableHead key={d.toISOString()} className="w-[80px] text-center px-1">
                    <div className="text-xs font-normal">{format(d, "EEE")}</div>
                    <div>{format(d, "dd")}</div>
                  </TableHead>
                ))}
                <TableHead className="w-[80px] text-center">Total</TableHead>
                <TableHead className="w-[200px]">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheet.entries.map((entry) => {
                const isReadonlyBlock = entry.isLeave || entry.isHoliday;
                return (
                  <TableRow key={entry.id} className={isReadonlyBlock ? "bg-muted/30" : ""}>
                    <TableCell className="p-2 font-medium">{entry.projectId}</TableCell>
                    <TableCell className="p-2 text-muted-foreground">
                      {entry.costCentreId}
                    </TableCell>
                    <TableCell className="p-2 text-muted-foreground">
                      {entry.activityCodeId}
                    </TableCell>
                    <TableCell className="p-2 text-muted-foreground">
                      {entry.locationCodeId}
                    </TableCell>

                    {days.map((d) => {
                      const dateStr = format(d, "yyyy-MM-dd");
                      const val = entry.hours[dateStr] || "";
                      return (
                        <TableCell key={dateStr} className="p-1 text-center">
                          <div className="text-sm">{val || "-"}</div>
                        </TableCell>
                      );
                    })}

                    <TableCell className="p-2 text-center font-bold">{entry.total}</TableCell>
                    <TableCell className="p-2 text-sm text-muted-foreground">
                      {entry.notes}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right font-bold">
                  Daily Totals:
                </TableCell>
                {days.map((d) => {
                  const dateStr = format(d, "yyyy-MM-dd");
                  const tot = dailyTotals[dateStr] || 0;
                  return (
                    <TableCell key={dateStr} className="text-center font-bold">
                      {tot}
                    </TableCell>
                  );
                })}
                <TableCell className="text-center font-bold text-lg">
                  {timesheet.totalHours}
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
        <CardFooter className="flex justify-end gap-2 bg-muted/20 py-4 border-t mt-4">
          {((isAssignedSupervisor && timesheet.status === "Pending Manager") ||
            (isHrReviewer && timesheet.status === "Pending HR")) && (
            <>
              <Button
                variant="destructive"
                onClick={() => {
                  setReason("");
                  setReturnDialogOpen(true);
                }}
              >
                <XCircle className="w-4 h-4 mr-2" /> Return to Employee
              </Button>
              <Button
                variant="default"
                onClick={handleApprove}
                disabled={reconciliation.unresolvedCount > 0}
                title={
                  reconciliation.unresolvedCount > 0
                    ? "Return the timesheet so the employee can explain attendance differences."
                    : undefined
                }
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                {timesheet.status === "Pending Manager" ? "Send to HR" : "Approve Timesheet"}
              </Button>
            </>
          )}

          {((isHrReviewer && timesheet.status === "Approved") ||
            ((isHrReviewer || isFinanceViewer) && timesheet.status === "Payroll Locked")) && (
              <Button
                variant="outline"
                onClick={() => {
                  setReason("");
                  setReopenDialogOpen(true);
                }}
              >
                <RotateCcw className="w-4 h-4 mr-2" /> Reopen / Correct
              </Button>
            )}
        </CardFooter>
      </Card>

      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Timesheet</DialogTitle>
            <DialogDescription>
              Provide a reason for returning this timesheet. The employee will need to correct and
              resubmit it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for return..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReturn}
              disabled={reason.trim().length < 3}
            >
              Return Timesheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenDialogOpen} onOpenChange={setReopenDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {timesheet.status === "Payroll Locked"
                ? "Correct Locked Timesheet"
                : "Reopen Timesheet"}
            </DialogTitle>
            <DialogDescription>
              {timesheet.status === "Payroll Locked"
                ? "This timesheet is locked for payroll. Reopening it will keep the original as Corrected and create a new draft for the employee to update."
                : "This timesheet is approved but not yet locked. Reopening will unlock it for the employee to edit."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for reopening..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[100px]"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleReopen} disabled={reason.trim().length < 3}>
              Confirm Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="mt-8 min-h-[400px]">
        <AuditViewer entityId={timesheet.id} entityType="timesheet" />
      </div>
    </div>
  );
}
