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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { fileMetadata } from "./documents.ts";
import { employees, users } from "./employee.ts";
import { organisations } from "./organisation.ts";

export const leaveScope = pgEnum("leave_scope", [
  "Annual",
  "Once Per Service",
  "Per Event",
  "Ledger",
  "Not Tracked",
]);
export const leaveAccrualMode = pgEnum("leave_accrual_mode", [
  "Upfront",
  "Monthly",
  "Per Pay Period",
  "Not Applicable",
]);
export const leaveTransactionType = pgEnum("leave_transaction_type", [
  "Entitlement",
  "Carry-Forward",
  "Accrual",
  "Approved Leave",
  "Leave Amendment",
  "Cancellation Restoration",
  "Expiry",
  "Manual Adjustment",
]);
export const leaveRequestStatus = pgEnum("leave_request_status", [
  "Pending Line Manager",
  "Pending HR",
  "Pending Super Admin",
  "Approved",
  "Taken",
  "Declined",
  "Automatically Refused",
  "Cancelled",
  "Cancellation Pending",
  "Cancellation Approved",
  "Amendment Pending Line Manager",
  "Amendment Pending HR",
]);

export const leavePolicies = pgTable(
  "leave_policies",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    legalBasis: text("legal_basis"),
    description: text("description").notNull(),
    isPaid: boolean("is_paid").notNull(),
    payTiers: jsonb("pay_tiers").notNull().default([]),
    baseEntitlementDays: numeric("base_entitlement_days", { precision: 7, scale: 2 })
      .notNull()
      .default("0"),
    scope: leaveScope("scope").notNull(),
    accrualMode: leaveAccrualMode("accrual_mode").notNull(),
    carryForwardLimit: numeric("carry_forward_limit", { precision: 7, scale: 2 })
      .notNull()
      .default("0"),
    allowNegativeBalance: boolean("allow_negative_balance").notNull().default(false),
    maxNegativeBalance: numeric("max_negative_balance", { precision: 7, scale: 2 }),
    requiresAttachment: boolean("requires_attachment").notNull().default(false),
    requiresHandoverContact: boolean("requires_handover_contact").notNull().default(true),
    countsTowardGratuity: boolean("counts_toward_gratuity").notNull().default(true),
    eligibility: jsonb("eligibility"),
    approvalChain: jsonb("approval_chain").$type<string[]>().notNull().default([]),
    noticeRules: jsonb("notice_rules"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isStatutory: boolean("is_statutory").notNull().default(false),
    consumesBalance: boolean("consumes_balance").notNull().default(true),
  },
  (table) => [
    uniqueIndex("leave_policies_org_code_unique").on(
      table.organisationId,
      sql`lower(${table.code})`,
    ),
    uniqueIndex("leave_policies_org_name_unique").on(
      table.organisationId,
      sql`lower(${table.name})`,
    ),
    index("leave_policies_org_enabled_idx").on(table.organisationId, table.isEnabled),
    check("leave_policies_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("leave_policies_code_not_blank", sql`btrim(${table.code}) <> ''`),
    check("leave_policies_entitlement_non_negative", sql`${table.baseEntitlementDays} >= 0`),
    check("leave_policies_carry_non_negative", sql`${table.carryForwardLimit} >= 0`),
    check(
      "leave_policies_negative_balance_consistency",
      sql`(${table.allowNegativeBalance} AND ${table.maxNegativeBalance} IS NOT NULL AND ${table.maxNegativeBalance} >= 0) OR (NOT ${table.allowNegativeBalance} AND ${table.maxNegativeBalance} IS NULL)`,
    ),
    check("leave_policies_statutory_enabled", sql`NOT ${table.isStatutory} OR ${table.isEnabled}`),
    check("leave_policies_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

/** Materialized balance for fast self-service reads; the transaction ledger remains authoritative. */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => leavePolicies.id, { onDelete: "restrict" }),
    leaveYear: integer("leave_year").notNull(),
    balanceDays: numeric("balance_days", { precision: 8, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("leave_balances_employee_policy_year_unique").on(
      table.employeeId,
      table.policyId,
      table.leaveYear,
    ),
    index("leave_balances_org_employee_idx").on(table.organisationId, table.employeeId),
    check("leave_balances_year_range", sql`${table.leaveYear} BETWEEN 2000 AND 2200`),
    check("leave_balances_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const leaveTransactions = pgTable(
  "leave_transactions",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => leavePolicies.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    transactionType: leaveTransactionType("transaction_type").notNull(),
    days: numeric("days", { precision: 8, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    referenceId: uuid("reference_id"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("leave_transactions_org_employee_date_idx").on(
      table.organisationId,
      table.employeeId,
      table.date,
    ),
    index("leave_transactions_policy_idx").on(table.policyId),
    check("leave_transactions_days_non_zero", sql`${table.days} <> 0`),
    check("leave_transactions_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
  ],
);

export const employeeLeaveEntitlementOverrides = pgTable(
  "employee_leave_entitlement_overrides",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => leavePolicies.id, { onDelete: "restrict" }),
    days: numeric("days", { precision: 8, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  },
  (table) => [
    index("leave_overrides_org_employee_idx").on(table.organisationId, table.employeeId),
    check("leave_overrides_days_non_negative", sql`${table.days} >= 0`),
    check("leave_overrides_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => leavePolicies.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    isHalfDay: boolean("is_half_day").notNull().default(false),
    workingDaysRequested: numeric("working_days_requested", { precision: 7, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    handoverContactId: uuid("handover_contact_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
    attachmentFileId: uuid("attachment_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    status: leaveRequestStatus("status").notNull(),
    refusalReason: text("refusal_reason"),
    cancellationReason: text("cancellation_reason"),
    pendingAmendment: jsonb("pending_amendment"),
    amendmentHistory: jsonb("amendment_history").notNull().default([]),
    sickPayTiers: jsonb("sick_pay_tiers").notNull().default([]),
    chainApprovals: jsonb("chain_approvals").notNull().default([]),
    policySnapshot: jsonb("policy_snapshot").notNull(),
  },
  (table) => [
    index("leave_requests_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    index("leave_requests_org_dates_idx").on(table.organisationId, table.startDate, table.endDate),
    check("leave_requests_date_order", sql`${table.endDate} >= ${table.startDate}`),
    check("leave_requests_days_positive", sql`${table.workingDaysRequested} > 0`),
    check("leave_requests_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
    check(
      "leave_requests_automatic_refusal_reason",
      sql`${table.status} <> 'Automatically Refused' OR btrim(coalesce(${table.refusalReason}, '')) <> ''`,
    ),
    check("leave_requests_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);
