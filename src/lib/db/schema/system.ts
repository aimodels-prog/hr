import { sql } from "drizzle-orm";
import {
  check,
  index,
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

export const auditRiskLevel = pgEnum("audit_risk_level", ["Low", "Medium", "High", "Critical"]);

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
