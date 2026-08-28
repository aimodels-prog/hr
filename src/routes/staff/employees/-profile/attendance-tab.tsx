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
import { AttendanceService } from "@/lib/data/attendance-service";
import { OvertimeService } from "@/lib/data/overtime-service";
import { useCurrentUser } from "@/lib/auth";

export function AttendanceTab({ employeeId }: { employeeId: string }) {
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const overtimeService = useMemo(() => new OvertimeService(), []);
  const currentUser = useCurrentUser();
  const destination =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin"
      ? "/staff/attendance"
      : currentUser.activeRole === "Line Manager"
        ? "/staff/attendance/corrections"
        : "/staff/me/attendance";
  const destinationLabel =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin"
      ? "Open Attendance Admin"
      : currentUser.activeRole === "Line Manager"
        ? "Open Attendance Corrections"
        : "Open My Attendance";

  const records = useMemo(
    () =>
      attendanceService
        .getRecordsForEmployee(employeeId, currentUser.getActorContext())
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 30),
    [attendanceService, currentUser, employeeId],
  );
  const corrections = useMemo(
    () =>
      attendanceService
        .getCorrectionsForEmployee(employeeId, currentUser.getActorContext())
        .filter(
          (c) =>
            records.some((r) => r.id === c.attendanceRecordId) &&
            c.status !== "Approved" &&
            c.status !== "Rejected",
        ),
    [attendanceService, currentUser, employeeId, records],
  );
  const overtimeClaims = useMemo(
    () =>
      overtimeService
        .getClaimsForEmployee(employeeId, currentUser.getActorContext())
        .sort((a, b) => b.date.localeCompare(a.date)),
    [overtimeService, employeeId, currentUser],
  );

  const lateCount = records.filter((r) => r.isLate).length;
  const pendingOvertime = overtimeClaims.filter(
    (c) => c.status === "Pending Manager" || c.status === "Pending HR",
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Late Arrivals (last 30 records)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lateCount}</div>
          </CardContent>
        </Card>
        <Card className={corrections.length > 0 ? "border-amber-200 bg-amber-50/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Corrections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{corrections.length}</div>
          </CardContent>
        </Card>
        <Card className={pendingOvertime > 0 ? "border-blue-200 bg-blue-50/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Overtime Claims
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingOvertime}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Recent Attendance</CardTitle>
          <Link to={destination} className="text-sm text-primary hover:underline">
            {destinationLabel}
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Clock In</TableHead>
                <TableHead>Clock Out</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No attendance records on file.
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{r.date}</TableCell>
                    <TableCell className="text-sm">
                      {r.clockIn || "-"}{" "}
                      {r.isLate && <span className="text-amber-600 text-xs ml-1">Late</span>}
                    </TableCell>
                    <TableCell className="text-sm">{r.clockOut || "-"}</TableCell>
                    <TableCell className="text-sm">{r.calculatedHours}h</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "Present"
                            ? "default"
                            : r.status === "Absent" || r.status === "Missing Punch"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
