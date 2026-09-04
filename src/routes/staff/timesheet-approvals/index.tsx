import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequireAnyPermission, useCurrentUser } from "@/lib/auth";
import { isBefore, parseISO, addDays } from "date-fns";

export const Route = createFileRoute("/staff/timesheet-approvals/")({
  component: TimesheetApprovalsRoute,
});

function TimesheetApprovalsRoute() {
  return (
    <RequireAnyPermission
      permissions={["timesheet:approve_direct_reports", "timesheet:finance_view"]}
      resourceName="Timesheet Approvals"
    >
      <TimesheetApprovalsContent />
    </RequireAnyPermission>
  );
}

function TimesheetApprovalsContent() {
  const currentUser = useCurrentUser();
  const tsService = useMemo(() => new TimesheetService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const periods = tsService.getPeriods();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    tsService.getCurrentPeriod()?.id || "",
  );
  const [filter, setFilter] = useState<string>("All"); // Missing, Late, Submitted, Returned, Approved

  if (!currentUser?.employeeId) {
    return <div>Employee profile required.</div>;
  }

  const allEmployees = empService.getEmployees(currentUser.getActorContext());
  const isHrReviewer = currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const isFinanceViewer = currentUser.activeRole === "Accounts";
  const visibleEmployees = allEmployees.filter(
    (employee) =>
      employee.status !== "Inactive" &&
      employee.status !== "Archived" &&
      (isHrReviewer || isFinanceViewer || employee.lineManagerId === currentUser.employeeId),
  );

  const settings = tsService.getSettings();
  const timesheets = tsService.getTimesheetsForContext(currentUser.getActorContext());
  const currentPeriodTimesheets = timesheets.filter((t) => t.periodId === selectedPeriodId);
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let isPastDeadline = false;
  if (selectedPeriod) {
    const deadline = addDays(parseISO(selectedPeriod.endDate), settings.submissionDeadlineDays);
    isPastDeadline = isBefore(deadline, today);
  }

  const listData = visibleEmployees.map((emp) => {
    const ts = currentPeriodTimesheets.find((t) => t.employeeId === emp.id);
    const status = ts?.status || "Missing";
    const isLate =
      isPastDeadline && (status === "Missing" || status === "Draft" || status === "Returned");

    return {
      emp,
      ts,
      status,
      isLate,
      totalHours: ts?.totalHours || 0,
      expectedHours: ts?.expectedHours || 0,
    };
  });

  const filteredData = listData.filter((item) => {
    if (filter === "All") return true;
    if (filter === "Missing" && item.status === "Missing") return true;
    if (filter === "Late" && item.isLate) return true;
    if (
      filter === "Submitted" &&
      (item.status === "Pending Manager" || item.status === "Pending HR")
    )
      return true;
    if (filter === "Returned" && item.status === "Returned") return true;
    if (
      filter === "Approved" &&
      (item.status === "Approved" ||
        item.status === "Payroll Locked" ||
        item.status === "Corrected")
    )
      return true;
    return false;
  });

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
      <PageHeader
        title={isFinanceViewer ? "Timesheet Register" : "Timesheet Approvals"}
        description={
          isFinanceViewer
            ? "View submitted and approved timesheets for payroll preparation."
            : isHrReviewer
              ? "Review only supervisor-approved timesheets with attendance or hours exceptions."
              : "Review timesheets submitted by employees who report directly to you."
        }
      />

      <div className="flex gap-4 mb-2 items-center">
        <div className="w-[300px]">
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
        <div className="w-[200px]">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All timesheets</SelectItem>
              <SelectItem value="Submitted">Awaiting approval</SelectItem>
              <SelectItem value="Late">Late</SelectItem>
              <SelectItem value="Missing">Missing</SelectItem>
              <SelectItem value="Returned">Returned</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hours Logged</TableHead>
                <TableHead>Compliance</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((row) => (
                <TableRow key={row.emp.id}>
                  <TableCell className="font-medium">{row.emp.preferredName}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === "Approved" ||
                        row.status === "Payroll Locked" ||
                        row.status === "Corrected"
                          ? "default"
                          : row.status === "Pending Manager" || row.status === "Pending HR"
                            ? "secondary"
                            : row.status === "Returned"
                              ? "destructive"
                              : "outline"
                      }
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        row.totalHours < row.expectedHours ? "text-destructive font-medium" : ""
                      }
                    >
                      {row.totalHours} / {row.expectedHours > 0 ? row.expectedHours : "?"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.isLate ? (
                      <Badge variant="destructive">LATE</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">OK</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.ts ? (
                      <Link
                        to="/staff/timesheet-approvals/$timesheetId"
                        params={{ timesheetId: row.ts.id }}
                      >
                        <Button
                          variant={
                            (!isHrReviewer &&
                              !isFinanceViewer &&
                              row.status === "Pending Manager") ||
                            (isHrReviewer && row.status === "Pending HR")
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                        >
                          {(!isHrReviewer &&
                            !isFinanceViewer &&
                            row.status === "Pending Manager") ||
                          (isHrReviewer && row.status === "Pending HR")
                            ? "Review"
                            : "View"}
                        </Button>
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">No timesheet</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filteredData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No timesheets match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
