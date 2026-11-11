import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { LiveAttendanceCard } from "./live-attendance-card";
import { DashboardCharts } from "./dashboard-charts";
import { StaffDataBoundary } from "@/components/layout/staff-data-boundary";
import { DASHBOARD_MODULES } from "@/lib/data/staff-module-plan";
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  CheckCircle,
  Clock3,
  FileText,
  GraduationCap,
  Plane,
} from "lucide-react";
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
  const annualBalance = balances.find((b) =>
    leaveService
      .getPolicies()
      .find((p) => p.id === b.policyId)
      ?.name.includes("Annual"),
  )?.available;
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

  if (previousNeedsReview && previousOpenPeriod && previousTimesheet?.status !== "Returned") {
    attentionItems.push({
      id: "previous-timesheet",
      severity: "warning",
      icon: CalendarDays,
      title: `${timesheetPeriodLabel(previousOpenPeriod)} timesheet needs your review`,
      meta: previousTimesheet?.status ?? "Not started",
      actionLabel: "Open",
      actionTo: `/staff/me/timesheets/${previousOpenPeriod.id}`,
    });
  }

  if (pendingTimeReviews > 0) {
    attentionItems.push({
      id: "time-reviews",
      severity: "info",
      icon: Clock3,
      title: `${pendingTimeReviews} visit or correction ${pendingTimeReviews === 1 ? "review" : "reviews"} pending`,
      meta: "Track the decision",
      actionLabel: "View status",
      actionTo: "/staff/requests?view=my",
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <DashboardPanel
          title="My timesheet"
          description={
            currentPeriod ? timesheetPeriodLabel(currentPeriod) : "Monthly work and leave"
          }
          viewAllLabel="All months"
          viewAllTo="/staff/me/timesheets"
          className="border-primary/15 bg-gradient-to-br from-card via-card to-primary/[0.04] p-5"
        >
          {currentPeriod && currentTimesheetSummary ? (
            <>
              <div className="grid gap-4 py-2 sm:grid-cols-3">
                {[
                  {
                    label: "Worked",
                    value: currentTimesheetSummary.workedHours,
                    tone: "text-primary",
                  },
                  {
                    label: "Paid leave",
                    value: currentTimesheetSummary.paidLeaveHours,
                    tone: "text-foreground",
                  },
                  {
                    label: "Expected work",
                    value: currentTimesheetSummary.requiredWorkHours,
                    tone: "text-foreground",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="sm:border-r sm:border-border/70 sm:pr-4 sm:last:border-0"
                  >
                    <p
                      className={`text-2xl font-semibold tracking-tight tabular-nums ${item.tone}`}
                    >
                      {item.value}
                      <span className="ml-1 text-sm font-medium text-muted-foreground">h</span>
                    </p>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-border/70 pt-4">
                <Link
                  to="/staff/me/timesheets/$periodId"
                  params={{ periodId: currentPeriod.id }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Open calendar <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed bg-background/70 px-4 py-7 text-sm text-muted-foreground">
              No timesheet is open for this month yet.
            </div>
          )}
        </DashboardPanel>
        {attentionItems.length > 0 ? (
          <DashboardPanel title="Needs attention" description="Your next actions" className="p-5">
            <AttentionQueue items={attentionItems} />
          </DashboardPanel>
        ) : (
          <DashboardPanel
            title="My leave"
            description={
              annualBalance === undefined ? "Balance not available yet" : "Available annual leave"
            }
            className="p-5"
          >
            <div className="rounded-xl bg-primary/[0.06] p-4">
              <p className="text-3xl font-semibold tracking-tight tabular-nums text-primary">
                {annualBalance ?? "—"}
                {annualBalance !== undefined && (
                  <span className="ml-1 text-sm font-medium text-muted-foreground">days</span>
                )}
              </p>
              {pendingLeaveRequests.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {pendingLeaveRequests.length}{" "}
                  {pendingLeaveRequests.length === 1 ? "request" : "requests"} awaiting a decision
                </p>
              )}
            </div>
            <Link
              to="/staff/me/leave-balances"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              View leave <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </DashboardPanel>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel
          title="Recent leave"
          viewAllLabel="View all"
          viewAllTo="/staff/me/leave-balances"
          className="p-5"
        >
          {leaveRequests.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <CalendarDays className="size-5 shrink-0 text-primary" aria-hidden="true" />
              No leave requests yet.
            </div>
          ) : (
            <div className="divide-y divide-border/70">
              {leaveRequests.slice(0, 4).map((request) => (
                <Link
                  key={request.id}
                  to="/staff/request-detail/$module/$requestId"
                  params={{ module: "Leave", requestId: request.id }}
                  search={{ from: "my" }}
                  className="flex items-center justify-between gap-3 rounded-lg py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{leaveDisplayType(request)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(request.startDate).toLocaleDateString()} to{" "}
                      {new Date(request.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      ["Approved", "Taken"].includes(request.status)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : /Declined|Refused|Rejected/.test(request.status)
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : /Pending/.test(request.status)
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : "border-border bg-muted/60 text-foreground"
                    }`}
                  >
                    {request.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </DashboardPanel>
        <DashboardPanel
          title="Development"
          viewAllLabel="My profile"
          viewAllTo="/staff/me/profile"
          className="p-5"
        >
          <div className="space-y-3">
            {obCase && (
              <Link
                to="/staff/me/onboarding"
                className="block rounded-xl border border-primary/10 bg-primary/[0.05] p-4 transition-colors hover:bg-primary/[0.08]"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-2xl font-semibold tracking-tight tabular-nums">
                      {obCase.progressPercentage}%
                    </p>
                    <p className="text-xs text-muted-foreground">Onboarding progress</p>
                  </div>
                  <ArrowUpRight className="size-4 text-primary" aria-hidden="true" />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/10">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(0, Math.min(100, obCase.progressPercentage))}%` }}
                  />
                </div>
              </Link>
            )}
            <div className="divide-y divide-border/70 rounded-xl border border-border/70">
              <Link
                to="/staff/me/training"
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <GraduationCap className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-medium">Training</span>
                <span className="text-xs text-muted-foreground">
                  {trainingRecords.length} {trainingRecords.length === 1 ? "record" : "records"}
                </span>
                <ArrowUpRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
              <Link
                to="/staff/me/overtime"
                className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <Clock3 className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex-1 text-sm font-medium">Overtime</span>
                <span className="text-xs text-muted-foreground">
                  {approvedOvertimeHours.toFixed(1)} h approved
                  {pendingOvertime.length > 0 ? ` · ${pendingOvertime.length} pending` : ""}
                </span>
                <ArrowUpRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </div>
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
