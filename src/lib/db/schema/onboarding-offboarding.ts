import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { fileMetadata } from "./documents.ts";
import { employees, systemRoleCode, users } from "./employee.ts";
import { organisations } from "./organisation.ts";

export const onboardingTemplates = pgTable(
  "onboarding_templates",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    countries: text("countries").array().notNull().default([]),
    legalEntities: text("legal_entities").array().notNull().default([]),
    departments: uuid("departments").array().notNull().default([]),
    roles: text("roles").array().notNull().default([]),
    employmentTypes: uuid("employment_types").array().notNull().default([]),
    templateTasks: jsonb("template_tasks").notNull().default([]),
  },
  (table) => [
    index("onboarding_templates_org_active_idx").on(table.organisationId, table.isActive),
    check("onboarding_templates_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

export const onboardingCaseStatus = pgEnum("onboarding_case_status", [
  "In Progress",
  "Completed",
  "Cancelled",
]);
export const onboardingCaseKind = pgEnum("onboarding_case_kind", [
  "New Hire Onboarding",
  "Employee Record Completion",
]);
export const onboardingCases = pgTable(
  "onboarding_cases",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").references(() => onboardingTemplates.id, {
      onDelete: "restrict",
    }),
    kind: onboardingCaseKind("kind").notNull().default("New Hire Onboarding"),
    status: onboardingCaseStatus("status").notNull().default("In Progress"),
    progressPercentage: integer("progress_percentage").notNull().default(0),
    isReadyForStartDate: boolean("is_ready_for_start_date").notNull().default(false),
    assignedHRId: uuid("assigned_hr_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("onboarding_cases_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    check("onboarding_cases_progress_range", sql`${table.progressPercentage} BETWEEN 0 AND 100`),
  ],
);

export const onboardingTaskStatus = pgEnum("onboarding_task_status", [
  "Pending",
  "Blocked",
  "Completed",
  "Waived",
]);
export const onboardingTasks = pgTable(
  "onboarding_tasks",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => onboardingCases.id, { onDelete: "cascade" }),
    templateTaskId: text("template_task_id"),
    title: text("title").notNull(),
    taskGroup: text("task_group").notNull(),
    checkpoint: text("checkpoint").notNull(),
    ownerRole: systemRoleCode("owner_role").notNull(),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    offsetDaysFromStart: integer("offset_days_from_start"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    isMandatory: boolean("is_mandatory").notNull().default(true),
    requiresEvidence: boolean("requires_evidence").notNull().default(false),
    instructions: text("instructions"),
    dependsOnTaskIds: uuid("depends_on_task_ids").array().notNull().default([]),
    selfServiceFormKey: text("self_service_form_key"),
    documentType: text("document_type"),
    verificationDocumentType: text("verification_document_type"),
    requiresBankDetails: boolean("requires_bank_details").notNull().default(false),
    status: onboardingTaskStatus("status").notNull().default("Pending"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    waiverReason: text("waiver_reason"),
  },
  (table) => [
    index("onboarding_tasks_org_status_due_idx").on(
      table.organisationId,
      table.status,
      table.dueDate,
    ),
    index("onboarding_tasks_case_idx").on(table.caseId),
    index("onboarding_tasks_assignee_idx").on(table.organisationId, table.assignedUserId),
    check("onboarding_tasks_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check(
      "onboarding_tasks_completion_consistency",
      sql`${table.status} <> 'Completed' OR (${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL)`,
    ),
    check(
      "onboarding_tasks_waiver_reason",
      sql`${table.status} <> 'Waived' OR btrim(coalesce(${table.waiverReason}, '')) <> ''`,
    ),
    check(
      "onboarding_tasks_evidence_consistency",
      sql`NOT (${table.requiresEvidence} AND ${table.status} = 'Completed') OR ${table.evidenceFileId} IS NOT NULL`,
    ),
  ],
);

export const offboardingTemplates = pgTable(
  "offboarding_templates",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    departments: uuid("departments").array().notNull().default([]),
    employmentTypes: uuid("employment_types").array().notNull().default([]),
    templateTasks: jsonb("template_tasks").notNull().default([]),
  },
  (table) => [
    index("offboarding_templates_org_active_idx").on(table.organisationId, table.isActive),
    check("offboarding_templates_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

export const offboardingCaseStatus = pgEnum("offboarding_case_status", [
  "In Progress",
  "Pending Clearance",
  "Completed",
  "Cancelled",
]);
export const offboardingConfidentiality = pgEnum("offboarding_confidentiality", [
  "Standard",
  "Restricted",
]);
export const offboardingCases = pgTable(
  "offboarding_cases",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    templateId: uuid("template_id").references(() => offboardingTemplates.id, {
      onDelete: "restrict",
    }),
    reasonCategory: text("reason_category").notNull(),
    noticeDate: date("notice_date", { mode: "string" }).notNull(),
    lastWorkingDate: date("last_working_date", { mode: "string" }).notNull(),
    confidentialityLevel: offboardingConfidentiality("confidentiality_level")
      .notNull()
      .default("Standard"),
    /** Encrypted because restricted cases can contain legal and disciplinary information. */
    confidentialNotesEncrypted: text("confidential_notes_encrypted"),
    rehireEligible: boolean("rehire_eligible").notNull().default(false),
    status: offboardingCaseStatus("status").notNull().default("In Progress"),
    progressPercentage: integer("progress_percentage").notNull().default(0),
    financialClearanceAt: timestamp("financial_clearance_at", {
      withTimezone: true,
      mode: "string",
    }),
    financialClearanceBy: uuid("financial_clearance_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    legalClearanceAt: timestamp("legal_clearance_at", { withTimezone: true, mode: "string" }),
    legalClearanceBy: uuid("legal_clearance_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "string" }),
    finalizedBy: uuid("finalized_by").references(() => users.id, { onDelete: "restrict" }),
    assignedHRId: uuid("assigned_hr_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("offboarding_cases_org_status_last_day_idx").on(
      table.organisationId,
      table.status,
      table.lastWorkingDate,
    ),
    index("offboarding_cases_org_employee_idx").on(table.organisationId, table.employeeId),
    check("offboarding_cases_date_order", sql`${table.lastWorkingDate} >= ${table.noticeDate}`),
    check("offboarding_cases_progress_range", sql`${table.progressPercentage} BETWEEN 0 AND 100`),
    check(
      "offboarding_cases_restricted_notes",
      sql`${table.confidentialityLevel} <> 'Restricted' OR btrim(coalesce(${table.confidentialNotesEncrypted}, '')) <> ''`,
    ),
    check(
      "offboarding_cases_finalization_consistency",
      sql`${table.status} <> 'Completed' OR (${table.finalizedAt} IS NOT NULL AND ${table.finalizedBy} IS NOT NULL AND ${table.financialClearanceAt} IS NOT NULL AND ${table.legalClearanceAt} IS NOT NULL)`,
    ),
  ],
);

export const offboardingTaskStatus = pgEnum("offboarding_task_status", [
  "Pending",
  "Blocked",
  "Completed",
  "Waived",
]);
export const offboardingTasks = pgTable(
  "offboarding_tasks",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => offboardingCases.id, { onDelete: "cascade" }),
    templateTaskId: text("template_task_id"),
    title: text("title").notNull(),
    taskGroup: text("task_group").notNull(),
    ownerRole: systemRoleCode("owner_role").notNull(),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    isMandatory: boolean("is_mandatory").notNull().default(true),
    requiresEvidence: boolean("requires_evidence").notNull().default(false),
    instructions: text("instructions"),
    dependsOnTaskIds: uuid("depends_on_task_ids").array().notNull().default([]),
    status: offboardingTaskStatus("status").notNull().default("Pending"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    waiverReason: text("waiver_reason"),
  },
  (table) => [
    index("offboarding_tasks_org_status_due_idx").on(
      table.organisationId,
      table.status,
      table.dueDate,
    ),
    index("offboarding_tasks_case_idx").on(table.caseId),
    index("offboarding_tasks_assignee_idx").on(table.organisationId, table.assignedUserId),
    check("offboarding_tasks_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check(
      "offboarding_tasks_completion_consistency",
      sql`${table.status} <> 'Completed' OR (${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL)`,
    ),
    check(
      "offboarding_tasks_waiver_reason",
      sql`${table.status} <> 'Waived' OR btrim(coalesce(${table.waiverReason}, '')) <> ''`,
    ),
  ],
);

/** Cross-module task inbox projection for approvals and assigned operational work. */
export const workflowTasks = pgTable(
  "workflow_tasks",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    module: text("module").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    assignedRole: systemRoleCode("assigned_role"),
    status: text("status").notNull().default("Open"),
    priority: text("priority").notNull().default("Normal"),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("workflow_tasks_org_assignee_status_idx").on(
      table.organisationId,
      table.assignedUserId,
      table.status,
    ),
    index("workflow_tasks_org_role_status_idx").on(
      table.organisationId,
      table.assignedRole,
      table.status,
    ),
    index("workflow_tasks_org_entity_idx").on(
      table.organisationId,
      table.entityType,
      table.entityId,
    ),
    check("workflow_tasks_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check(
      "workflow_tasks_status",
      sql`${table.status} IN ('Open', 'In Progress', 'Completed', 'Cancelled')`,
    ),
    check(
      "workflow_tasks_priority",
      sql`${table.priority} IN ('Low', 'Normal', 'High', 'Critical')`,
    ),
    check(
      "workflow_tasks_assignment_present",
      sql`${table.assignedUserId} IS NOT NULL OR ${table.assignedRole} IS NOT NULL`,
    ),
  ],
);
