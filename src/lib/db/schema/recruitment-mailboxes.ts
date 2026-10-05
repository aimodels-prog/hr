import { pgTable, uuid, text, timestamp, boolean, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { organisations } from "./organisation.ts";
import { users } from "./employee.ts";
import { vacancies } from "./recruitment.ts";

// Credentials must never be included in client-side business snapshots.
export const recruitmentMailboxes = pgTable(
  "recruitment_mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    email: text("email").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    connectedBy: uuid("connected_by")
      .notNull()
      .references(() => users.id),
    labelId: text("label_id").notNull(),
    sinceDate: text("since_date").notNull(),
    vacancyId: uuid("vacancy_id").references(() => vacancies.id),
    paused: boolean("paused").notNull().default(true),
    pageToken: text("page_token"),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("recruitment_mailbox_email_unique").on(table.organisationId, table.email),
  ],
);

export const recruitmentMailboxStates = pgTable("recruitment_mailbox_states", {
  stateHash: text("state_hash").primaryKey(),
  mailboxId: uuid("mailbox_id")
    .notNull()
    .references(() => recruitmentMailboxes.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  sessionId: uuid("session_id").notNull(),
  verifierEncrypted: text("verifier_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const recruitmentMailboxMessages = pgTable(
  "recruitment_mailbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => recruitmentMailboxes.id),
    messageId: text("message_id").notNull(),
    status: text("status").notNull(),
    importedCount: integer("imported_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("recruitment_mailbox_message_unique").on(table.mailboxId, table.messageId),
  ],
);
