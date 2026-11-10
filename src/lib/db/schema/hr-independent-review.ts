import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { employees } from "./employee.ts";
import { organisations } from "./organisation.ts";

/** Immutable reviewer routing for an HR employee's own pending request. */
export const hrIndependentReviewAssignments = pgTable(
  "hr_independent_review_assignments",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    module: text("module").notNull(),
    requestId: uuid("request_id").notNull(),
    requesterEmployeeId: uuid("requester_employee_id")
      .notNull()
      .references(() => employees.id),
    reviewerEmployeeId: uuid("reviewer_employee_id")
      .notNull()
      .references(() => employees.id),
    stage: text("stage").notNull().default("HR"),
  },
  (table) => [
    uniqueIndex("hr_independent_review_request_stage_unique").on(
      table.organisationId,
      table.module,
      table.requestId,
      table.stage,
    ),
    index("hr_independent_review_reviewer_idx").on(table.organisationId, table.reviewerEmployeeId),
    check(
      "hr_independent_review_module_valid",
      sql`${table.module} IN ('Leave','Timesheet','Attendance Correction','Overtime','Training','Visit','Time Away','Document','Training Certificate','Employment Confirmation')`,
    ),
    check(
      "hr_independent_review_not_self",
      sql`${table.requesterEmployeeId} <> ${table.reviewerEmployeeId}`,
    ),
  ],
);
