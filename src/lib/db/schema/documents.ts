import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { employees, users } from "./employee.ts";
import { organisations } from "./organisation.ts";

export const fileStorageStatus = pgEnum("file_storage_status", [
  "Pending Upload",
  "Available",
  "Quarantined",
  "Deleted",
]);

/** Metadata only. Object bytes move to S3-compatible storage in H6. */
export const fileMetadata = pgTable(
  "file_metadata",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    checksum: text("checksum"),
    storageKey: text("storage_key"),
    storageStatus: fileStorageStatus("storage_status").notNull().default("Pending Upload"),
    ownerEntityType: text("owner_entity_type").notNull(),
    ownerEntityId: uuid("owner_entity_id").notNull(),
  },
  (table) => [
    index("file_metadata_org_owner_idx").on(
      table.organisationId,
      table.ownerEntityType,
      table.ownerEntityId,
    ),
    uniqueIndex("file_metadata_org_storage_key_unique")
      .on(table.organisationId, table.storageKey)
      .where(sql`${table.storageKey} IS NOT NULL`),
    check("file_metadata_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("file_metadata_mime_not_blank", sql`btrim(${table.mimeType}) <> ''`),
    check("file_metadata_size_positive", sql`${table.size} > 0`),
    check("file_metadata_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

export const documentType = pgEnum("document_type", [
  "contract",
  "passport",
  "visa",
  "national_id",
  "work_permit",
  "driving_licence",
  "medical",
  "education_certificate",
  "professional_certificate",
  "bank_evidence",
  "other",
]);

export const documentVisibility = pgEnum("document_visibility", ["Public", "Restricted"]);
export const documentStatus = pgEnum("document_status", [
  "Pending Verification",
  "Valid",
  "Rejected",
  "Replaced",
]);

export const employeeDocuments = pgTable(
  "employee_documents",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    type: documentType("type").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => fileMetadata.id, { onDelete: "restrict" }),
    /** Passport, visa and identity document numbers are encrypted before writing. */
    documentNumberEncrypted: text("document_number_encrypted"),
    issueDate: date("issue_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    issuingAuthority: text("issuing_authority"),
    issuingCountry: text("issuing_country"),
    notes: text("notes"),
    visibility: documentVisibility("visibility").notNull().default("Restricted"),
    status: documentStatus("status").notNull().default("Pending Verification"),
    rejectionReason: text("rejection_reason"),
    replacedById: uuid("replaced_by_id").references((): AnyPgColumn => employeeDocuments.id, {
      onDelete: "restrict",
    }),
    assignedOwnerId: uuid("assigned_owner_id").references(() => employees.id, {
      onDelete: "restrict",
    }),
    snoozedUntil: date("snoozed_until", { mode: "string" }),
    snoozeReason: text("snooze_reason"),
    waiverReason: text("waiver_reason"),
  },
  (table) => [
    index("employee_documents_org_employee_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    index("employee_documents_org_expiry_idx").on(
      table.organisationId,
      table.expiryDate,
      table.status,
    ),
    check(
      "employee_documents_date_order",
      sql`${table.issueDate} IS NULL OR ${table.expiryDate} IS NULL OR ${table.expiryDate} >= ${table.issueDate}`,
    ),
    check(
      "employee_documents_replacement_not_self",
      sql`${table.replacedById} IS NULL OR ${table.replacedById} <> ${table.id}`,
    ),
    check(
      "employee_documents_rejection_reason",
      sql`${table.status} <> 'Rejected' OR btrim(coalesce(${table.rejectionReason}, '')) <> ''`,
    ),
    check("employee_documents_record_version_positive", sql`${table.recordVersion} >= 1`),
  ],
);

/** Immutable pointer history for every employee-document replacement. */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => employeeDocuments.id, { onDelete: "restrict" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => fileMetadata.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by").notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [
    uniqueIndex("document_versions_document_version_unique").on(
      table.documentId,
      table.versionNumber,
    ),
    index("document_versions_org_document_idx").on(table.organisationId, table.documentId),
    check("document_versions_version_positive", sql`${table.versionNumber} >= 1`),
    check("document_versions_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
  ],
);

export const employmentChanges = pgTable(
  "employment_changes",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("employment_changes_org_employee_date_idx").on(
      table.organisationId,
      table.employeeId,
      table.effectiveDate,
    ),
    check("employment_changes_field_not_blank", sql`btrim(${table.field}) <> ''`),
    check("employment_changes_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
  ],
);

export const profileChangeRequestStatus = pgEnum("profile_change_request_status", [
  "Pending",
  "Approved",
  "Rejected",
]);

export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull(),
    status: profileChangeRequestStatus("status").notNull().default("Pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "string" }),
    reviewNotes: text("review_notes"),
  },
  (table) => [
    index("profile_change_requests_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    check(
      "profile_change_requests_review_consistency",
      sql`${table.status} = 'Pending' OR (${table.reviewerId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`,
    ),
  ],
);

export const importBatchStatus = pgEnum("import_batch_status", [
  "Uploaded",
  "Validating",
  "Ready",
  "Importing",
  "Completed",
  "Failed",
  "Cancelled",
]);

export const importBatches = pgTable(
  "import_batches",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    module: text("module").notNull(),
    fileId: uuid("file_id").references(() => fileMetadata.id, { onDelete: "restrict" }),
    status: importBatchStatus("status").notNull().default("Uploaded"),
    source: text("source"),
    seedVersion: text("seed_version"),
    datasetChecksum: text("dataset_checksum"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    unchangedRows: integer("unchanged_rows").notNull().default(0),
    rejectedRows: integer("rejected_rows").notNull().default(0),
    warnings: jsonb("warnings").notNull().default([]),
    errors: jsonb("errors").notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("import_batches_org_module_status_idx").on(
      table.organisationId,
      table.module,
      table.status,
    ),
    check(
      "import_batches_counts_non_negative",
      sql`${table.totalRows} >= 0 AND ${table.validRows} >= 0 AND ${table.unchangedRows} >= 0 AND ${table.rejectedRows} >= 0`,
    ),
    check(
      "import_batches_counts_consistent",
      sql`${table.validRows} + ${table.unchangedRows} + ${table.rejectedRows} <= ${table.totalRows}`,
    ),
  ],
);
