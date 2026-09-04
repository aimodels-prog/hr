import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import {
  createOffboardingCaseInDatabase,
  createOnboardingCaseInDatabase,
  cancelOnboardingCaseInDatabase,
  assignOffboardingTaskOwnerInDatabase,
  archiveLifecycleTemplateInDatabase,
  cancelOffboardingCaseInDatabase,
  ensureCoreHrLifecycleTemplates,
  finaliseOffboardingCaseInDatabase,
  grantOffboardingClearanceInDatabase,
  listCoreHrLifecycleForActor,
  rescheduleOnboardingCaseInDatabase,
  readLifecycleTaskEvidenceInDatabase,
  saveOnboardingSelfServiceInDatabase,
  saveOffboardingTemplateInDatabase,
  saveOnboardingTemplateInDatabase,
  updateOffboardingTaskInDatabase,
  updateOnboardingTaskInDatabase,
} from "../db/repositories/core-hr-lifecycle.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { deleteObjectFile, saveObjectFile } from "../db/object-storage.server.ts";
import { ROLE_VALUES } from "../data/types.ts";
import {
  decideEmployeeDocumentInDatabase,
  listEmployeeDocumentsForActor,
  readEmployeeDocumentInDatabase,
  removeFailedEmployeeDocumentUploadInDatabase,
  replaceEmployeeDocumentInDatabase,
  uploadEmployeeDocumentToDatabase,
  updateDocumentExpiryTrackingInDatabase,
} from "../db/repositories/employee-document.repository.server.ts";
import {
  assignCompanyAssetInDatabase,
  closeCompanyAssetAssignmentInDatabase,
  listCompanyAssetAssignmentsForActor,
} from "../db/repositories/company-asset.repository.server.ts";
import { rolloverLeaveBalancesInDatabase } from "../db/repositories/leave.repository.server.ts";

const Actor = z
  .object({
    actorId: z.string().min(1),
    actorEmail: z.string().email().optional(),
    activeRole: z.enum(ROLE_VALUES),
  })
  .strict();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

async function verify(actorInput: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(
    actorInput.actorId,
    actorInput.actorEmail,
  );
  const verification = await verifyServerActorRole(
    organisationId,
    actorInput.actorId,
    undefined,
    actorInput.actorEmail,
  );
  if (!verification.verified || !verification.actor?.roles.includes(actorInput.activeRole)) {
    throw new Error("Your VIA access could not be verified.");
  }
  return {
    organisationId,
    actor: { ...verification.actor, activeRole: actorInput.activeRole },
  };
}

async function lifecycleSnapshotAfterChange(
  organisationId: string,
  actor: Awaited<ReturnType<typeof verify>>["actor"],
  caseId?: string,
) {
  const snapshot = await listCoreHrLifecycleForActor(organisationId, actor);
  const completedOwnCase = caseId
    ? snapshot.onboardingCases.find((item) => {
        if (item.id !== caseId || item.employeeId !== actor.employeeId) return false;
        const required = item.tasks.filter(
          (task) => task.ownerRole === "Employee" && task.isMandatory && task.selfServiceFormKey,
        );
        return (
          required.length > 0 &&
          required.every((task) => task.status === "Completed" || task.status === "Waived")
        );
      })
    : undefined;
  if (completedOwnCase && actor.employeeId) {
    await rolloverLeaveBalancesInDatabase(
      organisationId,
      new Date().getUTCFullYear(),
      actor,
      actor.employeeId,
    );
  }
  return snapshot;
}

export const getCoreHrLifecycleSnapshotFn = createServerFn({ method: "POST" })
  .validator((input: { actor: z.infer<typeof Actor> }) =>
    z.object({ actor: Actor }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    if (verified.actor.activeRole === "HR" || verified.actor.activeRole === "Super Admin") {
      await ensureCoreHrLifecycleTemplates(verified.organisationId, verified.actor);
    }
    return listCoreHrLifecycleForActor(verified.organisationId, verified.actor);
  });

const TemplateRole = z.enum(ROLE_VALUES);
const OnboardingTemplateTask = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(3).max(300),
    group: z.string().min(1).max(100),
    checkpoint: z.string().min(1).max(50),
    ownerRole: TemplateRole,
    assignedUserId: z.string().uuid().optional(),
    offsetDaysFromStart: z.number().int().min(-365).max(365),
    isMandatory: z.boolean(),
    requiresEvidence: z.boolean(),
    instructions: z.string().trim().max(2000).optional(),
    dependsOnTaskIds: z.array(z.string().min(1).max(100)).max(50).optional(),
    selfServiceFormKey: z
      .enum(["employment_details", "personal_details", "bank_details", "document_upload"])
      .optional(),
    documentType: z.string().max(100).optional(),
    verificationDocumentType: z.string().max(100).optional(),
    requiresBankDetails: z.boolean().optional(),
  })
  .strict();
const SaveOnboardingTemplate = z
  .object({
    actor: Actor,
    template: z
      .object({
        id: z.string().min(1),
        recordVersion: z.number().int().positive(),
        name: z.string(),
        description: z.string(),
        isActive: z.boolean(),
        countries: z.array(z.string()),
        legalEntities: z.array(z.string()),
        departments: z.array(z.string()),
        roles: z.array(z.string()),
        employmentTypes: z.array(z.string()),
        tasks: z.array(OnboardingTemplateTask).min(1).max(100),
      })
      .strict(),
  })
  .strict();
export const saveOnboardingTemplateFn = createServerFn({ method: "POST" })
  .validator((input) => SaveOnboardingTemplate.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return saveOnboardingTemplateInDatabase(
      verified.organisationId,
      data.template as Parameters<typeof saveOnboardingTemplateInDatabase>[1],
      verified.actor,
    );
  });

const OffboardingTemplateTask = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(3).max(300),
    group: z.string().min(1).max(100),
    ownerRole: TemplateRole,
    assignedUserId: z.string().uuid().optional(),
    offsetDaysFromLastWorkingDate: z.number().int().min(-365).max(365),
    isMandatory: z.boolean(),
    requiresEvidence: z.boolean(),
    instructions: z.string().trim().max(2000).optional(),
    dependsOnTaskIds: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict();
const SaveOffboardingTemplate = z
  .object({
    actor: Actor,
    template: z
      .object({
        id: z.string().min(1),
        recordVersion: z.number().int().positive(),
        name: z.string(),
        description: z.string(),
        isActive: z.boolean(),
        departments: z.array(z.string()),
        employmentTypes: z.array(z.string()),
        tasks: z.array(OffboardingTemplateTask).min(1).max(100),
      })
      .strict(),
  })
  .strict();
export const saveOffboardingTemplateFn = createServerFn({ method: "POST" })
  .validator((input) => SaveOffboardingTemplate.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return saveOffboardingTemplateInDatabase(
      verified.organisationId,
      data.template as Parameters<typeof saveOffboardingTemplateInDatabase>[1],
      verified.actor,
    );
  });

const ArchiveTemplate = z
  .object({
    actor: Actor,
    workflow: z.enum(["onboarding", "offboarding"]),
    templateId: z.string().uuid(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const archiveLifecycleTemplateFn = createServerFn({ method: "POST" })
  .validator((input) => ArchiveTemplate.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await archiveLifecycleTemplateInDatabase(
      verified.organisationId,
      data.workflow,
      data.templateId,
      data.reason,
      verified.actor,
    );
  });

const StartOnboarding = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    templateId: z.string().uuid(),
    assignedHRId: z.string().uuid().optional(),
  })
  .strict();

export const startOnboardingCaseFn = createServerFn({ method: "POST" })
  .validator((input) => StartOnboarding.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return createOnboardingCaseInDatabase(
      verified.organisationId,
      {
        employeeId: data.employeeId,
        templateId: data.templateId,
        ...(data.assignedHRId ? { assignedHRId: data.assignedHRId } : {}),
      },
      verified.actor,
    );
  });

const UpdateOnboardingTask = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    status: z.enum(["Pending", "Blocked", "Completed", "Waived"]),
    evidenceFileId: z.string().uuid().optional(),
    waiverReason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();

export const updateOnboardingTaskFn = createServerFn({ method: "POST" })
  .validator((input) => UpdateOnboardingTask.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await updateOnboardingTaskInDatabase(
      verified.organisationId,
      {
        caseId: data.caseId,
        taskId: data.taskId,
        status: data.status,
        ...(data.evidenceFileId ? { evidenceFileId: data.evidenceFileId } : {}),
        ...(data.waiverReason ? { waiverReason: data.waiverReason } : {}),
      },
      verified.actor,
    );
    return lifecycleSnapshotAfterChange(verified.organisationId, verified.actor, data.caseId);
  });

const OnboardingCaseAction = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    action: z.enum(["reschedule", "cancel"]),
    reason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();
export const applyOnboardingCaseActionFn = createServerFn({ method: "POST" })
  .validator((input) => OnboardingCaseAction.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    if (data.action === "reschedule")
      await rescheduleOnboardingCaseInDatabase(
        verified.organisationId,
        data.caseId,
        verified.actor,
      );
    else
      await cancelOnboardingCaseInDatabase(
        verified.organisationId,
        data.caseId,
        data.reason ?? "Cancelled employee onboarding",
        verified.actor,
      );
    return lifecycleSnapshotAfterChange(verified.organisationId, verified.actor, data.caseId);
  });

const CompleteOnboardingWithEvidence = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();

export const completeOnboardingTaskWithEvidenceFn = createServerFn({ method: "POST" })
  .validator((input) => CompleteOnboardingWithEvidence.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const fileId = crypto.randomUUID();
    await saveObjectFile({
      id: fileId,
      organisationId: verified.organisationId,
      bytes: Uint8Array.from(data.bytes),
      name: data.fileName,
      mimeType: data.mimeType,
      owner: { entityType: "onboarding-case", entityId: data.caseId },
      actor: verified.actor,
    });
    try {
      await updateOnboardingTaskInDatabase(
        verified.organisationId,
        { caseId: data.caseId, taskId: data.taskId, status: "Completed", evidenceFileId: fileId },
        verified.actor,
      );
    } catch (error) {
      await deleteObjectFile(
        verified.organisationId,
        fileId,
        verified.actor,
        "Removed evidence after onboarding task completion failed",
      ).catch(() => undefined);
      throw error;
    }
    return lifecycleSnapshotAfterChange(verified.organisationId, verified.actor, data.caseId);
  });

const CompleteOnboardingDocumentTask = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    employeeId: z.string().uuid(),
    type: z.enum([
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
    ]),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
    documentNumber: z.string().trim().max(200).optional(),
    issueDate: IsoDate.optional(),
    expiryDate: IsoDate.optional(),
    issuingAuthority: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const completeOnboardingDocumentTaskFn = createServerFn({ method: "POST" })
  .validator((input) => CompleteOnboardingDocumentTask.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    let documentId: string | undefined;
    try {
      documentId = await uploadEmployeeDocumentToDatabase(
        verified.organisationId,
        {
          employeeId: data.employeeId,
          type: data.type,
          fileName: data.fileName,
          mimeType: data.mimeType,
          bytes: Uint8Array.from(data.bytes),
          ...(data.documentNumber ? { documentNumber: data.documentNumber } : {}),
          ...(data.issueDate ? { issueDate: data.issueDate } : {}),
          ...(data.expiryDate ? { expiryDate: data.expiryDate } : {}),
          ...(data.issuingAuthority ? { issuingAuthority: data.issuingAuthority } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
          visibility: "Restricted",
        },
        verified.actor,
      );
      const documents = await listEmployeeDocumentsForActor(
        verified.organisationId,
        verified.actor,
      );
      const document = documents.find((item) => item.id === documentId);
      if (!document) throw new Error("The uploaded employee document could not be reloaded.");
      await updateOnboardingTaskInDatabase(
        verified.organisationId,
        {
          caseId: data.caseId,
          taskId: data.taskId,
          status: "Completed",
          evidenceFileId: document.fileId,
        },
        verified.actor,
      );
    } catch (error) {
      if (documentId) {
        await removeFailedEmployeeDocumentUploadInDatabase(
          verified.organisationId,
          documentId,
          verified.actor,
          "Removed document after onboarding task completion failed",
        ).catch(() => undefined);
      }
      throw error;
    }
    return lifecycleSnapshotAfterChange(verified.organisationId, verified.actor, data.caseId);
  });

const PersonalOnboardingDetails = z
  .object({
    dateOfBirth: IsoDate,
    gender: z.enum(["Male", "Female"]),
    nationality: z.string().trim().min(1).max(100),
    maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]),
    phone: z.string().trim().min(3).max(50),
    personalEmail: z.string().email().optional(),
    address: z.string().trim().min(3).max(1000),
    emergencyContacts: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(150),
            relationship: z.string().trim().min(1).max(100),
            phone: z.string().trim().min(3).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    dependants: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(150),
            relationship: z.string().trim().min(1).max(100),
            dateOfBirth: IsoDate,
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();
const BankOnboardingDetails = z
  .object({
    bankName: z.string().trim().min(2).max(150),
    accountNumber: z.string().trim().min(3).max(100),
    iban: z.string().trim().min(8).max(100),
    swiftCode: z.string().trim().max(50).optional(),
    branch: z.string().trim().max(150).optional(),
  })
  .strict();
const EmploymentOnboardingDetails = z
  .object({
    staffEntryType: z.enum(["New Employee", "Existing Employee"]),
    legalName: z.string().trim().min(2).max(200),
    preferredName: z.string().trim().min(1).max(100),
    startDate: IsoDate,
    departmentId: z.string().uuid(),
    positionId: z.string().uuid(),
    locationId: z.string().uuid(),
    employmentTypeId: z.string().uuid(),
    lineManagerEmail: z.string().trim().toLowerCase().email(),
    visaRequired: z.boolean(),
  })
  .strict();
const SaveOnboardingSelfService = z.discriminatedUnion("kind", [
  z
    .object({
      actor: Actor,
      caseId: z.string().uuid(),
      taskId: z.string().uuid(),
      kind: z.literal("employment_details"),
      details: EmploymentOnboardingDetails,
    })
    .strict(),
  z
    .object({
      actor: Actor,
      caseId: z.string().uuid(),
      taskId: z.string().uuid(),
      kind: z.literal("personal_details"),
      details: PersonalOnboardingDetails,
    })
    .strict(),
  z
    .object({
      actor: Actor,
      caseId: z.string().uuid(),
      taskId: z.string().uuid(),
      kind: z.literal("bank_details"),
      details: BankOnboardingDetails,
    })
    .strict(),
]);
export const saveOnboardingSelfServiceFn = createServerFn({ method: "POST" })
  .validator((input) => SaveOnboardingSelfService.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await saveOnboardingSelfServiceInDatabase(
      verified.organisationId,
      data as Parameters<typeof saveOnboardingSelfServiceInDatabase>[1],
      verified.actor,
    );
    return lifecycleSnapshotAfterChange(verified.organisationId, verified.actor, data.caseId);
  });

const StartOffboarding = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    templateId: z.string().uuid(),
    assignedHRId: z.string().uuid(),
    reasonCategory: z.enum([
      "Resignation",
      "Termination",
      "Contract End",
      "Retirement",
      "Transfer",
      "Other",
    ]),
    noticeDate: IsoDate,
    lastWorkingDate: IsoDate,
    confidentialityLevel: z.enum(["Standard", "Restricted"]),
    confidentialNotes: z.string().trim().max(5000).optional(),
    rehireEligible: z.boolean(),
  })
  .strict();

export const startOffboardingCaseFn = createServerFn({ method: "POST" })
  .validator((input) => StartOffboarding.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return createOffboardingCaseInDatabase(
      verified.organisationId,
      {
        employeeId: data.employeeId,
        templateId: data.templateId,
        assignedHRId: data.assignedHRId,
        reasonCategory: data.reasonCategory,
        noticeDate: data.noticeDate,
        lastWorkingDate: data.lastWorkingDate,
        confidentialityLevel: data.confidentialityLevel,
        ...(data.confidentialNotes ? { confidentialNotes: data.confidentialNotes } : {}),
        rehireEligible: data.rehireEligible,
      },
      verified.actor,
    );
  });

const UpdateOffboardingTask = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    status: z.enum(["Pending", "Blocked", "Completed", "Waived"]),
    evidenceFileId: z.string().uuid().optional(),
    waiverReason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();

export const updateOffboardingTaskFn = createServerFn({ method: "POST" })
  .validator((input) => UpdateOffboardingTask.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await updateOffboardingTaskInDatabase(
      verified.organisationId,
      {
        caseId: data.caseId,
        taskId: data.taskId,
        status: data.status,
        ...(data.evidenceFileId ? { evidenceFileId: data.evidenceFileId } : {}),
        ...(data.waiverReason ? { waiverReason: data.waiverReason } : {}),
      },
      verified.actor,
    );
    return listCoreHrLifecycleForActor(verified.organisationId, verified.actor);
  });

const CompleteOffboardingWithEvidence = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();

export const completeOffboardingTaskWithEvidenceFn = createServerFn({ method: "POST" })
  .validator((input) => CompleteOffboardingWithEvidence.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const fileId = crypto.randomUUID();
    await saveObjectFile({
      id: fileId,
      organisationId: verified.organisationId,
      bytes: Uint8Array.from(data.bytes),
      name: data.fileName,
      mimeType: data.mimeType,
      owner: { entityType: "offboarding-case", entityId: data.caseId },
      actor: verified.actor,
    });
    try {
      await updateOffboardingTaskInDatabase(
        verified.organisationId,
        { caseId: data.caseId, taskId: data.taskId, status: "Completed", evidenceFileId: fileId },
        verified.actor,
      );
    } catch (error) {
      await deleteObjectFile(
        verified.organisationId,
        fileId,
        verified.actor,
        "Removed evidence after offboarding task completion failed",
      ).catch(() => undefined);
      throw error;
    }
    return listCoreHrLifecycleForActor(verified.organisationId, verified.actor);
  });

const ReadLifecycleEvidence = z
  .object({
    actor: Actor,
    workflow: z.enum(["onboarding", "offboarding"]),
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
  })
  .strict();
export const readLifecycleTaskEvidenceFn = createServerFn({ method: "POST" })
  .validator((input) => ReadLifecycleEvidence.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const result = await readLifecycleTaskEvidenceInDatabase(
      verified.organisationId,
      data.workflow,
      data.caseId,
      data.taskId,
      verified.actor,
    );
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });

const AssignOffboardingTask = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    assignedUserId: z.string().uuid().optional(),
  })
  .strict();
export const assignOffboardingTaskFn = createServerFn({ method: "POST" })
  .validator((input) => AssignOffboardingTask.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await assignOffboardingTaskOwnerInDatabase(
      verified.organisationId,
      data.caseId,
      data.taskId,
      data.assignedUserId,
      verified.actor,
    );
  });

const OffboardingAction = z
  .object({
    actor: Actor,
    caseId: z.string().uuid(),
    action: z.enum(["financial-clearance", "legal-clearance", "finalise"]),
    reason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();
export const applyOffboardingActionFn = createServerFn({ method: "POST" })
  .validator((input) => OffboardingAction.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    if (data.action === "financial-clearance")
      await grantOffboardingClearanceInDatabase(
        verified.organisationId,
        data.caseId,
        "financial",
        verified.actor,
      );
    else if (data.action === "legal-clearance")
      await grantOffboardingClearanceInDatabase(
        verified.organisationId,
        data.caseId,
        "legal",
        verified.actor,
      );
    else
      await finaliseOffboardingCaseInDatabase(verified.organisationId, data.caseId, verified.actor);
    return listCoreHrLifecycleForActor(verified.organisationId, verified.actor);
  });

const CancelOffboarding = z
  .object({ actor: Actor, caseId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) })
  .strict();
export const cancelOffboardingCaseFn = createServerFn({ method: "POST" })
  .validator((input) => CancelOffboarding.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await cancelOffboardingCaseInDatabase(
      verified.organisationId,
      data.caseId,
      data.reason,
      verified.actor,
    );
    return listCoreHrLifecycleForActor(verified.organisationId, verified.actor);
  });

const DocumentType = z.enum([
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
const DocumentBytes = z
  .array(z.number().int().min(0).max(255))
  .min(1)
  .max(10 * 1024 * 1024);

export const getEmployeeDocumentsFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listEmployeeDocumentsForActor(verified.organisationId, verified.actor);
  });

const UploadEmployeeDocument = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    type: DocumentType,
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: DocumentBytes,
    documentNumber: z.string().trim().max(255).optional(),
    issueDate: IsoDate.optional(),
    expiryDate: IsoDate.optional(),
    issuingAuthority: z.string().trim().max(255).optional(),
    issuingCountry: z.string().trim().max(255).optional(),
    notes: z.string().trim().max(2000).optional(),
    visibility: z.enum(["Public", "Restricted"]),
  })
  .strict();

export const uploadEmployeeDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => UploadEmployeeDocument.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return uploadEmployeeDocumentToDatabase(
      verified.organisationId,
      {
        employeeId: data.employeeId,
        type: data.type,
        fileName: data.fileName,
        mimeType: data.mimeType,
        bytes: Uint8Array.from(data.bytes),
        ...(data.documentNumber ? { documentNumber: data.documentNumber } : {}),
        ...(data.issueDate ? { issueDate: data.issueDate } : {}),
        ...(data.expiryDate ? { expiryDate: data.expiryDate } : {}),
        ...(data.issuingAuthority ? { issuingAuthority: data.issuingAuthority } : {}),
        ...(data.issuingCountry ? { issuingCountry: data.issuingCountry } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
        visibility: data.visibility,
      },
      verified.actor,
    );
  });

const ReplaceEmployeeDocument = z
  .object({
    actor: Actor,
    documentId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: DocumentBytes,
    reason: z.string().trim().min(3).max(1000),
    documentNumber: z.string().trim().max(255).optional(),
    issueDate: IsoDate.optional(),
    expiryDate: IsoDate.optional(),
    issuingAuthority: z.string().trim().max(255).optional(),
    issuingCountry: z.string().trim().max(255).optional(),
    notes: z.string().trim().max(2000).optional(),
    visibility: z.enum(["Public", "Restricted"]).optional(),
  })
  .strict();
export const replaceEmployeeDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => ReplaceEmployeeDocument.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return replaceEmployeeDocumentInDatabase(
      verified.organisationId,
      data.documentId,
      {
        fileName: data.fileName,
        mimeType: data.mimeType,
        bytes: Uint8Array.from(data.bytes),
        reason: data.reason,
        ...(data.documentNumber ? { documentNumber: data.documentNumber } : {}),
        ...(data.issueDate ? { issueDate: data.issueDate } : {}),
        ...(data.expiryDate ? { expiryDate: data.expiryDate } : {}),
        ...(data.issuingAuthority ? { issuingAuthority: data.issuingAuthority } : {}),
        ...(data.issuingCountry ? { issuingCountry: data.issuingCountry } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
        ...(data.visibility ? { visibility: data.visibility } : {}),
      },
      verified.actor,
    );
  });

const DecideEmployeeDocument = z
  .object({
    actor: Actor,
    documentId: z.string().uuid(),
    decision: z.enum(["verify", "reject"]),
    reason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
export const decideEmployeeDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => DecideEmployeeDocument.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await decideEmployeeDocumentInDatabase(
      verified.organisationId,
      data.documentId,
      data.decision,
      data.reason,
      verified.actor,
    );
  });

const ReadEmployeeDocument = z
  .object({ actor: Actor, fileId: z.string().uuid(), reason: z.string().trim().min(3).max(500) })
  .strict();
export const readEmployeeDocumentFn = createServerFn({ method: "POST" })
  .validator((input) => ReadEmployeeDocument.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const result = await readEmployeeDocumentInDatabase(
      verified.organisationId,
      data.fileId,
      verified.actor,
      data.reason,
    );
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });

const DocumentExpiryAction = z.discriminatedUnion("kind", [
  z
    .object({
      actor: Actor,
      documentId: z.string().uuid(),
      kind: z.literal("assign"),
      ownerEmployeeId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      actor: Actor,
      documentId: z.string().uuid(),
      kind: z.literal("snooze"),
      until: IsoDate,
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
  z
    .object({
      actor: Actor,
      documentId: z.string().uuid(),
      kind: z.literal("waive"),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
]);
export const updateDocumentExpiryTrackingFn = createServerFn({ method: "POST" })
  .validator((input) => DocumentExpiryAction.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const action =
      data.kind === "assign"
        ? ({ kind: data.kind, ownerEmployeeId: data.ownerEmployeeId } as const)
        : data.kind === "snooze"
          ? ({ kind: data.kind, until: data.until, reason: data.reason } as const)
          : ({ kind: data.kind, reason: data.reason } as const);
    await updateDocumentExpiryTrackingInDatabase(
      verified.organisationId,
      data.documentId,
      action,
      verified.actor,
    );
  });

export const getCompanyAssetAssignmentsFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listCompanyAssetAssignmentsForActor(verified.organisationId, verified.actor);
  });

const AssetType = z.enum([
  "Laptop",
  "Desktop",
  "Monitor",
  "Phone",
  "SIM Card",
  "Access Card",
  "Vehicle",
  "Other",
]);
const AssetCondition = z.enum(["New", "Good", "Fair", "Damaged"]);
const AssignAsset = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    assetType: AssetType,
    assetTag: z.string().trim().min(2).max(100),
    description: z.string().trim().min(3).max(500),
    assignedDate: IsoDate,
    conditionAtAssignment: AssetCondition,
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export const assignCompanyAssetFn = createServerFn({ method: "POST" })
  .validator((input) => AssignAsset.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return assignCompanyAssetInDatabase(
      verified.organisationId,
      {
        employeeId: data.employeeId,
        assetType: data.assetType,
        assetTag: data.assetTag,
        description: data.description,
        assignedDate: data.assignedDate,
        conditionAtAssignment: data.conditionAtAssignment,
        ...(data.notes ? { notes: data.notes } : {}),
      },
      verified.actor,
    );
  });

const CloseAsset = z
  .object({
    actor: Actor,
    assignmentId: z.string().uuid(),
    outcome: z.enum(["Returned", "Lost", "Damaged"]),
    condition: AssetCondition.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export const closeCompanyAssetAssignmentFn = createServerFn({ method: "POST" })
  .validator((input) => CloseAsset.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await closeCompanyAssetAssignmentInDatabase(
      verified.organisationId,
      data.assignmentId,
      data.outcome,
      data.condition,
      data.notes,
      verified.actor,
    );
  });
