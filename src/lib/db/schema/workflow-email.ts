import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  check,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { notifications } from "./system.ts";
import { organisations } from "./organisation.ts";
import { users } from "./employee.ts";
export const workflowEmailDigests = pgTable(
  "workflow_email_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    deliveryDay: date("delivery_day").notNull(),
    topic: text("topic").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_email_digests_daily_unique").on(
      table.organisationId,
      table.recipientUserId,
      table.deliveryDay,
      table.topic,
    ),
  ],
);
export const workflowNotificationEmails = pgTable(
  "workflow_notification_emails",
  {
    notificationId: uuid("notification_id")
      .primaryKey()
      .references(() => notifications.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    status: text("status").notNull().default("Queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    digestId: uuid("digest_id").references(() => workflowEmailDigests.id),
  },
  (table) => [
    index("workflow_notification_emails_queue_idx").on(table.status, table.nextAttemptAt),
    index("workflow_notification_emails_digest_idx").on(table.digestId),
    index("workflow_notification_emails_org_idx").on(table.organisationId, table.status),
    check(
      "workflow_notification_emails_status_check",
      sql`${table.status} IN ('Queued','Sending','Sent','Blocked','Failed','Uncertain','Skipped')`,
    ),
    check(
      "workflow_notification_emails_check",
      sql`${table.status}<>'Sent' OR (${table.providerMessageId} IS NOT NULL AND ${table.sentAt} IS NOT NULL)`,
    ),
  ],
);
