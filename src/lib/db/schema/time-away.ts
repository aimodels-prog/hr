import { sql } from "drizzle-orm";
import { pgTable, uuid, text, date, index, check } from "drizzle-orm/pg-core";
import { mutableRecordColumns } from "./common.ts";
import { organisations } from "./organisation.ts";
import { employees } from "./employee.ts";
export const timeAway = pgTable(
  "time_away",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    date: date("date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    category: text("category").notNull(),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("Pending HR"),
    treatment: text("treatment"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
  },
  (t) => [
    index("time_away_org_employee_date").on(t.organisationId, t.employeeId, t.date),
    check("time_away_status", sql`${t.status} IN ('Pending HR','Approved','Rejected','Cancelled')`),
    check(
      "time_away_category",
      sql`${t.category} IN ('Medical appointment','Personal matter','Other')`,
    ),
    check(
      "time_away_treatment",
      sql`${t.treatment} IS NULL OR ${t.treatment} IN ('Paid time','Unpaid time','Leave')`,
    ),
    check(
      "time_away_approved_treatment",
      sql`${t.status} <> 'Approved' OR (${t.treatment} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL)`,
    ),
    check(
      "time_away_times",
      sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.endTime} > ${t.startTime}`,
    ),
  ],
);
