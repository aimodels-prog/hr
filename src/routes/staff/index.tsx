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
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeDashboard } from "@/components/dashboards/employee-dashboard";
import { ManagerDashboard } from "@/components/dashboards/manager-dashboard";
import { HrDashboard } from "@/components/dashboards/hr-dashboard";
import { AccountsDashboard } from "@/components/dashboards/accounts-dashboard";
import { AdminDashboard } from "@/components/dashboards/admin-dashboard";

export const Route = createFileRoute("/staff/")({
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
            title: "Create vacancy",
            description: "Start a hiring request",
            to: "/staff/vacancies/new",
            icon: FilePlus2,
            tone: "bg-primary/10 text-primary",
          },
          {
            title: "Create employee",
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
            title: "Onboarding",
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

  const quickActions = [
    ...roleQuickActions,
    {
      title: "Apply for a position",
      description: "Explore open VIA opportunities",
      to: "/staff/opportunities?action=apply",
      icon: Briefcase,
      tone: "bg-primary/10 text-primary",
    },
    {
      title: "Recommend someone",
      description: "Send a candidate and CV to HR",
      to: "/staff/opportunities?action=refer",
      icon: HeartHandshake,
      tone: "bg-success/10 text-success",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      {/* Header Banner */}
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border/70 pb-6">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-primary">
            Your workspace
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-[-0.04em]">
              Welcome back, {displayName.split(" ")[0]}
            </h1>
            <Badge variant="outline" className="rounded-full bg-card px-2.5 text-[11px]">
              {activeRole}
            </Badge>
          </div>
          {currentEmployee && (
            <p className="mt-2 text-sm text-muted-foreground">
              {[currentEmployee.position, currentEmployee.department, currentEmployee.location]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {activeRole === "HR" && currentEmployee && (
        <section aria-labelledby="my-day-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 id="my-day-heading" className="text-sm font-bold">
                My day
              </h2>
              <p className="text-xs text-muted-foreground">
                Your own attendance, leave, timesheet and assigned work
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                title: "My attendance",
                to: "/staff/me/attendance",
                icon: Clock3,
              },
              {
                title: "My leave",
                to: "/staff/me/leave-balances",
                icon: CalendarPlus,
              },
              {
                title: "My timesheet",
                to: "/staff/me/timesheets",
                icon: ClipboardCheck,
              },
              {
                title: "My tasks",
                to: "/staff/my-tasks",
                icon: UserCheck,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.title}
                  to={item.to}
                  className="group flex min-h-12 items-center gap-3 rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/30"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold">{item.title}</span>
                  <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {(activeRole === "Employee" || activeRole === "IT") && currentEmployee && (
        <EmployeeDashboard employee={currentEmployee} userId={currentUserId} />
      )}
      {activeRole === "Line Manager" && currentEmployee && (
        <ManagerDashboard employee={currentEmployee} userId={currentUserId} />
      )}
      {activeRole === "HR" && <HrDashboard />}
      {activeRole === "Accounts" && <AccountsDashboard />}
      {activeRole === "Super Admin" && <AdminDashboard />}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Quick access</h2>
          <span className="text-xs text-muted-foreground">Your most-used areas</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.title}
                to={action.to}
                className="group flex items-center gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md"
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.tone}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{action.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {action.description}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
