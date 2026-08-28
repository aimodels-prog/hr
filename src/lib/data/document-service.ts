import { getApplicationDataServices } from "./application-data.ts";
import { LocalRepository } from "./repository.ts";
import type {
  Employee,
  EmployeeDocument,
  ActorContext,
  FileMetadata,
  DocumentType,
} from "./types.ts";

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

// Document types that, in practice, are always issued with a printed/embossed document number -
// a passport, visa, work permit, national ID or driving licence without one is not a real document.
const DOCUMENT_NUMBER_REQUIRED_TYPES = new Set<DocumentType>([
  "passport",
  "visa",
  "work_permit",
  "national_id",
  "driving_licence",
]);

function assertValidDocumentMetadata(metadata: {
  type: DocumentType;
  documentNumber?: string | undefined;
  issueDate?: string | undefined;
  expiryDate?: string | undefined;
}): void {
  if (metadata.issueDate && metadata.expiryDate) {
    const issue = new Date(metadata.issueDate).getTime();
    const expiry = new Date(metadata.expiryDate).getTime();
    if (issue > expiry) {
      throw new Error("Issue date cannot be after the expiry date.");
    }
  }

  if (DOCUMENT_NUMBER_REQUIRED_TYPES.has(metadata.type) && !metadata.documentNumber?.trim()) {
    throw new Error(`A document number is required for ${metadata.type} documents.`);
  }
}

export class DocumentService {
  private documentRepo: LocalRepository<EmployeeDocument>;
  private employeeRepo: LocalRepository<Employee>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.documentRepo = new LocalRepository<EmployeeDocument>(
      "employee_documents",
      storage,
      audit,
      { module: "core-hr", entityType: "employee_document" },
    );
    this.employeeRepo = new LocalRepository<Employee>("employees", storage, audit, {
      module: "core-hr",
      entityType: "employee",
    });
  }

  private deny(action: string, employeeId: string, context: ActorContext, reason: string): never {
    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "core-hr",
      entityType: "employee_document",
      entityId: employeeId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
    throw new Error(reason);
  }

  private assertCanManage(employeeId: string, context: ActorContext): void {
    const isSelf = context.actor.employeeId === employeeId;
    const isHrOrAdmin =
      context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    if (!isSelf && !isHrOrAdmin) {
      this.deny(
        "manage document",
        employeeId,
        context,
        "You can upload or replace documents only for yourself, or while acting as HR or Super Admin.",
      );
    }
  }

  /** Trusted workflow-only repository access. User-facing code must use getDocuments. */
  getDocumentRepository(context: ActorContext) {
    if (context.actor.userId !== "system" || !context.actor.roles.includes("Super Admin")) {
      this.deny(
        "open raw document repository",
        context.actor.employeeId ?? context.actor.userId,
        context,
        "Raw document storage is reserved for trusted system workflows.",
      );
    }
    return this.documentRepo;
  }

  getDocuments(
    context: ActorContext,
    options: { includeArchived?: boolean } = {},
  ): EmployeeDocument[] {
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    const employees = this.employeeRepo.list({ includeArchived: true });
    return this.documentRepo.list(repositoryOptions).filter((document) => {
      if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") {
        return true;
      }
      if (context.actor.employeeId === document.employeeId) return true;
      const employee = employees.find((item) => item.id === document.employeeId);
      return (
        context.actor.activeRole === "Line Manager" &&
        employee?.lineManagerId === context.actor.employeeId &&
        document.visibility === "Public"
      );
    });
  }

  getDocumentById(
    documentId: string,
    context: ActorContext,
    options: { includeArchived?: boolean } = {},
  ): EmployeeDocument | null {
    const document = this.documentRepo.getById(documentId, options);
    if (!document) return null;
    const permitted = this.getDocuments(context, options).find((item) => item.id === documentId);
    if (!permitted) {
      this.deny(
        "view document record",
        document.employeeId,
        context,
        "You do not have permission to view this document.",
      );
    }
    return permitted;
  }

  getExpiringDocuments(context: ActorContext) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    return this.getDocuments(context).filter((doc) => {
      if (
        !doc.expiryDate ||
        doc.status === "Replaced" ||
        doc.status === "Rejected" ||
        doc.waiverReason
      ) {
        return false;
      }
      const expiry = new Date(doc.expiryDate);
      return expiry <= thirtyDaysFromNow;
    });
  }

  async uploadDocument(
    employeeId: string,
    fileBlob: Blob,
    filename: string,
    metadata: Omit<
      EmployeeDocument,
      | "id"
      | "createdAt"
      | "createdBy"
      | "updatedAt"
      | "updatedBy"
      | "recordVersion"
      | "archivedAt"
      | "status"
      | "fileId"
      | "employeeId"
    >,
    actorContext: ActorContext,
  ): Promise<EmployeeDocument> {
    const { files } = getApplicationDataServices();
    this.assertCanManage(employeeId, actorContext);
    if (fileBlob.size === 0) throw new Error("The selected document is empty.");
    if (fileBlob.size > MAX_DOCUMENT_SIZE) throw new Error("Documents cannot exceed 10 MB.");
    if (!ALLOWED_DOCUMENT_TYPES.has(fileBlob.type)) {
      throw new Error("Documents must be PDF, JPG or PNG files.");
    }
    assertValidDocumentMetadata(metadata);

    // 1. Save file blob to IndexedDB
    const fileRecord = await files.save(
      {
        blob: fileBlob,
        name: filename,
        owner: { entityType: "employee", entityId: employeeId },
      },
      actorContext,
    );

    // 2. Save document metadata
    // If the uploader is HR/Super Admin, they might immediately mark it Valid.
    // Employee uploads await HR review; HR and Super Admin uploads are treated as verified.
    const isHr =
      actorContext.actor.activeRole === "HR" || actorContext.actor.activeRole === "Super Admin";
    const initialStatus = isHr ? "Valid" : "Pending Verification";

    try {
      return this.documentRepo.create(
        {
          employeeId,
          fileId: fileRecord.id,
          status: initialStatus,
          ...metadata,
        },
        actorContext,
      );
    } catch (error) {
      await files.delete(fileRecord.id, {
        actor: actorContext.actor,
        reason: "Removed file after document record creation failed",
      });
      throw error;
    }
  }

  async replaceDocument(
    oldDocumentId: string,
    fileBlob: Blob,
    filename: string,
    metadata: Omit<
      EmployeeDocument,
      | "id"
      | "createdAt"
      | "createdBy"
      | "updatedAt"
      | "updatedBy"
      | "recordVersion"
      | "archivedAt"
      | "status"
      | "fileId"
      | "employeeId"
    >,
    actorContext: ActorContext,
  ): Promise<EmployeeDocument> {
    const oldDoc = this.documentRepo.getById(oldDocumentId);
    if (!oldDoc) throw new Error("Document to replace not found.");
    this.assertCanManage(oldDoc.employeeId, actorContext);

    // Uploading the new document and marking the old one Replaced are two separate writes - if
    // the second fails, the old document must not be left looking Valid/current alongside the
    // new one, with no version chain linking them.
    const { storage, files } = getApplicationDataServices();
    const snapshot = storage.exportState();
    let newDoc: EmployeeDocument | undefined;
    try {
      // Upload new document
      newDoc = await this.uploadDocument(
        oldDoc.employeeId,
        fileBlob,
        filename,
        metadata,
        actorContext,
      );

      // Update old document status to replaced and link it
      this.documentRepo.update(
        oldDoc.id,
        {
          status: "Replaced",
          replacedById: newDoc.id,
        },
        actorContext,
      );

      return newDoc;
    } catch (err) {
      storage.replaceState(snapshot);
      // The new document's record is reverted by the snapshot restore above, but its file blob
      // lives outside storage's snapshot scope - it must be deleted explicitly, or it becomes an
      // orphaned file with no document record pointing to it.
      if (newDoc) await files.delete(newDoc.fileId, actorContext);
      throw new Error(
        `Failed to replace document: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  verifyDocument(documentId: string, actorContext: ActorContext) {
    const doc = this.documentRepo.getById(documentId);
    if (!doc || doc.status !== "Pending Verification")
      throw new Error("Document is not pending verification");
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.deny(
        "verify document",
        doc.employeeId,
        actorContext,
        "Only HR or a Super Admin can verify documents.",
      );
    }
    if (actorContext.actor.employeeId === doc.employeeId) {
      this.deny(
        "verify document",
        doc.employeeId,
        actorContext,
        "You cannot verify your own document.",
      );
    }

    this.documentRepo.update(documentId, { status: "Valid" }, actorContext);
  }

  rejectDocument(documentId: string, reason: string, actorContext: ActorContext) {
    const doc = this.documentRepo.getById(documentId);
    if (!doc || doc.status !== "Pending Verification")
      throw new Error("Document is not pending verification");
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.deny(
        "reject document",
        doc.employeeId,
        actorContext,
        "Only HR or a Super Admin can reject documents.",
      );
    }
    if (actorContext.actor.employeeId === doc.employeeId) {
      this.deny(
        "reject document",
        doc.employeeId,
        actorContext,
        "You cannot reject your own document.",
      );
    }
    if (!reason || reason.trim().length < 3) throw new Error("Rejection reason is required");

    this.documentRepo.update(
      documentId,
      {
        status: "Rejected",
        rejectionReason: reason,
      },
      actorContext,
    );
  }

  async downloadFile(
    fileId: string,
    actorContext: ActorContext,
  ): Promise<{ blob: Blob; metadata: FileMetadata }> {
    const { files } = getApplicationDataServices();
    const document = this.documentRepo.list().find((item) => item.fileId === fileId);
    if (!document) throw new Error("Document record not found");
    const employee = this.employeeRepo.getById(document.employeeId, { includeArchived: true });
    const isSelf = actorContext.actor.employeeId === document.employeeId;
    const isHrOrAdmin =
      actorContext.actor.activeRole === "HR" || actorContext.actor.activeRole === "Super Admin";
    const isDirectManager =
      actorContext.actor.activeRole === "Line Manager" &&
      actorContext.actor.employeeId !== undefined &&
      employee?.lineManagerId === actorContext.actor.employeeId;
    if (!isSelf && !isHrOrAdmin && !(isDirectManager && document.visibility === "Public")) {
      this.deny(
        "access document file",
        document.employeeId,
        actorContext,
        "You do not have permission to access this document.",
      );
    }
    const metadata = await files.getMetadata(fileId);
    const blob = await files.getBlob(fileId);

    if (!metadata || !blob) throw new Error("File not found");
    getApplicationDataServices().audit.record({
      context: actorContext,
      action: actorContext.reason?.toLowerCase().includes("download") ? "download" : "view",
      module: "core-hr",
      entityType: "employee_document",
      entityId: document.id,
      after: { fileId, employeeId: document.employeeId, type: document.type },
      reason: actorContext.reason || "Document accessed",
      riskLevel: document.visibility === "Restricted" ? "Medium" : "Low",
    });
    return { blob, metadata };
  }
}
