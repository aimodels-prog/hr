import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ClipboardCheck,
  ArrowRight,
  UserCheck,
  Briefcase,
  FilePlus2,
  CalendarPlus,
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
            tone: "bg-primary/10 text-primary",
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
          {
            title: "New employees",
            description: "Track new joiner readiness",
            to: "/staff/onboarding",
            icon: UserCheck,
            tone: "bg-primary/10 text-primary",
          },
        ]
      : activeRole === "Line Manager"
        ? [
            {
              title: "Leave approvals",
              description: "Review direct-report leave",
              to: "/staff/leave-approvals",
              icon: CalendarPlus,
              tone: "bg-primary/10 text-primary",
            },
            {
              title: "Timesheet approvals",
              description: "Review submitted hours",
              to: "/staff/timesheet-approvals",
              icon: Clock3,
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
                tone: "bg-primary/10 text-primary",
              },
              {
                title: "Travel approvals",
                description: "Review budget clearance",
                to: "/staff/travel-accounts-approvals",
                icon: Plane,
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
          : activeRole === "Super Admin"
            ? [
                {
                  title: "Create employee",
                  description: "Add a staff record",
                  to: "/staff/employees/new",
                  icon: UserPlus,
                  tone: "bg-primary/10 text-primary",
                },
                {
                  title: "Final leave approvals",
                  description: "Complete leave decisions",
                  to: "/staff/leave-approvals",
                  icon: CalendarPlus,
                  tone: "bg-success/10 text-success",
                },
                {
                  title: "Payroll control",
                  description: "Review and lock periods",
                  to: "/staff/payroll/periods",
                  icon: WalletCards,
                  tone: "bg-warning/10 text-warning",
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
                  title: "My profile",
                  description: "Documents and personal data",
                  to: "/staff/me/profile",
                  icon: UserCheck,
                  tone: "bg-success/10 text-success",
                },
              ];

  const quickAccess = (
    <section aria-label="Quick access" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {roleQuickActions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.title}
            to={action.to}
            className="group flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-muted/30"
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
      {/* Header Banner */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {["HR", "Super Admin"].includes(activeRole)
                ? "People overview"
                : `Welcome back, ${displayName.split(" ")[0]}`}
            </h1>
            <Badge variant="outline" className="rounded-full bg-card px-2.5 text-[11px]">
              {activeRole}
            </Badge>
          </div>
        </div>{" "}
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
          </div>
        )}
      </div>

      {quickAccess}
      <RequestTrackerSummary />
      <DashboardActionQueue />
      {(activeRole === "Employee" || activeRole === "IT") && currentEmployee && (
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
