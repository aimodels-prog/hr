import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
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
import { TimesheetService } from "@/lib/data/timesheet-service";
import { isConfiguredTimesheetPeriod, timesheetPeriodLabel } from "@/lib/data/timesheet-periods";
import { RequirePermission, useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/staff/me/timesheets/")({
  component: TimesheetListRoute,
});

function TimesheetListRoute() {
  const currentUser = useCurrentUser();
  const tsService = useMemo(() => new TimesheetService(), []);

  if (!currentUser?.employeeId) {
    return <div>Employee profile required.</div>;
  }

  const settings = tsService.getSettings();
  const existingTimesheets = tsService.getTimesheetsForEmployee(
    currentUser.employeeId,
    currentUser.getActorContext(),
  );
  const timesheetByPeriodId = new Map(existingTimesheets.map((ts) => [ts.periodId, ts]));
  const periods = tsService
    .getPeriods()
    .filter(
      (period) =>
        timesheetByPeriodId.has(period.id) ||
        isConfiguredTimesheetPeriod(
          period,
          settings.periodFrequency,
          settings.weeklyPeriodStartDay,
        ),
    );

  return (
    <RequirePermission permission="timesheet:view_self" resourceName="My Timesheets">
      <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
        <PageHeader
          title="My Timesheets"
          description="Review each day's work and leave. Submit once per month."
        />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Worked</TableHead>
                  <TableHead>Paid leave</TableHead>
                  <TableHead>Credited total</TableHead>
                  <TableHead>Required work</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  // Read-only: an existing timesheet is shown as-is; a period the employee has
                  // never opened gets a computed preview only - opening $periodId is what
                  // actually creates the record, not viewing this list.
                  const existing = timesheetByPeriodId.get(period.id);
                  const ts =
                    existing ?? tsService.previewTimesheetSummary(currentUser.employeeId!, period);
                  if (!ts) return null;
                  const summary = tsService.getPeriodSummary(
                    currentUser.employeeId!,
                    period,
                    existing,
                  );
                  const isUnder =
                    summary.workedHours < summary.requiredWorkHours &&
                    ["Draft", "Not Started", "Returned"].includes(ts.status);

                  return (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium">
                        {timesheetPeriodLabel(period)}
                        {period.status === "Closed" && (
                          <Badge variant="outline" className="ml-2">
                            Closed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            ts.status === "Approved" || ts.status === "Payroll Locked"
                              ? "default"
                              : ts.status === "Returned"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {ts.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={isUnder ? "text-destructive font-medium" : ""}>
                          {summary.workedHours} h
                        </span>
                      </TableCell>
                      <TableCell>
                        {summary.paidLeaveHours} h
                        {summary.unpaidLeaveHours > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {summary.unpaidLeaveHours} h unpaid (0 credit)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{summary.creditedHours} h</TableCell>
                      <TableCell className="text-muted-foreground">
                        {summary.requiredWorkHours} h
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to="/staff/me/timesheets/$periodId" params={{ periodId: period.id }}>
                          <Button
                            variant={
                              ts.status === "Draft" ||
                              ts.status === "Returned" ||
                              ts.status === "Not Started"
                                ? "default"
                                : "outline"
                            }
                            size="sm"
                          >
                            {ts.status === "Not Started"
                              ? "Open Calendar"
                              : ts.status === "Draft" || ts.status === "Returned"
                                ? "Open Calendar"
                                : "View Calendar"}
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {periods.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No timesheet periods have been generated by HR yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
