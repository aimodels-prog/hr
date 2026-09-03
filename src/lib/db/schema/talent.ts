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
import { organisations } from "./organisation.ts";

export const reviewTemplates = pgTable(
  "review_templates",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    maxRating: integer("max_rating").notNull().default(5),
    sections: jsonb("sections").notNull().default([]),
    employeeCanSeeManagerRatings: boolean("employee_can_see_manager_ratings")
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("review_templates_org_name_unique").on(
      table.organisationId,
      sql`lower(${table.name})`,
    ),
    index("review_templates_org_active_idx").on(table.organisationId, table.isActive),
    check("review_templates_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("review_templates_rating_range", sql`${table.maxRating} BETWEEN 1 AND 10`),
  ],
);

export const reviewCycleStatus = pgEnum("review_cycle_status", ["Draft", "Active", "Completed"]);
export const performanceCycles = pgTable(
  "performance_cycles",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => reviewTemplates.id, { onDelete: "restrict" }),
    status: reviewCycleStatus("status").notNull().default("Draft"),
    departments: uuid("departments").array().notNull().default([]),
    employmentTypes: uuid("employment_types").array().notNull().default([]),
    selfAssessmentDeadline: date("self_assessment_deadline", { mode: "string" }).notNull(),
    managerReviewDeadline: date("manager_review_deadline", { mode: "string" }).notNull(),
    discussionDeadline: date("discussion_deadline", { mode: "string" }).notNull(),
    objectiveSettingDeadline: date("objective_setting_deadline", { mode: "string" }),
    requiresModeration: boolean("requires_moderation").notNull().default(false),
    employeeCanSeeManagerRatings: boolean("employee_can_see_manager_ratings"),
  },
  (table) => [
    index("performance_cycles_org_status_idx").on(table.organisationId, table.status),
    index("performance_cycles_org_deadlines_idx").on(
      table.organisationId,
      table.selfAssessmentDeadline,
      table.managerReviewDeadline,
    ),
    check("performance_cycles_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check(
      "performance_cycles_deadline_order",
      sql`${table.selfAssessmentDeadline} <= ${table.managerReviewDeadline} AND ${table.managerReviewDeadline} <= ${table.discussionDeadline}`,
    ),
    check(
      "performance_cycles_objective_deadline_order",
      sql`${table.objectiveSettingDeadline} IS NULL OR ${table.objectiveSettingDeadline} <= ${table.selfAssessmentDeadline}`,
    ),
  ],
);

export const performanceReviews = pgTable(
  "performance_reviews",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => performanceCycles.id, { onDelete: "restrict" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => reviewTemplates.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("Draft"),
    sections: jsonb("sections").notNull().default([]),
    overallSelfScore: numeric("overall_self_score", { precision: 5, scale: 2 }),
    overallManagerScore: numeric("overall_manager_score", { precision: 5, scale: 2 }),
    managerSummaryComment: text("manager_summary_comment"),
    developmentPlan: text("development_plan"),
    discussionHeldAt: timestamp("discussion_held_at", { withTimezone: true, mode: "string" }),
    discussionRecordedAt: timestamp("discussion_recorded_at", {
      withTimezone: true,
      mode: "string",
    }),
    discussionRecordedBy: uuid("discussion_recorded_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    discussionNotes: text("discussion_notes"),
    employeeAcknowledgedAt: timestamp("employee_acknowledged_at", {
      withTimezone: true,
      mode: "string",
    }),
    employeeAcknowledgementComment: text("employee_acknowledgement_comment"),
    employeeAgreesWithReview: boolean("employee_agrees_with_review"),
    moderatedAt: timestamp("moderated_at", { withTimezone: true, mode: "string" }),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "restrict" }),
    moderationComment: text("moderation_comment"),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "restrict" }),
    correctedReason: text("corrected_reason"),
    originalReviewId: uuid("original_review_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => performanceReviews.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("performance_reviews_employee_cycle_unique")
      .on(table.employeeId, table.cycleId)
      .where(sql`${table.archivedAt} IS NULL`),
    index("performance_reviews_org_status_idx").on(table.organisationId, table.status),
    index("performance_reviews_org_employee_idx").on(table.organisationId, table.employeeId),
    check(
      "performance_reviews_self_score_non_negative",
      sql`${table.overallSelfScore} IS NULL OR ${table.overallSelfScore} >= 0`,
    ),
    check(
      "performance_reviews_manager_score_non_negative",
      sql`${table.overallManagerScore} IS NULL OR ${table.overallManagerScore} >= 0`,
    ),
    check(
      "performance_reviews_lock_consistency",
      sql`${table.lockedAt} IS NULL OR ${table.lockedBy} IS NOT NULL`,
    ),
  ],
);

export const employeeGoals = pgTable(
  "employee_goals",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => performanceCycles.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    successMeasure: text("success_measure").notNull(),
    targetValue: text("target_value").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    weight: integer("weight").notNull(),
    progressPercent: integer("progress_percent").notNull().default(0),
    status: text("status").notNull().default("Draft"),
    managerFeedback: text("manager_feedback"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("employee_goals_org_employee_cycle_idx").on(
      table.organisationId,
      table.employeeId,
      table.cycleId,
    ),
    index("employee_goals_org_status_idx").on(table.organisationId, table.status),
    check("employee_goals_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check("employee_goals_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("employee_goals_measure_not_blank", sql`btrim(${table.successMeasure}) <> ''`),
    check("employee_goals_target_not_blank", sql`btrim(${table.targetValue}) <> ''`),
    check("employee_goals_date_order", sql`${table.dueDate} >= ${table.startDate}`),
    check("employee_goals_weight_range", sql`${table.weight} BETWEEN 1 AND 100`),
    check("employee_goals_progress_range", sql`${table.progressPercent} BETWEEN 0 AND 100`),
    check(
      "employee_goals_status",
      sql`${table.status} IN ('Draft','Pending Approval','Changes Requested','Active','Completion Pending','Completed','Cancelled')`,
    ),
  ],
);

export const goalCheckIns = pgTable(
  "goal_check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => employeeGoals.id, { onDelete: "restrict" }),
    progressPercent: integer("progress_percent").notNull(),
    progressComment: text("progress_comment").notNull(),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").notNull(),
  },
  (table) => [
    index("goal_check_ins_org_goal_created_idx").on(
      table.organisationId,
      table.goalId,
      table.createdAt,
    ),
    check("goal_check_ins_progress_range", sql`${table.progressPercent} BETWEEN 0 AND 100`),
    check("goal_check_ins_comment_not_blank", sql`btrim(${table.progressComment}) <> ''`),
  ],
);

export const trainingCourses = pgTable(
  "training_courses",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    deliveryType: text("delivery_type").notNull(),
    durationHours: numeric("duration_hours", { precision: 8, scale: 2 }).notNull(),
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull(),
    validityMonths: integer("validity_months"),
    renewalIntervalMonths: integer("renewal_interval_months"),
    requiredRoles: text("required_roles").array().notNull().default([]),
    requiredLocations: uuid("required_locations").array().notNull().default([]),
    requiredProjects: uuid("required_projects").array().notNull().default([]),
    isMandatory: boolean("is_mandatory").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("training_courses_org_code_unique").on(
      table.organisationId,
      sql`lower(${table.code})`,
    ),
    index("training_courses_org_active_idx").on(table.organisationId, table.isActive),
    check("training_courses_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check("training_courses_duration_positive", sql`${table.durationHours} > 0`),
    check("training_courses_cost_non_negative", sql`${table.cost} >= 0`),
    check("training_courses_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "training_courses_delivery_type",
      sql`${table.deliveryType} IN ('Classroom', 'Virtual', 'Blended', 'Self-paced')`,
    ),
  ],
);

export const trainingRequests = pgTable(
  "training_requests",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "restrict" }),
    origin: text("origin").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("Pending Supervisor"),
    supervisorDecisionAt: timestamp("supervisor_decision_at", {
      withTimezone: true,
      mode: "string",
    }),
    supervisorDecisionBy: uuid("supervisor_decision_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    supervisorComment: text("supervisor_comment"),
    hrDecisionAt: timestamp("hr_decision_at", { withTimezone: true, mode: "string" }),
    hrDecisionBy: uuid("hr_decision_by").references(() => users.id, { onDelete: "restrict" }),
    hrComment: text("hr_comment"),
    rejectionReason: text("rejection_reason"),
  },
  (table) => [
    index("training_requests_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    check(
      "training_requests_origin",
      sql`${table.origin} IN ('Employee Request', 'Supervisor Assignment', 'HR Assignment')`,
    ),
    check("training_requests_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
    check(
      "training_requests_rejection_reason",
      sql`${table.status} <> 'Rejected' OR btrim(coalesce(${table.rejectionReason}, '')) <> ''`,
    ),
  ],
);

export const trainingSessions = pgTable(
  "training_sessions",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true, mode: "string" }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "string" }).notNull(),
    location: text("location").notNull(),
    facilitator: text("facilitator").notNull(),
    capacity: integer("capacity").notNull(),
    status: text("status").notNull().default("Scheduled"),
  },
  (table) => [
    index("training_sessions_org_start_idx").on(table.organisationId, table.startAt),
    check("training_sessions_date_order", sql`${table.endAt} > ${table.startAt}`),
    check("training_sessions_capacity_positive", sql`${table.capacity} > 0`),
    check(
      "training_sessions_status",
      sql`${table.status} IN ('Scheduled', 'Completed', 'Cancelled')`,
    ),
  ],
);

export const trainingAssignments = pgTable(
  "training_assignments",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").references(() => trainingRequests.id, {
      onDelete: "restrict",
    }),
    sessionId: uuid("session_id").references(() => trainingSessions.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("Assigned"),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "string" }).notNull(),
    attendanceRecordedAt: timestamp("attendance_recorded_at", {
      withTimezone: true,
      mode: "string",
    }),
    attendanceRecordedBy: uuid("attendance_recorded_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    completionDate: date("completion_date", { mode: "string" }),
    result: text("result"),
    actualCost: numeric("actual_cost", { precision: 14, scale: 2 }),
    cancellationReason: text("cancellation_reason"),
  },
  (table) => [
    uniqueIndex("training_assignments_employee_course_session_unique").on(
      table.employeeId,
      table.courseId,
      table.sessionId,
    ),
    uniqueIndex("training_assignments_employee_course_open_unique")
      .on(table.employeeId, table.courseId)
      .where(
        sql`${table.archivedAt} IS NULL AND ${table.status} IN ('Assigned','Scheduled','Attended')`,
      ),
    index("training_assignments_org_status_idx").on(table.organisationId, table.status),
    index("training_assignments_org_employee_idx").on(table.organisationId, table.employeeId),
    check(
      "training_assignments_cost_non_negative",
      sql`${table.actualCost} IS NULL OR ${table.actualCost} >= 0`,
    ),
    check(
      "training_assignments_cancellation_reason",
      sql`${table.status} <> 'Cancelled' OR btrim(coalesce(${table.cancellationReason}, '')) <> ''`,
    ),
  ],
);

export const trainingRecords = pgTable(
  "training_records",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    courseId: uuid("course_id").references(() => trainingCourses.id, { onDelete: "restrict" }),
    assignmentId: uuid("assignment_id").references(() => trainingAssignments.id, {
      onDelete: "restrict",
    }),
    title: text("title").notNull(),
    provider: text("provider").notNull(),
    completionDate: date("completion_date", { mode: "string" }).notNull(),
    expiryDate: date("expiry_date", { mode: "string" }),
    certificateFileId: uuid("certificate_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    hrVerified: boolean("hr_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
    verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "restrict" }),
    verificationComment: text("verification_comment"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true, mode: "string" }),
    rejectedBy: uuid("rejected_by").references(() => users.id, { onDelete: "restrict" }),
    rejectionReason: text("rejection_reason"),
  },
  (table) => [
    index("training_records_org_employee_idx").on(table.organisationId, table.employeeId),
    index("training_records_org_expiry_idx").on(table.organisationId, table.expiryDate),
    check(
      "training_records_date_order",
      sql`${table.expiryDate} IS NULL OR ${table.expiryDate} >= ${table.completionDate}`,
    ),
    check(
      "training_records_verification_consistency",
      sql`NOT ${table.hrVerified} OR (${table.verifiedAt} IS NOT NULL AND ${table.verifiedBy} IS NOT NULL)`,
    ),
  ],
);
