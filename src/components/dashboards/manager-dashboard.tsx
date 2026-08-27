import { useMemo } from "react";
import {
  CalendarCheck,
  Clock,
  AlertTriangle,
  ClipboardCheck,
  UserCog,
  TimerReset,
} from "lucide-react";
import { EmployeeService } from "@/lib/data/employee-service";
import { LeaveService } from "@/lib/data/leave-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { PerformanceService } from "@/lib/data/performance-service";
import { AttendanceService } from "@/lib/data/attendance-service";
import { OvertimeService } from "@/lib/data/overtime-service";
import type { Employee } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import {
  isCurrentWorkforceMember,
  isDateRangeActiveOn,
} from "@/components/dashboards/dashboard-data";
import {
  AttentionQueue,
  PulseStrip,
  DashboardPanel,
  type AttentionItem,
  type PulseMetric,
} from "@/components/dashboards/dashboard-kit";

const LONG_WAIT_DAYS = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function displayName(emp: Employee | undefined): string {
  if (!emp) return "Unknown";
  return `${emp.preferredName} ${emp.legalName.split(" ").slice(-1)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function ManagerDashboard({ employee, userId }: { employee: Employee; userId: string }) {
  const currentUser = useCurrentUser();
  const empService = useMemo(() => new EmployeeService(), []);
  const leaveService = useMemo(() => new LeaveService(), []);
  const tsService = useMemo(() => new TimesheetService(), []);
  const obService = useMemo(() => new OnboardingService(), []);
  const perfService = useMemo(() => new PerformanceService(), []);
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const overtimeService = useMemo(() => new OvertimeService(), []);

  // Direct Reports
  const allEmployees = empService.getEmployees();
  const directReports = allEmployees.filter(
    (e) => e.lineManagerId === employee.id && isCurrentWorkforceMember(e),
  );
  const teamIds = new Set(directReports.map((e) => e.id));

  // Leave
  const allLeaveRequests = leaveService.getRequests();
  const pendingLeave = allLeaveRequests.filter(
    (r) => r.status === "Pending Line Manager" && teamIds.has(r.employeeId),
  );
  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const activeLeave = allLeaveRequests.filter(
    (r) =>
      r.status === "Approved" &&
      teamIds.has(r.employeeId) &&
      isDateRangeActiveOn(r.startDate, r.endDate, now),
  );
  const teamOutThisWeek = allLeaveRequests
    .filter((r) => teamIds.has(r.employeeId) && (r.status === "Approved" || r.status === "Taken"))
    .filter((r) => new Date(r.startDate) <= weekEnd && new Date(r.endDate) >= now)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  // Timesheets
  const allTeamTimesheets = tsService.getAllTimesheets().filter((t) => teamIds.has(t.employeeId));
  const pendingTimesheets = allTeamTimesheets.filter((t) => t.status === "Pending Manager");
  const returnedTimesheets = allTeamTimesheets.filter((t) => t.status === "Returned");
  const attendanceExceptions = attendanceService
    .getAllRecords()
    .filter(
      (record) =>
        teamIds.has(record.employeeId) &&
        ["Absent", "Late", "Missing Punch", "Correction Pending"].includes(record.status) &&
        new Date(record.date) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
  const pendingOvertime = overtimeService
    .getClaimsForDirectReports(currentUser.getActorContext())
    .filter((claim) => teamIds.has(claim.employeeId) && claim.status === "Pending Manager");

  // Onboarding/Offboarding tasks assigned to this manager
  const obTasks = obService
    .getCases()
    .flatMap((c) =>
      c.tasks
        .filter((t) => t.assignedUserId === userId && t.status === "Pending")
        .map((t) => ({ task: t, caseRecord: c })),
    );

  // Performance reviews awaiting this manager's input
  const pendingReviews = perfService
    .getReviews()
    .filter((r) => teamIds.has(r.employeeId) && r.status === "Manager Review Pending");

  // ---------- Attention Queue ----------

  const attentionItems: AttentionItem[] = [];

  for (const req of pendingLeave) {
    const emp = allEmployees.find((e) => e.id === req.employeeId);
    const waitDays = Math.floor((now.getTime() - new Date(req.createdAt).getTime()) / MS_PER_DAY);
    attentionItems.push({
      id: `leave-${req.id}`,
      severity: waitDays > LONG_WAIT_DAYS ? "critical" : "warning",
      icon: CalendarCheck,
      title: `${displayName(emp)}: ${req.policySnapshot.name}`,
      meta:
        waitDays > 0
          ? `Waiting ${waitDays} day${waitDays === 1 ? "" : "s"} · ${formatDate(req.startDate)} to ${formatDate(req.endDate)}`
          : `${formatDate(req.startDate)} to ${formatDate(req.endDate)}`,
      actionLabel: "Review",
      actionTo: "/staff/leave-approvals",
    });
  }

  if (returnedTimesheets.length > 0) {
    attentionItems.push({
      id: "timesheets-returned",
      severity: "critical",
      icon: AlertTriangle,
      title: "Returned team timesheets need resubmission",
      meta: `${returnedTimesheets.length} timesheet${returnedTimesheets.length === 1 ? "" : "s"} sent back`,
      actionLabel: "Review",
      actionTo: "/staff/timesheet-approvals",
    });
  }

  if (pendingTimesheets.length > 0) {
    attentionItems.push({
      id: "timesheets-pending",
      severity: "warning",
      icon: Clock,
      title: "Timesheets pending your approval",
      meta: `${pendingTimesheets.length} timesheet${pendingTimesheets.length === 1 ? "" : "s"} awaiting review`,
      actionLabel: "Review",
      actionTo: "/staff/timesheet-approvals",
    });
  }

  if (pendingReviews.length > 0) {
    attentionItems.push({
      id: "reviews-pending",
      severity: "warning",
      icon: ClipboardCheck,
      title: "Performance reviews awaiting your input",
      meta: `${pendingReviews.length} review${pendingReviews.length === 1 ? "" : "s"} pending`,
      actionLabel: "Review",
      actionTo: "/staff/my-tasks",
    });
  }

  if (obTasks.length > 0) {
    const overdueObTasks = obTasks.filter(({ task }) => new Date(task.dueDate) < now);
    attentionItems.push({
      id: "onboarding-tasks",
      severity: overdueObTasks.length > 0 ? "warning" : "info",
      icon: UserCog,
      title: "Onboarding / offboarding tasks assigned to you",
      meta:
        overdueObTasks.length > 0
          ? `${overdueObTasks.length} of ${obTasks.length} task${obTasks.length === 1 ? "" : "s"} overdue`
          : `${obTasks.length} task${obTasks.length === 1 ? "" : "s"} pending`,
      actionLabel: "View",
      actionTo: "/staff/my-tasks",
    });
  }

  if (pendingOvertime.length > 0) {
    attentionItems.push({
      id: "overtime-pending",
      severity: "warning",
      icon: TimerReset,
      title: `${pendingOvertime.length} overtime claim${pendingOvertime.length === 1 ? "" : "s"} awaiting review`,
      meta: "Validate hours, project and attendance evidence",
      actionLabel: "Review",
      actionTo: "/staff/overtime-approvals",
    });
  }

  // ---------- Pulse Strip ----------

  const pulseMetrics: PulseMetric[] = [
    { label: "Direct Reports", value: String(directReports.length) },
    { label: "On Leave Now", value: String(activeLeave.length) },
    { label: "Pending Leave", value: String(pendingLeave.length) },
    { label: "Pending Timesheets", value: String(pendingTimesheets.length) },
    { label: "Returned Timesheets", value: String(returnedTimesheets.length) },
    { label: "Pending Reviews", value: String(pendingReviews.length) },
    { label: "Attendance Alerts", value: String(attendanceExceptions.length) },
    { label: "Overtime Claims", value: String(pendingOvertime.length) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PulseStrip metrics={pulseMetrics} />
      <AttentionQueue items={attentionItems} />
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="Team Out This Week"
          description="Approved leave affecting immediate coverage"
          viewAllLabel="View Leave Calendar"
          viewAllTo="/staff/leave-approvals"
        >
          {teamOutThisWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No team members on approved leave right now.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {teamOutThisWeek.map((req) => {
                const emp = allEmployees.find((e) => e.id === req.employeeId);
                return (
                  <div
                    key={req.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{displayName(emp)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {req.policySnapshot.name}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(req.startDate)} to {formatDate(req.endDate)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardPanel>
        <DashboardPanel
          title="Direct Report Readiness"
          description="Current team workflow status"
          viewAllLabel="Open Team Performance"
          viewAllTo="/staff/performance/team"
        >
          {directReports.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              No direct reports are assigned to you.
            </p>
          ) : (
            <div className="divide-y">
              {directReports.slice(0, 6).map((report) => {
                const onLeave = activeLeave.some((request) => request.employeeId === report.id);
                const timesheet = allTeamTimesheets
                  .filter((item) => item.employeeId === report.id)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                const hasAttendanceAlert = attendanceExceptions.some(
                  (record) => record.employeeId === report.id,
                );
                return (
                  <div
                    key={report.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{displayName(report)}</p>
                      <p className="truncate text-xs text-muted-foreground">{report.position}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1 text-[10px]">
                      {onLeave && (
                        <span className="rounded-full bg-info/10 px-2 py-1 text-info">
                          On leave
                        </span>
                      )}
                      {hasAttendanceAlert && (
                        <span className="rounded-full bg-warning/10 px-2 py-1 text-warning">
                          Attendance
                        </span>
                      )}
                      <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
                        TS: {timesheet?.status || "Not started"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardPanel>
      </div>
    </div>
  );
}
