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
import { Button } from "@/components/ui/button";
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
  const {
    displayName,
    activeRole,
    can: checkCan,
    currentEmployee,
    id: currentUserId,
  } = useCurrentUser();
  const canManageRecruitment = checkCan("recruitment:manage_vacancies");
  const quickActions: Array<{
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
            title: "Import candidates",
            description: "Review an HR spreadsheet",
            to: "/staff/candidates/import",
            icon: Upload,
            tone: "bg-info/10 text-info",
          },
          {
            title: "Interview centre",
            description: "Schedules and scorecards",
            to: "/staff/interviews",
            icon: CalendarPlus,
            tone: "bg-success/10 text-success",
          },
          {
            title: "Create employee",
            description: "Add a staff record",
            to: "/staff/employees/new",
            icon: UserPlus,
            tone: "bg-warning/10 text-warning",
          },
          {
            title: "Import employees",
            description: "Bring in a batch from a spreadsheet",
            to: "/staff/employees/import",
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
          {
            title: "Document expiry",
            description: "Review compliance risk",
            to: "/staff/document-expiry",
            icon: ShieldCheck,
            tone: "bg-destructive/10 text-destructive",
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
        {activeRole === "HR" && canManageRecruitment && (
          <Button asChild variant="outline" className="w-full justify-start md:w-auto">
            <Link to="/staff/vacancies/new">
              <FilePlus2 className="mr-2 h-4 w-4" /> New Vacancy
            </Link>
          </Button>
        )}
      </div>

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
