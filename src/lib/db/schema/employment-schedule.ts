import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mutableRecordColumns } from "./common.ts";
import { employees, systemRoleCode } from "./employee.ts";
import { organisations } from "./organisation.ts";

export const scheduledEmploymentChanges = pgTable(
  "scheduled_employment_changes",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    fields: text("fields").array().notNull(),
    // Includes proposed compensation and the baseline used for conflict detection.
    encryptedPayload: text("encrypted_payload").notNull(),
    reason: text("reason").notNull(),
    authorRole: systemRoleCode("author_role").notNull(),
    status: text("status")
      .$type<"Pending" | "Applied" | "Cancelled" | "Needs Review">()
      .notNull()
      .default("Pending"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    reviewNote: text("review_note"),
  },
  (table) => [
    index("scheduled_employment_due_idx").on(
      table.organisationId,
      table.status,
      table.effectiveDate,
    ),
    index("scheduled_employment_employee_idx").on(table.organisationId, table.employeeId),
    check(
      "scheduled_employment_status_check",
      sql`${table.status} IN ('Pending','Applied','Cancelled','Needs Review')`,
    ),
    check("scheduled_employment_reason_check", sql`length(btrim(${table.reason})) >= 5`),
    check("scheduled_employment_fields_check", sql`cardinality(${table.fields}) > 0`),
    check(
      "scheduled_employment_applied_check",
      sql`${table.status} <> 'Applied' OR ${table.appliedAt} IS NOT NULL`,
    ),
  ],
);
