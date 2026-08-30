import { useMemo } from "react";
import { AlertTriangle, Briefcase, CheckCircle, FileText, Plane } from "lucide-react";
import { LeaveService } from "@/lib/data/leave-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { DocumentService } from "@/lib/data/document-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { PerformanceService } from "@/lib/data/performance-service";
import { TravelService } from "@/lib/data/travel-service";
import { AttendanceService } from "@/lib/data/attendance-service";
import { OvertimeService } from "@/lib/data/overtime-service";
import { TrainingService } from "@/lib/data/training-service";
import type { Employee } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import { sortByStartDate } from "@/components/dashboards/dashboard-data";
import {
  AttentionQueue,
  DashboardPanel,
  PulseStrip,
  type AttentionItem,
  type PulseMetric,
} from "@/components/dashboards/dashboard-kit";

export function EmployeeDashboard({ employee, userId }: { employee: Employee; userId: string }) {
  const currentUser = useCurrentUser();
  const actorContext = currentUser.getActorContext();
  const leaveService = useMemo(() => new LeaveService(), []);
  const tsService = useMemo(() => new TimesheetService(), []);
  const docService = useMemo(() => new DocumentService(), []);
  const obService = useMemo(() => new OnboardingService(), []);
  const perfService = useMemo(() => new PerformanceService(), []);
  const travelService = useMemo(() => new TravelService(), []);
  const attendanceService = useMemo(() => new AttendanceService(), []);
  const overtimeService = useMemo(() => new OvertimeService(), []);
  const trainingService = useMemo(() => new TrainingService(), []);

  // Leave
  const balances = leaveService.getAllBalancesForEmployee(employee.id, actorContext);
  const annualBalance =
    balances.find((b) =>
      leaveService
        .getPolicies()
        .find((p) => p.id === b.policyId)
        ?.name.includes("Annual"),
    )?.available || 0;
  const upcomingLeave = sortByStartDate(
    leaveService
      .getLeaveRequestsForEmployee(employee.id, actorContext)
      .filter((r) => r.status === "Approved" && new Date(r.startDate) > new Date()),
  );
  const leaveRequests = leaveService
    .getLeaveRequestsForEmployee(employee.id, actorContext)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingLeaveRequests = leaveRequests.filter((request) =>
    ["Pending Line Manager", "Pending HR", "Pending Super Admin"].includes(request.status),
  );

  // Timesheet
  const employeeTimesheets = tsService
    .getTimesheetsForEmployee(employee.id, actorContext)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const overdueTs = employeeTimesheets.filter((t) => t.status === "Returned");
  const latestTimesheet = employeeTimesheets[0] || null;
  const latestTimesheetPeriod = latestTimesheet
    ? tsService.getPeriods().find((period) => period.id === latestTimesheet.periodId)
    : null;

  // Documents (90-day window so both warning (31-90 days) and critical (<=30 days) tiers are reachable,
  // matching hr-dashboard.tsx's split instead of pre-filtering through the 30-day-only getExpiringDocuments())
  const today = new Date();
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);
  const expiringDocs = docService
    .getDocuments(actorContext)
    .filter(
      (d) =>
        d.employeeId === employee.id &&
        d.expiryDate &&
        d.status !== "Replaced" &&
        d.status !== "Rejected" &&
        !d.waiverReason &&
        new Date(d.expiryDate) <= in90,
    );

  // Tasks (Onboarding, Performance, Training)
  const obCase = obService
    .getCasesForContext(actorContext)
    .find((c) => c.employeeId === employee.id && c.progressPercentage < 100);
  const myObTasks =
    obCase?.tasks.filter((t) => t.assignedUserId === userId && t.status === "Pending") || [];

  const myReviews = perfService
    .getReviewsForEmployee(employee.id, actorContext)
    .filter((r) => r.status === "Self Assessment Pending");

  // Travel
  const myTravel = travelService
    .getRequestsForEmployee(employee.id, actorContext)
    .filter((r) => r.status !== "Closed" && r.status !== "Rejected" && r.status !== "Draft");
  const attendanceExceptions = attendanceService
    .getRecordsForEmployee(employee.id, actorContext)
    .filter(
      (record) =>
        ["Absent", "Late", "Missing Punch", "Correction Pending"].includes(record.status) &&
        new Date(record.date) >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
  const overtimeClaims = overtimeService.getClaimsForEmployee(employee.id, actorContext);
  const pendingOvertime = overtimeClaims.filter((claim) =>
    ["Pending Manager", "Pending HR"].includes(claim.status),
  );
  const approvedOvertimeHours = overtimeClaims
    .filter((claim) => claim.status === "Approved")
    .reduce((sum, claim) => sum + claim.hours, 0);
  const trainingRecords = trainingService.getRecordsForUser(employee.id, actorContext);

  // ---------- Attention Queue ----------
  const attentionItems: AttentionItem[] = [];

  if (overdueTs.length > 0) {
    attentionItems.push({
      id: "timesheet-overdue",
      severity: "critical",
      icon: AlertTriangle,
      title: `${overdueTs.length} timesheet${overdueTs.length > 1 ? "s" : ""} returned for correction`,
      meta: "Action required before it can be resubmitted",
      actionLabel: "Fix now",
      actionTo: "/staff/me/timesheets",
    });
  }

  if (myReviews.length > 0) {
    const review = myReviews[0];
    attentionItems.push({
      id: "self-assessment",
      severity: "warning",
      icon: Briefcase,
      title: "Self-assessment due for Performance Review",
      meta:
        myReviews.length > 1
          ? `${myReviews.length} reviews awaiting your input`
          : "Awaiting your input",
      actionLabel: "Start",
      actionTo: `/staff/performance/reviews/${review!.id}`,
    });
  }

  if (myObTasks.length > 0 && obCase) {
    attentionItems.push({
      id: "onboarding-tasks",
      severity: "warning",
      icon: CheckCircle,
      title: `${myObTasks.length} onboarding task${myObTasks.length > 1 ? "s" : ""} pending`,
      meta: "Part of your onboarding checklist",
      actionLabel: "View",
      actionTo: "/staff/me/onboarding",
    });
  }

  if (expiringDocs.length > 0) {
    const soonestDiffDays = Math.min(
      ...expiringDocs.map(
        (d) => (new Date(d.expiryDate!).getTime() - new Date().getTime()) / (1000 * 3600 * 24),
      ),
    );
    attentionItems.push({
      id: "documents-expiring",
      severity: soonestDiffDays <= 30 ? "critical" : "warning",
      icon: FileText,
      title: `${expiringDocs.length} document${expiringDocs.length > 1 ? "s" : ""} expired or expiring soon`,
      meta: "Keep your records up to date",
      actionLabel: "Update",
      actionTo: "/staff/me/profile",
    });
  }

  if (myTravel.length > 0) {
    attentionItems.push({
      id: "travel-active",
      severity: "info",
      icon: Plane,
      title: `${myTravel.length} active travel request${myTravel.length > 1 ? "s" : ""}`,
      meta: "In progress",
      actionLabel: "Track",
      actionTo: "/staff/travel",
    });
  }

  // ---------- Pulse Strip ----------
  const pulseMetrics: PulseMetric[] = [
    {
      label: "Annual Leave",
      value: `${annualBalance.toFixed(1)} days`,
      note:
        upcomingLeave.length > 0
          ? `Upcoming leave: ${new Date(upcomingLeave[0]!.startDate).toLocaleDateString()}`
          : "Available balance",
    },
    {
      label: "Timesheet",
      value:
        overdueTs.length > 0
          ? "Needs correction"
          : latestTimesheet
            ? latestTimesheet.status
            : "Not started",
      ...(latestTimesheetPeriod
        ? { note: `${latestTimesheetPeriod.startDate} to ${latestTimesheetPeriod.endDate}` }
        : {}),
    },
    {
      label: "Pending Requests",
      value: String(pendingLeaveRequests.length + pendingOvertime.length + myTravel.length),
      note: "Leave, overtime and travel",
    },
    {
      label: "Attendance Alerts",
      value: String(attendanceExceptions.length),
      note: attendanceExceptions.length ? "Review your record" : "No exceptions",
    },
    {
      label: "Approved Overtime",
      value: `${approvedOvertimeHours.toFixed(1)} hrs`,
      note: `${pendingOvertime.length} awaiting approval`,
    },
    {
      label: "Training Records",
      value: String(trainingRecords.length),
      note: `${trainingRecords.filter((record) => record.hrVerified).length} HR verified`,
    },
  ];

  if (employee.startDate) {
    const yearsOfService =
      (new Date().getTime() - new Date(employee.startDate).getTime()) / (1000 * 3600 * 24 * 365.25);
    if (yearsOfService >= 0) {
      pulseMetrics.push({
        label: "With Us Since",
        value: new Date(employee.startDate).toLocaleDateString(),
        note: `${yearsOfService.toFixed(1)} years of service`,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PulseStrip metrics={pulseMetrics} />
      <DashboardPanel title="Things that need you">
        <AttentionQueue items={attentionItems} />
      </DashboardPanel>
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="My Recent Requests"
          description="Latest leave requests and their current decision"
          viewAllLabel="Open Leave"
          viewAllTo="/staff/me/leave-balances"
        >
          {leaveRequests.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              You have not submitted any leave requests.
            </p>
          ) : (
            <div className="divide-y">
              {leaveRequests.slice(0, 4).map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{request.policySnapshot.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(request.startDate).toLocaleDateString()} to{" "}
                      {new Date(request.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium">
                    {request.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DashboardPanel>
        <DashboardPanel
          title="Work and Development"
          description="Your current work and HR information"
          viewAllLabel="My Profile"
          viewAllTo="/staff/me/profile"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Attendance exceptions", attendanceExceptions.length],
              ["Pending overtime", pendingOvertime.length],
              ["Training records", trainingRecords.length],
              ["Onboarding progress", obCase ? `${obCase.progressPercentage}%` : "Complete"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-muted/20 p-3">
                <p className="text-lg font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
