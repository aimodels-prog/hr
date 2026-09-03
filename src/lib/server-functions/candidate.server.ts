import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { submitPublicApplicationToDatabase } from "../db/repositories/public-application.repository.server.ts";
import {
  PublicApplicationSchema,
  validatePublicCv,
} from "../recruitment/public-application-validation.server.ts";
import {
  listPanelInterviewReadSnapshot,
  listRecruitmentReadSnapshot,
} from "../db/repositories/recruitment-read.repository.server.ts";
import {
  resolveDefaultOrganisationId,
  resolveOrganisationIdForActor,
  verifyServerActorRole,
} from "../db/utils.server.ts";
import { ROLE_VALUES } from "../data/types.ts";
import { and, eq } from "drizzle-orm";
import { getDatabaseClient } from "../db/client.ts";
import { candidateCvRecords } from "../db/schema/recruitment.ts";
import { readObjectFile } from "../db/object-storage.server.ts";
import {
  addCandidateRecommendationInDatabase,
  exportCandidatesFromDatabase,
  logCandidateContactInDatabase,
  mergeCandidatesInDatabase,
  reassignCandidateOwnerInDatabase,
  updateCandidateDetailsInDatabase,
  updateCandidateStageInDatabase,
} from "../db/repositories/candidate-mutation.repository.server.ts";
import {
  finaliseCandidateCvIntakeInDatabase,
  processNextCandidateCvJob,
  uploadCandidateCvIntakeToDatabase,
} from "../db/repositories/candidate-cv-intake.repository.server.ts";
import {
  createAssessmentBatchInDatabase,
  finaliseShortlistInDatabase,
  includeCandidateInAssessmentInDatabase,
  runDetailedAssessmentInDatabase,
  saveShortlistDraftInDatabase,
  updateAssessmentSelectionInDatabase,
} from "../db/repositories/recruitment-screening.repository.server.ts";
import { importCandidatesInDatabase } from "../db/repositories/candidate-import.repository.server.ts";
import { parseCandidateSpreadsheetInDatabase } from "../db/repositories/candidate-spreadsheet.repository.server.ts";

const RecruitmentActor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

async function verifyRecruitmentActor(data: z.infer<typeof RecruitmentActor>) {
  const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
  const verified = await verifyServerActorRole(
    organisationId,
    data.actorId,
    undefined,
    data.actorEmail,
  );
  if (
    !verified.verified ||
    !verified.actor?.roles.includes(data.activeRole) ||
    (data.activeRole !== "HR" && data.activeRole !== "Super Admin")
  ) {
    throw new Error("Only HR or a Super Admin can manage recruitment.");
  }
  return { organisationId, actor: { ...verified.actor, activeRole: data.activeRole } };
}

export const getRecruitmentSnapshotFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof RecruitmentActor>) => RecruitmentActor.parse(input))
  .handler(async ({ data }) => {
    const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const verified = await verifyServerActorRole(
      organisationId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!verified.verified || !verified.actor?.roles.includes(data.activeRole)) {
      throw new Error("Your VIA session is not authorised to view recruitment records.");
    }
    if (data.activeRole === "HR" || data.activeRole === "Super Admin") {
      return listRecruitmentReadSnapshot(organisationId);
    }
    return listPanelInterviewReadSnapshot(organisationId, verified.actor.userId);
  });

const CandidateStageChange = z.object({
  actor: RecruitmentActor,
  candidateId: z.string().uuid(),
  stage: z.enum([
    "Sourced",
    "Applied",
    "Screened",
    "Shortlisted",
    "Interview",
    "Offer",
    "Hired",
    "On Hold",
    "Not Selected",
    "Withdrawn",
    "Archived",
  ]),
  reason: z.string().trim().min(3).max(500),
});

export const updateCandidateStageFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateStageChange>) => CandidateStageChange.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await updateCandidateStageInDatabase(
      verified.organisationId,
      data.candidateId,
      data.stage,
      verified.actor,
      data.reason,
    );
  });

const CandidateOwnerChange = z.object({
  actor: RecruitmentActor,
  candidateId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const reassignCandidateOwnerFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateOwnerChange>) => CandidateOwnerChange.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await reassignCandidateOwnerInDatabase(
      verified.organisationId,
      data.candidateId,
      data.ownerUserId,
      verified.actor,
      data.reason,
    );
  });

const CandidateDetailsChange = z.object({
  actor: RecruitmentActor,
  candidateId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  details: z.object({
    email: z.string().trim().email(),
    phone: z.string().trim().min(5).max(50),
    currentTitle: z.string().trim().max(200).optional(),
    currentCompany: z.string().trim().max(200).optional(),
    yearsOfExperience: z.number().int().min(0).max(80),
    nationality: z.string().trim().max(100).optional(),
    location: z.string().trim().min(1).max(200),
    projectId: z.string().uuid().optional(),
    projectName: z.string().trim().max(200).optional(),
    projectType: z.string().trim().max(200).optional(),
    shortlistStatus: z.string().trim().max(200).optional(),
    trackerStatus: z.string().trim().max(200).optional(),
    visaStatus: z
      .enum([
        "Own Visa",
        "Company Visa",
        "Freelance Visa",
        "Visit Visa",
        "Requires Sponsorship",
        "Omani (No Visa Required)",
        "Not Applicable",
        "Other",
      ])
      .optional(),
    maritalStatus: z
      .enum(["Single", "Married", "Married (With Family)", "Not Specified"])
      .optional(),
    noticePeriod: z.string().trim().max(200).optional(),
    currentSalary: z.string().trim().max(200).optional(),
    expectedSalary: z.string().trim().max(200).optional(),
    acceptedSalary: z.string().trim().max(200).optional(),
    interviewDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    remarks: z.string().trim().max(5000).optional(),
  }),
});

export const updateCandidateDetailsFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateDetailsChange>) => CandidateDetailsChange.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await updateCandidateDetailsInDatabase(
      verified.organisationId,
      data.candidateId,
      data.details,
      verified.actor,
      data.reason,
    );
  });

const CandidateMerge = z.object({
  actor: RecruitmentActor,
  primaryId: z.string().uuid(),
  duplicateId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});

export const mergeCandidatesFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateMerge>) => CandidateMerge.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await mergeCandidatesInDatabase(
      verified.organisationId,
      data.primaryId,
      data.duplicateId,
      verified.actor,
      data.reason,
    );
  });

const CandidateContact = z.object({
  actor: RecruitmentActor,
  contact: z.object({
    candidateId: z.string().uuid(),
    channel: z.enum(["Email", "Phone", "LinkedIn", "In-Person", "Other"]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vacancyId: z.string().uuid().optional(),
    outcome: z.enum([
      "No Answer",
      "Interested",
      "Not Interested",
      "Follow-up Required",
      "Interview Arranged",
      "Unavailable",
      "Invalid Contact",
      "Do Not Contact",
    ]),
    notes: z.string().trim().min(1).max(5000),
    nextFollowUpDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
});

export const logCandidateContactFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateContact>) => CandidateContact.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return logCandidateContactInDatabase(verified.organisationId, data.contact, verified.actor);
  });

const CandidateRecommendation = z.object({
  actor: RecruitmentActor,
  recommendation: z
    .object({
      candidateId: z.string().uuid(),
      vacancyId: z.string().uuid().optional(),
      recommenderType: z.enum([
        "Agency",
        "Employee Referral",
        "External Person",
        "Client",
        "Supplier",
        "Company",
      ]),
      recommenderName: z.string().trim().min(1).max(200),
      recommenderCompany: z.string().trim().max(200).optional(),
      recommenderPosition: z.string().trim().max(200).optional(),
      recommenderEmail: z.union([z.literal(""), z.string().trim().email()]),
      recommenderPhone: z.string().trim().max(50).optional(),
      relationship: z.string().trim().max(500).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().trim().min(1).max(5000),
      commercialTerms: z.string().trim().max(2000).optional(),
    })
    .refine((value) => value.recommenderEmail || value.recommenderPhone?.trim(), {
      path: ["recommenderPhone"],
      message: "Enter the recommender's email or phone number.",
    }),
});

export const addCandidateRecommendationFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateRecommendation>) =>
    CandidateRecommendation.parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return addCandidateRecommendationInDatabase(
      verified.organisationId,
      data.recommendation,
      verified.actor,
    );
  });

const CandidateExport = z.object({
  actor: RecruitmentActor,
  candidateIds: z.array(z.string().uuid()).min(1).max(5000),
  reason: z.string().trim().min(3).max(500),
});

export const exportCandidatesFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateExport>) => CandidateExport.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return exportCandidatesFromDatabase(
      verified.organisationId,
      data.candidateIds,
      verified.actor,
      data.reason,
    );
  });

const CandidateCvDownload = z.object({
  actor: RecruitmentActor,
  cvRecordId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const downloadCandidateCvFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof CandidateCvDownload>) => CandidateCvDownload.parse(input))
  .handler(async ({ data }) => {
    const organisationId = await resolveOrganisationIdForActor(
      data.actor.actorId,
      data.actor.actorEmail,
    );
    const verified = await verifyServerActorRole(
      organisationId,
      data.actor.actorId,
      undefined,
      data.actor.actorEmail,
    );
    if (
      !verified.verified ||
      !verified.actor?.roles.includes(data.actor.activeRole) ||
      (data.actor.activeRole !== "HR" && data.actor.activeRole !== "Super Admin")
    ) {
      throw new Error("Only HR or a Super Admin can access candidate CVs.");
    }
    const db = getDatabaseClient();
    const [cv] = await db
      .select({ fileId: candidateCvRecords.fileId })
      .from(candidateCvRecords)
      .where(
        and(
          eq(candidateCvRecords.organisationId, organisationId),
          eq(candidateCvRecords.id, data.cvRecordId),
        ),
      )
      .limit(1);
    if (!cv) throw new Error("The CV record was not found.");
    const file = await readObjectFile(
      organisationId,
      cv.fileId,
      { ...verified.actor, activeRole: data.actor.activeRole },
      data.reason,
    );
    return {
      metadata: file.metadata,
      fileBase64: Buffer.from(file.bytes).toString("base64"),
    };
  });

const DirectCandidateCv = z
  .object({
    actor: RecruitmentActor,
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().max(150),
    fileBase64: z.string().min(1).max(14_000_000),
    source: z.enum([
      "Careers Portal",
      "Direct Email",
      "WhatsApp",
      "Employee Referral",
      "Agency",
      "Walk-in",
      "HR Upload",
      "Other",
    ]),
    receivedAt: z.string().datetime(),
    consentStatus: z.enum([
      "Confirmed",
      "Privacy Notice Sent",
      "Awaiting Confirmation",
      "Refused",
      "Expired",
    ]),
    vacancyId: z.string().uuid().optional(),
    notes: z.string().trim().max(5000).optional(),
    isRecommended: z.boolean().default(false),
  })
  .strict();

export const uploadCandidateCvFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof DirectCandidateCv>) => DirectCandidateCv.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    const bytes = Buffer.from(data.fileBase64, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("CV must be no larger than 10 MB.");
    }
    const mimeType = validatePublicCv(data.fileName, data.mimeType, bytes);
    const receivedAt = new Date(data.receivedAt);
    if (receivedAt.getTime() > Date.now())
      throw new Error("Date received cannot be in the future.");
    const result = await uploadCandidateCvIntakeToDatabase(
      verified.organisationId,
      {
        fileName: data.fileName,
        mimeType,
        bytes,
        source: data.source,
        receivedAt: receivedAt.toISOString(),
        consentStatus: data.consentStatus,
        ...(data.vacancyId ? { vacancyId: data.vacancyId } : {}),
        ...(data.notes ? { notes: data.notes } : {}),
        isRecommended: data.isRecommended,
      },
      verified.actor,
    );

    // The durable job exists before this responsive first attempt. If the request
    // ends early, the standalone worker can safely resume it later.
    await processNextCandidateCvJob(`interactive:${verified.actor.userId}`, result.jobId);
    return result;
  });

const FinaliseCandidateCv = z
  .object({
    actor: RecruitmentActor,
    cvRecordId: z.string().uuid(),
    existingCandidateId: z.string().uuid().optional(),
    vacancyId: z.string().uuid().optional(),
    consentStatus: z.enum([
      "Confirmed",
      "Privacy Notice Sent",
      "Awaiting Confirmation",
      "Refused",
      "Expired",
    ]),
    candidate: z.object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(320),
      phone: z.string().trim().min(5).max(50),
      location: z.string().trim().min(1).max(200),
      currentCompany: z.string().trim().max(200).optional(),
      currentTitle: z.string().trim().max(200).optional(),
      yearsOfExperience: z.number().int().min(0).max(80),
      skills: z.array(z.string().trim().min(1)).max(100).optional(),
      education: z.array(z.string().trim().min(1)).max(100).optional(),
      certifications: z.array(z.string().trim().min(1)).max(100).optional(),
      languages: z.array(z.string().trim().min(1)).max(100).optional(),
      availability: z.string().trim().max(200).optional(),
      workEligibility: z.string().trim().max(200).optional(),
      talentPools: z.array(z.string().trim().min(1)).max(100).optional(),
    }),
  })
  .strict();

export const finaliseCandidateCvFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof FinaliseCandidateCv>) => FinaliseCandidateCv.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return finaliseCandidateCvIntakeInDatabase(
      verified.organisationId,
      {
        cvRecordId: data.cvRecordId,
        ...(data.existingCandidateId ? { existingCandidateId: data.existingCandidateId } : {}),
        ...(data.vacancyId ? { vacancyId: data.vacancyId } : {}),
        consentStatus: data.consentStatus,
        candidate: JSON.parse(JSON.stringify(data.candidate)),
      },
      verified.actor,
    );
  });

export const includeCandidateInAssessmentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        vacancyId: z.string().uuid(),
        candidateId: z.string().uuid(),
        cvRecordId: z.string().uuid(),
        source: z.enum(["Recommended", "HR Added"]),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return includeCandidateInAssessmentInDatabase(
      verified.organisationId,
      {
        vacancyId: data.vacancyId,
        candidateId: data.candidateId,
        cvRecordId: data.cvRecordId,
        source: data.source,
        reason: data.reason,
      },
      verified.actor,
    );
  });

export const createAssessmentBatchFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        vacancyId: z.string().uuid(),
        targetSize: z.number().int().min(1).max(10),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return createAssessmentBatchInDatabase(
      verified.organisationId,
      data.vacancyId,
      data.targetSize,
      verified.actor,
    );
  });

export const updateAssessmentSelectionFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        batchId: z.string().uuid(),
        candidateIds: z.array(z.string().uuid()).min(1).max(10),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await updateAssessmentSelectionInDatabase(
      verified.organisationId,
      data.batchId,
      data.candidateIds,
      data.reason,
      verified.actor,
    );
    return { ok: true };
  });

export const runDetailedAssessmentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: RecruitmentActor, batchId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return runDetailedAssessmentInDatabase(verified.organisationId, data.batchId, verified.actor);
  });

export const saveShortlistDraftFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        vacancyId: z.string().uuid(),
        targetSize: z.number().int().min(1).max(10),
        selectedCandidateIds: z.array(z.string().uuid()).min(1).max(10),
        overrideReasons: z.array(
          z.object({ candidateId: z.string().uuid(), reason: z.string().trim().min(5).max(1000) }),
        ),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return saveShortlistDraftInDatabase(
      verified.organisationId,
      {
        vacancyId: data.vacancyId,
        targetSize: data.targetSize,
        selectedCandidateIds: data.selectedCandidateIds,
        overrideReasons: data.overrideReasons,
      },
      verified.actor,
    );
  });

export const finaliseShortlistFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        shortlistId: z.string().uuid(),
        unselectedAction: z.enum(["On Hold", "Not Selected"]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await finaliseShortlistInDatabase(
      verified.organisationId,
      data.shortlistId,
      data.unselectedAction,
      verified.actor,
    );
    return { ok: true };
  });

const ImportCandidateRow = z.object({
  sourceSheet: z.string().trim().min(1).max(200),
  sourceRowIndex: z.number().int().positive(),
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  email: z.string().trim().max(320),
  phone: z.string().trim().max(50),
  nationality: z.string().trim().max(100).optional(),
  location: z.string().trim().max(200),
  currentCompany: z.string().trim().max(200).optional(),
  currentTitle: z.string().trim().max(200).optional(),
  yearsOfExperience: z.number().min(0).max(80),
  stage: z.enum([
    "Sourced",
    "Applied",
    "Screened",
    "Shortlisted",
    "Interview",
    "Offer",
    "Hired",
    "On Hold",
    "Not Selected",
    "Withdrawn",
    "Archived",
  ]),
  shortlistStatus: z.string().max(200).optional(),
  trackerStatus: z.string().max(200).optional(),
  projectName: z.string().max(200).optional(),
  projectType: z.string().max(200).optional(),
  visaStatus: z
    .enum([
      "Own Visa",
      "Company Visa",
      "Freelance Visa",
      "Visit Visa",
      "Requires Sponsorship",
      "Omani (No Visa Required)",
      "Not Applicable",
      "Other",
    ])
    .optional(),
  maritalStatus: z.enum(["Single", "Married", "Married (With Family)", "Not Specified"]).optional(),
  noticePeriod: z.string().max(200).optional(),
  lastContactAt: z.string().max(100).optional(),
  interviewDate: z.string().max(100).optional(),
  currentSalary: z.string().max(200).optional(),
  expectedSalary: z.string().max(200).optional(),
  acceptedSalary: z.string().max(200).optional(),
  remarks: z.string().max(5000).optional(),
  source: z.string().max(200).optional(),
  originalImportValues: z.record(z.string()).optional(),
  resolution: z.enum(["create", "merge", "skip", "create_separate"]),
  existingCandidateId: z.string().uuid().optional(),
});

export const parseCandidateSpreadsheetFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().max(150),
        fileBase64: z.string().min(1).max(14_000_000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    const bytes = Buffer.from(data.fileBase64, "base64");
    return parseCandidateSpreadsheetInDatabase(
      verified.organisationId,
      { fileName: data.fileName, mimeType: data.mimeType, bytes },
      verified.actor,
    );
  });

export const importCandidatesFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: RecruitmentActor,
        rows: z.array(ImportCandidateRow).min(1).max(5000),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return importCandidatesInDatabase(
      verified.organisationId,
      JSON.parse(JSON.stringify(data.rows)),
      verified.actor,
      data.reason,
    );
  });

export const submitPublicApplicationFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof PublicApplicationSchema>) =>
    PublicApplicationSchema.parse(input),
  )
  .handler(async ({ data }) => {
    const bytes = Buffer.from(data.fileBase64, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
      throw new Error("CV must be no larger than 10 MB.");
    }
    const mimeType = validatePublicCv(data.fileName, data.mimeType, bytes);
    const organisationId = await resolveDefaultOrganisationId();
    const result = await submitPublicApplicationToDatabase(organisationId, {
      ...data,
      mimeType,
      fileBytes: bytes,
    });
    // The committed queue record remains authoritative. This first attempt keeps the
    // applicant experience fast, while the standalone worker safely resumes any retry.
    void processNextCandidateCvJob(`public-submit:${result.applicationId}`, result.jobId).catch(
      () => undefined,
    );
    return {
      referenceId: result.referenceId,
      candidateId: result.candidateId,
      applicationId: result.applicationId,
    };
  });
