import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DocumentType, EmployeeDocument } from "../../data/types.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { getDatabaseClient } from "../client.ts";
import { readObjectFile, saveObjectFile } from "../object-storage.server.ts";
import { documentVersions, employeeDocuments, fileMetadata } from "../schema/documents.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const documentTypes = new Set<DocumentType>([
  "passport",
  "visa",
  "national_id",
  "work_permit",
  "contract",
  "driving_licence",
  "medical",
  "education_certificate",
  "professional_certificate",
  "bank_evidence",
  "other",
]);
const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const identityDocumentTypes = new Set<DocumentType>([
  "passport",
  "visa",
  "national_id",
  "work_permit",
]);

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function listEmployeeDocumentsForActor(
  organisationId: string,
  actor: AuditActorContext,
): Promise<EmployeeDocument[]> {
  const db = getDatabaseClient();
  const rows = await db
    .select({ document: employeeDocuments, managerId: employees.lineManagerId })
    .from(employeeDocuments)
    .innerJoin(employees, eq(employeeDocuments.employeeId, employees.id))
    .where(
      and(
        eq(employeeDocuments.organisationId, organisationId),
        isNull(employeeDocuments.archivedAt),
      ),
    )
    .orderBy(asc(employeeDocuments.createdAt));
  return rows
    .filter(({ document, managerId }) => {
      if (actor.activeRole === "HR" || actor.activeRole === "Super Admin") return true;
      if (document.employeeId === actor.employeeId) return true;
      if (actor.activeRole === "Accounts" && document.type === "bank_evidence") return true;
      return (
        actor.activeRole === "Line Manager" &&
        managerId === actor.employeeId &&
        document.visibility === "Public"
      );
    })
    .map(({ document }) => ({
      id: document.id,
      createdAt: requiredIso(document.createdAt),
      createdBy: document.createdBy,
      updatedAt: requiredIso(document.updatedAt),
      updatedBy: document.updatedBy,
      ...(document.archivedAt ? { archivedAt: requiredIso(document.archivedAt) } : {}),
      recordVersion: document.recordVersion,
      employeeId: document.employeeId,
      type: document.type,
      fileId: document.fileId,
      ...(document.documentNumberEncrypted
        ? { documentNumber: decryptSensitiveJson<string>(document.documentNumberEncrypted) }
        : {}),
      ...(document.issueDate ? { issueDate: document.issueDate } : {}),
      ...(document.expiryDate ? { expiryDate: document.expiryDate } : {}),
      ...(document.issuingAuthority ? { issuingAuthority: document.issuingAuthority } : {}),
      ...(document.issuingCountry ? { issuingCountry: document.issuingCountry } : {}),
      ...(document.notes ? { notes: document.notes } : {}),
      visibility: document.visibility,
      status: document.status,
      ...(document.rejectionReason ? { rejectionReason: document.rejectionReason } : {}),
      ...(document.replacedById ? { replacedById: document.replacedById } : {}),
      ...(document.assignedOwnerId ? { assignedOwnerId: document.assignedOwnerId } : {}),
      ...(document.snoozedUntil ? { snoozedUntil: document.snoozedUntil } : {}),
      ...(document.snoozeReason ? { snoozeReason: document.snoozeReason } : {}),
      ...(document.waiverReason ? { waiverReason: document.waiverReason } : {}),
    }));
}

export async function decideEmployeeDocumentInDatabase(
  organisationId: string,
  documentId: string,
  decision: "verify" | "reject",
  reason: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can review employee documents.");
  }
  if (decision === "reject" && (reason?.trim().length ?? 0) < 3) {
    throw new Error("Explain why the document is being rejected.");
  }
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.organisationId, organisationId),
          eq(employeeDocuments.id, documentId),
        ),
      )
      .for("update")
      .limit(1);
    if (!document || document.status !== "Pending Verification") {
      throw new Error("This document is not awaiting review.");
    }
    if (document.employeeId === actor.employeeId) {
      throw new Error("You cannot review your own employee document.");
    }
    await tx
      .update(employeeDocuments)
      .set({
        status: decision === "verify" ? "Valid" : "Rejected",
        rejectionReason: decision === "reject" ? reason!.trim() : null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employeeDocuments.recordVersion} + 1`,
      })
      .where(eq(employeeDocuments.id, documentId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: decision,
      module: "core-hr",
      entityType: "employee-document",
      entityId: documentId,
      beforeSummary: { status: document.status },
      afterSummary: { status: decision === "verify" ? "Valid" : "Rejected" },
      reason: decision === "reject" ? reason!.trim() : "Verified employee document",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function readEmployeeDocumentInDatabase(
  organisationId: string,
  fileId: string,
  actor: AuditActorContext,
  reason: string,
) {
  const db = getDatabaseClient();
  const [row] = await db
    .select({ document: employeeDocuments, managerId: employees.lineManagerId })
    .from(employeeDocuments)
    .innerJoin(employees, eq(employeeDocuments.employeeId, employees.id))
    .innerJoin(fileMetadata, eq(employeeDocuments.fileId, fileMetadata.id))
    .where(
      and(
        eq(employeeDocuments.organisationId, organisationId),
        eq(employeeDocuments.fileId, fileId),
        eq(fileMetadata.storageStatus, "Available"),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Employee document not found.");
  const allowed =
    actor.activeRole === "HR" ||
    actor.activeRole === "Super Admin" ||
    row.document.employeeId === actor.employeeId ||
    (actor.activeRole === "Accounts" && row.document.type === "bank_evidence") ||
    (actor.activeRole === "Line Manager" &&
      row.managerId === actor.employeeId &&
      row.document.visibility === "Public");
  if (!allowed) throw new Error("You do not have permission to open this employee document.");
  return readObjectFile(organisationId, fileId, actor, reason);
}

export async function updateDocumentExpiryTrackingInDatabase(
  organisationId: string,
  documentId: string,
  action:
    | { kind: "assign"; ownerEmployeeId: string }
    | { kind: "snooze"; until: string; reason: string }
    | { kind: "waive"; reason: string },
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can manage document follow-up.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.organisationId, organisationId),
          eq(employeeDocuments.id, documentId),
          isNull(employeeDocuments.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!document || document.status === "Replaced" || document.status === "Rejected")
      throw new Error("This document is not open for expiry follow-up.");
    let values: Partial<typeof employeeDocuments.$inferInsert>;
    let reason: string;
    if (action.kind === "assign") {
      const [owner] = await tx
        .select({ employeeId: users.employeeId })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.employeeId, action.ownerEmployeeId),
            eq(users.status, "Active"),
            eq(roles.code, "HR"),
          ),
        )
        .limit(1);
      if (!owner) throw new Error("The follow-up owner must be an active HR employee.");
      values = { assignedOwnerId: action.ownerEmployeeId };
      reason = "Assigned document follow-up owner";
    } else if (action.kind === "snooze") {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(action.until) ||
        action.until <= new Date().toISOString().slice(0, 10)
      )
        throw new Error("Choose a future reminder date.");
      if (action.reason.trim().length < 5)
        throw new Error("Explain why reminders are being paused.");
      values = { snoozedUntil: action.until, snoozeReason: action.reason.trim() };
      reason = action.reason.trim();
    } else {
      if (action.reason.trim().length < 5)
        throw new Error("Explain why this requirement is being removed.");
      values = { waiverReason: action.reason.trim(), snoozedUntil: null, snoozeReason: null };
      reason = action.reason.trim();
    }
    await tx
      .update(employeeDocuments)
      .set({
        ...values,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employeeDocuments.recordVersion} + 1`,
      })
      .where(eq(employeeDocuments.id, documentId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: action.kind,
      module: "document-expiry",
      entityType: "employee-document",
      entityId: documentId,
      afterSummary: action,
      reason,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function uploadEmployeeDocumentToDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    type: DocumentType;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    issuingAuthority?: string;
    issuingCountry?: string;
    notes?: string;
    visibility?: "Public" | "Restricted";
  },
  actor: AuditActorContext,
): Promise<string> {
  if (
    actor.activeRole !== "HR" &&
    actor.activeRole !== "Super Admin" &&
    actor.employeeId !== input.employeeId
  ) {
    throw new Error("You do not have permission to upload this employee document.");
  }
  if (!documentTypes.has(input.type)) throw new Error("Unsupported employee document type.");
  if (!input.fileName.trim() || input.bytes.byteLength === 0)
    throw new Error("A non-empty document is required.");
  if (input.bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("Employee documents cannot exceed 10 MB.");
  if (!allowedMimeTypes.has(input.mimeType))
    throw new Error("Employee documents must be PDF, JPG or PNG files.");
  if (
    identityDocumentTypes.has(input.type) &&
    (!input.documentNumber?.trim() ||
      !input.issueDate ||
      !input.expiryDate ||
      !input.issuingAuthority?.trim())
  ) {
    throw new Error("Document number, issuing authority, issue date and expiry date are required.");
  }
  if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate)
    throw new Error("Expiry date cannot be before issue date.");
  const db = getDatabaseClient();
  const documentId = randomUUID();
  const fileId = randomUUID();
  const stored = await saveObjectFile({
    id: fileId,
    organisationId,
    bytes: input.bytes,
    name: input.fileName,
    mimeType: input.mimeType,
    owner: { entityType: "employee-document", entityId: documentId },
    actor,
  });
  try {
    await db.transaction(async (tx) => {
      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)),
        )
        .limit(1);
      if (!employee) throw new Error("Employee not found.");
      await tx.insert(employeeDocuments).values({
        id: documentId,
        organisationId,
        employeeId: input.employeeId,
        type: input.type,
        fileId,
        documentNumberEncrypted: input.documentNumber
          ? encryptSensitiveJson(input.documentNumber)
          : null,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate,
        issuingAuthority: input.issuingAuthority,
        issuingCountry: input.issuingCountry,
        notes: input.notes,
        visibility: input.visibility ?? "Restricted",
        status: "Pending Verification",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof employeeDocuments.$inferInsert);
      await tx.insert(documentVersions).values({
        id: randomUUID(),
        organisationId,
        documentId,
        fileId,
        versionNumber: 1,
        createdBy: actor.userId,
        reason: "Initial employee document upload",
      } as typeof documentVersions.$inferInsert);
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole ?? null,
        actorRoles: actor.roles ?? [actor.activeRole],
        action: "upload",
        module: "core-hr",
        entityType: "employee-document",
        entityId: documentId,
        afterSummary: {
          employeeId: input.employeeId,
          type: input.type,
          fileName: input.fileName,
          version: 1,
        },
        reason: "Uploaded an employee document",
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
    });
    return documentId;
  } catch (error) {
    const { deleteObjectFile } = await import("../object-storage.server.ts");
    await deleteObjectFile(
      organisationId,
      fileId,
      actor,
      "Removed document after database transaction failed",
    ).catch(() => undefined);
    throw error;
  }
}

/**
 * Compensating cleanup used only when a workflow fails after its document upload committed.
 * User-facing deletion is intentionally not exposed: employee files remain versioned records.
 */
export async function removeFailedEmployeeDocumentUploadInDatabase(
  organisationId: string,
  documentId: string,
  actor: AuditActorContext,
  reason: string,
): Promise<void> {
  const db = getDatabaseClient();
  const fileId = await db.transaction(async (tx) => {
    const [document] = await tx
      .select({ fileId: employeeDocuments.fileId })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.organisationId, organisationId),
          eq(employeeDocuments.id, documentId),
        ),
      )
      .for("update")
      .limit(1);
    if (!document) return null;
    await tx
      .delete(documentVersions)
      .where(
        and(
          eq(documentVersions.organisationId, organisationId),
          eq(documentVersions.documentId, documentId),
        ),
      );
    await tx
      .delete(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.organisationId, organisationId),
          eq(employeeDocuments.id, documentId),
        ),
      );
    return document.fileId;
  });
  if (fileId) {
    const { deleteObjectFile } = await import("../object-storage.server.ts");
    await deleteObjectFile(organisationId, fileId, actor, reason);
  }
}

export async function replaceEmployeeDocumentInDatabase(
  organisationId: string,
  documentId: string,
  input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    reason: string;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    issuingAuthority?: string;
    issuingCountry?: string;
    notes?: string;
    visibility?: "Public" | "Restricted";
  },
  actor: AuditActorContext,
): Promise<string> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can replace employee documents.");
  if (input.reason.trim().length < 3)
    throw new Error("Explain why this document is being replaced.");
  if (!allowedMimeTypes.has(input.mimeType) || input.bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("Replacement documents must be PDF, JPG or PNG files up to 10 MB.");
  if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate)
    throw new Error("Expiry date cannot be before issue date.");
  const db = getDatabaseClient();
  const replacementId = randomUUID();
  const fileId = randomUUID();
  const stored = await saveObjectFile({
    id: fileId,
    organisationId,
    bytes: input.bytes,
    name: input.fileName,
    mimeType: input.mimeType,
    owner: { entityType: "employee-document", entityId: replacementId },
    actor,
  });
  try {
    await db.transaction(async (tx) => {
      const [old] = await tx
        .select()
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.organisationId, organisationId),
            eq(employeeDocuments.id, documentId),
          ),
        )
        .limit(1);
      if (!old) throw new Error("Employee document not found.");
      const [latest] = await tx
        .select({ version: sql<number>`coalesce(max(${documentVersions.versionNumber}), 0)` })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId));
      const version = Number(latest?.version ?? 0) + 1;
      await tx.insert(employeeDocuments).values({
        id: replacementId,
        organisationId,
        employeeId: old.employeeId,
        type: old.type,
        fileId,
        documentNumberEncrypted: input.documentNumber
          ? encryptSensitiveJson(input.documentNumber)
          : old.documentNumberEncrypted,
        issueDate: input.issueDate ?? old.issueDate,
        expiryDate: input.expiryDate ?? old.expiryDate,
        issuingAuthority: input.issuingAuthority ?? old.issuingAuthority,
        issuingCountry: input.issuingCountry ?? old.issuingCountry,
        notes: input.notes ?? old.notes,
        visibility: input.visibility ?? old.visibility,
        status: "Pending Verification",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof employeeDocuments.$inferInsert);
      await tx
        .update(employeeDocuments)
        .set({
          status: "Replaced",
          replacedById: replacementId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${employeeDocuments.recordVersion} + 1`,
        })
        .where(eq(employeeDocuments.id, documentId));
      await tx.insert(documentVersions).values({
        id: randomUUID(),
        organisationId,
        documentId: replacementId,
        fileId,
        versionNumber: version,
        createdBy: actor.userId,
        reason: input.reason.trim(),
      } as typeof documentVersions.$inferInsert);
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole ?? null,
        actorRoles: actor.roles ?? [actor.activeRole],
        action: "replace",
        module: "core-hr",
        entityType: "employee-document",
        entityId: documentId,
        afterSummary: { replacementId, version },
        reason: input.reason.trim(),
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
    });
    return replacementId;
  } catch (error) {
    const { deleteObjectFile } = await import("../object-storage.server.ts");
    await deleteObjectFile(
      organisationId,
      fileId,
      actor,
      "Removed replacement after transaction failed",
    ).catch(() => undefined);
    throw error;
  }
}
