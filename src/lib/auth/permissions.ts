import type { Employee, RecordId, Role } from "../data/types.ts";

export const ALL_PERMISSIONS = [
  // Employee profile & directory
  "employee:view_self",
  "employee:edit_self",
  "employee:view_directory",
  "employee:view_direct_reports",
  "employee:view_all",
  "employee:manage_all",

  // Recruitment
  "recruitment:view_vacancies",
  "recruitment:manage_vacancies",
  "recruitment:view_candidates",
  "recruitment:manage_candidates",
  "recruitment:view_interviews",
  "recruitment:manage_interviews",
  "recruitment:score_interviews_assigned",
  "recruitment:view_notes_private",

  // Leave
  "leave:view_self",
  "leave:request_self",
  "leave:approve_direct_reports",
  "leave:admin_all",
  "leave:final_approve",

  // Timesheets & Attendance
  "timesheet:view_self",
  "timesheet:submit_self",
  "timesheet:approve_direct_reports",
  "timesheet:admin_all",
  "timesheet:finance_view",
  "overtime:approve_direct_reports",
  "overtime:admin_all",
  "attendance:view_self",
  "attendance:clock_self",
  "attendance:request_correction_self",
  "attendance:approve_direct_reports",
  "attendance:site_visit_request_self",
  "attendance:site_visit_approve",
  "attendance:manage_all",

  // Travel & Reimbursements
  "travel:request_self",
  "travel:approve_direct_reports",
  "travel:hr_review",
  "travel:finance_review",
  "travel:final_close",

  // Payroll
  "payroll:view",
  "payroll:prepare",
  "payroll:export",
  "payroll:lock",

  // Documents & Onboarding & Offboarding
  "document:view_self",
  "document:view_direct_reports",
  "document:view_all",
  "document:manage_all",
  "onboarding:view_self",
  "onboarding:manage_all",
  "offboarding:manage_all",

  // Performance & Training
  "performance:view_self",
  "performance:view_direct_reports",
  "performance:manage_all",
  "training:view_all",
  "training:manage_all",

  // System, Master Data & Audit
  "system:settings_manage",
  "system:users_manage",
  "system:audit_view",
  "system:backup_manage",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  Employee: [
    "employee:view_self",
    "employee:edit_self",
    "employee:view_directory",
    "leave:view_self",
    "leave:request_self",
    "timesheet:view_self",
    "timesheet:submit_self",
    "attendance:view_self",
    "attendance:clock_self",
    "attendance:request_correction_self",
    "attendance:site_visit_request_self",
    "travel:request_self",
    "document:view_self",
    "onboarding:view_self",
    "performance:view_self",
    "training:view_all",
    "recruitment:score_interviews_assigned",
  ],

  // "IT" is not defined in PRODUCT_IMPLEMENTATION_PLAN.md's role list yet - until it is,
  // grant the same self-service baseline as Employee rather than assuming elevated access.
  IT: [
    "employee:view_self",
    "employee:edit_self",
    "employee:view_directory",
    "leave:view_self",
    "leave:request_self",
    "timesheet:view_self",
    "timesheet:submit_self",
    "attendance:view_self",
    "attendance:clock_self",
    "attendance:request_correction_self",
    "attendance:site_visit_request_self",
    "travel:request_self",
    "document:view_self",
    "onboarding:view_self",
    "performance:view_self",
    "training:view_all",
    "recruitment:score_interviews_assigned",
  ],

  "Line Manager": [
    "employee:view_self",
    "employee:edit_self",
    "employee:view_directory",
    "employee:view_direct_reports",
    "recruitment:view_vacancies",
    "recruitment:view_interviews",
    "leave:view_self",
    "leave:request_self",
    "leave:approve_direct_reports",
    "timesheet:view_self",
    "timesheet:submit_self",
    "timesheet:approve_direct_reports",
    "overtime:approve_direct_reports",
    "attendance:view_self",
    "attendance:clock_self",
    "attendance:request_correction_self",
    "attendance:approve_direct_reports",
    "attendance:site_visit_request_self",
    "travel:request_self",
    "travel:approve_direct_reports",
    "document:view_self",
    "document:view_direct_reports",
    "onboarding:view_self",
    "performance:view_self",
    "performance:view_direct_reports",
    "training:view_all",
    "recruitment:score_interviews_assigned",
  ],

  HR: [
    "employee:view_self",
    "employee:edit_self",
    "employee:view_directory",
    "employee:view_direct_reports",
    "employee:view_all",
    "employee:manage_all",
    "recruitment:view_vacancies",
    "recruitment:manage_vacancies",
    "recruitment:view_candidates",
    "recruitment:manage_candidates",
    "recruitment:view_interviews",
    "recruitment:manage_interviews",
    "recruitment:view_notes_private",
    "leave:view_self",
    "leave:request_self",
    "leave:approve_direct_reports",
    "leave:admin_all",
    "leave:final_approve",
    "timesheet:view_self",
    "timesheet:submit_self",
    "timesheet:approve_direct_reports",
    "timesheet:admin_all",
    "timesheet:finance_view",
    "overtime:approve_direct_reports",
    "overtime:admin_all",
    "attendance:view_self",
    "attendance:clock_self",
    "attendance:request_correction_self",
    "attendance:approve_direct_reports",
    "attendance:site_visit_request_self",
    "attendance:site_visit_approve",
    "attendance:manage_all",
    "travel:request_self",
    "travel:approve_direct_reports",
    "travel:hr_review",
    "document:view_self",
    "document:view_direct_reports",
    "document:view_all",
    "document:manage_all",
    "onboarding:view_self",
    "onboarding:manage_all",
    "offboarding:manage_all",
    "performance:view_self",
    "performance:view_direct_reports",
    "performance:manage_all",
    "training:view_all",
    "training:manage_all",
    "system:users_manage",
    "system:audit_view",
    "recruitment:score_interviews_assigned",
  ],

  Accounts: [
    "employee:view_self",
    "employee:edit_self",
    "employee:view_directory",
    "leave:view_self",
    "leave:request_self",
    "timesheet:view_self",
    "timesheet:submit_self",
    "timesheet:finance_view",
    "attendance:view_self",
    "attendance:clock_self",
    "attendance:request_correction_self",
    "attendance:site_visit_request_self",
    "travel:request_self",
    "travel:finance_review",
    "payroll:view",
    "payroll:prepare",
    "payroll:export",
    "payroll:lock",
    "document:view_self",
    "onboarding:view_self",
    "performance:view_self",
    "training:view_all",
    "recruitment:score_interviews_assigned",
  ],

  "Super Admin": ALL_PERMISSIONS,
};

export interface CurrentUserContext {
  userId: RecordId;
  employeeId?: RecordId | undefined;
  displayName: string;
  workspaceEmail: string;
  assignedRoles: Role[];
  activeRole: Role;
  permissions: ReadonlySet<Permission>;
  isDevelopmentPreview?: boolean | undefined;
}

export function getEffectivePermissions(roles: Role[]): Set<Permission> {
  const effective = new Set<Permission>();
  for (const role of roles) {
    const list = ROLE_PERMISSIONS[role];
    if (list) {
      for (const perm of list) {
        effective.add(perm);
      }
    }
  }
  return effective;
}

export function getRolePermissions(role: Role): Set<Permission> {
  const effective = new Set<Permission>();
  const list = ROLE_PERMISSIONS[role];
  if (list) {
    for (const perm of list) {
      effective.add(perm);
    }
  }
  return effective;
}

export function can(
  permission: Permission,
  context: CurrentUserContext | null | undefined,
): boolean {
  if (!context) return false;
  return context.permissions.has(permission);
}

export function canAny(
  permissions: Permission[],
  context: CurrentUserContext | null | undefined,
): boolean {
  if (!context) return false;
  return permissions.some((perm) => context.permissions.has(perm));
}

export function canAll(
  permissions: Permission[],
  context: CurrentUserContext | null | undefined,
): boolean {
  if (!context) return false;
  return permissions.every((perm) => context.permissions.has(perm));
}

export function canViewEmployee(
  targetEmployee: Employee | RecordId | null | undefined,
  context: CurrentUserContext | null | undefined,
  allEmployees?: Employee[],
): boolean {
  if (!context || !targetEmployee) return false;

  const targetId = typeof targetEmployee === "string" ? targetEmployee : targetEmployee.id;

  // Viewing self is always permitted for employees
  if (context.employeeId && context.employeeId === targetId) {
    return true;
  }

  // Super Admin and HR can view all employees
  if (context.permissions.has("employee:view_all")) {
    return true;
  }

  // Line Manager can view direct reports
  if (context.permissions.has("employee:view_direct_reports")) {
    if (typeof targetEmployee !== "string") {
      return targetEmployee.lineManagerId === context.employeeId;
    }
    if (allEmployees) {
      const match = allEmployees.find((e) => e.id === targetId);
      return match?.lineManagerId === context.employeeId;
    }
  }

  // Basic directory view allows public employee metadata only
  return context.permissions.has("employee:view_directory");
}

export function canManageCandidate(
  _candidateId: string | undefined,
  context: CurrentUserContext | null | undefined,
): boolean {
  if (!context) return false;
  return context.permissions.has("recruitment:manage_candidates");
}

export function canAccessPayroll(context: CurrentUserContext | null | undefined): boolean {
  if (!context) return false;
  return context.permissions.has("payroll:view") || context.permissions.has("payroll:prepare");
}

export function canViewAuditLog(context: CurrentUserContext | null | undefined): boolean {
  if (!context) return false;
  return context.permissions.has("system:audit_view");
}

export function canManageSettings(context: CurrentUserContext | null | undefined): boolean {
  if (!context) return false;
  return context.permissions.has("system:settings_manage");
}
