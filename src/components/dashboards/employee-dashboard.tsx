import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { LiveAttendanceCard } from "./live-attendance-card";
import { DashboardCharts } from "./dashboard-charts";
import { StaffDataBoundary } from "@/components/layout/staff-data-boundary";
import { DASHBOARD_MODULES } from "@/lib/data/staff-module-plan";
import { AlertTriangle, Briefcase, CheckCircle, FileText, Plane } from "lucide-react";
import { LeaveService } from "@/lib/data/leave-service";
import { leaveDisplayType } from "@/lib/data/leave-presentation";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { timesheetPeriodLabel } from "@/lib/data/timesheet-periods";
import { organisationDate } from "@/lib/data/approved-leave";
import { SettingsService } from "@/lib/data/settings-service";
import { DocumentService } from "@/lib/data/document-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { PerformanceService } from "@/lib/data/performance-service";
import { TravelService } from "@/lib/data/travel-service";
import { AttendanceService } from "@/lib/data/attendance-service";
import { OvertimeService } from "@/lib/data/overtime-service";
import { TrainingService } from "@/lib/data/training-service";
import type { Employee } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import {
  AttentionQueue,
  DashboardPanel,
  type AttentionItem,
} from "@/components/dashboards/dashboard-kit";

export function EmployeeDashboard({ employee, userId }: { employee: Employee; userId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <LiveAttendanceCard />
      <DashboardCharts scope="self" />
      <StaffDataBoundary modules={DASHBOARD_MODULES.employee}>
        <EmployeeDashboardDetails employee={employee} userId={userId} />
      </StaffDataBoundary>
    </div>
  );
}

function EmployeeDashboardDetails({ employee, userId }: { employee: Employee; userId: string }) {
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
  const todayDate = organisationDate(
    new Date(),
    new SettingsService().getAppSettingsSync().timezone,
  );
  const currentPeriod = tsService
    .getPeriods()
    .find((period) => period.startDate <= todayDate && period.endDate >= todayDate);
  const currentTimesheet = currentPeriod
    ? employeeTimesheets.find((sheet) => sheet.periodId === currentPeriod.id)
    : undefined;
  const currentTimesheetSummary = currentPeriod
    ? tsService.getPeriodSummary(employee.id, currentPeriod, currentTimesheet)
    : null;
  const previousOpenPeriod = tsService
    .getPeriods()
    .filter(
      (period) =>
        period.status === "Open" &&
        period.endDate < todayDate &&
        (!employee.startDate || employee.startDate <= period.endDate),
    )
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const previousTimesheet = previousOpenPeriod
    ? employeeTimesheets.find((sheet) => sheet.periodId === previousOpenPeriod.id)
    : undefined;
  const previousNeedsReview = Boolean(
    previousOpenPeriod &&
    (!previousTimesheet || ["Draft", "Returned"].includes(previousTimesheet.status)),
  );
  const attendanceRecordDates = new Map<string, string>();
  for (const record of attendanceService.getRecordsForEmployee(employee.id, actorContext)) {
    attendanceRecordDates.set(record.id, record.date);
    if (record.databaseId) attendanceRecordDates.set(record.databaseId, record.date);
  }
  const inCurrentPeriod = (date: string | undefined) =>
    Boolean(
      currentPeriod && date && date >= currentPeriod.startDate && date <= currentPeriod.endDate,
    );
  const pendingTimeReviews =
    attendanceService
      .getCorrectionsForEmployee(employee.id, actorContext)
      .filter(
        (item) =>
          ["Pending Manager", "Pending HR"].includes(item.status) &&
          inCurrentPeriod(attendanceRecordDates.get(item.attendanceRecordId)),
      ).length +
    attendanceService
      .getSiteVisitsForEmployee(employee.id, actorContext)
      .filter((item) => item.status === "Pending HR" && inCurrentPeriod(item.date)).length;

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

  return (
    <div className="flex flex-col gap-4">
      <DashboardPanel
        title="My timesheet"
        description={currentPeriod ? timesheetPeriodLabel(currentPeriod) : "Monthly work and leave"}
        viewAllLabel="All months"
        viewAllTo="/staff/me/timesheets"
      >
        <div className="space-y-3">
          {currentPeriod && currentTimesheetSummary ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <p>
                  <span className="font-semibold">{currentTimesheetSummary.workedHours} h</span>{" "}
                  worked
                </p>
                <p>
                  <span className="font-semibold">{currentTimesheetSummary.paidLeaveHours} h</span>{" "}
                  paid leave
                </p>
                <p>
                  <span className="font-semibold">
                    {currentTimesheetSummary.requiredWorkHours} h
                  </span>{" "}
                  required work
                </p>
                {pendingTimeReviews > 0 && (
                  <p className="text-amber-700">
                    {pendingTimeReviews} correction or visit review
                    {pendingTimeReviews === 1 ? "" : "s"} pending
                  </p>
                )}
              </div>
              <Link
                to="/staff/me/timesheets/$periodId"
                params={{ periodId: currentPeriod.id }}
                className="inline-flex shrink-0 items-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Open daily calendar
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This month's timesheet has not been opened by HR yet.
            </p>
          )}
          {previousNeedsReview && previousOpenPeriod && (
            <Link
              to="/staff/me/timesheets/$periodId"
              params={{ periodId: previousOpenPeriod.id }}
              className="block rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:underline"
            >
              {timesheetPeriodLabel(previousOpenPeriod)} needs your review ·{" "}
              {previousTimesheet?.status ?? "Not started"}
            </Link>
          )}
        </div>
      </DashboardPanel>
      <details className="rounded-xl border bg-card p-4">
        <summary className="mb-3 cursor-pointer text-sm font-medium">My request reminders</summary>
        <AttentionQueue items={attentionItems} />
      </details>
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="My recent leave requests"
          viewAllLabel="Open Leave"
          viewAllTo="/staff/me/leave-balances"
        >
          {leaveRequests.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">No leave requests yet.</p>
          ) : (
            <div className="divide-y">
              {leaveRequests.slice(0, 4).map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{leaveDisplayType(request)}</p>
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
          title="My development"
          viewAllLabel="My Profile"
          viewAllTo="/staff/me/profile"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Approved overtime hours", approvedOvertimeHours.toFixed(1)],
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
