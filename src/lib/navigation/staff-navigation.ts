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
  FileSearch,
  Network,
  PartyPopper,
  BriefcaseBusiness,
  BookOpen,
} from "lucide-react";
import type { Permission } from "../auth/permissions.ts";
import type { Role } from "../data/types.ts";
import { HR_SETUP_SECTIONS } from "../auth/company-setup-policy.ts";

export interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  keywords?: string;
  requiredPermission?: Permission;
  requiredAnyPermission?: Permission[];
  requiredRoles?: Role[];
  /** Task shortcuts are searchable, without repeating them in the main menu. */
  shortcuts?: Array<{ title: string; url: string; keywords?: string }> | undefined;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

const navigation: NavGroup[] = [
  {
    label: "Home",
    items: [{ title: "Dashboard", url: "/staff", icon: LayoutDashboard }],
  },
  {
    label: "My Workspace",
    items: [
      {
        title: "My Profile",
        url: "/staff/me/profile",
        keywords: "my details contact personal employee",
        icon: Contact,
        requiredPermission: "employee:view_self",
      },
      { title: "My Tasks", url: "/staff/my-tasks", icon: ClipboardCheck },
      {
        title: "My Setup",
        url: "/staff/me/onboarding",
        keywords: "new joiner setup personal details",
        icon: UserCheck,
        requiredPermission: "onboarding:view_self",
      },
      {
        title: "My Leave Balances",
        url: "/staff/me/leave-balances",
        keywords: "annual sick holiday entitlement remaining balance",
        icon: CalendarDays,
        requiredPermission: "leave:view_self",
      },
      {
        title: "My Timesheets",
        url: "/staff/timesheets",
        icon: CalendarClock,
        requiredPermission: "timesheet:view_self",
      },
      {
        title: "My Attendance",
        url: "/staff/me/attendance",
        icon: Clock,
        requiredPermission: "attendance:view_self",
      },
      {
        title: "Quick Visits",
        url: "/staff/me/attendance?action=site-visit",
        keywords: "quick site ministry visit official duty",
        icon: Clock,
        requiredPermission: "attendance:view_self",
      },
      {
        title: "My Overtime",
        url: "/staff/me/overtime",
        icon: Clock,
        requiredPermission: "timesheet:view_self",
      },
      {
        title: "Time Away",
        url: "/staff/time-away",
        keywords: "hospital appointment absence personal time away team",
        icon: Clock,
        requiredPermission: "attendance:view_self",
      },
      {
        title: "My Travel",
        url: "/staff/travel",
        icon: Plane,
        requiredPermission: "travel:request_self",
      },
      {
        title: "My Payslips",
        url: "/staff/payslips",
        icon: CalendarDays,
        requiredPermission: "document:view_self",
      },
      {
        title: "My Performance",
        url: "/staff/me/performance",
        icon: TrendingUp,
        requiredPermission: "performance:view_self",
      },
      {
        title: "My Training",
        url: "/staff/me/training",
        icon: GraduationCap,
        requiredPermission: "training:view_self",
      },
      { title: "Opportunities", url: "/staff/opportunities", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Approvals",
    items: [
      {
        title: "Requests & approvals",
        url: "/staff/requests",
        keywords: "pending requests approval inbox status",
        icon: ClipboardCheck,
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
        title: "Attendance Corrections",
        url: "/staff/attendance/corrections",
        icon: ClipboardCheck,
        requiredPermission: "attendance:approve_direct_reports",
      },
      {
        title: "Overtime Approvals",
        url: "/staff/overtime-approvals",
        icon: ClipboardCheck,
        requiredAnyPermission: ["overtime:approve_direct_reports", "overtime:admin_all"],
      },
      {
        title: "Team Travel Approvals",
        url: "/staff/travel-approvals",
        icon: ClipboardCheck,
        requiredPermission: "travel:manager_review",
      },
      {
        title: "HR Travel Approvals",
        url: "/staff/travel-hr-approvals",
        icon: ClipboardCheck,
        requiredPermission: "travel:hr_review",
      },
      {
        title: "Accounts Travel Approvals",
        url: "/staff/travel-accounts-approvals",
        icon: ClipboardCheck,
        requiredPermission: "travel:finance_review",
      },
    ],
  },
  {
    label: "Employees",
    items: [
      {
        title: "Employee Directory",
        url: "/staff/employees",
        keywords: "employee colleague directory contact email phone staff profile",
        icon: Contact,
        requiredPermission: "employee:view_directory",
      },
      {
        title: "Organisation Chart",
        url: "/staff/org-chart",
        icon: Network,
        requiredPermission: "employee:view_directory",
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
    label: "Time & Leave",
    items: [
      {
        title: "Leave Management",
        url: "/staff/leave-admin",
        keywords: "annual sick leave balances entitlement calendar adjustments",
        icon: CalendarClock,
        requiredPermission: "leave:admin_all",
      },
      {
        title: "Attendance & Visits",
        url: "/staff/attendance",
        keywords: "biometric fingerprint clock terminal site visit working hours",
        icon: Clock,
        requiredPermission: "attendance:manage_all",
      },
      {
        title: "Employee Timesheets",
        url: "/staff/timesheet-monitoring",
        icon: ClipboardCheck,
        requiredPermission: "timesheet:finance_view",
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
        keywords: "talent pool cv applicant",
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
        keywords: "referral recommend",
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
    label: "Performance & Training",
    items: [
      {
        title: "Team Performance",
        url: "/staff/performance/team",
        icon: Users,
        requiredPermission: "performance:view_direct_reports",
      },
      {
        title: "Performance Cycles",
        url: "/staff/performance/cycles",
        keywords: "objectives appraisal review",
        icon: ClipboardCheck,
        requiredPermission: "performance:manage_all",
      },
      {
        title: "Training Records",
        url: "/staff/training",
        keywords: "certification learning courses",
        icon: GraduationCap,
        requiredAnyPermission: ["training:manage_all", "training:view_direct_reports"],
      },
    ],
  },
  {
    label: "Documents",
    items: [
      {
        title: "Employee Documents",
        url: "/staff/files",
        keywords:
          "employee record staff file visa permit passport insurance payslip documents history",
        icon: FolderOpen,
        requiredPermission: "employee:view_all",
      },
      {
        title: "Document Expiry",
        url: "/staff/document-expiry",
        keywords: "visa work permit passport insurance registration renewal expiry",
        icon: FileBadge,
        requiredPermission: "employee:manage_all",
      },
      {
        title: "Policies & Documents",
        url: "/staff/company-library",
        keywords: "sop policies company documents registration insurance benefits handbook",
        icon: CalendarDays,
        requiredPermission: "document:view_self",
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        title: "Payroll Inputs",
        url: "/staff/payroll/periods",
        keywords: "payroll salary wages finance payslip",
        icon: Calculator,
        requiredPermission: "payroll:view",
      },
      {
        title: "Overtime Ledger",
        url: "/staff/payroll/overtime",
        icon: Calculator,
        requiredPermission: "payroll:view",
      },
      {
        title: "Reimbursement Settlement",
        url: "/staff/travel-closures",
        icon: ClipboardCheck,
        requiredPermission: "travel:final_close",
      },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        title: "Reports",
        url: "/staff/reports",
        icon: BarChart,
        // HR/Super Admin via full audit access; Accounts via their payroll-scoped
        // subset of the Reports Centre (see ReportService.getScopedEmployees).
        requiredAnyPermission: ["system:audit_view", "payroll:view"],
      },
    ],
  },
  {
    label: "HR Settings",
    items: [
      {
        title: "Document Requirements",
        url: "/staff/settings?section=documentRequirements",
        keywords: "documents education degree passport CV certificates required uploads",
        icon: Settings,
        requiredRoles: ["HR", "Super Admin"],
      },
      {
        title: "Company Setup",
        url: "/staff/settings",
        keywords: "department position employment type location working week company setup",
        icon: Settings,
        requiredRoles: ["HR", "Super Admin"],
      },
      {
        title: "Reminder Settings",
        url: "/staff/settings?section=reminders",
        keywords: "notifications email timing reminders travel training leave",
        icon: CalendarClock,
        requiredRoles: ["HR", "Super Admin"],
      },
      {
        title: "Leave Policies",
        url: "/staff/leave-policies",
        keywords: "leave rules eligibility entitlement",
        icon: CalendarClock,
        requiredPermission: "leave:admin_all",
      },
      {
        title: "Timesheet Settings",
        url: "/staff/timesheet-settings",
        icon: CalendarClock,
        requiredAnyPermission: ["timesheet:admin_all", "system:settings_manage"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Users & Access",
        url: "/staff/users",
        icon: Users,
        requiredPermission: "system:users_manage",
      },
      {
        title: "Audit History",
        url: "/staff/audit",
        icon: Shield,
        requiredRoles: ["Super Admin"],
      },
    ],
  },
  {
    label: "Support",
    items: [
      {
        title: "Help & Knowledge",
        url: "/staff/help",
        icon: BookOpen,
        keywords: "help guide knowledge support how instructions documentation",
      },
    ],
  },
];

/** Filter before searching. Navigation never grants access to a destination. */
export function staffNavigation(role: Role, can: (permission: Permission) => boolean): NavGroup[] {
  const groups = navigation.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.requiredRoles || item.requiredRoles.includes(role)) &&
        (item.requiredAnyPermission
          ? item.requiredAnyPermission.some(can)
          : !item.requiredPermission || can(item.requiredPermission)),
    ),
  }));
  const available = groups.flatMap((group) => group.items);
  const pick = (url: string, title?: string, keywords?: string): NavItem[] => {
    const item = available.find((item) => item.url === url);
    return item
      ? [
          {
            ...item,
            ...(title ? { title } : {}),
            keywords: [item.keywords, keywords].filter(Boolean).join(" "),
          },
        ]
      : [];
  };
  const personalDetails = pick(
    "/staff/me/profile",
    "My Profile",
    "passport visa insurance card education certificate documents upload photo dependants family emergency contacts",
  );
  if (personalDetails[0])
    personalDetails[0].shortcuts = [
      {
        title: "My documents",
        url: "/staff/me/profile#section=documents",
        keywords:
          "upload passport visa insurance card education degree certificate missing document",
      },
      {
        title: "Family & dependants",
        url: "/staff/me/profile#section=dependants",
        keywords: "wife husband children family dependants",
      },
      { title: "Emergency contacts", url: "/staff/me/profile#section=emergency_contacts" },
      {
        title: "Personal details",
        url: "/staff/me/profile#section=personal",
        keywords: "address phone profile photo",
      },
      {
        title: "My equipment",
        url: "/staff/me/profile#section=equipment",
        keywords: "laptop assets assigned equipment",
      },
    ];
  const attendance = pick(
    "/staff/me/attendance",
    "My Attendance",
    "clock in out hours correction visits site ministry",
  );
  if (attendance[0])
    attendance[0].shortcuts = pick(
      "/staff/me/attendance?action=site-visit",
      "Quick visit",
      "site ministry visit official duty",
    );
  const personal: NavGroup[] = [
    {
      label: "My Work",
      items: [
        ...pick(
          "/staff/me/leave-balances",
          "My Leave",
          "apply request leave annual sick balance holiday",
        ),
        ...pick("/staff/timesheets", "My Timesheets", "submit record hours timesheet").map(
          (item) => ({
            ...item,
            url: "/staff/me/timesheets",
            shortcuts: [{ title: "My Timesheets", url: "/staff/timesheets" }],
          }),
        ),
        ...attendance,
        ...pick("/staff/time-away", "Time Away", "absence hospital appointment"),
        ...pick("/staff/me/overtime", "My Overtime", "apply request overtime"),
        ...pick("/staff/travel", "My Travel", "trip request car flight hotel receipts expenses"),
      ],
    },
    {
      label: "My Details",
      items: [
        ...personalDetails,
        ...pick("/staff/payslips"),
        ...pick("/staff/me/onboarding", "My Setup", "joining onboarding checklist"),
      ],
    },
    {
      label: "My Development",
      items: [
        ...pick(
          "/staff/me/performance",
          "My Objectives & Appraisal",
          "goals objectives performance review",
        ),
        ...pick("/staff/me/training", "My Training", "course learning certificate"),
        ...(role === "Employee"
          ? pick("/staff/interviews", "My Interviews", "assigned panel interview scorecard")
          : []),
      ],
    },
  ];
  const hr = role === "HR" || role === "Super Admin";
  const approvals = available.filter(
    (item) => groupForUrl(groups, item.url) === "Approvals" && item.url !== "/staff/requests",
  );
  const inbox: NavItem = {
    title: "Approvals",
    url: "/staff/requests",
    icon: ClipboardCheck,
    keywords:
      "approve approval pending waiting request decision leave timesheet attendance overtime travel training documents objective profile offers",
    shortcuts: [
      {
        title: "Waiting for my approval",
        url: "/staff/requests?view=approvals",
        keywords: "approve timesheet HR timesheets approvals leave documents training",
      },
      ...(hr
        ? [
            {
              title: "All employee requests",
              url: "/staff/requests?view=organisation",
              keywords: "organisation tracker request status progress",
            },
          ]
        : []),
      ...approvals,
      ...(!can("recruitment:manage_candidates")
        ? [{ title: "Assigned offer approvals", url: "/staff/offers", keywords: "offer approve" }]
        : []),
    ],
  };
  const companySetup = available.find((item) => item.url === "/staff/settings");
  if (companySetup) {
    const sections =
      role === "HR"
        ? HR_SETUP_SECTIONS
        : [...HR_SETUP_SECTIONS, "numbering", "costCentres", "activityCodes", "currencies", "data"];
    const labels: Record<string, string> = {
      org: "Company information",
      departments: "Departments",
      positions: "Positions",
      locations: "Work locations",
      employmentTypes: "Employment types",
      workingTimes: "Working hours",
      publicHolidays: "Public holidays",
      projects: "Projects",
      grades: "Grades",
      connections: "Email & Calendar",
      interviewTemplates: "Interview scorecards",
      onboardingTemplates: "New employee checklists",
      offboardingTemplates: "Leaving employee checklists",
      performanceTemplates: "Appraisal templates",
      numbering: "Employee numbering",
      costCentres: "Cost centres",
      activityCodes: "Activity codes",
      currencies: "Currencies",
      data: "Backups & recovery",
    };
    companySetup.shortcuts = sections
      .filter((section) => labels[section])
      .map((section) => ({
        title: labels[section]!,
        url: `/staff/settings?section=${section}`,
        keywords: `add edit setup configuration ${section === "connections" ? "Google Meet interview email calendar connection" : ""}`,
      }));
  }
  const business = groups
    .filter((group) => !["Home", "My Workspace", "Approvals", "Support"].includes(group.label))
    .map((group) => ({
      ...group,
      label: group.label === "HR Settings" ? "Settings" : group.label,
      items: group.items.map((item) => ({
        ...item,
        title:
          item.url === "/staff/employees" && hr
            ? "Manage Employees"
            : item.url === "/staff/vacancies"
              ? "Job Vacancies"
              : item.url === "/staff/candidates/intake"
                ? "CV Uploads & Mailboxes"
                : item.url === "/staff/performance/cycles"
                  ? "Appraisal Periods"
                  : item.url === "/staff/training"
                    ? "Training"
                    : item.url === "/staff/onboarding"
                      ? "New Employees"
                      : item.url === "/staff/offboarding"
                        ? "Leaving Employees"
                        : item.title,
      })),
    }));
  if (hr) {
    business
      .find((group) => group.label === "Time & Leave")
      ?.items.push(...pick("/staff/time-away", "Time Away", "absence hospital appointment team"));
    const employees = business
      .find((group) => group.label === "Employees")
      ?.items.find((item) => item.url === "/staff/employees");
    if (employees) employees.keywords += " equipment assets employee records former archive";
    const jobs = business
      .find((group) => group.label === "Recruitment")
      ?.items.find((item) => item.url === "/staff/vacancies");
    if (jobs)
      jobs.shortcuts = [
        {
          title: "Add job",
          url: "/staff/vacancies/new",
          keywords: "new create vacancy publish career portal job description",
        },
      ];
    if (role === "HR") {
      const settings = business.find((group) => group.label === "Settings");
      const administration = business.find((group) => group.label === "Administration");
      if (settings && administration) {
        settings.items.push(...administration.items);
        administration.items = [];
      }
    }
  }
  const home: NavGroup = {
    label: "Home",
    items: [
      ...pick("/staff"),
      { ...pick("/staff/my-tasks")[0]!, title: hr ? "Tasks & Reminders" : "My Tasks" },
      ...(role === "Employee"
        ? [
            {
              title: "My Requests",
              url: "/staff/requests",
              icon: ClipboardCheck,
              keywords: "pending requests approval waiting status progress history",
              shortcuts: [
                {
                  title: "Waiting for my approval",
                  url: "/staff/requests?view=approvals",
                  keywords: "assigned reviews approval",
                },
                {
                  title: "Assigned offer approvals",
                  url: "/staff/offers",
                  keywords: "assigned offer approve",
                },
              ],
            },
          ]
        : [inbox]),
    ],
  };
  const result = hr
    ? [home, ...business]
    : role === "Employee"
      ? [
          home,
          ...personal,
          {
            label: "Company",
            items: [
              ...pick("/staff/employees", "Colleague Directory"),
              ...pick("/staff/org-chart"),
              ...pick(
                "/staff/company-library",
                "Policies & Insurance",
                "sop handbook benefits insurance company documents",
              ),
              ...pick(
                "/staff/opportunities",
                "Job Opportunities",
                "career vacancies apply recommend referral",
              ),
            ],
          },
        ]
      : [home, ...personal, ...business];
  return [...result, ...groups.filter((group) => group.label === "Support")]
    .filter((group) => group.items.length)
    .map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.url === "/staff/travel" && ["Travel Admin", "Accounts"].includes(role)
          ? {
              ...item,
              title: "Travel & bookings",
              keywords: "booking desk car flight hotel travel",
            }
          : item,
      ),
    }));
}

function groupForUrl(groups: NavGroup[], url: string) {
  return groups.find((group) => group.items.some((item) => item.url === url))?.label;
}

export function searchNavigation(groups: NavGroup[], query: string): NavGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (!words.length) return [item];
        const matches = (title: string, keywords = "") =>
          words.every((word) =>
            [group.label, title, keywords].join(" ").toLowerCase().includes(word),
          );
        const shortcuts = (item.shortcuts ?? [])
          .filter((shortcut) => matches(shortcut.title, shortcut.keywords))
          .map((shortcut) => ({ ...item, ...shortcut, shortcuts: undefined }));
        return shortcuts.length ? shortcuts : matches(item.title, item.keywords) ? [item] : [];
      }),
    }))
    .filter((group) => group.items.length);
}

/** Longest path wins; explicit query actions beat their parent page. */
export function activeNavigationUrl(groups: NavGroup[], href: string): string | undefined {
  const location = new URL(href, "https://navigation.local");
  const matches = (url: string, allowDescendant: boolean) => {
    const target = new URL(url, location.origin);
    return (
      (location.pathname === target.pathname ||
        (allowDescendant &&
          target.pathname !== "/staff" &&
          location.pathname.startsWith(target.pathname + "/"))) &&
      [...target.searchParams].every(([key, value]) => location.searchParams.get(key) === value)
    );
  };
  return groups
    .flatMap((group) => group.items)
    .map((item) => {
      const destinations = [
        ...(matches(item.url, true) ? [item.url] : []),
        ...(item.shortcuts ?? [])
          .filter((shortcut) => matches(shortcut.url, false))
          .map((shortcut) => shortcut.url),
      ];
      return { item, specificity: Math.max(0, ...destinations.map((url) => url.length)) };
    })
    .filter((match) => match.specificity > 0)
    .sort((a, b) => b.specificity - a.specificity)[0]?.item.url;
}
