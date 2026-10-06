import "@tanstack/react-start/server-only";
import { getEmployeeRequirements } from "./document-requirements.repository.server.ts";
import { validateDocumentAnswers, standardDocumentKeys } from "../../data/document-requirements.ts";
import { assertHrDocumentWrite } from "../../data/hr-owned-fields.ts";

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { DocumentType, EmployeeDocument } from "../../data/types.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { getDatabaseClient } from "../client.ts";
import { readObjectFile, saveObjectFile } from "../object-storage.server.ts";
import { documentVersions, employeeDocuments, fileMetadata } from "../schema/documents.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { auditEvents, notifications } from "../schema/system.ts";
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
  "insurance_card",
  "insurance_benefits",
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
      if (
        ["visa", "work_permit"].includes(document.type) &&
        (!document.documentNumberEncrypted ||
          !document.issueDate ||
          !document.expiryDate ||
          !document.issuingAuthority)
      )
        return false;
      if (document.dependantId) return false;
      if (actor.activeRole === "Accounts" && document.type === "bank_evidence") return true;
      if (document.type === "insurance_card" || document.type === "insurance_benefits")
        return false;
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
      ...(document.dependantId ? { dependantId: document.dependantId } : {}),
      ...(document.dependantDocumentKind
        ? { dependantDocumentKind: document.dependantDocumentKind }
        : {}),
      type: document.type,
      ...(document.requirementSnapshot
        ? {
            requirementSnapshot: document.requirementSnapshot,
            requirementId: document.requirementSnapshot.id,
          }
        : {}),
      ...(document.answersEncrypted
        ? { answers: decryptSensitiveJson<Record<string, string>>(document.answersEncrypted) }
        : {}),
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
      ...(document.replacesDocumentId ? { replacesDocumentId: document.replacesDocumentId } : {}),
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
  verifiedDetails?: {
    answers?: Record<string, string> | undefined;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    issuingAuthority?: string;
    issuingCountry?: string;
    notes?: string;
    visibility?: "Public" | "Restricted";
  },
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can review employee documents.");
  }
  if (decision === "reject" && (reason?.trim().length ?? 0) < 3) {
    throw new Error("Explain why the document is being rejected.");
  }
  const db = getDatabaseClient();
  const [identity] = await db
    .select({ employeeId: employeeDocuments.employeeId })
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.organisationId, organisationId),
        eq(employeeDocuments.id, documentId),
      ),
    )
    .limit(1);
  if (!identity) throw new Error("Document not found.");
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${organisationId + ":documents:" + identity.employeeId}))`,
    );
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
    if (decision === "verify" && document.replacesDocumentId) {
      const [previous] = await tx
        .select()
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.organisationId, organisationId),
            eq(employeeDocuments.id, document.replacesDocumentId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        !previous ||
        previous.employeeId !== document.employeeId ||
        previous.archivedAt ||
        (previous.status === "Replaced" && previous.replacedById !== document.id)
      )
        throw new Error(
          "The previous document changed. Refresh before reviewing this replacement.",
        );
      await tx
        .update(employeeDocuments)
        .set({
          status: "Replaced",
          replacedById: document.id,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${employeeDocuments.recordVersion} + 1`,
        })
        .where(eq(employeeDocuments.id, previous.id));
    }
    const configuredAnswers =
      document.requirementSnapshot && decision === "verify"
        ? validateDocumentAnswers(
            document.requirementSnapshot,
            verifiedDetails?.answers ??
              (document.answersEncrypted
                ? decryptSensitiveJson<Record<string, string>>(document.answersEncrypted)
                : {}),
            true,
            true,
          )
        : undefined;
    if (configuredAnswers) {
      verifiedDetails = {
        ...verifiedDetails,
        ...Object.fromEntries(standardDocumentKeys.map((k) => [k, configuredAnswers[k]])),
      };
    }
    const documentNumber = verifiedDetails?.documentNumber?.trim();
    const issuingAuthority = verifiedDetails?.issuingAuthority?.trim();
    const issueDate = verifiedDetails?.issueDate;
    const expiryDate = verifiedDetails?.expiryDate;
    if (
      decision === "verify" &&
      !document.requirementSnapshot &&
      (identityDocumentTypes.has(document.type) || !!document.dependantId) &&
      (!(documentNumber || document.documentNumberEncrypted) ||
        !(issuingAuthority || document.issuingAuthority) ||
        !(issueDate || document.issueDate) ||
        !(expiryDate || document.expiryDate))
    ) {
      throw new Error(
        "HR must complete the document number, issuing authority, issue date and expiry date before verification.",
      );
    }
    const finalIssueDate = issueDate ?? document.issueDate;
    const finalExpiryDate = expiryDate ?? document.expiryDate;
    if (finalIssueDate && finalExpiryDate && finalExpiryDate < finalIssueDate) {
      throw new Error("Expiry date cannot be before issue date.");
    }
    await tx
      .update(employeeDocuments)
      .set({
        status: decision === "verify" ? "Valid" : "Rejected",
        ...(configuredAnswers ? { answersEncrypted: encryptSensitiveJson(configuredAnswers) } : {}),
        rejectionReason: decision === "reject" ? reason!.trim() : null,
        ...(decision === "verify" && documentNumber
          ? { documentNumberEncrypted: encryptSensitiveJson(documentNumber) }
          : {}),
        ...(decision === "verify" && issueDate ? { issueDate } : {}),
        ...(decision === "verify" && expiryDate ? { expiryDate } : {}),
        ...(decision === "verify" && issuingAuthority ? { issuingAuthority } : {}),
        ...(decision === "verify" && verifiedDetails?.issuingCountry?.trim()
          ? { issuingCountry: verifiedDetails.issuingCountry.trim() }
          : {}),
        ...(decision === "verify" && verifiedDetails?.notes?.trim()
          ? { notes: verifiedDetails.notes.trim() }
          : {}),
        ...(decision === "verify" && verifiedDetails?.visibility
          ? {
              visibility:
                document.requirementSnapshot ||
                document.dependantId ||
                document.type.startsWith("insurance_")
                  ? ("Restricted" as const)
                  : verifiedDetails.visibility,
            }
          : {}),
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
      afterSummary: {
        status: decision === "verify" ? "Valid" : "Rejected",
        ...(decision === "verify" ? { officialDetailsConfirmedByHr: true } : {}),
      },
      reason: decision === "reject" ? reason!.trim() : "Verified employee document",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    const recipients = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.employeeId, document.employeeId),
          eq(users.status, "Active"),
          isNull(users.archivedAt),
        ),
      );
    for (const recipient of recipients)
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: recipient.id,
          type: `employee-document.${decision === "verify" ? "approved" : "rejected"}`,
          title:
            decision === "verify"
              ? "HR verified your document"
              : "Your document needs a replacement",
          message:
            decision === "verify"
              ? `HR verified your ${document.dependantId ? "dependant's " : ""}${document.dependantDocumentKind ?? document.type} document. No further action is needed for this upload.`
              : `HR could not verify your ${document.dependantId ? "dependant's " : ""}${document.dependantDocumentKind ?? document.type} document. Open Documents to read HR's explanation and upload a replacement.`,
          link: {
            entityType: "employee-document",
            entityId: document.id,
            path: "/staff/me/profile",
          },
          deduplicationKey: `document-decision:${document.id}:${decision}`,
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        })
        .onConflictDoNothing();
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
  if (
    !["HR", "Super Admin"].includes(actor.activeRole) &&
    row.document.employeeId !== actor.employeeId &&
    ["visa", "work_permit"].includes(row.document.type) &&
    (!row.document.documentNumberEncrypted ||
      !row.document.issueDate ||
      !row.document.expiryDate ||
      !row.document.issuingAuthority)
  )
    throw new Error("HR must complete this immigration document before it is available.");
  const allowed =
    actor.activeRole === "HR" ||
    actor.activeRole === "Super Admin" ||
    row.document.employeeId === actor.employeeId ||
    (!row.document.dependantId &&
      actor.activeRole === "Accounts" &&
      row.document.type === "bank_evidence") ||
    (actor.activeRole === "Line Manager" &&
      !row.document.dependantId &&
      !row.document.type.startsWith("insurance_") &&
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
    requirementId?: string | undefined;
    answers?: Record<string, string> | undefined;
    type: DocumentType;
    dependantId?: string;
    dependantDocumentKind?: "passport" | "national_id" | "visa";
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
  if (
    !!input.dependantId !== !!input.dependantDocumentKind ||
    (input.dependantId && input.type !== "other")
  )
    throw new Error("Choose the dependant and family document type.");
  assertHrDocumentWrite(input.type, actor.activeRole);
  const isHr = ["HR", "Super Admin"].includes(actor.activeRole);
  const requirement = input.requirementId
    ? (await getEmployeeRequirements(organisationId, input.employeeId, actor)).find(
        (r) => r.id === input.requirementId,
      )
    : undefined;
  if (input.requirementId && (!requirement || requirement.type !== input.type || input.dependantId))
    throw new Error("This document requirement does not apply to this employee.");
  if (requirement?.uploadBy === "HR" && !isHr) throw new Error("Only HR can upload this document.");
  const answers = requirement
    ? validateDocumentAnswers(requirement, input.answers ?? {}, isHr)
    : undefined;
  if (answers)
    for (const key of standardDocumentKeys) {
      delete input[key];
      if (answers[key]) input[key] = answers[key]!;
    }
  if (!input.fileName.trim() || input.bytes.byteLength === 0)
    throw new Error("A non-empty document is required.");
  if (input.bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("Employee documents cannot exceed 10 MB.");
  if (!allowedMimeTypes.has(input.mimeType))
    throw new Error("Employee documents must be PDF, JPG or PNG files.");
  if (
    identityDocumentTypes.has(input.type) &&
    !requirement &&
    !(
      actor.employeeId === input.employeeId &&
      (input.type === "visa" || input.type === "work_permit")
    ) &&
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
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${organisationId + ":documents:" + input.employeeId}))`,
      );
      if (requirement && !requirement.multiple) {
        const duplicate = await tx
          .select({ id: employeeDocuments.id })
          .from(employeeDocuments)
          .where(
            and(
              eq(employeeDocuments.organisationId, organisationId),
              eq(employeeDocuments.employeeId, input.employeeId),
              isNull(employeeDocuments.archivedAt),
              sql`${employeeDocuments.status} IN ('Valid','Pending Verification')`,
              sql`(${employeeDocuments.requirementSnapshot}->>'id' = ${requirement.id} OR (${employeeDocuments.requirementSnapshot} IS NULL AND ${employeeDocuments.dependantId} IS NULL AND ${requirement.id === requirement.type} AND ${employeeDocuments.type} = ${requirement.type}))`,
            ),
          )
          .limit(1);
        if (duplicate.length)
          throw new Error(
            "This document already exists. Use Replace to submit a new version for HR review.",
          );
      }
      const [employee] = await tx
        .select({
          id: employees.id,
          dependants: employees.dependants,
          preferredName: employees.preferredName,
          legalName: employees.legalName,
        })
        .from(employees)
        .where(
          and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)),
        )
        .limit(1);
      if (!employee) throw new Error("Employee not found.");
      if (input.dependantId && !employee.dependants?.some((d) => d.id === input.dependantId))
        throw new Error("Save this dependant's details before uploading their documents.");
      await tx.insert(employeeDocuments).values({
        id: documentId,
        organisationId,
        employeeId: input.employeeId,
        dependantId: input.dependantId,
        dependantDocumentKind: input.dependantDocumentKind,
        type: input.type,
        requirementSnapshot: requirement,
        answersEncrypted: answers ? encryptSensitiveJson(answers) : null,
        fileId,
        documentNumberEncrypted: input.documentNumber
          ? encryptSensitiveJson(input.documentNumber)
          : null,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate,
        issuingAuthority: input.issuingAuthority,
        issuingCountry: input.issuingCountry,
        notes: input.notes,
        visibility:
          !isHr || !!requirement || input.dependantId || input.type.startsWith("insurance_")
            ? "Restricted"
            : (input.visibility ?? "Restricted"),
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
      const reviewers = await tx
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(
          userRoles,
          and(eq(userRoles.userId, users.id), eq(userRoles.organisationId, organisationId)),
        )
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            isNull(users.archivedAt),
            sql`${roles.code} IN ('HR','Super Admin')`,
            sql`${users.employeeId} <> ${input.employeeId}`,
          ),
        );
      for (const reviewer of reviewers)
        await tx
          .insert(notifications)
          .values({
            organisationId,
            recipientUserId: reviewer.id,
            type: "employee-document.approval_required",
            title: "Document uploaded — HR verification required",
            message: `${employee.preferredName || employee.legalName} has a new ${input.dependantId ? "family " : ""}${input.dependantDocumentKind ?? input.type} document awaiting HR verification. Open Documents to check the file, complete the official details and verify or return it.`,
            link: {
              entityType: "employee-document",
              entityId: documentId,
              path: `/staff/employees/${input.employeeId}`,
            },
            deduplicationKey: `document-upload:${documentId}`,
            createdBy: actor.userId!,
            updatedBy: actor.userId!,
          })
          .onConflictDoNothing();
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
    answers?: Record<string, string> | undefined;
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
  if (input.reason.trim().length < 3)
    throw new Error("Explain why this document is being replaced.");
  if (!allowedMimeTypes.has(input.mimeType) || input.bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("Replacement documents must be PDF, JPG or PNG files up to 10 MB.");
  if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate)
    throw new Error("Expiry date cannot be before issue date.");
  const db = getDatabaseClient();
  const replacementId = randomUUID();
  const [permitted] = await db
    .select()
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.organisationId, organisationId),
        eq(employeeDocuments.id, documentId),
      ),
    )
    .limit(1);
  if (
    !permitted ||
    (!["HR", "Super Admin"].includes(actor.activeRole) && permitted.employeeId !== actor.employeeId)
  )
    throw new Error("You cannot replace this employee document.");
  assertHrDocumentWrite(permitted.type, actor.activeRole);
  const isHr = ["HR", "Super Admin"].includes(actor.activeRole);
  if (permitted.requirementSnapshot?.uploadBy === "HR" && !isHr)
    throw new Error("Only HR can replace this document.");
  const answers = permitted.requirementSnapshot
    ? validateDocumentAnswers(permitted.requirementSnapshot, input.answers ?? {}, isHr)
    : undefined;
  if (answers)
    for (const key of standardDocumentKeys) {
      delete input[key];
      if (answers[key]) input[key] = answers[key]!;
    }
  if (!input.fileName.trim() || input.bytes.byteLength === 0)
    throw new Error("A non-empty document is required.");
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
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${organisationId + ":documents:" + permitted.employeeId}))`,
      );
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
      if (!old || old.archivedAt || old.status === "Replaced")
        throw new Error("This document has changed. Refresh and try again.");
      const targetId = old.status === "Valid" ? old.id : (old.replacesDocumentId ?? old.id);
      const [target] = await tx
        .select()
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.organisationId, organisationId),
            eq(employeeDocuments.id, targetId),
          ),
        )
        .limit(1);
      if (
        !target ||
        target.archivedAt ||
        (target.status === "Replaced" && target.replacedById !== old.id)
      )
        throw new Error("A newer document version exists. Refresh and revise the current version.");
      const [pending] = await tx
        .select({ id: employeeDocuments.id })
        .from(employeeDocuments)
        .where(
          and(
            eq(employeeDocuments.organisationId, organisationId),
            eq(employeeDocuments.replacesDocumentId, targetId),
            eq(employeeDocuments.status, "Pending Verification"),
            isNull(employeeDocuments.archivedAt),
          ),
        )
        .limit(1);
      if (pending && pending.id !== old.id)
        throw new Error(
          "A replacement is already awaiting HR review. Update that pending version instead.",
        );
      const [latest] = await tx
        .select({ version: sql<number>`coalesce(max(${documentVersions.versionNumber}), 0)` })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId));
      const version = Number(latest?.version ?? 0) + 1;
      if (old.status !== "Valid")
        await tx
          .update(employeeDocuments)
          .set({
            status: "Replaced",
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${employeeDocuments.recordVersion} + 1`,
          })
          .where(eq(employeeDocuments.id, old.id));
      await tx.insert(employeeDocuments).values({
        id: replacementId,
        replacesDocumentId: targetId,
        organisationId,
        employeeId: old.employeeId,
        requirementSnapshot: old.requirementSnapshot,
        answersEncrypted: answers ? encryptSensitiveJson(answers) : old.answersEncrypted,
        dependantId: old.dependantId,
        dependantDocumentKind: old.dependantDocumentKind,
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
        visibility:
          !isHr || !!old.requirementSnapshot || old.dependantId || old.type.startsWith("insurance_")
            ? "Restricted"
            : (input.visibility ?? old.visibility),
        status: "Pending Verification",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof employeeDocuments.$inferInsert);
      if (old.status !== "Valid")
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
      if (target.status === "Replaced" && target.id !== old.id) {
        await tx
          .update(employeeDocuments)
          .set({
            replacedById: replacementId,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${employeeDocuments.recordVersion} + 1`,
          })
          .where(eq(employeeDocuments.id, target.id));
      }
      await tx.insert(documentVersions).values({
        id: randomUUID(),
        organisationId,
        documentId: replacementId,
        fileId,
        versionNumber: version,
        createdBy: actor.userId,
        reason: input.reason.trim(),
      } as typeof documentVersions.$inferInsert);
      const reviewers = await tx
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(
          userRoles,
          and(eq(userRoles.userId, users.id), eq(userRoles.organisationId, organisationId)),
        )
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            isNull(users.archivedAt),
            sql`${roles.code} IN ('HR','Super Admin')`,
            sql`${users.employeeId} <> ${old.employeeId}`,
          ),
        );
      for (const reviewer of reviewers)
        await tx
          .insert(notifications)
          .values({
            organisationId,
            recipientUserId: reviewer.id,
            type: "employee-document.approval_required",
            title: "Document replacement awaiting review",
            message:
              "Review the proposed replacement. The previously approved document remains current until verification.",
            link: {
              entityType: "employee-document",
              entityId: replacementId,
              path: `/staff/employees/${old.employeeId}`,
            },
            deduplicationKey: `document-replacement:${replacementId}`,
            createdBy: actor.userId!,
            updatedBy: actor.userId!,
          })
          .onConflictDoNothing();
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
