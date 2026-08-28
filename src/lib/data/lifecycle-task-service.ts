import { getApplicationDataServices } from "./application-data.ts";
import { OffboardingService } from "./offboarding-service.ts";
import type { OffboardingCase } from "./offboarding-types.ts";
import { OnboardingService } from "./onboarding-service.ts";
import type { OnboardingCase } from "./onboarding-types.ts";
import { DocumentService } from "./document-service.ts";
import { SYSTEM_CONTEXT, type ActorContext, type EmployeeDocument } from "./types.ts";

export type LifecycleWorkflow = "onboarding" | "offboarding";

const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export class LifecycleTaskService {
  private readonly onboarding = new OnboardingService();
  private readonly offboarding = new OffboardingService();
  private readonly documents = new DocumentService();

  async openEvidence(
    workflow: LifecycleWorkflow,
    caseId: string,
    taskId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; name: string }> {
    const lifecycleCase =
      workflow === "onboarding"
        ? this.onboarding.getCaseById(caseId, context)
        : this.offboarding.getCaseById(caseId, context);
    if (!lifecycleCase) throw new Error("Case not found.");
    if (workflow === "onboarding") {
      this.onboarding.requireCaseAccess(lifecycleCase as OnboardingCase, context);
    } else {
      this.offboarding.requireCaseAccess(lifecycleCase as OffboardingCase, context);
    }
    const task = lifecycleCase.tasks.find((item) => item.id === taskId);
    if (!task?.evidenceFileId) throw new Error("No evidence is attached to this task.");
    const employeeDocument = this.documents
      .getDocumentRepository(SYSTEM_CONTEXT)
      .list()
      .find((document) => document.fileId === task.evidenceFileId);
    if (employeeDocument) {
      const result = await this.documents.downloadFile(task.evidenceFileId, {
        ...context,
        reason: "Viewed onboarding task evidence",
      });
      return { blob: result.blob, name: result.metadata.name };
    }
    const { files, audit } = getApplicationDataServices();
    const metadata = await files.getMetadata(task.evidenceFileId);
    const blob = await files.getBlob(task.evidenceFileId);
    if (!metadata || !blob) throw new Error("The evidence file is unavailable.");
    if (metadata.owner.entityType !== `${workflow}-case` || metadata.owner.entityId !== caseId) {
      throw new Error("The evidence file is not linked to this case.");
    }
    audit.record({
      context,
      action: "view",
      module: workflow,
      entityType: `${workflow}-task-evidence`,
      entityId: taskId,
      after: { fileId: metadata.id, caseId },
      reason: "Viewed task evidence",
      riskLevel: "Medium",
    });
    return { blob, name: metadata.name };
  }

  async completeOnboardingDocumentTask(
    caseId: string,
    taskId: string,
    employeeId: string,
    file: File,
    metadata: Pick<
      EmployeeDocument,
      "type" | "documentNumber" | "issueDate" | "expiryDate" | "issuingAuthority" | "notes"
    >,
    context: ActorContext,
  ): Promise<OnboardingCase> {
    const onboardingCase = this.onboarding.getCaseById(caseId, context);
    if (!onboardingCase || onboardingCase.employeeId !== employeeId) {
      throw new Error("The onboarding case does not belong to this employee.");
    }
    const task = onboardingCase.tasks.find((item) => item.id === taskId);
    if (!task || task.selfServiceFormKey !== "document_upload") {
      throw new Error("This is not an employee document task.");
    }
    if (task.documentType && metadata.type !== task.documentType) {
      throw new Error("The selected document type does not match this onboarding task.");
    }
    if (["passport", "visa", "national_id", "work_permit"].includes(metadata.type)) {
      if (
        !metadata.documentNumber?.trim() ||
        !metadata.issuingAuthority?.trim() ||
        !metadata.issueDate ||
        !metadata.expiryDate
      ) {
        throw new Error(
          "Document number, issuing authority, issue date and expiry date are required.",
        );
      }
      if (metadata.expiryDate < metadata.issueDate) {
        throw new Error("Document expiry date cannot be before its issue date.");
      }
    }
    this.validateEvidence(file);
    let document: EmployeeDocument | undefined;
    try {
      document = await this.documents.uploadDocument(
        employeeId,
        new Blob([await file.arrayBuffer()], { type: file.type }),
        file.name,
        { ...metadata, visibility: "Restricted" },
        context,
      );
      // Explicitly awaited (not just returned) so a rejection from updateTaskStatus (now async)
      // is caught by this try/catch and triggers the document cleanup below, instead of the
      // rejected promise passing straight through untouched.
      return await this.onboarding.updateTaskStatus(
        caseId,
        taskId,
        "Completed",
        context,
        document.fileId,
      );
    } catch (error) {
      if (document) {
        this.documents.getDocumentRepository(SYSTEM_CONTEXT).archive(document.id, {
          ...context,
          reason: "Removed document after onboarding task completion failed",
        });
        await getApplicationDataServices().files.delete(document.fileId, context);
      }
      throw error;
    }
  }

  async complete(
    workflow: "onboarding",
    caseId: string,
    taskId: string,
    context: ActorContext,
    evidence?: File | undefined,
  ): Promise<OnboardingCase>;
  async complete(
    workflow: "offboarding",
    caseId: string,
    taskId: string,
    context: ActorContext,
    evidence?: File | undefined,
  ): Promise<OffboardingCase>;
  async complete(
    workflow: LifecycleWorkflow,
    caseId: string,
    taskId: string,
    context: ActorContext,
    evidence?: File | undefined,
  ): Promise<OnboardingCase | OffboardingCase> {
    const task = this.getTask(workflow, caseId, taskId, context);
    if (!task) throw new Error("Task not found");
    if (task.requiresEvidence && !evidence) {
      throw new Error("Attach the required evidence before completing this task.");
    }
    if (evidence) this.validateEvidence(evidence);

    let savedFileId: string | undefined;
    try {
      if (evidence) {
        const metadata = await getApplicationDataServices().files.save(
          {
            blob: new Blob([await evidence.arrayBuffer()], { type: evidence.type }),
            name: evidence.name,
            mimeType: evidence.type,
            owner: { entityType: `${workflow}-case`, entityId: caseId },
          },
          context,
        );
        savedFileId = metadata.id;
      }
      // Explicitly awaited (not just returned) so a rejection from either branch - in
      // particular offboarding's async evidence-ownership check - is caught by this try/catch
      // and triggers the file cleanup below, instead of the rejected promise passing straight
      // through untouched (returning an unawaited promise from inside a try block bypasses its
      // own catch).
      return workflow === "onboarding"
        ? await this.onboarding.updateTaskStatus(caseId, taskId, "Completed", context, savedFileId)
        : await this.offboarding.updateTaskStatus(
            caseId,
            taskId,
            "Completed",
            context,
            savedFileId,
          );
    } catch (error) {
      if (savedFileId) await getApplicationDataServices().files.delete(savedFileId, context);
      throw error;
    }
  }

  waive(
    workflow: "onboarding",
    caseId: string,
    taskId: string,
    reason: string,
    context: ActorContext,
  ): Promise<OnboardingCase>;
  waive(
    workflow: "offboarding",
    caseId: string,
    taskId: string,
    reason: string,
    context: ActorContext,
  ): Promise<OffboardingCase>;
  async waive(
    workflow: LifecycleWorkflow,
    caseId: string,
    taskId: string,
    reason: string,
    context: ActorContext,
  ): Promise<OnboardingCase | OffboardingCase> {
    return workflow === "onboarding"
      ? this.onboarding.updateTaskStatus(caseId, taskId, "Waived", context, undefined, reason)
      : this.offboarding.updateTaskStatus(caseId, taskId, "Waived", context, undefined, reason);
  }

  private getTask(
    workflow: LifecycleWorkflow,
    caseId: string,
    taskId: string,
    context: ActorContext,
  ) {
    const lifecycleCase =
      workflow === "onboarding"
        ? this.onboarding.getCaseById(caseId, context)
        : this.offboarding.getCaseById(caseId, context);
    return lifecycleCase?.tasks.find((task) => task.id === taskId);
  }

  private validateEvidence(file: File): void {
    if (file.size === 0) throw new Error("The selected evidence file is empty.");
    if (file.size > MAX_EVIDENCE_SIZE) throw new Error("Evidence files cannot exceed 10 MB.");
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      throw new Error("Evidence must be a PDF, JPG or PNG file.");
    }
  }
}
