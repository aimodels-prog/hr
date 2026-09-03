import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { employees, users } from "./employee.ts";
import { organisations } from "./organisation.ts";

export const workspaceIdentityMappings = pgTable(
  "workspace_identity_mappings",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workspaceEmail: text("workspace_email").notNull(),
    workspaceSubject: text("workspace_subject"),
    status: text("status").notNull().default("Pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("workspace_identity_mappings_employee_unique").on(table.employeeId),
    uniqueIndex("workspace_identity_mappings_user_unique").on(table.userId),
    uniqueIndex("workspace_identity_mappings_org_email_unique").on(
      table.organisationId,
      sql`lower(${table.workspaceEmail})`,
    ),
    uniqueIndex("workspace_identity_mappings_subject_unique")
      .on(table.workspaceSubject)
      .where(sql`${table.workspaceSubject} IS NOT NULL`),
    check(
      "workspace_identity_mappings_email_normalized",
      sql`${table.workspaceEmail} = lower(btrim(${table.workspaceEmail}))`,
    ),
    check(
      "workspace_identity_mappings_status",
      sql`${table.status} IN ('Pending', 'Verified', 'Suspended', 'Archived')`,
    ),
    check(
      "workspace_identity_mappings_verification_consistency",
      sql`${table.status} <> 'Verified' OR ${table.verifiedAt} IS NOT NULL`,
    ),
  ],
);

/** Authentication wiring is H4; H3.3 only establishes the durable session model. */
export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("portal_sessions_token_hash_unique").on(table.tokenHash),
    index("portal_sessions_org_user_expiry_idx").on(
      table.organisationId,
      table.userId,
      table.expiresAt,
    ),
    check("portal_sessions_token_hash_not_blank", sql`btrim(${table.tokenHash}) <> ''`),
    check("portal_sessions_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "portal_sessions_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const notificationPriority = pgEnum("notification_priority", [
  "Low",
  "Normal",
  "High",
  "Critical",
]);
export const notificationStatus = pgEnum("notification_status", ["Unread", "Read", "Dismissed"]);

export const notifications = pgTable(
  "notifications",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    priority: notificationPriority("priority").notNull().default("Normal"),
    status: notificationStatus("status").notNull().default("Unread"),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }),
    readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true, mode: "string" }),
    deduplicationKey: text("deduplication_key"),
    link: jsonb("link").$type<{ entityType: string; entityId: string; path?: string }>(),
  },
  (table) => [
    index("notifications_org_recipient_status_idx").on(
      table.organisationId,
      table.recipientUserId,
      table.status,
    ),
    index("notifications_org_due_idx").on(table.organisationId, table.dueAt),
    uniqueIndex("notifications_org_dedup_unique")
      .on(table.organisationId, table.recipientUserId, table.deduplicationKey)
      .where(sql`${table.deduplicationKey} IS NOT NULL`),
    check("notifications_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check("notifications_message_not_blank", sql`btrim(${table.message}) <> ''`),
    check(
      "notifications_read_consistency",
      sql`${table.status} <> 'Read' OR ${table.readAt} IS NOT NULL`,
    ),
    check(
      "notifications_dismissed_consistency",
      sql`${table.status} <> 'Dismissed' OR ${table.dismissedAt} IS NOT NULL`,
    ),
  ],
);

/** User-owned report filters. Report data itself is always rebuilt from PostgreSQL. */
export const reportSavedViews = pgTable(
  "report_saved_views",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reportId: text("report_id").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters")
      .$type<{
        search: string;
        dateFrom: string;
        dateTo: string;
        department: string;
        status: string;
      }>()
      .notNull(),
  },
  (table) => [
    index("report_saved_views_owner_report_idx").on(
      table.organisationId,
      table.ownerUserId,
      table.reportId,
    ),
    uniqueIndex("report_saved_views_owner_name_unique")
      .on(table.organisationId, table.ownerUserId, table.reportId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} IS NULL`),
    check("report_saved_views_report_not_blank", sql`btrim(${table.reportId}) <> ''`),
    check(
      "report_saved_views_name_length",
      sql`char_length(btrim(${table.name})) BETWEEN 2 AND 60`,
    ),
  ],
);

export const auditRiskLevel = pgEnum("audit_risk_level", ["Low", "Medium", "High", "Critical"]);

export const backgroundJobStatus = pgEnum("background_job_status", [
  "Queued",
  "Running",
  "Retry Scheduled",
  "Completed",
  "Failed",
  "Cancelled",
]);

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    module: text("module").notNull(),
    jobType: text("job_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    status: backgroundJobStatus("status").notNull().default("Queued"),
    payload: jsonb("payload").notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    lockedBy: text("locked_by"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
  },
  (table) => [
    index("background_jobs_claim_idx").on(table.status, table.nextAttemptAt),
    index("background_jobs_org_entity_idx").on(
      table.organisationId,
      table.entityType,
      table.entityId,
    ),
    check(
      "background_jobs_attempts_valid",
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0`,
    ),
    check("background_jobs_type_not_blank", sql`btrim(${table.jobType}) <> ''`),
  ],
);

/** Durable worker-process presence. Monitoring treats an old heartbeat as stale. */
export const workerInstances = pgTable(
  "worker_instances",
  {
    id: uuid("id").primaryKey(),
    workerId: text("worker_id").notNull(),
    hostname: text("hostname").notNull(),
    buildVersion: text("build_version").notNull(),
    status: text("status").notNull().default("Running"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true, mode: "date" }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("worker_instances_worker_id_unique").on(table.workerId),
    index("worker_instances_status_heartbeat_idx").on(table.status, table.heartbeatAt),
    check("worker_instances_id_not_blank", sql`btrim(${table.workerId}) <> ''`),
    check(
      "worker_instances_status",
      sql`${table.status} IN ('Running','Stopping','Stopped','Stale')`,
    ),
  ],
);

/** One database lease per scheduled task prevents duplicate work across replicas. */
export const workerSchedules = pgTable(
  "worker_schedules",
  {
    taskName: text("task_name").primaryKey(),
    intervalSeconds: integer("interval_seconds").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lockedBy: text("locked_by"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true, mode: "date" }),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true, mode: "date" }),
    lastStatus: text("last_status"),
    lastResult: jsonb("last_result"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  },
  (table) => [
    index("worker_schedules_due_idx").on(table.nextRunAt, table.leaseExpiresAt),
    check("worker_schedules_task_not_blank", sql`btrim(${table.taskName}) <> ''`),
    check("worker_schedules_interval_positive", sql`${table.intervalSeconds} BETWEEN 1 AND 86400`),
    check("worker_schedules_failures_non_negative", sql`${table.consecutiveFailures} >= 0`),
    check(
      "worker_schedules_status",
      sql`${table.lastStatus} IS NULL OR ${table.lastStatus} IN ('Completed','Failed')`,
    ),
  ],
);

/** Bounded operational history used for failure review and duration monitoring. */
export const workerTaskRuns = pgTable(
  "worker_task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workerInstanceId: uuid("worker_instance_id")
      .notNull()
      .references(() => workerInstances.id, { onDelete: "restrict" }),
    taskName: text("task_name").notNull(),
    status: text("status").notNull().default("Running"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
    result: jsonb("result"),
    error: text("error"),
  },
  (table) => [
    index("worker_task_runs_task_started_idx").on(table.taskName, table.startedAt),
    index("worker_task_runs_status_started_idx").on(table.status, table.startedAt),
    check("worker_task_runs_task_not_blank", sql`btrim(${table.taskName}) <> ''`),
    check("worker_task_runs_status", sql`${table.status} IN ('Running','Completed','Failed')`),
    check(
      "worker_task_runs_duration_non_negative",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
  ],
);

/**
 * Immutable business and security history. This table intentionally has no
 * mutable-record update/archive columns. The migration adds a trigger that
 * rejects UPDATE and DELETE even for the table owner, plus restricted grants
 * for the runtime role.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    actorUserId: uuid("actor_user_id"),
    actorEmployeeId: uuid("actor_employee_id"),
    actorDisplayName: text("actor_display_name").notNull(),
    activeRole: text("active_role"),
    actorRoles: text("actor_roles").array().notNull().default([]),
    sessionId: uuid("session_id"),
    action: text("action").notNull(),
    module: text("module").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    beforeSummary: jsonb("before_summary"),
    afterSummary: jsonb("after_summary"),
    reason: text("reason"),
    riskLevel: auditRiskLevel("risk_level").notNull().default("Low"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("audit_events_org_occurred_idx").on(table.organisationId, table.occurredAt),
    index("audit_events_org_actor_idx").on(table.organisationId, table.actorUserId),
    index("audit_events_org_entity_idx").on(table.organisationId, table.entityType, table.entityId),
    index("audit_events_org_module_action_idx").on(
      table.organisationId,
      table.module,
      table.action,
    ),
    check("audit_events_actor_name_not_blank", sql`btrim(${table.actorDisplayName}) <> ''`),
    check("audit_events_action_not_blank", sql`btrim(${table.action}) <> ''`),
    check("audit_events_module_not_blank", sql`btrim(${table.module}) <> ''`),
    check("audit_events_entity_type_not_blank", sql`btrim(${table.entityType}) <> ''`),
  ],
);
