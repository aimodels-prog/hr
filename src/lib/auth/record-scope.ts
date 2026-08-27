import type { Employee, EmployeeDocument } from "../data/types.ts";
import type { Candidate } from "../hr-data.ts";
import { can, type CurrentUserContext } from "./permissions.ts";

/**
 * Returns the subset of employees accessible to the current user context
 * based on role record-scoping rules:
 * - Super Admin / HR: all employees
 * - Line Manager: self + direct reports
 * - Employee: self only
 * - Accounts: self only (for employee records; payroll scoping is separate)
 */
export function getScopedEmployees(
  employees: Employee[],
  userContext: CurrentUserContext | null | undefined,
): Employee[] {
  if (!userContext) return [];

  // Super Admin and HR see all internal employee records.
  // Accounts' payroll:view permission grants payroll-data access separately - it must not
  // widen this employee-directory scope, or Accounts would see every employee's directory record.
  if (can("employee:view_all", userContext)) {
    return employees;
  }

  // Line Manager sees self + direct reports
  if (can("employee:view_direct_reports", userContext) && userContext.employeeId) {
    return employees.filter(
      (emp) => emp.id === userContext.employeeId || emp.lineManagerId === userContext.employeeId,
    );
  }

  // Employee (and Accounts acting as employee) sees self only
  if (userContext.employeeId) {
    return employees.filter((emp) => emp.id === userContext.employeeId);
  }

  return [];
}

/**
 * Checks whether a specific employee record is accessible by the current user.
 */
export function isEmployeeInScope(
  targetEmployee: Employee | null | undefined,
  userContext: CurrentUserContext | null | undefined,
): boolean {
  if (!targetEmployee || !userContext) return false;

  if (can("employee:view_all", userContext)) {
    return true;
  }

  if (userContext.employeeId && targetEmployee.id === userContext.employeeId) {
    return true;
  }

  if (
    can("employee:view_direct_reports", userContext) &&
    userContext.employeeId &&
    targetEmployee.lineManagerId === userContext.employeeId
  ) {
    return true;
  }

  return false;
}

/**
 * Returns only the direct reports for a given manager employee ID.
 */
export function getScopedDirectReports(
  employees: Employee[],
  managerEmployeeId: string | undefined,
): Employee[] {
  if (!managerEmployeeId) return [];
  return employees.filter((emp) => emp.lineManagerId === managerEmployeeId);
}

// Matches the manager-loop circuit breaker already used in employee-service.ts's
// validateHierarchy - a defensive bound, not an expected depth.
const MAX_ANCESTOR_HOPS = 100;

/**
 * Everyone getScopedEmployees would return, plus every ancestor in each of their management
 * chains up to the top of the company. A Line Manager or Employee only ever sees their own
 * vertical slice this way - never a colleague's unrelated branch - which mirrors the
 * single-manager lookup every profile page already allows (looking up your own manager's
 * name), just carried all the way up. Used to render a reporting-line tree (org chart) that
 * still makes sense for a narrowly-scoped viewer instead of showing disconnected fragments.
 */
export function getScopedEmployeesWithAncestors(
  employees: Employee[],
  userContext: CurrentUserContext | null | undefined,
): Employee[] {
  const scoped = getScopedEmployees(employees, userContext);
  const allById = new Map(employees.map((e) => [e.id, e]));
  const visible = new Map<string, Employee>();

  for (const employee of scoped) {
    let current: Employee | undefined = employee;
    let hops = 0;
    while (current && !visible.has(current.id) && hops < MAX_ANCESTOR_HOPS) {
      visible.set(current.id, current);
      current = current.lineManagerId ? allById.get(current.lineManagerId) : undefined;
      hops += 1;
    }
  }

  return [...visible.values()];
}

/**
 * Returns the subset of employee documents accessible to the current user context,
 * scoped to the same employees getScopedEmployees would return (self / direct reports /
 * everyone, depending on role) rather than every document in storage.
 */
export function getScopedDocuments(
  documents: EmployeeDocument[],
  employees: Employee[],
  userContext: CurrentUserContext | null | undefined,
): EmployeeDocument[] {
  const scopedEmployeeIds = new Set(getScopedEmployees(employees, userContext).map((e) => e.id));
  return documents.filter((doc) => scopedEmployeeIds.has(doc.employeeId));
}

/**
 * Returns candidate records scoped by recruitment permissions.
 * HR and Super Admin see all candidates.
 * Other roles without candidate view permissions see an empty list.
 */
export function getScopedCandidates(
  candidates: Candidate[],
  userContext: CurrentUserContext | null | undefined,
): Candidate[] {
  if (!userContext) return [];

  if (can("recruitment:view_candidates", userContext)) {
    return candidates;
  }

  // Line manager can see interview candidates if they have recruitment:view_interviews
  if (can("recruitment:view_interviews", userContext)) {
    return candidates.filter((c) => c.stage === "Interview" || Boolean(c.interview));
  }

  return [];
}

/**
 * Checks if a candidate is accessible for the current user context.
 */
export function isCandidateInScope(
  candidate: Candidate | null | undefined,
  userContext: CurrentUserContext | null | undefined,
): boolean {
  if (!candidate || !userContext) return false;

  if (can("recruitment:view_candidates", userContext)) {
    return true;
  }

  if (
    can("recruitment:view_interviews", userContext) &&
    (candidate.stage === "Interview" || Boolean(candidate.interview))
  ) {
    return true;
  }

  return false;
}
