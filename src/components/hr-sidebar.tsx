import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FilePlus2,
  Users,
  CalendarClock,
  ClipboardCheck,
  Calculator,
  FolderOpen,
  CalendarDays,
  Clock,
  Plane,
  DoorOpen,
  TrendingUp,
  GraduationCap,
  BarChart,
  Shield,
  Settings,
  UserCheck,
  HeartHandshake,
  Activity,
  Contact,
  FileBadge,
  ExternalLink,
  FileSearch,
  Network,
  PartyPopper,
} from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useCurrentUser } from "@/lib/auth";
import type { Permission } from "@/lib/auth/permissions";

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  requiredPermission?: Permission;
  /** Visible if the user holds ANY of these permissions (used instead of requiredPermission). */
  requiredAnyPermission?: Permission[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/staff", icon: LayoutDashboard },
      {
        title: "My Profile",
        url: "/staff/me/profile",
        icon: Contact,
        requiredPermission: "employee:view_self",
      },
      { title: "My Tasks", url: "/staff/my-tasks", icon: ClipboardCheck },
      {
        title: "My Onboarding",
        url: "/staff/me/onboarding",
        icon: UserCheck,
        requiredPermission: "onboarding:view_self",
      },
    ],
  },
  {
    label: "Recruitment",
    items: [
      {
        title: "Vacancies",
        url: "/staff/vacancies",
        icon: FilePlus2,
        requiredPermission: "recruitment:manage_vacancies",
      },
      {
        title: "Candidate Pool",
        url: "/staff/candidates",
        icon: Users,
        requiredPermission: "recruitment:view_candidates",
      },
      {
        title: "Incoming CVs",
        url: "/staff/candidates/intake",
        icon: FileSearch,
        requiredPermission: "recruitment:manage_candidates",
      },
      {
        title: "Contact Tracker",
        url: "/staff/candidates/contacts",
        icon: Activity,
        requiredPermission: "recruitment:manage_candidates",
      },
      {
        title: "Recommendations",
        url: "/staff/recommendations",
        icon: HeartHandshake,
        requiredPermission: "recruitment:view_candidates",
      },
      {
        title: "Interviews",
        url: "/staff/interviews",
        icon: CalendarClock,
        requiredPermission: "recruitment:score_interviews_assigned",
      },
      {
        title: "Offers",
        url: "/staff/offers",
        icon: UserCheck,
        requiredPermission: "recruitment:manage_candidates",
      },
    ],
  },
  {
    label: "Core HR",
    items: [
      {
        title: "Directory",
        url: "/staff/employees",
        icon: Contact,
        requiredPermission: "employee:view_directory",
      },
      {
        title: "Org Chart",
        url: "/staff/org-chart",
        icon: Network,
        requiredPermission: "employee:view_directory",
      },
      {
        title: "Employee Files",
        url: "/staff/files",
        icon: FolderOpen,
        requiredPermission: "employee:view_all",
      },
      {
        title: "Document Expiry",
        url: "/staff/document-expiry",
        icon: FileBadge,
        requiredPermission: "employee:manage_all",
      },
      {
        title: "Work Anniversaries",
        url: "/staff/anniversaries",
        icon: PartyPopper,
        requiredPermission: "employee:manage_all",
      },
      {
        title: "Onboarding",
        url: "/staff/onboarding",
        icon: ClipboardCheck,
        requiredPermission: "onboarding:manage_all",
      },
      {
        title: "Offboarding",
        url: "/staff/offboarding",
        icon: DoorOpen,
        requiredPermission: "offboarding:manage_all",
      },
    ],
  },
  {
    label: "Time & Travel",
    items: [
      {
        title: "My Leave Balances",
        url: "/staff/me/leave-balances",
        icon: CalendarDays,
        requiredPermission: "leave:view_self",
      },
      {
        title: "Leave Approvals",
        url: "/staff/leave-approvals",
        icon: ClipboardCheck,
        requiredPermission: "leave:approve_direct_reports",
      },
      {
        title: "Timesheet Approvals",
        url: "/staff/timesheet-approvals",
        icon: ClipboardCheck,
        requiredPermission: "timesheet:approve_direct_reports",
      },
      {
        title: "Leave Admin",
        url: "/staff/leave-admin",
        icon: CalendarClock,
        requiredPermission: "leave:admin_all",
      },
      {
        title: "Timesheets",
        url: "/staff/timesheets",
        icon: CalendarClock,
        requiredPermission: "timesheet:view_self",
      },
      {
        title: "Timesheet Monitoring",
        url: "/staff/timesheet-monitoring",
        icon: ClipboardCheck,
        requiredPermission: "timesheet:finance_view",
      },
      {
        title: "My Attendance",
        url: "/staff/me/attendance",
        icon: Clock,
        requiredPermission: "attendance:view_self",
      },
      {
        title: "Attendance Corrections",
        url: "/staff/attendance/corrections",
        icon: ClipboardCheck,
        requiredPermission: "attendance:approve_direct_reports",
      },
      {
        title: "Attendance Admin",
        url: "/staff/attendance",
        icon: Clock,
        requiredPermission: "attendance:manage_all",
      },
      {
        title: "My Overtime",
        url: "/staff/me/overtime",
        icon: Clock,
        requiredPermission: "timesheet:view_self",
      },
      {
        title: "Overtime Approvals",
        url: "/staff/overtime-approvals",
        icon: ClipboardCheck,
        requiredAnyPermission: ["overtime:approve_direct_reports", "overtime:admin_all"],
      },
      {
        title: "My Travel",
        url: "/staff/travel",
        icon: Plane,
        requiredPermission: "travel:request_self",
      },
      {
        title: "HR Travel Approvals",
        url: "/staff/travel-hr-approvals",
        icon: ClipboardCheck,
        requiredPermission: "travel:hr_review",
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        title: "Payroll Dashboard",
        url: "/staff/payroll/periods",
        icon: Calculator,
        requiredPermission: "payroll:view",
      },
      {
        title: "Overtime Ledger",
        url: "/staff/payroll/overtime",
        icon: Calculator,
        requiredAnyPermission: ["payroll:view", "overtime:admin_all"],
      },
      {
        title: "Accounts Travel Approvals",
        url: "/staff/travel-accounts-approvals",
        icon: ClipboardCheck,
        requiredPermission: "payroll:view",
      },
      {
        title: "Travel Reimbursements",
        url: "/staff/travel-closures",
        icon: ClipboardCheck,
        requiredPermission: "system:settings_manage",
      },
    ],
  },
  {
    label: "Talent",
    items: [
      {
        title: "My Performance",
        url: "/staff/me/performance",
        icon: TrendingUp,
        requiredPermission: "performance:view_self",
      },
      {
        title: "Team Performance",
        url: "/staff/performance/team",
        icon: Users, // Using Users icon
        requiredPermission: "performance:view_self", // General permission, filtered in route
      },
      {
        title: "Performance Cycles",
        url: "/staff/performance/cycles",
        icon: ClipboardCheck,
        requiredPermission: "system:settings_manage",
      },
      {
        title: "My Certifications",
        url: "/staff/me/training",
        icon: GraduationCap,
        requiredPermission: "training:view_all",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        title: "Reports",
        url: "/staff/reports",
        icon: BarChart,
        // HR/Super Admin via full audit access; Accounts via their payroll-scoped
        // subset of the Reports Centre (see ReportService.getScopedEmployees).
        requiredAnyPermission: ["system:audit_view", "payroll:view"],
      },
      {
        title: "User Management",
        url: "/staff/users",
        icon: Users,
        requiredPermission: "system:users_manage",
      },
      {
        title: "Audit History",
        url: "/staff/audit",
        icon: Shield,
        requiredPermission: "system:audit_view",
      },
      {
        title: "Settings & Master Data",
        url: "/staff/settings",
        icon: Settings,
        requiredPermission: "system:settings_manage",
      },
      {
        title: "Timesheet Settings",
        url: "/staff/timesheet-settings",
        icon: CalendarClock,
        requiredPermission: "system:settings_manage",
      },
    ],
  },
];

export function HrSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { displayName, activeRole, can: checkCan, currentEmployee } = useCurrentUser();

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border/70 px-4 py-4 group-data-[collapsible=icon]:px-2">
        <Link
          to="/staff"
          aria-label="VIA HR System dashboard"
          className="flex h-10 items-center overflow-hidden"
        >
          <BrandLogo
            invert
            className="h-10 min-w-[108px] group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:min-w-[86px]"
          />
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-1 py-2">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) => {
            if (item.requiredAnyPermission) {
              return item.requiredAnyPermission.some((perm) => checkCan(perm));
            }
            if (!item.requiredPermission) return true;
            return checkCan(item.requiredPermission);
          });

          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={group.label} className="py-1.5">
              <SidebarGroupLabel className="px-2 text-[10px] font-bold uppercase tracking-[0.16em] text-sidebar-foreground/45">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                        tooltip={item.title}
                        className="h-9 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/78 data-[active=true]:bg-white/12 data-[active=true]:font-semibold data-[active=true]:text-white data-[active=true]:shadow-sm"
                      >
                        <Link to={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}

        <SidebarGroup>
          <SidebarGroupLabel>Public</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Career portal"
                  className="h-9 rounded-lg px-2.5 text-[13px] text-sidebar-foreground/78"
                >
                  <Link to="/">
                    <ExternalLink />
                    <span>Career portal</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border/70 px-4 py-4 text-xs group-data-[collapsible=icon]:hidden">
        <p className="truncate font-semibold text-sidebar-foreground">{displayName}</p>
        <p className="text-[11px] truncate">
          {activeRole} · {currentEmployee?.position || "Staff"}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
