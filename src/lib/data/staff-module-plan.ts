import type { Role } from "./types.ts";

export type StaffModule =
  | "lifecycle"
  | "leave"
  | "timesheets"
  | "attendance"
  | "overtime"
  | "travel"
  | "performance"
  | "training"
  | "payroll"
  | "vacancies"
  | "recruitment"
  | "documents";

/** Only compatibility-cache consumers belong here. Server-query pages load their own data. */
export function staffPageModules(
  pathname: string,
  hash: string,
  section: string,
  role: Role,
): StaffModule[] {
  const path = pathname.replace(/\/$/, "");
  const hr = role === "HR" || role === "Super Admin";
  // Let existing permission boundaries render access-denied screens without first calling
  // a privileged data endpoint. Assigned offer reviews and panel interviews query their own scope.
  if (/^\/staff\/payroll(\/|$)/.test(path) && role !== "Accounts" && role !== "Super Admin")
    return [];
  if (!hr && /^\/staff\/(candidates|recommendations|offers|interviews)(\/|$)/.test(path)) return [];
  if (!hr && role !== "Line Manager" && /^\/staff\/vacancies(\/|$)/.test(path)) return [];
  if (path === "/staff") return []; // Dashboard charts and details load independently.
  if (path === "/staff/settings") {
    if (section === "leavePolicies") return ["leave"];
    if (section === "onboardingTemplates" || section === "offboardingTemplates")
      return ["lifecycle"];
    if (section === "performanceTemplates") return ["performance"];
    if (section === "interviewTemplates") return ["recruitment"];
    return [];
  }
  if (path === "/staff/employees/new" || path === "/staff/employees/import") return ["lifecycle"];
  if (path === "/staff/me/profile" || /^\/staff\/employees\/(?!new$|import$)[^/]+$/.test(path)) {
    const tab = hash.replace(/^#/, "") || "overview";
    if (tab === "leave") return ["leave"];
    if (tab === "timesheets") return ["timesheets", "leave"];
    if (tab === "attendance") return ["attendance", "overtime"];
    if (tab === "travel") return ["travel"];
    if (tab === "performance") return ["performance"];
    if (tab === "training") return ["training"];
    if (tab === "onboarding") return ["lifecycle"];
    if (
      [
        "employment",
        "personal",
        "emergency_contacts",
        "dependants",
        "documents",
        "equipment",
        "activity",
        "payroll",
        "audit",
      ].includes(tab)
    )
      return [];
    // Unknown sections fall back to overview in EmployeeProfileView too.
    return ["documents", "timesheets", "lifecycle", ...(hr ? ["recruitment" as const] : [])];
  }
  if (/^\/staff\/(me\/)?leave(?:-|\/|$)/.test(path)) return ["leave"];
  if (/^\/staff\/(me\/)?timesheet/.test(path)) return ["timesheets", "leave"];
  if (/^\/staff\/(me\/)?overtime/.test(path)) return ["overtime", "timesheets"];
  if (/^\/staff\/travel/.test(path)) return ["travel"];
  if (/^\/staff\/(me\/)?performance/.test(path)) return ["performance"];
  if (/^\/staff\/(me\/)?training/.test(path)) return ["training"];
  if (/^\/staff\/(onboarding|offboarding|me\/onboarding)(\/|$)/.test(path))
    return ["lifecycle", "documents"];
  if (path === "/staff/payroll/overtime") return ["overtime", "payroll"];
  if (/^\/staff\/payroll(\/|$)/.test(path)) return ["payroll", "timesheets", "overtime", "travel"];
  if (path === "/staff/vacancies" || path === "/staff/vacancies/new") return ["vacancies"];
  if (/^\/staff\/(vacancies|candidates|offers|interviews|recommendations)(\/|$)/.test(path))
    return ["recruitment"];
  return [];
}

export const DASHBOARD_MODULES = {
  employee: [
    "leave",
    "timesheets",
    "documents",
    "lifecycle",
    "performance",
    "travel",
    "attendance",
    "overtime",
    "training",
  ],
  hr: ["documents", "lifecycle", "leave", "timesheets", "travel", "recruitment"],
  manager: ["leave", "timesheets", "lifecycle", "performance", "attendance", "overtime"],
  accounts: ["travel", "payroll", "timesheets", "overtime"],
} satisfies Record<string, StaffModule[]>;

export const STAFF_MODULE_DEPENDENCIES: Partial<Record<StaffModule, StaffModule[]>> = {
  recruitment: ["vacancies"],
};
