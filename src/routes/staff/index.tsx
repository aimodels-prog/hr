import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardCheck,
  ArrowRight,
  Briefcase,
  FilePlus2,
  CalendarPlus,
  CalendarClock,
  Plane,
  Upload,
  UserPlus,
  Settings,
  ShieldCheck,
  WalletCards,
  Clock3,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeDashboard } from "@/components/dashboards/employee-dashboard";
import { ManagerDashboard } from "@/components/dashboards/manager-dashboard";
import { HrDashboard } from "@/components/dashboards/hr-dashboard";
import { AccountsDashboard } from "@/components/dashboards/accounts-dashboard";
import { employeeSearch } from "@/components/employees/employee-filter";
import { RequestTrackerSummary } from "@/components/dashboards/request-tracker-summary";
import { DashboardActionQueue } from "@/components/dashboards/dashboard-action-queue";

export const Route = createFileRoute("/staff/")({
  validateSearch: employeeSearch,
  head: () => ({
    meta: [
      { title: "Staff Dashboard | VIA HR System" },
      {
        name: "description",
        content: "Track operations, recruitment, interviews, and team records in one place.",
      },
      { property: "og:title", content: "Staff Dashboard | VIA HR System" },
      { property: "og:description", content: "Role-scoped overview for VIA HR operations." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { displayName, activeRole, currentEmployee, id: currentUserId } = useCurrentUser();
  const roleQuickActions: Array<{
    title: string;
    description: string;
    to: string;
    hash?: string;
    icon: LucideIcon;
    tone: string;
  }> =
    activeRole === "HR"
      ? [
          {
            title: "Add job",
            description: "Start a hiring request",
            to: "/staff/vacancies/new",
            icon: FilePlus2,
            tone: "bg-info/10 text-info",
          },
          {
            title: "Add employee",
            description: "Add a staff record",
            to: "/staff/employees/new",
            icon: UserPlus,
            tone: "bg-warning/10 text-warning",
          },
          {
            title: "Add a candidate CV",
            description: "Save a CV in the Candidate Pool",
            to: "/staff/candidates/intake",
            icon: Upload,
            tone: "bg-info/10 text-info",
          },
        ]
      : activeRole === "Line Manager"
        ? [
            {
              title: "My requests",
              description: "Track my own requests",
              to: "/staff/requests?view=my",
              icon: CalendarPlus,
              tone: "bg-warning/10 text-warning",
            },
            {
              title: "My team",
              description: "Direct-report performance",
              to: "/staff/performance/team",
              icon: Users,
              tone: "bg-success/10 text-success",
            },
            {
              title: "My tasks",
              description: "Assigned people actions",
              to: "/staff/my-tasks",
              icon: ClipboardCheck,
              tone: "bg-info/10 text-info",
            },
          ]
        : activeRole === "Accounts"
          ? [
              {
                title: "Payroll periods",
                description: "Prepare and validate inputs",
                to: "/staff/payroll/periods",
                icon: WalletCards,
                tone: "bg-info/10 text-info",
              },
              {
                title: "Payroll overtime",
                description: "Review approved overtime",
                to: "/staff/payroll/overtime",
                icon: Clock3,
                tone: "bg-warning/10 text-warning",
              },
              {
                title: "Reports centre",
                description: "Finance-ready HR reports",
                to: "/staff/reports",
                icon: Briefcase,
                tone: "bg-success/10 text-success",
              },
            ]
          : activeRole === "Travel Admin"
            ? [
                {
                  title: "Travel bookings",
                  description: "Arrange approved trips",
                  to: "/staff/travel",
                  icon: Plane,
                  tone: "bg-primary/10 text-primary",
                },
                {
                  title: "My requests",
                  description: "Track my own requests",
                  to: "/staff/requests?view=my",
                  icon: ClipboardCheck,
                  tone: "bg-info/10 text-info",
                },
                {
                  title: "My timesheet",
                  description: "Record and submit hours",
                  to: "/staff/me/timesheets",
                  icon: Clock3,
                  tone: "bg-warning/10 text-warning",
                },
              ]
            : activeRole === "Super Admin"
              ? [
                  {
                    title: "Employee requests",
                    description: "View progress without deciding",
                    to: "/staff/requests?view=organisation",
                    icon: ClipboardCheck,
                    tone: "bg-success/10 text-success",
                  },
                  {
                    title: "Audit history",
                    description: "Review sensitive changes",
                    to: "/staff/audit",
                    icon: ShieldCheck,
                    tone: "bg-destructive/10 text-destructive",
                  },
                  {
                    title: "System settings",
                    description: "Roles, rules and master data",
                    to: "/staff/settings",
                    icon: Settings,
                    tone: "bg-info/10 text-info",
                  },
                  {
                    title: "Reports centre",
                    description: "Executive people insight",
                    to: "/staff/reports",
                    icon: Briefcase,
                    tone: "bg-primary/10 text-primary",
                  },
                ]
              : [
                  {
                    title: "Request leave",
                    description: "Check balance and request",
                    to: "/staff/me/leave-balances",
                    hash: "action=request",
                    icon: CalendarPlus,
                    tone: "bg-primary/10 text-primary",
                  },
                  {
                    title: "My timesheet",
                    description: "Record and submit hours",
                    to: "/staff/me/timesheets",
                    icon: Clock3,
                    tone: "bg-warning/10 text-warning",
                  },
                  {
                    title: "Request travel",
                    description: "Request approval before travel",
                    to: "/staff/travel/new",
                    icon: Plane,
                    tone: "bg-info/10 text-info",
                  },
                  {
                    title: "My requests",
                    description: "Track requests and approvals",
                    to: "/staff/requests?view=my",
                    icon: ClipboardCheck,
                    tone: "bg-success/10 text-success",
                  },
                ];

  const quickAccess = (
    <section
      aria-label="Quick access"
      className={`grid gap-2 sm:grid-cols-2 ${roleQuickActions.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}
    >
      {roleQuickActions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.title}
            to={action.to}
            {...(action.hash ? { hash: action.hash } : {})}
            className="group relative flex min-h-14 items-center gap-3 overflow-hidden rounded-xl border bg-card px-4 py-3 shadow-sm transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[#13af6f] before:content-['']"
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${action.tone}`}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium">{action.title}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
    </section>
  );

  return (
    <div
      key={`${currentUserId}:${activeRole}`}
      className="mx-auto max-w-7xl space-y-6 pb-10"
      data-dashboard-role={activeRole}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {activeRole === "HR" ? "HR workspace" : `${activeRole} workspace`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Welcome, {displayName.split(" ")[0]}.
            </h1>
            <Badge variant="outline" className="rounded-full bg-card px-3 py-1 text-xs">
              {activeRole}
            </Badge>
          </div>
        </div>
        {currentEmployee && !["HR", "Super Admin"].includes(activeRole) && (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/staff/me/attendance"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium"
            >
              <Clock3 className="h-4 w-4" /> My attendance
            </Link>
            <Link
              to="/staff/me/attendance"
              search={{ action: "site-visit" }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
            >
              <Plane className="h-4 w-4" /> Quick visit
            </Link>
            <Link
              to="/staff/time-away"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium"
            >
              <CalendarClock className="h-4 w-4" /> Time Away
            </Link>
          </div>
        )}
      </div>

      <section
        className="via-dashboard-hero relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-8"
        aria-label="Workspace overview"
      >
        <div className="relative z-10 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {activeRole === "HR"
              ? "People operations at a glance"
              : activeRole === "Employee"
                ? "Your work, all in one place"
                : "Your workspace at a glance"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
            {activeRole === "HR"
              ? "See your team, pending approvals and the work that needs attention."
              : activeRole === "Employee"
                ? "Check your hours, requests and next steps."
                : "See what needs your attention and continue your work."}
          </p>
          <Link
            to={
              activeRole === "HR"
                ? "/staff/requests?view=approvals"
                : (roleQuickActions[0]?.to ?? "/staff/requests?view=my")
            }
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-[#0b5796] shadow-sm transition-colors hover:bg-[#eaf5ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {activeRole === "HR"
              ? "Review approvals"
              : (roleQuickActions[0]?.title ?? "My requests")}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <RequestTrackerSummary />
      {quickAccess}
      <DashboardActionQueue />
      {["Employee", "IT", "Travel Admin"].includes(activeRole) && currentEmployee && (
        <EmployeeDashboard employee={currentEmployee} userId={currentUserId} />
      )}
      {activeRole === "Line Manager" && currentEmployee && (
        <ManagerDashboard employee={currentEmployee} userId={currentUserId} />
      )}
      {["HR", "Super Admin"].includes(activeRole) && <HrDashboard />}
      {activeRole === "Accounts" && <AccountsDashboard />}
    </div>
  );
}
