import type { Employee } from "../data/types.ts";
import type { Candidate } from "../hr-data.ts";
import { can, type CurrentUserContext } from "./permissions.ts";

export const REDACTED_MASK = "••••••••";

/**
 * Returns a masked representation of sensitive string/number values.
 */
export function maskValue(
  value: string | number | undefined | null,
  maskChar = "•",
  length = 8,
): string {
  if (value === undefined || value === null || value === "") {
    return maskChar.repeat(length);
  }
  return maskChar.repeat(Math.max(6, String(value).length));
}

type EmployeeFieldAccess = "directory" | "personnel" | "supervision" | "payroll" | "performance";

// Classify every Employee field explicitly. New model fields require a deliberate access
// decision, and unexpected runtime fields are never copied into a browser response.
// The directory includes the common record/work fields required by the employee cache;
// confidential personnel, payroll and supervisory data are granted separately below.
const EMPLOYEE_FIELD_ACCESS = {
  id: "directory",
  databaseId: "directory",
  createdAt: "directory",
  createdBy: "directory",
  updatedAt: "directory",
  updatedBy: "directory",
  archivedAt: "directory",
  recordVersion: "directory",
  employeeNumber: "directory",
  legalName: "directory",
  preferredName: "directory",
  workEmail: "directory",
  phone: "directory",
  department: "directory",
  position: "directory",
  location: "directory",
  country: "directory",
  legalEntity: "directory",
  employmentType: "directory",
  startDate: "directory",
  lineManagerId: "directory",
  workspaceEmail: "directory",
  status: "directory",
  personalEmail: "personnel",
  address: "personnel",
  emergencyContacts: "personnel",
  dependants: "personnel",
  dateOfBirth: "personnel",
  gender: "personnel",
  nationality: "personnel",
  maritalStatus: "personnel",
  passportNumber: "personnel",
  nationalId: "personnel",
  staffEntryType: "personnel",
  visaRequired: "personnel",
  profileSetupStatus: "personnel",
  profileSetupCompletedAt: "personnel",
  employmentConfirmationStatus: "personnel",
  employmentConfirmedAt: "personnel",
  employmentConfirmedBy: "personnel",
  employmentReviewNote: "personnel",
  proposedEmploymentDetails: "personnel",
  proposedLineManagerEmail: "personnel",
  terminationReason: "personnel",
  candidateId: "personnel",
  offerId: "personnel",
  recommendationIds: "personnel",
  grade: "supervision",
  probationEndDate: "supervision",
  terminationDate: "supervision",
  weeklyHours: "supervision",
  projectId: "supervision",
  costCentreId: "supervision",
  salary: "payroll",
  bankDetails: "payroll",
  socialInsuranceNumber: "payroll",
  performanceRating: "performance",
  performanceNotes: "performance",
} satisfies Record<keyof Employee, EmployeeFieldAccess>;

/** Server and preview projection: only explicitly authorised field groups leave the HR file. */
export function redactEmployee(
  employee: Employee,
  userContext: CurrentUserContext | null | undefined,
): Employee {
  const isSelf = Boolean(userContext?.employeeId && userContext.employeeId === employee.id);
  const isSuperAdmin = userContext?.activeRole === "Super Admin";
  const isDirectReport =
    can("employee:view_direct_reports", userContext) &&
    userContext?.employeeId &&
    employee.lineManagerId === userContext.employeeId;
  const isAccounts = userContext?.activeRole === "Accounts" || can("payroll:view", userContext);
  const isHR = userContext?.activeRole === "HR" || can("employee:manage_all", userContext);
  const allowed = new Set<EmployeeFieldAccess>(["directory"]);
  if (isSelf || isHR || isSuperAdmin) allowed.add("personnel");
  if (isSelf || isHR || isAccounts || isDirectReport || isSuperAdmin) allowed.add("supervision");
  if (isSelf || isAccounts || isSuperAdmin) allowed.add("payroll");
  if (isSelf || isHR || isDirectReport || isSuperAdmin) allowed.add("performance");

  const safe = Object.fromEntries(
    Object.entries(employee).filter(
      ([key]) =>
        Object.hasOwn(EMPLOYEE_FIELD_ACCESS, key) &&
        allowed.has(EMPLOYEE_FIELD_ACCESS[key as keyof Employee]),
    ),
  ) as unknown as Employee;
  if (!allowed.has("personnel")) {
    safe.emergencyContacts = [];
    safe.dependants = [];
  }
  if (!userContext) delete safe.phone;

  return safe;
}

/**
 * Applies field-level redaction on a Candidate record.
 * Specifically:
 * - privateNotes are redacted for all roles EXCEPT HR and Super Admin.
 * - salaryExpectation is redacted for roles without recruitment/payroll permission.
 */
export function redactCandidate(
  candidate: Candidate,
  userContext: CurrentUserContext | null | undefined,
): Candidate {
  const { privateNotes, salaryExpectation, ...safeCandidate } = candidate;
  if (!userContext) {
    return safeCandidate;
  }

  const canSeePrivateNotes = can("recruitment:view_notes_private", userContext);
  const canSeeSalary =
    can("recruitment:manage_candidates", userContext) ||
    can("payroll:view", userContext) ||
    userContext.activeRole === "Super Admin";

  return {
    ...safeCandidate,
    ...(canSeePrivateNotes && privateNotes !== undefined ? { privateNotes } : {}),
    ...(canSeeSalary && salaryExpectation !== undefined ? { salaryExpectation } : {}),
  };
}

/**
 * Checks if a specific field category is permitted for viewing.
 */
export type SensitiveFieldCategory =
  "salary" | "bank" | "passport" | "performance" | "recruitment_notes" | "payroll";

export function canViewSensitiveField(
  category: SensitiveFieldCategory,
  targetEmployee: Employee | null | undefined,
  userContext: CurrentUserContext | null | undefined,
): boolean {
  if (!userContext) return false;
  if (userContext.activeRole === "Super Admin") return true;

  const isSelf =
    targetEmployee && userContext.employeeId && targetEmployee.id === userContext.employeeId;

  switch (category) {
    case "salary":
      return Boolean(
        isSelf || userContext.activeRole === "Accounts" || can("payroll:view", userContext),
      );
    case "bank":
      return Boolean(
        isSelf || userContext.activeRole === "Accounts" || can("payroll:view", userContext),
      );
    case "passport":
      return Boolean(
        isSelf || userContext.activeRole === "HR" || can("employee:manage_all", userContext),
      );
    case "performance": {
      const isDirectReport =
        targetEmployee &&
        can("employee:view_direct_reports", userContext) &&
        userContext.employeeId &&
        targetEmployee.lineManagerId === userContext.employeeId;
      return Boolean(
        isSelf ||
        isDirectReport ||
        userContext.activeRole === "HR" ||
        can("performance:manage_all", userContext),
      );
    }
    case "recruitment_notes":
      return can("recruitment:view_notes_private", userContext);
    case "payroll":
      return can("payroll:view", userContext);
    default:
      return false;
  }
}

/**
 * Redacts a single sensitive field's value for bulk/export contexts (e.g. a directory CSV
 * export), gated by the same canViewSensitiveField(category, ...) rule the rest of the app
 * already uses to decide whether this viewer may see this field. Evaluated per-record rather
 * than once for the whole export, since "self" visibility varies row to row across a listing.
 *
 * Returns the raw value when the viewer is permitted to see it, a masked placeholder (via
 * maskValue) when the field has a value but is hidden by permission, and an empty string when
 * there is nothing to show either way.
 */
export function redactSensitiveExportField(
  value: string | number | undefined | null,
  category: SensitiveFieldCategory,
  targetEmployee: Employee | null | undefined,
  userContext: CurrentUserContext | null | undefined,
): string {
  if (value === undefined || value === null || value === "") return "";
  return canViewSensitiveField(category, targetEmployee, userContext)
    ? String(value)
    : maskValue(value);
}
