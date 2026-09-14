import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { organisations } from "./organisation.ts";
import { users } from "./employee.ts";

// Integration credentials are deliberately excluded from all business-data snapshots.
export const googleCalendarConnections = pgTable("google_calendar_connections", {
  organisationId: uuid("organisation_id")
    .primaryKey()
    .references(() => organisations.id),
  accountEmail: text("account_email").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  connectedBy: uuid("connected_by")
    .notNull()
    .references(() => users.id),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

export const googleCalendarOAuthStates = pgTable("google_calendar_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  organisationId: uuid("organisation_id")
    .notNull()
    .references(() => organisations.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  sessionId: uuid("session_id").notNull(),
  verifierEncrypted: text("verifier_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
