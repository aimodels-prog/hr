import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { DashboardCharts } from "./dashboard-charts";
import {
  FileWarning,
  FileClock,
  Clock,
  UserCog,
  CalendarClock,
  Plane,
  ClipboardCheck,
  Send,
} from "lucide-react";
import { EmployeeService } from "@/lib/data/employee-service";
import { RecruitmentService } from "@/lib/data/recruitment-service";
import { DocumentService } from "@/lib/data/document-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { TimesheetService } from "@/lib/data/timesheet-service";
import { LeaveService } from "@/lib/data/leave-service";
import { TravelService } from "@/lib/data/travel-service";
import { InterviewService } from "@/lib/data/interview-service";
import { ScorecardService } from "@/lib/data/scorecard-service";
import { OfferService } from "@/lib/data/offer-service";
import type { Employee } from "@/lib/data/types";
import { isCurrentWorkforceMember } from "@/components/dashboards/dashboard-data";
import { useCurrentUser } from "@/lib/auth";
import {
  AttentionQueue,
  PulseStrip,
  DashboardPanel,
  ProgressRing,
  type AttentionItem,
  type PulseMetric,
} from "@/components/dashboards/dashboard-kit";

function formatNames(names: string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

export function HrDashboard() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const search = location.search as { employeeId?: string; days?: 7 | 30 };
  const [term, setTerm] = useState("");
  const service = useMemo(() => new EmployeeService(), []);
  const employees = service.getEmployees(user.getActorContext());
  const selected = employees.find((person) => person.id === search.employeeId);
  const matches = employees.filter((person) =>
    `${person.legalName} ${person.preferredName ?? ""} ${person.workEmail}`
      .toLowerCase()
      .includes(term.trim().toLowerCase()),
  );
  const select = (employeeId?: string) => {
    setTerm("");
    void navigate({ to: "/staff", search: { employeeId, days: search.days ?? 30 } });
  };
  return (
    <div className="space-y-4">
      <section
        className="rounded-xl border bg-card p-4 space-y-3"
        aria-label="Employee dashboard filter"
      >
        <label htmlFor="hr-employee-search" className="block font-semibold">
          Find an employee
        </label>
        <input
          id="hr-employee-search"
          type="search"
          placeholder="Search name or VIA email"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="h-11 w-full rounded-lg border bg-background px-3"
        />
        {term.trim() && (
          <ul aria-label="Matching employees" className="max-h-64 overflow-y-auto divide-y">
            {matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="w-full p-3 text-left hover:bg-muted focus-visible:outline-primary"
                  onClick={() => select(person.id)}
                >
                  {person.preferredName || person.legalName}
                  <span className="block break-all text-xs text-muted-foreground">
                    {person.workEmail}
                  </span>
                </button>
              </li>
            ))}
            {!matches.length && <li className="p-3 text-sm">No matching employees.</li>}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status">
            {selected
              ? `Viewing: ${selected.preferredName || selected.legalName} — Individual overview`
              : search.employeeId
                ? "This employee is unavailable. Clear the selection to see the organisation."
                : "Viewing: All employees — Organisation overview"}
          </p>
          {search.employeeId && (
            <button className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => select()}>
              Clear employee filter
            </button>
          )}
        </div>
      </section>
      {selected ? (
        <>
          <nav
            aria-label="Selected employee records"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          >
            {Object.entries({
              overview: "Employee overview",
              employment: "Employment & history",
              personal: "Personal details",
              documents: "Documents, visa & insurance",
              leave: "Leave & balances",
              timesheets: "Timesheets",
              attendance: "Attendance & overtime",
              travel: "Travel",
              performance: "Performance",
              training: "Training",
              equipment: "Assets",
              onboarding: "Onboarding & offboarding",
            }).map(([section, label]) => (
              <Link
                key={section}
                to="/staff/employees/$employeeId"
                params={{ employeeId: selected.id }}
                search={{ days: search.days ?? 30 }}
                hash={section}
                className="rounded-lg border bg-card p-3 text-sm font-medium hover:bg-muted"
              >
                {label}
              </Link>
            ))}
          </nav>
          <DashboardCharts
            scope="hr"
            employeeId={selected.databaseId ?? selected.id}
            profileId={selected.id}
          />
        </>
      ) : (
        !search.employeeId && <OrganisationHrDashboard />
      )}
    </div>
  );
}

function OrganisationHrDashboard() {
  const currentUser = useCurrentUser();
  const empService = useMemo(() => new EmployeeService(), []);
  const recService = useMemo(() => new RecruitmentService(), []);
  const docService = useMemo(() => new DocumentService(), []);
  const obService = useMemo(() => new OnboardingService(), []);
  const tsService = useMemo(() => new TimesheetService(), []);
  const leaveService = useMemo(() => new LeaveService(), []);
  const travelService = useMemo(() => new TravelService(), []);
  const interviewService = useMemo(() => new InterviewService(), []);
  const scorecardService = useMemo(() => new ScorecardService(), []);
  const offerService = useMemo(() => new OfferService(), []);

  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const allEmployees = empService.getEmployees(currentUser.getActorContext());
  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const e of allEmployees) map.set(e.id, e);
    return map;
  }, [allEmployees]);
  const nameFor = (employeeId: string) => {
    const emp = employeeById.get(employeeId);
    return emp ? emp.preferredName || emp.legalName : "Unknown employee";
  };

  // ---------- Headcount & joiner delta (real startDate comparison, no fabrication) ----------
  const activeEmployees = allEmployees.filter((employee) =>
    isCurrentWorkforceMember(employee, today),
  );

  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const reportableEmployees = allEmployees.filter(
    (employee) => employee.status !== "Inactive" && employee.status !== "Archived",
  );
  const thisMonthJoiners = reportableEmployees.filter((e) => {
    const sd = new Date(e.startDate);
    return sd >= thisMonthStart && sd < nextMonthStart;
  });
  const lastMonthJoiners = reportableEmployees.filter((e) => {
    const sd = new Date(e.startDate);
    return sd >= lastMonthStart && sd < thisMonthStart;
  });
  const joinerDelta = thisMonthJoiners.length - lastMonthJoiners.length;

  // ---------- Recruitment ----------
  const vacancies = recService.getVacancies().filter((v) => v.status === "Open");
  const candidates = recService.getCandidates();
  const applicants = candidates.reduce(
    (acc, c) =>
      acc +
      c.applications.filter(
        (a) => a.status !== "Rejected" && a.status !== "Withdrawn" && a.status !== "Hired",
      ).length,
    0,
  );
  const allInterviews = interviewService.getInterviews(currentUser.getActorContext());
  const upcomingInterviews = allInterviews
    .filter(
      (interview) =>
        interview.status === "Scheduled" &&
        interview.confirmedSlot &&
        new Date(interview.confirmedSlot.startTime) >= now,
    )
    .sort(
      (a, b) =>
        new Date(a.confirmedSlot!.startTime).getTime() -
        new Date(b.confirmedSlot!.startTime).getTime(),
    );
  const interviewsAwaitingScores = allInterviews.filter((interview) => {
    if (!interview.templateId || ["Cancelled", "No Show"].includes(interview.status)) return false;
    const interviewHasOccurred =
      interview.status === "Completed" ||
      (interview.status === "Scheduled" &&
        interview.confirmedSlot &&
        new Date(interview.confirmedSlot.startTime) <= now);
    if (!interviewHasOccurred) return false;
    return !scorecardService.calculateInterviewMetrics(interview.id, interview.panelUserIds)
      .isComplete;
  });
  const allOffers = offerService.getAllOffers(currentUser.getActorContext());
  const offersAwaitingResponse = allOffers.filter((offer) => offer.status === "Sent");
  const activeOffers = allOffers.filter((offer) =>
    ["Draft", "Pending Approval", "Approved", "Ready to Send", "Sent"].includes(offer.status),
  );

  // ---------- Documents ----------
  const allDocs = docService.getDocuments(currentUser.getActorContext());
  const relevantDocs = allDocs.filter(
    (d) =>
      activeEmployees.some((employee) => employee.id === d.employeeId) &&
      d.expiryDate &&
      d.status !== "Replaced" &&
      d.status !== "Rejected" &&
      !d.waiverReason,
  );
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const in90 = new Date(today);
  in90.setDate(in90.getDate() + 90);

  const docsExpiringCritical = relevantDocs.filter((d) => new Date(d.expiryDate!) <= in30);
  const docsExpiringWarning = relevantDocs.filter((d) => {
    const exp = new Date(d.expiryDate!);
    return exp > in30 && exp <= in90;
  });

  // ---------- Onboarding ----------
  const allCases = obService.getCasesForContext(currentUser.getActorContext());
  const activeCases = allCases.filter(
    (c) => c.status !== "Completed" && c.status !== "Cancelled" && c.progressPercentage < 100,
  );
  const stalledCases = activeCases.filter((c) =>
    c.tasks.some(
      (t) => new Date(t.dueDate) < today && t.status !== "Completed" && t.status !== "Waived",
    ),
  );
  const averageOnboardingProgress = activeCases.length
    ? activeCases.reduce((sum, item) => sum + item.progressPercentage, 0) / activeCases.length
    : 100;

  // ---------- Leave & Timesheets ----------
  const allLeaveRequests = leaveService.getAllRequests(currentUser.getActorContext());
  const pendingLeave = allLeaveRequests.filter(
    (r) =>
      r.status === "Pending Line Manager" ||
      r.status === "Pending HR" ||
      r.status === "Pending Super Admin",
  );
  const overdueTimesheets = tsService
    .getAllTimesheets(currentUser.getActorContext())
    .filter((t) => t.status === "Returned");

  // ---------- Travel (HR approval half of dual approval workflow) ----------
  const pendingHrTravel = travelService
    .getAllRequests(currentUser.getActorContext())
    .filter((r) => r.status === "Pending HR and Accounts" && r.hrApprovalStatus === "Pending");

  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const onLeaveThisWeek = allLeaveRequests
    .filter((r) => r.status === "Approved" || r.status === "Taken")
    .filter((r) => new Date(r.startDate) <= weekEnd && new Date(r.endDate) >= today)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  const onLeaveToday = onLeaveThisWeek.filter(
    (request) => new Date(request.startDate) <= today && new Date(request.endDate) >= today,
  );
  const peopleOnLeaveToday = new Set(onLeaveToday.map((request) => request.employeeId)).size;

  // ---------- Attention Queue ----------
  const attentionItems: AttentionItem[] = [];

  if (docsExpiringCritical.length > 0) {
    const names = [...new Set(docsExpiringCritical.map((d) => nameFor(d.employeeId)))];
    attentionItems.push({
      id: "docs-critical",
      severity: "critical",
      icon: FileWarning,
      title: `${docsExpiringCritical.length} document${docsExpiringCritical.length === 1 ? "" : "s"} expired or due within 30 days`,
      meta: formatNames(names),
      actionLabel: "Review",
      actionTo: "/staff/document-expiry",
    });
  }

  if (overdueTimesheets.length > 0) {
    const names = [...new Set(overdueTimesheets.map((t) => nameFor(t.employeeId)))];
    attentionItems.push({
      id: "timesheets-returned",
      severity: "critical",
      icon: Clock,
      title: `${overdueTimesheets.length} timesheet${overdueTimesheets.length === 1 ? "" : "s"} returned for correction`,
      meta: formatNames(names),
      actionLabel: "Review",
      actionTo: "/staff/timesheet-monitoring",
    });
  }

  if (docsExpiringWarning.length > 0) {
    const names = [...new Set(docsExpiringWarning.map((d) => nameFor(d.employeeId)))];
    attentionItems.push({
      id: "docs-warning",
      severity: "warning",
      icon: FileClock,
      title: `${docsExpiringWarning.length} document${docsExpiringWarning.length === 1 ? "" : "s"} expiring in 31-90 days`,
      meta: formatNames(names),
      actionLabel: "Review",
      actionTo: "/staff/document-expiry",
    });
  }

  if (pendingHrTravel.length > 0) {
    const names = [...new Set(pendingHrTravel.map((r) => nameFor(r.employeeId)))];
    attentionItems.push({
      id: "travel-hr-approval",
      severity: "warning",
      icon: Plane,
      title: `${pendingHrTravel.length} travel request${pendingHrTravel.length === 1 ? "" : "s"} awaiting HR approval`,
      meta: formatNames(names),
      actionLabel: "Review",
      actionTo: "/staff/travel-hr-approvals",
    });
  }

  if (activeCases.length > 0) {
    attentionItems.push({
      id: "onboarding-active",
      severity: stalledCases.length > 0 ? "warning" : "info",
      icon: UserCog,
      title: `${activeCases.length} onboarding case${activeCases.length === 1 ? "" : "s"} in progress`,
      meta:
        stalledCases.length > 0
          ? `${stalledCases.length} with overdue tasks`
          : "All tasks on schedule",
      actionLabel: "Review",
      actionTo: "/staff/onboarding",
    });
  }

  if (pendingLeave.length > 0) {
    attentionItems.push({
      id: "leave-pending",
      severity: pendingLeave.length > 5 ? "warning" : "info",
      icon: CalendarClock,
      title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? "" : "s"} awaiting approval`,
      meta: "Awaiting a line manager or Super Admin decision",
      actionLabel: "Monitor",
      actionTo: "/staff/leave-admin",
    });
  }

  if (interviewsAwaitingScores.length > 0) {
    attentionItems.push({
      id: "interview-scorecards",
      severity: "warning",
      icon: ClipboardCheck,
      title: `${interviewsAwaitingScores.length} interview${interviewsAwaitingScores.length === 1 ? "" : "s"} awaiting scorecards`,
      meta: "Hiring decisions remain incomplete until assigned panel members submit",
      actionLabel: "Review",
      actionTo: "/staff/interviews",
    });
  }

  if (offersAwaitingResponse.length > 0) {
    attentionItems.push({
      id: "offers-awaiting-response",
      severity: "info",
      icon: Send,
      title: `${offersAwaitingResponse.length} offer${offersAwaitingResponse.length === 1 ? "" : "s"} awaiting candidate response`,
      meta: "Monitor response deadlines and candidate decisions",
      actionLabel: "Review",
      actionTo: "/staff/offers",
    });
  }

  // ---------- Pulse Strip ----------
  const pulseMetrics: PulseMetric[] = [
    {
      label: "Current workforce",
      value: String(activeEmployees.length),
      note: "Active employees",
    },
    {
      label: "Not on leave today",
      value: String(Math.max(activeEmployees.length - peopleOnLeaveToday, 0)),
      note: `${peopleOnLeaveToday} on approved leave`,
    },
    {
      label: "Joining this month",
      value: String(thisMonthJoiners.length),
      note:
        joinerDelta === 0
          ? "Same as last month"
          : `${joinerDelta > 0 ? "+" : ""}${joinerDelta} compared with last month`,
    },
    {
      label: "Documents requiring action",
      value: String(docsExpiringCritical.length + docsExpiringWarning.length),
      note: `${docsExpiringCritical.length} urgent`,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="hr-attention-heading">
        <div className="mb-3">
          <h2 id="hr-attention-heading" className="text-sm font-bold">
            Needs my attention
          </h2>
          <p className="text-xs text-muted-foreground">The most important HR work to move today</p>
        </div>
        <AttentionQueue items={attentionItems.slice(0, 5)} />
        {attentionItems.length > 5 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {attentionItems.length - 5} more item{attentionItems.length - 5 === 1 ? "" : "s"} can be
            reviewed from My Tasks.
          </p>
        ) : null}
      </section>

      <PulseStrip metrics={pulseMetrics} />
      <DashboardCharts scope="hr" />

      <div className="grid gap-4 lg:grid-cols-3">
        <DashboardPanel
          title="People on leave today"
          viewAllLabel="Open Leave Admin"
          viewAllTo="/staff/leave-admin"
        >
          {onLeaveToday.length === 0 ? (
            <p className="text-sm text-muted-foreground">No employees are on approved leave.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {onLeaveToday.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{nameFor(r.employeeId)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.policySnapshot.name}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {new Date(r.startDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    {" - "}
                    {new Date(r.endDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Onboarding readiness"
          description={`${activeCases.length} active · ${stalledCases.length} needing intervention`}
          viewAllLabel="Open Onboarding"
          viewAllTo="/staff/onboarding"
        >
          <div className="flex flex-col gap-4">
            <ProgressRing value={averageOnboardingProgress} label="Active case progress" />
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="text-xl font-bold tabular-nums">{activeCases.length}</p>
                <p className="text-xs text-muted-foreground">In progress</p>
              </div>
              <div className="rounded-lg bg-destructive/8 p-3">
                <p className="text-xl font-bold tabular-nums text-destructive">
                  {stalledCases.length}
                </p>
                <p className="text-xs text-muted-foreground">Need intervention</p>
              </div>
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel
          title="Recruitment"
          description="Current hiring work"
          viewAllLabel="Open Vacancies"
          viewAllTo="/staff/vacancies"
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Open vacancies", vacancies.length],
              ["Active applicants", applicants],
              ["Upcoming interviews", upcomingInterviews.length],
              ["Active offers", activeOffers.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xl font-bold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
