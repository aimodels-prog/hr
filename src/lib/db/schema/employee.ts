import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import {
  costCentres,
  departments,
  employmentTypes,
  grades,
  locations,
  positions,
  projects,
  workingTimes,
} from "./master-data.ts";
import { organisations } from "./organisation.ts";

export const employeeStatus = pgEnum("employee_status", [
  "Onboarding",
  "Active",
  "Probation",
  "Notice",
  "Inactive",
  "Archived",
]);

export const userStatus = pgEnum("user_status", ["Active", "Suspended", "Archived"]);

export const staffEntryType = pgEnum("staff_entry_type", ["New Employee", "Existing Employee"]);
export const profileSetupStatus = pgEnum("profile_setup_status", [
  "Not Started",
  "In Progress",
  "Completed",
]);
export const employmentConfirmationStatus = pgEnum("employment_confirmation_status", [
  "Not Submitted",
  "Pending HR Review",
  "Confirmed",
  "Changes Requested",
]);

export const systemRoleCode = pgEnum("system_role_code", [
  "Employee",
  "Line Manager",
  "HR",
  "Accounts",
  "Super Admin",
  "IT",
]);

export const employees = pgTable(
  "employees",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employeeNumber: text("employee_number").notNull(),
    legalName: text("legal_name").notNull(),
    preferredName: text("preferred_name").notNull(),
    workEmail: text("work_email").notNull(),
    personalEmail: text("personal_email"),
    phone: text("phone"),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict", onUpdate: "cascade" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "restrict", onUpdate: "cascade" }),
    gradeId: uuid("grade_id").references(() => grades.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employmentTypeId: uuid("employment_type_id")
      .notNull()
      .references(() => employmentTypes.id, { onDelete: "restrict", onUpdate: "cascade" }),
    workingTimeId: uuid("working_time_id").references(() => workingTimes.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    lineManagerId: uuid("line_manager_id").references((): AnyPgColumn => employees.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    costCentreId: uuid("cost_centre_id").references(() => costCentres.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    country: text("country"),
    legalEntity: text("legal_entity"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    probationEndDate: date("probation_end_date", { mode: "string" }),
    staffEntryType: staffEntryType("staff_entry_type"),
    profileSetupStatus: profileSetupStatus("profile_setup_status").notNull().default("Completed"),
    profileSetupCompletedAt: timestamp("profile_setup_completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    employmentConfirmationStatus: employmentConfirmationStatus("employment_confirmation_status")
      .notNull()
      .default("Confirmed"),
    employmentConfirmedAt: timestamp("employment_confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    // Kept as an audit UUID rather than a database foreign key because users already
    // has a required employee foreign key. Avoiding a circular schema dependency also
    // keeps generated query types strict and stable.
    employmentConfirmedBy: uuid("employment_confirmed_by"),
    employmentReviewNote: text("employment_review_note"),
    proposedEmploymentDetails: jsonb("proposed_employment_details").$type<{
      legalName: string;
      preferredName: string;
      staffEntryType: "New Employee" | "Existing Employee";
      startDate: string;
      departmentId: string;
      positionId: string;
      locationId: string;
      employmentTypeId: string;
      lineManagerId: string | null;
      lineManagerEmail: string;
    }>(),
    proposedLineManagerEmail: text("proposed_line_manager_email"),
    workspaceEmail: text("workspace_email"),
    candidateId: uuid("candidate_id"),
    offerId: uuid("offer_id"),
    status: employeeStatus("status").notNull().default("Onboarding"),
    address: text("address"),
    emergencyContacts: jsonb("emergency_contacts")
      .$type<Array<{ name: string; relationship: string; phone: string; email?: string }>>()
      .notNull()
      .default([]),
    dependants: jsonb("dependants")
      .$type<Array<{ name: string; relationship: string; dateOfBirth: string }>>()
      .notNull()
      .default([]),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    gender: text("gender"),
    nationality: text("nationality"),
    maritalStatus: text("marital_status"),
    terminationDate: date("termination_date", { mode: "string" }),
    terminationReason: text("termination_reason"),
    weeklyHours: numeric("weekly_hours", { precision: 6, scale: 2 }),
    performanceRating: numeric("performance_rating", { precision: 3, scale: 2 }),
    performanceNotes: text("performance_notes"),
  },
  (table) => [
    uniqueIndex("employees_number_unique").on(table.organisationId, table.employeeNumber),
    uniqueIndex("employees_work_email_unique").on(
      table.organisationId,
      sql`lower(${table.workEmail})`,
    ),
    uniqueIndex("employees_workspace_email_unique")
      .on(table.organisationId, sql`lower(${table.workspaceEmail})`)
      .where(sql`${table.workspaceEmail} IS NOT NULL`),
    index("employees_department_idx").on(table.organisationId, table.departmentId, table.status),
    index("employees_location_idx").on(table.organisationId, table.locationId, table.status),
    index("employees_position_idx").on(table.organisationId, table.positionId, table.status),
    index("employees_manager_idx").on(table.organisationId, table.lineManagerId, table.status),
    index("employees_project_idx").on(table.organisationId, table.projectId, table.status),
    index("employees_cost_centre_idx").on(table.organisationId, table.costCentreId, table.status),
    index("employees_start_date_idx").on(table.organisationId, table.startDate),
    check("employees_legal_name_not_blank", sql`btrim(${table.legalName}) <> ''`),
    check("employees_preferred_name_not_blank", sql`btrim(${table.preferredName}) <> ''`),
    check("employees_number_not_blank", sql`btrim(${table.employeeNumber}) <> ''`),
    check(
      "employees_work_email_normalized",
      sql`${table.workEmail} = lower(btrim(${table.workEmail}))`,
    ),
    check(
      "employees_workspace_email_normalized",
      sql`${table.workspaceEmail} IS NULL OR ${table.workspaceEmail} = lower(btrim(${table.workspaceEmail}))`,
    ),
    check(
      "employees_proposed_manager_email_normalized",
      sql`${table.proposedLineManagerEmail} IS NULL OR ${table.proposedLineManagerEmail} = lower(btrim(${table.proposedLineManagerEmail}))`,
    ),
    check(
      "employees_manager_not_self",
      sql`${table.lineManagerId} IS NULL OR ${table.lineManagerId} <> ${table.id}`,
    ),
    check(
      "employees_probation_date_order",
      sql`${table.probationEndDate} IS NULL OR ${table.probationEndDate} >= ${table.startDate}`,
    ),
    check(
      "employees_termination_consistency",
      sql`${table.terminationDate} IS NULL OR ${table.terminationDate} >= ${table.startDate}`,
    ),
    check(
      "employees_weekly_hours_range",
      sql`${table.weeklyHours} IS NULL OR (${table.weeklyHours} > 0 AND ${table.weeklyHours} <= 168)`,
    ),
    check(
      "employees_performance_rating_range",
      sql`${table.performanceRating} IS NULL OR (${table.performanceRating} >= 0 AND ${table.performanceRating} <= 5)`,
    ),
    check("employees_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    ...mutableRecordColumns,
    code: systemRoleCode("code").notNull(),
    description: text("description").notNull(),
    isAssignable: boolean("is_assignable").notNull().default(true),
    isProtected: boolean("is_protected").notNull().default(true),
  },
  (table) => [
    uniqueIndex("roles_code_unique").on(table.code),
    check("roles_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("roles_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const users = pgTable(
  "users",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict", onUpdate: "cascade" }),
    displayName: text("display_name").notNull(),
    workspaceEmail: text("workspace_email").notNull(),
    workspaceSubject: text("workspace_subject"),
    status: userStatus("status").notNull().default("Active"),
  },
  (table) => [
    uniqueIndex("users_employee_unique").on(table.employeeId),
    uniqueIndex("users_workspace_email_unique").on(
      table.organisationId,
      sql`lower(${table.workspaceEmail})`,
    ),
    uniqueIndex("users_workspace_subject_unique")
      .on(table.workspaceSubject)
      .where(sql`${table.workspaceSubject} IS NOT NULL`),
    index("users_status_idx").on(table.organisationId, table.status),
    check("users_display_name_not_blank", sql`btrim(${table.displayName}) <> ''`),
    check(
      "users_workspace_email_normalized",
      sql`${table.workspaceEmail} = lower(btrim(${table.workspaceEmail}))`,
    ),
    check("users_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict", onUpdate: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    assignedBy: uuid("assigned_by").notNull(),
    reason: text("reason").notNull().default("Initial employee access"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId], name: "user_roles_pk" }),
    index("user_roles_organisation_idx").on(table.organisationId),
    index("user_roles_role_idx").on(table.roleId),
    check("user_roles_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
  ],
);

export const employeeReportingLines = pgTable(
  "employee_reporting_lines",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict", onUpdate: "cascade" }),
    supervisorId: uuid("supervisor_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict", onUpdate: "cascade" }),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    isPrimary: boolean("is_primary").notNull().default(true),
    reason: text("reason").notNull(),
  },
  (table) => [
    uniqueIndex("employee_reporting_lines_current_primary_unique")
      .on(table.employeeId)
      .where(
        sql`${table.isPrimary} AND ${table.effectiveTo} IS NULL AND ${table.archivedAt} IS NULL`,
      ),
    index("employee_reporting_lines_supervisor_idx").on(
      table.organisationId,
      table.supervisorId,
      table.effectiveTo,
    ),
    index("employee_reporting_lines_employee_idx").on(
      table.organisationId,
      table.employeeId,
      table.effectiveFrom,
    ),
    check("employee_reporting_lines_not_self", sql`${table.employeeId} <> ${table.supervisorId}`),
    check(
      "employee_reporting_lines_date_order",
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
    check("employee_reporting_lines_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
    check("employee_reporting_lines_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

/** Ciphertext only. Plain identifiers must never be written to these columns. */
export const employeeSensitiveIdentifiers = pgTable(
  "employee_sensitive_identifiers",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade", onUpdate: "cascade" }),
    passportNumberEncrypted: text("passport_number_encrypted"),
    nationalIdEncrypted: text("national_id_encrypted"),
    socialInsuranceNumberEncrypted: text("social_insurance_number_encrypted"),
  },
  (table) => [
    uniqueIndex("employee_sensitive_identifiers_employee_unique").on(table.employeeId),
    index("employee_sensitive_identifiers_org_idx").on(table.organisationId),
    check(
      "employee_sensitive_identifiers_record_version_positive",
      sql`${table.recordVersion} >= 1`,
    ),
  ],
);

/** Salary is encrypted as one versioned JSON envelope for safe future expansion. */
export const employeeCompensation = pgTable(
  "employee_compensation",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade", onUpdate: "cascade" }),
    encryptedPayload: text("encrypted_payload").notNull(),
  },
  (table) => [
    uniqueIndex("employee_compensation_employee_unique").on(table.employeeId),
    index("employee_compensation_org_idx").on(table.organisationId),
    check("employee_compensation_payload_not_blank", sql`btrim(${table.encryptedPayload}) <> ''`),
    check("employee_compensation_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

/** Bank details are encrypted as one versioned JSON envelope. */
export const employeeBankDetails = pgTable(
  "employee_bank_details",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict", onUpdate: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade", onUpdate: "cascade" }),
    encryptedPayload: text("encrypted_payload").notNull(),
  },
  (table) => [
    uniqueIndex("employee_bank_details_employee_unique").on(table.employeeId),
    index("employee_bank_details_org_idx").on(table.organisationId),
    check("employee_bank_details_payload_not_blank", sql`btrim(${table.encryptedPayload}) <> ''`),
    check("employee_bank_details_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export type EmployeeRow = typeof employees.$inferSelect;
export type NewEmployeeRow = typeof employees.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
