import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, date, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { mutableRecordColumns } from "./common.ts";
import { organisations } from "./organisation.ts";
import { fileMetadata } from "./documents.ts";
export const companyLibrary = pgTable(
  "company_library",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    familyId: uuid("family_id").notNull(),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    kind: text("kind").notNull(),
    audience: text("audience").notNull(),
    status: text("status").notNull().default("Draft"),
    processing: text("processing").notNull().default("Not prepared"),
    encryptedPages: text("encrypted_pages"),
    issueDate: date("issue_date"),
    expiryDate: date("expiry_date"),
    fileId: uuid("file_id")
      .notNull()
      .references(() => fileMetadata.id),
  },
  (table) => [
    index("company_library_org_idx").on(table.organisationId, table.kind, table.status),
    uniqueIndex("company_library_version_unique").on(
      table.organisationId,
      table.familyId,
      table.version,
    ),
    uniqueIndex("company_library_current_unique")
      .on(table.organisationId, table.familyId)
      .where(sql`${table.status} = 'Published'`),
    check("company_library_kind", sql`${table.kind} IN ('Library', 'Company')`),
    check(
      "company_library_access",
      sql`${table.audience} IN ('All staff', 'HR only') AND (${table.kind} <> 'Company' OR ${table.audience} = 'HR only')`,
    ),
  ],
);
