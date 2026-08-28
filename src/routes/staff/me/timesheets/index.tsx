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

  const periods = tsService.getPeriods();
  const settings = tsService.getSettings();
  const existingTimesheets = tsService.getTimesheetsForEmployee(
    currentUser.employeeId,
    currentUser.getActorContext(),
  );
  const timesheetByPeriodId = new Map(existingTimesheets.map((ts) => [ts.periodId, ts]));

  return (
    <RequirePermission permission="timesheet:view_self" resourceName="My Timesheets">
      <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
        <PageHeader
          title="My Timesheets"
          description="Log your weekly hours, projects, and activities."
        />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Logged Hours</TableHead>
                  <TableHead>Expected</TableHead>
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

                  const diff = ts.totalHours - ts.expectedHours;
                  const isUnder = ts.totalHours < ts.expectedHours && ts.status === "Draft";

                  return (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium">
                        {period.startDate} to {period.endDate}
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
                          {ts.totalHours}
                        </span>
                        {diff > 0 && (
                          <span className="text-xs text-muted-foreground ml-1">(+{diff} OT)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{ts.expectedHours}</TableCell>
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
                              ? "Start Timesheet"
                              : ts.status === "Draft" || ts.status === "Returned"
                                ? "Edit Timesheet"
                                : "View Details"}
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {periods.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
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
