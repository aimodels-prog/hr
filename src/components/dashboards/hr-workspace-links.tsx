import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Users,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";

const links = [
  {
    title: "Approvals",
    to: "/staff/requests",
    icon: ClipboardCheck,
    permission: null,
  },
  {
    title: "Employees",
    to: "/staff/employees",
    icon: Users,
    permission: "employee:view_directory",
  },
  {
    title: "Employee files",
    to: "/staff/files",
    icon: FolderOpen,
    permission: "employee:view_all",
  },
  {
    title: "Attendance",
    to: "/staff/attendance",
    icon: Clock3,
    permission: "attendance:manage_all",
  },
  { title: "Leave", to: "/staff/leave-admin", icon: CalendarDays, permission: "leave:admin_all" },
  {
    title: "Timesheets",
    to: "/staff/timesheet-monitoring",
    icon: LayoutDashboard,
    permission: "timesheet:finance_view",
  },
  {
    title: "Recruitment",
    to: "/staff/vacancies",
    icon: FileText,
    permission: "recruitment:manage_vacancies",
  },
  {
    title: "Reports",
    to: "/staff/reports",
    icon: LayoutDashboard,
    permission: "system:audit_view",
  },
] as const;

export function HrWorkspaceLinks() {
  const user = useCurrentUser();
  return (
    <nav aria-label="HR workspace links" className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">Go straight to</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {links
          .filter((item) => !item.permission || user.can(item.permission))
          .map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.title}
                to={item.to}
                {...(item.to === "/staff/requests"
                  ? { search: { view: "approvals" as const } }
                  : {})}
                className="group flex min-h-12 items-center gap-3 rounded-xl border border-border/70 bg-background px-3 py-2 transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                <ArrowUpRight
                  className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
      </div>
    </nav>
  );
}
