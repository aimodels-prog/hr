import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { useCurrentUser } from "@/lib/auth";

export function TimesheetsTab({ employeeId }: { employeeId: string }) {
  const timesheetService = useMemo(() => new TimesheetService(), []);
  const currentUser = useCurrentUser();
  const destination =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin"
      ? "/staff/timesheet-monitoring"
      : currentUser.activeRole === "Line Manager"
        ? "/staff/timesheet-approvals"
        : "/staff/me/timesheets";
  const destinationLabel =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin"
      ? "Open Timesheet Monitoring"
      : currentUser.activeRole === "Line Manager"
        ? "Open Timesheet Approvals"
        : "Open My Timesheets";

  const timesheets = useMemo(
    () =>
      timesheetService
        .getTimesheetsForEmployee(employeeId)
        .sort((a, b) => b.periodId.localeCompare(a.periodId)),
    [timesheetService, employeeId],
  );
  const periods = useMemo(() => timesheetService.getPeriods(), [timesheetService]);

  const returned = timesheets.filter((t) => t.status === "Returned").length;
  const pending = timesheets.filter(
    (t) => t.status === "Pending Manager" || t.status === "Pending HR",
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Periods Logged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{timesheets.length}</div>
          </CardContent>
        </Card>
        <Card className={pending > 0 ? "border-amber-200 bg-amber-50/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Awaiting Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pending}</div>
          </CardContent>
        </Card>
        <Card className={returned > 0 ? "border-rose-200 bg-rose-50/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Returned / Needs Fixing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{returned}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Timesheet History</CardTitle>
          <Link to={destination} className="text-sm text-primary hover:underline">
            {destinationLabel}
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Expected Hours</TableHead>
                <TableHead>Total Hours</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No timesheets on record.
                  </TableCell>
                </TableRow>
              ) : (
                timesheets.map((t) => {
                  const period = periods.find((p) => p.id === t.periodId);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm">
                        {period ? `${period.startDate} to ${period.endDate}` : t.periodId}
                      </TableCell>
                      <TableCell className="text-sm">{t.expectedHours}h</TableCell>
                      <TableCell className="text-sm">{t.totalHours}h</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            t.status === "Approved" || t.status === "Payroll Locked"
                              ? "default"
                              : t.status === "Returned"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.submittedAt ? new Date(t.submittedAt).toLocaleDateString() : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
