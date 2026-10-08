import type { Role } from "../data/types.ts";
import type { MasterDataCollection } from "../data/master-data.ts";

export const HR_MASTER_COLLECTIONS: readonly MasterDataCollection[] = [
  "departments",
  "positions",
  "locations",
  "grades",
  "employmentTypes",
  "workingTimes",
  "publicHolidays",
];
export const HR_SETUP_SECTIONS = [
  "org",
  "departments",
  "positions",
  "locations",
  "grades",
  "employmentTypes",
  "workingTimes",
  "publicHolidays",
  "projects",
  "documentRequirements",
  "reminders",
  "leavePolicies",
  "connections",
  "interviewTemplates",
  "onboardingTemplates",
  "offboardingTemplates",
  "performanceTemplates",
] as const;
export const HR_COMPANY_SETTINGS_KEYS = [
  "organisationName",
  "timezone",
  "workingDays",
  "standardDailyHours",
  "standardWeeklyHours",
  "probationDurationMonths",
  "leaveYearStart",
  "leaveYearEnd",
  "documentReminderDays",
  "leaveIncludesWeekends",
  "requireOnboardingCompletionBeforeDashboard",
] as const;

export function canManageMasterCollection(
  roles: readonly Role[],
  collection: MasterDataCollection,
) {
  return (
    roles.includes("Super Admin") ||
    (roles.includes("HR") && HR_MASTER_COLLECTIONS.includes(collection))
  );
}
export function canManageProjects(roles: readonly Role[]) {
  return roles.includes("HR") || roles.includes("Super Admin");
}
export function canViewCompanySetupSection(role: Role, section: string) {
  return (
    role === "Super Admin" ||
    (role === "HR" && (HR_SETUP_SECTIONS as readonly string[]).includes(section))
  );
}
export function canChangeCompanySettings(roles: readonly Role[], keys: readonly string[]) {
  return (
    roles.includes("Super Admin") ||
    (roles.includes("HR") &&
      keys.every((key) => (HR_COMPANY_SETTINGS_KEYS as readonly string[]).includes(key)))
  );
}
