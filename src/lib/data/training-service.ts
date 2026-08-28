import { LocalRepository } from "./repository.ts";
import { SYSTEM_CONTEXT, type ActorContext } from "./types.ts";
import type { TrainingRecord } from "./training-types.ts";
import { DocumentService } from "./document-service.ts";
import { getApplicationDataServices } from "./application-data.ts";

export class TrainingService {
  private recordRepo: LocalRepository<TrainingRecord>;
  private documentService = new DocumentService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.recordRepo = new LocalRepository<TrainingRecord>("training_records", storage, audit, {
      module: "hr",
      entityType: "training-record",
    });
  }

  getRecords() {
    return this.recordRepo.list();
  }

  getRecordsForUser(employeeId: string) {
    return this.recordRepo.list().filter((r) => r.employeeId === employeeId);
  }

  private assertCanAdd(employeeId: string, context: ActorContext): void {
    const isSelf = context.actor.employeeId === employeeId;
    const isHrOrAdmin =
      context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    if (isSelf || isHrOrAdmin) return;

    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "training",
      entityType: "training-record",
      entityId: employeeId,
      reason: "Attempted to add training to another employee without HR access",
      riskLevel: "High",
    });
    throw new Error(
      "You can add training only for yourself, or while acting as HR or Super Admin.",
    );
  }

  addRecord(
    data: {
      employeeId: string;
      title: string;
      provider: string;
      completionDate: string;
      expiryDate?: string;
      certificateFileId?: string;
    },
    context: ActorContext,
  ) {
    this.assertCanAdd(data.employeeId, context);
    if (data.expiryDate && data.expiryDate < data.completionDate) {
      throw new Error("The expiry date cannot be before the completion date.");
    }
    const record = this.recordRepo.create(
      {
        employeeId: data.employeeId,
        title: data.title,
        provider: data.provider,
        completionDate: data.completionDate,
        ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
        ...(data.certificateFileId !== undefined
          ? { certificateFileId: data.certificateFileId }
          : {}),
        hrVerified: false,
      },
      context,
    );

    // Document Integration - the certificate file is already uploaded (via the training
    // request's own upload step) by the time we get here, so we only need to register its
    // metadata as an EmployeeDocument, not upload a new blob.
    if (data.certificateFileId) {
      this.documentService.getDocumentRepository(SYSTEM_CONTEXT).create(
        {
          employeeId: data.employeeId,
          type: "professional_certificate",
          fileId: data.certificateFileId,
          issueDate: data.completionDate,
          ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
          notes: `Certificate for training: ${data.title}`,
          visibility: "Public",
          status: "Pending Verification",
        },
        context,
      );
    }

    return record;
  }

  async addRecordWithCertificate(
    data: {
      employeeId: string;
      title: string;
      provider: string;
      completionDate: string;
      expiryDate?: string;
    },
    file: { blob: Blob; name: string },
    context: ActorContext,
  ) {
    this.assertCanAdd(data.employeeId, context);
    const { files } = getApplicationDataServices();
    const savedFile = await files.save(
      {
        blob: file.blob,
        name: file.name,
        owner: { entityType: "employee", entityId: data.employeeId },
      },
      context,
    );

    try {
      return this.addRecord({ ...data, certificateFileId: savedFile.id }, context);
    } catch (error) {
      await files.delete(savedFile.id, {
        actor: context.actor,
        reason: "Removed certificate after training record creation failed",
      });
      throw error;
    }
  }

  verifyRecord(recordId: string, context: ActorContext) {
    const record = this.recordRepo.getById(recordId);
    if (!record) throw new Error("Record not found");
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      getApplicationDataServices().audit.record({
        context,
        action: "access-denied",
        module: "training",
        entityType: "training-record",
        entityId: recordId,
        reason: "Attempted to verify training without HR access",
        riskLevel: "High",
      });
      throw new Error("Only HR or a Super Admin can verify training records.");
    }
    if (record.certificateFileId) {
      const document = this.documentService
        .getDocumentRepository(SYSTEM_CONTEXT)
        .list()
        .find((item) => item.fileId === record.certificateFileId);
      if (document?.status === "Pending Verification") {
        this.documentService.verifyDocument(document.id, context);
      }
    }
    return this.recordRepo.update(recordId, { hrVerified: true }, context);
  }
}
