import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { notifications } from "./system.ts";
import { organisations } from "./organisation.ts";
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
  },
  (table) => [
    index("workflow_notification_emails_queue_idx").on(table.status, table.nextAttemptAt),
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
