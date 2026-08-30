import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { fileMetadata } from "./documents.ts";
import { employees, users } from "./employee.ts";
import { costCentres, projects } from "./master-data.ts";
import { organisations } from "./organisation.ts";

export const travelRequestStatus = pgEnum("travel_request_status", [
  "Draft",
  "Pending HR and Accounts",
  "Pre-authorised",
  "Pending Super Admin Closure",
  "Closed",
  "Rejected",
  "Withdrawn",
]);
export const travelApprovalState = pgEnum("travel_approval_state", [
  "Pending",
  "Approved",
  "Rejected",
]);

export const travelRequests = pgTable(
  "travel_requests",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    destination: text("destination").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    costCentreId: uuid("cost_centre_id").references(() => costCentres.id, {
      onDelete: "restrict",
    }),
    estTransport: numeric("est_transport", { precision: 14, scale: 2 }).notNull().default("0"),
    estAccommodation: numeric("est_accommodation", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    estPerDiem: numeric("est_per_diem", { precision: 14, scale: 2 }).notNull().default("0"),
    estOther: numeric("est_other", { precision: 14, scale: 2 }).notNull().default("0"),
    totalEstimate: numeric("total_estimate", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    notes: text("notes"),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    hrApprovalStatus: travelApprovalState("hr_approval_status").notNull().default("Pending"),
    accountsApprovalStatus: travelApprovalState("accounts_approval_status")
      .notNull()
      .default("Pending"),
    hrNotes: text("hr_notes"),
    accountsNotes: text("accounts_notes"),
    hrApprovedAt: timestamp("hr_approved_at", { withTimezone: true, mode: "string" }),
    hrApprovedBy: uuid("hr_approved_by").references(() => users.id, { onDelete: "restrict" }),
    accountsApprovedAt: timestamp("accounts_approved_at", { withTimezone: true, mode: "string" }),
    accountsApprovedBy: uuid("accounts_approved_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    preAuthorisedAt: timestamp("pre_authorised_at", { withTimezone: true, mode: "string" }),
    authorisedBudget: jsonb("authorised_budget"),
    actualTotal: numeric("actual_total", { precision: 14, scale: 2 }),
    actualTotalOmr: numeric("actual_total_omr", { precision: 14, scale: 2 }),
    varianceExplanation: text("variance_explanation"),
    closureNotes: text("closure_notes"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "restrict" }),
    payrollPeriodId: uuid("payroll_period_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => payrollPeriods.id,
      { onDelete: "restrict" },
    ),
    status: travelRequestStatus("status").notNull().default("Draft"),
  },
  (table) => [
    index("travel_requests_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    index("travel_requests_org_dates_idx").on(table.organisationId, table.startDate, table.endDate),
    check("travel_requests_date_order", sql`${table.endDate} >= ${table.startDate}`),
    check(
      "travel_requests_estimates_non_negative",
      sql`${table.estTransport} >= 0 AND ${table.estAccommodation} >= 0 AND ${table.estPerDiem} >= 0 AND ${table.estOther} >= 0 AND ${table.totalEstimate} >= 0`,
    ),
    check(
      "travel_requests_actual_non_negative",
      sql`${table.actualTotal} IS NULL OR ${table.actualTotal} >= 0`,
    ),
    check(
      "travel_requests_actual_omr_non_negative",
      sql`${table.actualTotalOmr} IS NULL OR ${table.actualTotalOmr} >= 0`,
    ),
    check("travel_requests_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "travel_requests_pre_authorised_dual_approval",
      sql`${table.status} <> 'Pre-authorised' OR (${table.hrApprovalStatus} = 'Approved' AND ${table.accountsApprovalStatus} = 'Approved' AND ${table.preAuthorisedAt} IS NOT NULL)`,
    ),
    check("travel_requests_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

/** Durable, independent decision history for the dual approval stages. */
export const travelApprovals = pgTable(
  "travel_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    travelRequestId: uuid("travel_request_id")
      .notNull()
      .references(() => travelRequests.id, { onDelete: "restrict" }),
    stage: text("stage").notNull(),
    state: travelApprovalState("state").notNull(),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    reason: text("reason"),
  },
  (table) => [
    uniqueIndex("travel_approvals_request_stage_unique").on(table.travelRequestId, table.stage),
    index("travel_approvals_org_state_idx").on(table.organisationId, table.state),
    check("travel_approvals_stage", sql`${table.stage} IN ('HR', 'Accounts')`),
    check(
      "travel_approvals_rejection_reason",
      sql`${table.state} <> 'Rejected' OR btrim(coalesce(${table.reason}, '')) <> ''`,
    ),
  ],
);

export const expenseItems = pgTable(
  "expense_items",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    travelRequestId: uuid("travel_request_id")
      .notNull()
      .references(() => travelRequests.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 14, scale: 6 }),
    reference: text("reference").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    notes: text("notes"),
    receiptFileId: uuid("receipt_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("expense_items_org_request_date_idx").on(
      table.organisationId,
      table.travelRequestId,
      table.date,
    ),
    check(
      "expense_items_category",
      sql`${table.category} IN ('Transport', 'Accommodation', 'Per Diem', 'Other')`,
    ),
    check("expense_items_amount_positive", sql`${table.amount} > 0`),
    check(
      "expense_items_exchange_rate_positive",
      sql`${table.exchangeRate} IS NULL OR ${table.exchangeRate} > 0`,
    ),
    check("expense_items_reference_not_blank", sql`btrim(${table.reference}) <> ''`),
    check("expense_items_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const reimbursements = pgTable(
  "reimbursements",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    travelRequestId: uuid("travel_request_id")
      .notNull()
      .references(() => travelRequests.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "restrict" }),
    rejectionReason: text("rejection_reason"),
  },
  (table) => [
    uniqueIndex("reimbursements_travel_request_unique").on(table.travelRequestId),
    index("reimbursements_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    check("reimbursements_amount_non_negative", sql`${table.amount} >= 0`),
    check("reimbursements_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const payrollPeriodStatus = pgEnum("payroll_period_status", [
  "Draft",
  "Collecting Inputs",
  "Exceptions",
  "Prepared",
  "Approved",
  "Locked",
  "Exported",
  "Corrected",
]);

export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    cutoffDate: date("cutoff_date", { mode: "string" }).notNull(),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    status: payrollPeriodStatus("status").notNull().default("Draft"),
    notes: text("notes"),
    compiledInputs: jsonb("compiled_inputs").notNull().default([]),
  },
  (table) => [
    uniqueIndex("payroll_periods_org_dates_unique").on(
      table.organisationId,
      table.startDate,
      table.endDate,
    ),
    index("payroll_periods_org_status_idx").on(table.organisationId, table.status),
    check("payroll_periods_date_order", sql`${table.endDate} >= ${table.startDate}`),
    check("payroll_periods_cutoff_order", sql`${table.cutoffDate} <= ${table.paymentDate}`),
    check("payroll_periods_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

export const payrollInputs = pgTable(
  "payroll_inputs",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    approvedOvertimeHours: numeric("approved_overtime_hours", { precision: 8, scale: 2 })
      .notNull()
      .default("0"),
    unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 8, scale: 2 })
      .notNull()
      .default("0"),
    reimbursementsTotal: numeric("reimbursements_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    reimbursementsCurrency: text("reimbursements_currency").notNull(),
    manualAdjustmentsTotal: numeric("manual_adjustments_total", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull(),
  },
  (table) => [
    uniqueIndex("payroll_inputs_period_employee_unique").on(table.periodId, table.employeeId),
    index("payroll_inputs_org_employee_idx").on(table.organisationId, table.employeeId),
    check("payroll_inputs_overtime_non_negative", sql`${table.approvedOvertimeHours} >= 0`),
    check("payroll_inputs_leave_non_negative", sql`${table.unpaidLeaveDays} >= 0`),
  ],
);

export const payrollExceptions = pgTable(
  "payroll_exceptions",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    description: text("description").notNull(),
    severity: text("severity").notNull(),
    acknowledged: boolean("acknowledged").notNull().default(false),
    acknowledgementNotes: text("acknowledgement_notes"),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("payroll_exceptions_org_period_severity_idx").on(
      table.organisationId,
      table.periodId,
      table.severity,
    ),
    check("payroll_exceptions_severity", sql`${table.severity} IN ('High', 'Medium', 'Low')`),
    check(
      "payroll_exceptions_ack_consistency",
      sql`NOT ${table.acknowledged} OR (${table.acknowledgedBy} IS NOT NULL AND ${table.acknowledgedAt} IS NOT NULL)`,
    ),
  ],
);

export const payrollManualAdjustments = pgTable(
  "payroll_manual_adjustments",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => payrollPeriods.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("payroll_adjustments_org_period_employee_idx").on(
      table.organisationId,
      table.periodId,
      table.employeeId,
    ),
    check(
      "payroll_adjustments_type",
      sql`${table.type} IN ('Allowance', 'Deduction', 'Correction')`,
    ),
    check("payroll_adjustments_amount_non_zero", sql`${table.amount} <> 0`),
    check("payroll_adjustments_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("payroll_adjustments_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
  ],
);
