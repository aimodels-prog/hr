import { integer, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Metadata shared by mutable VIA records.
 *
 * Actor columns deliberately remain UUID values rather than foreign keys. This
 * permits the bootstrap/system actor to create the first user and preserves the
 * historical actor identifier even if an access mapping is later archived.
 */
export const mutableRecordColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  recordVersion: integer("record_version").notNull().default(1),
};

export const mutableRecordChecks = {
  versionSql: "record_version >= 1",
};
