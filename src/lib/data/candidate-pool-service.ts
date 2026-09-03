import {
  LocalCvExtractionProvider,
  type CvExtractionProvider,
} from "../integrations/cv-extraction.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { LocalRepository } from "./repository.ts";
import type {
  ActorContext,
  Candidate,
  CandidateApplication,
  CandidateConsentStatus,
  CandidateCvExtractedFields,
  CandidateCvRecord,
  CandidateCvSource,
  CandidateInterviewRecommendation,
  CandidateRecommendation,
  FileMetadata,
  Vacancy,
} from "./types.ts";

const MAX_CV_SIZE = 10 * 1024 * 1024;
const CV_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

function resolveCvMimeType(fileName: string, suppliedMimeType: string): string {
  if (CV_MIME_TYPES.has(suppliedMimeType)) return suppliedMimeType;
  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".doc") return "application/msword";
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === ".txt") return "text/plain";
  return suppliedMimeType;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^00/, "").replace(/^968/, "");
}

function unique(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function assertHr(context: ActorContext, action: string, entityId: string): void {
  if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") return;
  recordAccessDenied(getApplicationDataServices().audit, {
    context,
    action,
    module: "candidates",
    entityType: "candidate-pool",
    entityId,
  });
  throw new Error("Only HR or Super Admin can manage the Candidate Pool.");
}

export class CandidatePoolService {
  private readonly candidateRepo: LocalRepository<Candidate>;
  private readonly applicationRepo: LocalRepository<CandidateApplication>;
  private readonly vacancyRepo: LocalRepository<Vacancy>;
  private readonly cvRepo: LocalRepository<CandidateCvRecord>;
  private readonly recommendationRepo: LocalRepository<CandidateInterviewRecommendation>;

  constructor(private readonly extractor: CvExtractionProvider = new LocalCvExtractionProvider()) {
    const { storage, audit } = getApplicationDataServices();
    this.candidateRepo = new LocalRepository("candidates", storage, audit, {
      module: "candidates",
      entityType: "candidate",
    });
    this.applicationRepo = new LocalRepository("applications", storage, audit, {
      module: "applications",
      entityType: "candidate-application",
    });
    this.vacancyRepo = new LocalRepository("vacancies", storage, audit, {
      module: "recruitment",
      entityType: "vacancy",
    });
    this.cvRepo = new LocalRepository("candidate_cv_records", storage, audit, {
      module: "candidates",
      entityType: "candidate-cv",
    });
    this.recommendationRepo = new LocalRepository(
      "candidate_interview_recommendations",
      storage,
      audit,
      { module: "recruitment", entityType: "interview-recommendation" },
    );
  }

  getCvIntakes(context: ActorContext): CandidateCvRecord[] {
    assertHr(context, "candidate_cv_intake_view_denied", "all");
    return this.cvRepo
      .list()
      .filter((record) => !record.candidateId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  getCandidateCvs(candidateId: string, context: ActorContext): CandidateCvRecord[] {
    assertHr(context, "candidate_cv_view_denied", candidateId);
    return this.cvRepo
      .list()
      .filter((record) => record.candidateId === candidateId)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async getCvFile(
    cvRecordId: string,
    context: ActorContext,
  ): Promise<{ metadata: FileMetadata; blob: Blob }> {
    assertHr(context, "candidate_cv_download_denied", cvRecordId);
    const record = this.cvRepo.getById(cvRecordId);
    if (!record) throw new Error("The CV record was not found.");
    const { files, audit } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(record.fileId),
      files.getBlob(record.fileId),
    ]);
    if (!metadata || !blob) {
      const { downloadCandidateCvFn } = await import("../server-functions/candidate.server.ts");
      const users = getApplicationDataServices().storage.readCollection<{
        id: string;
        workspaceEmail?: string;
      }>("users");
      const actorEmail =
        context.actor.workspaceEmail ??
        users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
      const downloaded = await downloadCandidateCvFn({
        data: {
          actor: {
            actorId: context.actor.userId,
            ...(actorEmail ? { actorEmail } : {}),
            activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
          },
          cvRecordId,
          reason: context.reason || "Viewed candidate CV",
        },
      });
      const binary = atob(downloaded.fileBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return {
        metadata: downloaded.metadata,
        blob: new Blob([bytes], { type: downloaded.metadata.mimeType }),
      };
    }
    audit.record({
      context,
      action: "candidate_cv_download",
      module: "candidates",
      entityType: "candidate-cv",
      entityId: record.id,
      reason: context.reason || "Opened a candidate CV",
      riskLevel: "Medium",
      after: { candidateId: record.candidateId, fileName: metadata.name },
    });
    return { metadata, blob };
  }

  getCvIntakeById(cvRecordId: string, context: ActorContext): CandidateCvRecord | undefined {
    assertHr(context, "candidate_cv_intake_view_denied", cvRecordId);
    return this.cvRepo.getById(cvRecordId) || undefined;
  }

  saveCvIntakeReviewDraft(
    cvRecordId: string,
    input: { extractedFields: CandidateCvExtractedFields; vacancyId: string },
    context: ActorContext,
  ): CandidateCvRecord {
    assertHr(context, "candidate_cv_review_draft_denied", cvRecordId);
    const record = this.cvRepo.getById(cvRecordId);
    if (!record || record.candidateId) throw new Error("This CV intake is no longer available.");
    const vacancy = this.vacancyRepo.getById(input.vacancyId);
    if (!vacancy || vacancy.status !== "Open") throw new Error("Select an open vacancy.");
    return this.cvRepo.update(
      record.id,
      {
        vacancyId: vacancy.id,
        extractedFields: input.extractedFields,
        recommendationPending: true,
      },
      { ...context, reason: "Saved CV review before recording recommender details" },
    );
  }

  confirmCandidateCvExtraction(cvRecordId: string, context: ActorContext): CandidateCvRecord {
    assertHr(context, "candidate_cv_review_denied", cvRecordId);
    const record = this.cvRepo.getById(cvRecordId);
    if (!record || !record.candidateId) throw new Error("The linked candidate CV was not found.");
    if (record.processingStatus === "Ready") return record;
    const candidate = this.candidateRepo.getById(record.candidateId);
    if (!candidate) throw new Error("The candidate profile was not found.");
    const extracted = record.extractedFields;
    this.candidateRepo.update(
      candidate.id,
      {
        skills: unique([...(candidate.skills || []), ...(extracted.skills || [])]),
        education: unique([...(candidate.education || []), ...(extracted.education || [])]),
        certifications: unique([
          ...(candidate.certifications || []),
          ...(extracted.certifications || []),
        ]),
        languages: unique([...(candidate.languages || []), ...(extracted.languages || [])]),
        currentCompany: candidate.currentCompany || extracted.currentCompany,
        currentTitle: candidate.currentTitle || extracted.currentTitle,
        yearsOfExperience:
          candidate.yearsOfExperience > 0
            ? candidate.yearsOfExperience
            : extracted.yearsOfExperience || 0,
        latestCvRecordId: record.id,
        cvFileId: record.fileId,
      },
      { ...context, reason: "Confirmed CV-extracted Candidate Pool information" },
    );
    return this.cvRepo.update(
      record.id,
      {
        processingStatus: "Ready",
        reviewedAt: new Date().toISOString(),
        reviewedByUserId: context.actor.userId,
      },
      { ...context, reason: "Confirmed extracted CV information" },
    );
  }

  getInterviewRecommendations(
    candidateId: string,
    context: ActorContext,
  ): CandidateInterviewRecommendation[] {
    assertHr(context, "interview_recommendation_view_denied", candidateId);
    return this.recommendationRepo
      .list()
      .filter((record) => record.candidateId === candidateId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async uploadDirectCv(
    input: {
      file: Blob;
      fileName: string;
      source: CandidateCvSource;
      receivedAt: string;
      consentStatus: CandidateConsentStatus;
      vacancyId?: string;
      notes?: string;
      isRecommended?: boolean;
    },
    context: ActorContext,
  ): Promise<CandidateCvRecord> {
    assertHr(context, "candidate_cv_upload_denied", "new");
    if (!input.fileName.trim()) throw new Error("The CV file name is required.");
    if (input.file.size === 0) throw new Error("The selected CV is empty.");
    if (input.file.size > MAX_CV_SIZE) throw new Error("CV files cannot exceed 10 MB.");
    const mimeType = resolveCvMimeType(input.fileName, input.file.type);
    if (!CV_MIME_TYPES.has(mimeType)) {
      throw new Error("Upload a PDF, Word document or plain-text CV.");
    }
    const receivedAt = new Date(input.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) throw new Error("Enter a valid date received.");
    if (receivedAt.getTime() > Date.now())
      throw new Error("Date received cannot be in the future.");
    if (input.vacancyId && !this.vacancyRepo.getById(input.vacancyId)) {
      throw new Error("The selected vacancy no longer exists.");
    }

    // Service tests and local scripts do not have a TanStack Start request context.
    // Keep their deterministic preview path; all browser calls use the server path below.
    if (typeof window === "undefined") {
      const intakeId = crypto.randomUUID();
      const { files } = getApplicationDataServices();
      const file = await files.save(
        {
          blob: input.file,
          name: input.fileName,
          mimeType,
          owner: { entityType: "candidate-cv", entityId: intakeId },
        },
        context,
      );
      try {
        const record = this.cvRepo.create(
          {
            id: intakeId,
            fileId: file.id,
            originalFileName: input.fileName,
            source: input.source,
            receivedAt: receivedAt.toISOString(),
            processingStatus: "Extracting",
            extractionMethod: "Local Preview",
            extractedFields: {},
            fieldConfidence: {},
            extractionWarnings: [],
            consentStatus: input.consentStatus,
            ...(input.vacancyId ? { vacancyId: input.vacancyId } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            ...(input.isRecommended ? { recommendationPending: true } : {}),
          },
          context,
        );
        try {
          const extraction = await this.extractor.extract({
            file: input.file,
            fileName: input.fileName,
          });
          return this.cvRepo.update(
            record.id,
            {
              processingStatus: "Awaiting HR Review",
              extractionMethod: extraction.method,
              extractedFields: extraction.fields,
              fieldConfidence: extraction.confidence,
              extractionWarnings: extraction.warnings,
            },
            context,
          );
        } catch (error) {
          return this.cvRepo.update(
            record.id,
            {
              processingStatus: "Processing Failed",
              extractionWarnings: [
                error instanceof Error ? error.message : "The CV could not be processed.",
              ],
            },
            context,
          );
        }
      } catch (error) {
        await files.delete(file.id, {
          ...context,
          reason: "Removed CV after intake creation failed",
        });
        throw error;
      }
    }
    if (mimeType === "text/plain") throw new Error("Upload the original PDF, DOC or DOCX CV.");
    const { uploadCandidateCvFn } = await import("../server-functions/candidate.server.ts");
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      workspaceEmail?: string;
    }>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    const vacancy = input.vacancyId ? this.vacancyRepo.getById(input.vacancyId) : undefined;
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const result = await uploadCandidateCvFn({
      data: {
        actor: {
          actorId: context.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
        },
        fileName: input.fileName,
        mimeType,
        fileBase64: btoa(binary),
        source: input.source,
        receivedAt: receivedAt.toISOString(),
        consentStatus: input.consentStatus,
        ...(vacancy ? { vacancyId: vacancy.databaseId ?? vacancy.id } : {}),
        ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
        isRecommended: input.isRecommended ?? false,
      },
    });
    const { CandidateService } = await import("./candidate-service.ts");
    await new CandidateService().hydrateCompatibilityCache(context);
    const record = this.cvRepo.getById(result.cvRecordId);
    if (!record) throw new Error("The saved CV could not be loaded. Refresh and try again.");
    return record;
  }

  async registerPortalCv(input: {
    candidate: Candidate;
    application: CandidateApplication;
  }): Promise<CandidateCvRecord> {
    const context: ActorContext = {
      actor: {
        userId: "SYSTEM",
        displayName: "VIA HR System",
        roles: ["Super Admin"],
        activeRole: "Super Admin",
      },
      reason: "Registered a CV received through the Careers Portal",
    };
    const existing = this.cvRepo
      .list()
      .find((record) => record.applicationId === input.application.id);
    if (existing) return existing;

    const { files } = getApplicationDataServices();
    const metadata = await files.getMetadata(input.application.cvFileId);
    if (!metadata)
      throw new Error("The submitted CV could not be registered in the Candidate Pool.");
    const record = this.cvRepo.create(
      {
        candidateId: input.candidate.id,
        applicationId: input.application.id,
        vacancyId: input.application.vacancyId,
        fileId: input.application.cvFileId,
        originalFileName: metadata.name,
        source: "Careers Portal",
        receivedAt: input.application.createdAt,
        processingStatus: "Uploaded",
        extractionMethod: "Candidate Provided",
        extractedFields: {
          firstName: input.candidate.firstName,
          lastName: input.candidate.lastName,
          email: input.candidate.email,
          phone: input.candidate.phone,
          location: input.candidate.location,
          currentCompany: input.candidate.currentCompany,
          currentTitle: input.candidate.currentTitle,
          yearsOfExperience: input.candidate.yearsOfExperience,
        },
        fieldConfidence: {
          firstName: 1,
          lastName: 1,
          email: 1,
          phone: 1,
          location: 1,
          yearsOfExperience: 1,
        },
        extractionWarnings: [],
        consentStatus: "Confirmed",
      },
      context,
    );
    this.candidateRepo.update(
      input.candidate.id,
      {
        cvFileId: input.application.cvFileId,
        latestCvRecordId: record.id,
        consentStatus: "Confirmed",
        consentUpdatedAt: input.application.consentedAt,
      },
      context,
    );
    return record;
  }

  findPossibleMatches(email: string, phone: string): Candidate[] {
    const normalEmail = email.trim().toLowerCase();
    const normalPhone = normalizePhone(phone);
    return this.candidateRepo
      .list()
      .filter(
        (candidate) =>
          !candidate.mergedIntoId &&
          ((normalEmail && candidate.email.toLowerCase() === normalEmail) ||
            (normalPhone && normalizePhone(candidate.phone) === normalPhone)),
      );
  }

  finaliseCvIntake(
    input: Parameters<CandidatePoolService["finaliseCvIntakeLegacy"]>[0],
    context: ActorContext,
  ):
    | { candidate: Candidate; application?: CandidateApplication; cvRecord: CandidateCvRecord }
    | Promise<{
        candidate: Candidate;
        application?: CandidateApplication;
        cvRecord: CandidateCvRecord;
      }> {
    assertHr(context, "candidate_cv_review_denied", input.cvRecordId);
    if (typeof window === "undefined") return this.finaliseCvIntakeLegacy(input, context);
    return this.finaliseCvIntakeDatabase(input, context);
  }

  private async finaliseCvIntakeDatabase(
    input: Parameters<CandidatePoolService["finaliseCvIntakeLegacy"]>[0],
    context: ActorContext,
  ): Promise<{
    candidate: Candidate;
    application?: CandidateApplication;
    cvRecord: CandidateCvRecord;
  }> {
    assertHr(context, "candidate_cv_review_denied", input.cvRecordId);
    const { finaliseCandidateCvFn } = await import("../server-functions/candidate.server.ts");
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      workspaceEmail?: string;
    }>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    const vacancy = input.vacancyId ? this.vacancyRepo.getById(input.vacancyId) : undefined;
    const result = await finaliseCandidateCvFn({
      data: {
        actor: {
          actorId: context.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
        },
        cvRecordId: input.cvRecordId,
        ...(input.existingCandidateId ? { existingCandidateId: input.existingCandidateId } : {}),
        ...(vacancy ? { vacancyId: vacancy.databaseId ?? vacancy.id } : {}),
        consentStatus: input.consentStatus,
        candidate: input.candidate,
      },
    });
    const { CandidateService } = await import("./candidate-service.ts");
    await new CandidateService().hydrateCompatibilityCache(context);
    const candidate = this.candidateRepo.getById(result.candidateId);
    const cvRecord = this.cvRepo.getById(result.cvRecordId);
    const application = result.applicationId
      ? this.applicationRepo.getById(result.applicationId)
      : undefined;
    if (!candidate || !cvRecord)
      throw new Error("The confirmed Candidate Pool record could not be loaded.");
    return { candidate, ...(application ? { application } : {}), cvRecord };
  }

  private finaliseCvIntakeLegacy(
    input: {
      cvRecordId: string;
      existingCandidateId?: string;
      forceCreateNew?: boolean;
      candidate: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        location: string;
        currentCompany?: string;
        currentTitle?: string;
        yearsOfExperience: number;
        skills?: string[];
        education?: string[];
        certifications?: string[];
        languages?: string[];
        availability?: string;
        workEligibility?: string;
        talentPools?: string[];
      };
      vacancyId?: string;
      consentStatus: CandidateConsentStatus;
    },
    context: ActorContext,
  ): { candidate: Candidate; application?: CandidateApplication; cvRecord: CandidateCvRecord } {
    assertHr(context, "candidate_cv_review_denied", input.cvRecordId);
    const cvRecord = this.cvRepo.getById(input.cvRecordId);
    if (!cvRecord) throw new Error("The CV intake record was not found.");
    if (cvRecord.candidateId) throw new Error("This CV has already been added to a candidate.");
    if (cvRecord.processingStatus === "Extracting") {
      throw new Error("Wait for CV processing to finish before reviewing it.");
    }
    if (!input.candidate.firstName.trim() || !input.candidate.lastName.trim()) {
      throw new Error("First name and last name are required.");
    }
    if (!input.candidate.email.trim() || !input.candidate.phone.trim()) {
      throw new Error("Email and phone number are required for duplicate protection.");
    }
    if (
      !Number.isFinite(input.candidate.yearsOfExperience) ||
      input.candidate.yearsOfExperience < 0
    ) {
      throw new Error("Years of experience must be zero or greater.");
    }
    if (input.vacancyId && input.consentStatus !== "Confirmed") {
      throw new Error("Candidate consent must be confirmed before creating a vacancy application.");
    }

    const services = getApplicationDataServices();
    const snapshot = services.storage.exportState();
    try {
      const matches = this.findPossibleMatches(input.candidate.email, input.candidate.phone);
      let candidate: Candidate;
      if (input.existingCandidateId) {
        const existing = this.candidateRepo.getById(input.existingCandidateId);
        if (!existing) throw new Error("The selected candidate no longer exists.");
        candidate = this.candidateRepo.update(
          existing.id,
          {
            firstName: input.candidate.firstName.trim(),
            lastName: input.candidate.lastName.trim(),
            email: input.candidate.email.trim(),
            phone: input.candidate.phone.trim(),
            location: input.candidate.location.trim(),
            currentCompany: input.candidate.currentCompany?.trim() || existing.currentCompany,
            currentTitle: input.candidate.currentTitle?.trim() || existing.currentTitle,
            yearsOfExperience: input.candidate.yearsOfExperience,
            skills: unique([...(existing.skills ?? []), ...(input.candidate.skills ?? [])]),
            education: unique([
              ...(existing.education ?? []),
              ...(input.candidate.education ?? []),
            ]),
            certifications: unique([
              ...(existing.certifications ?? []),
              ...(input.candidate.certifications ?? []),
            ]),
            languages: unique([
              ...(existing.languages ?? []),
              ...(input.candidate.languages ?? []),
            ]),
            availability: input.candidate.availability?.trim() || existing.availability,
            workEligibility: input.candidate.workEligibility?.trim() || existing.workEligibility,
            talentPools: unique([
              ...(existing.talentPools ?? []),
              ...(input.candidate.talentPools ?? []),
            ]),
            cvFileId: cvRecord.fileId,
            latestCvRecordId: cvRecord.id,
            consentStatus: input.consentStatus,
            consentUpdatedAt: new Date().toISOString(),
          },
          {
            ...context,
            reason: "Reviewed a new CV and updated the existing Candidate Pool profile",
          },
        );
      } else {
        if (matches.length > 0 && !input.forceCreateNew) {
          throw new Error("DUPLICATE_CANDIDATE_MATCH_FOUND");
        }
        candidate = this.candidateRepo.create(
          {
            firstName: input.candidate.firstName.trim(),
            lastName: input.candidate.lastName.trim(),
            email: input.candidate.email.trim(),
            phone: input.candidate.phone.trim(),
            location: input.candidate.location.trim(),
            currentCompany: input.candidate.currentCompany?.trim(),
            currentTitle: input.candidate.currentTitle?.trim(),
            yearsOfExperience: input.candidate.yearsOfExperience,
            stage: input.vacancyId ? "Applied" : "Sourced",
            doNotContact: false,
            source: cvRecord.source,
            skills: unique(input.candidate.skills),
            education: unique(input.candidate.education),
            certifications: unique(input.candidate.certifications),
            languages: unique(input.candidate.languages),
            availability: input.candidate.availability?.trim(),
            workEligibility: input.candidate.workEligibility?.trim(),
            talentPools: unique(input.candidate.talentPools),
            cvFileId: cvRecord.fileId,
            latestCvRecordId: cvRecord.id,
            consentStatus: input.consentStatus,
            consentUpdatedAt: new Date().toISOString(),
          },
          { ...context, reason: "Added a reviewed CV to the Candidate Pool" },
        );
      }

      let application: CandidateApplication | undefined;
      const vacancyId = input.vacancyId || cvRecord.vacancyId;
      if (vacancyId) {
        const vacancy = this.vacancyRepo.getById(vacancyId);
        if (!vacancy || vacancy.status !== "Open") {
          throw new Error("Only an open vacancy can receive a new application.");
        }
        const existingApplication = this.applicationRepo
          .list()
          .find((item) => item.candidateId === candidate.id && item.vacancyId === vacancyId);
        if (existingApplication) {
          application = this.applicationRepo.update(
            existingApplication.id,
            { cvFileId: cvRecord.fileId },
            { ...context, reason: "Linked a reviewed CV version to the existing application" },
          );
        } else {
          application = this.applicationRepo.create(
            {
              referenceId: this.createApplicationReference(),
              candidateId: candidate.id,
              vacancyId,
              status: "New",
              cvFileId: cvRecord.fileId,
              noticePeriod: candidate.noticePeriod || "To be confirmed",
              screeningAnswers: [],
              source: cvRecord.source,
              consentGiven: true,
              consentedAt: new Date().toISOString(),
            },
            { ...context, reason: "Created an application from a directly received CV" },
          );
          this.vacancyRepo.update(
            vacancy.id,
            { applicantCount: (vacancy.applicantCount || 0) + 1 },
            context,
          );
        }
      }

      const reviewed = this.cvRepo.update(
        cvRecord.id,
        {
          candidateId: candidate.id,
          applicationId: application?.id,
          vacancyId,
          processingStatus: "Ready",
          consentStatus: input.consentStatus,
          reviewedAt: new Date().toISOString(),
          reviewedByUserId: context.actor.userId,
        },
        { ...context, reason: "Confirmed extracted CV information" },
      );
      return { candidate, ...(application ? { application } : {}), cvRecord: reviewed };
    } catch (error) {
      services.storage.replaceState(snapshot);
      throw error;
    }
  }

  async finaliseRecommendedCvIntake(
    finaliseInput: Parameters<CandidatePoolService["finaliseCvIntake"]>[0],
    recommendationInput: Omit<
      CandidateRecommendation,
      | "id"
      | "createdAt"
      | "createdBy"
      | "updatedAt"
      | "updatedBy"
      | "recordVersion"
      | "archivedAt"
      | "candidateId"
    >,
    context: ActorContext,
  ) {
    assertHr(context, "recommended_candidate_finalise_denied", finaliseInput.cvRecordId);
    if (!finaliseInput.vacancyId) throw new Error("Select a vacancy for the recommendation.");
    const services = getApplicationDataServices();
    const snapshot = services.storage.exportState();
    try {
      const result = await this.finaliseCvIntake(finaliseInput, context);
      const { CandidateService } = await import("./candidate-service.ts");
      const recommendation = new CandidateService().addRecommendation(
        {
          ...recommendationInput,
          candidateId: result.candidate.id,
          vacancyId: finaliseInput.vacancyId,
        },
        { ...context, reason: "Recorded who recommended the candidate" },
      );
      const { CandidatePreparationService } = await import("./candidate-preparation-service.ts");
      const screening = await new CandidatePreparationService(this.extractor).includeCandidate(
        {
          vacancyId: finaliseInput.vacancyId,
          candidateId: result.candidate.id,
          cvRecordId: result.cvRecord.id,
          source: "Recommended",
          reason:
            recommendationInput.notes.trim() ||
            `Recommended by ${recommendationInput.recommenderName}`,
        },
        {
          ...context,
          reason:
            recommendationInput.notes.trim() ||
            `Recommended by ${recommendationInput.recommenderName}`,
        },
      );
      const cvRecord = this.cvRepo.update(
        result.cvRecord.id,
        { recommendationPending: false, recommendationId: recommendation.id },
        { ...context, reason: "Linked recommender details to the uploaded CV" },
      );
      return { ...result, cvRecord, recommendation, screening };
    } catch (error) {
      services.storage.replaceState(snapshot);
      services.audit.record({
        context,
        action: "recommended_candidate_intake_rollback",
        module: "recruitment",
        entityType: "candidate-cv",
        entityId: finaliseInput.cvRecordId,
        reason: error instanceof Error ? error.message : "Recommended candidate intake failed",
        riskLevel: "High",
      });
      throw error;
    }
  }

  async recommendForInterview(
    input: {
      candidateId: string;
      vacancyId: string;
      reason: string;
      cvRecordId?: string;
    },
    context: ActorContext,
  ): Promise<CandidateInterviewRecommendation> {
    assertHr(context, "interview_recommendation_denied", input.candidateId);
    if (input.reason.trim().length < 10) {
      throw new Error("Explain why this candidate should be interviewed.");
    }
    const candidate = this.candidateRepo.getById(input.candidateId);
    if (!candidate) throw new Error("Candidate not found.");
    if (candidate.doNotContact) throw new Error("This candidate is marked Do Not Contact.");
    if (candidate.mergedIntoId || candidate.stage === "Archived") {
      throw new Error("An archived or merged candidate cannot be recommended.");
    }
    const vacancy = this.vacancyRepo.getById(input.vacancyId);
    if (!vacancy || vacancy.status !== "Open") {
      throw new Error("Select an open vacancy.");
    }
    const cvRecord = input.cvRecordId
      ? this.cvRepo.getById(input.cvRecordId)
      : this.cvRepo.getById(candidate.latestCvRecordId || "");
    if (input.cvRecordId && (!cvRecord || cvRecord.candidateId !== candidate.id)) {
      throw new Error("Select a CV that belongs to this candidate.");
    }
    if (cvRecord && cvRecord.processingStatus !== "Ready") {
      throw new Error("Confirm the CV information before recommending this candidate.");
    }
    const fileId = cvRecord?.fileId || candidate.cvFileId;
    if (!fileId || !cvRecord) {
      throw new Error("Add and confirm a CV before recommending this candidate for interview.");
    }

    const existingRecommendation = this.recommendationRepo
      .list()
      .find(
        (item) =>
          item.candidateId === candidate.id &&
          item.vacancyId === vacancy.id &&
          item.status !== "Withdrawn",
      );
    if (existingRecommendation) {
      throw new Error("This candidate is already recommended for this vacancy.");
    }

    const snapshot = getApplicationDataServices().storage.exportState();
    try {
      if (candidate.consentStatus !== "Confirmed") {
        throw new Error("Candidate consent must be confirmed before interview recommendation.");
      }
      const { CandidatePreparationService } = await import("./candidate-preparation-service.ts");
      const { application } = await new CandidatePreparationService(
        this.extractor,
      ).includeCandidate(
        {
          candidateId: candidate.id,
          vacancyId: vacancy.id,
          cvRecordId: cvRecord.id,
          source: "Recommended",
          reason: input.reason.trim(),
        },
        context,
      );

      const recommendation = this.recommendationRepo.create(
        {
          candidateId: candidate.id,
          vacancyId: vacancy.id,
          applicationId: application.id,
          cvRecordId: cvRecord?.id,
          recommendedByUserId: context.actor.userId,
          reason: input.reason.trim(),
          status: "Ready for Assessment",
        },
        { ...context, reason: input.reason.trim() },
      );
      this.applicationRepo.update(
        application.id,
        {
          hrInterviewRecommendationId: recommendation.id,
        },
        { ...context, reason: "Pinned an HR-recommended candidate for detailed assessment" },
      );
      this.candidateRepo.update(
        candidate.id,
        { stage: candidate.stage === "Sourced" ? "Screened" : candidate.stage },
        { ...context, reason: "Included an HR-recommended candidate in vacancy screening" },
      );

      const hiringManagerUserId = vacancy.hiringManagerId
        ? getApplicationDataServices()
            .storage.readCollection<{ id: string; employeeId?: string }>("users")
            .find((user) => user.employeeId === vacancy.hiringManagerId)?.id
        : undefined;
      if (hiringManagerUserId) {
        getApplicationDataServices().notifications.create(
          {
            recipientUserId: hiringManagerUserId,
            type: "Interview Recommendation",
            title: "Candidate recommended for interview",
            message: `${candidate.firstName} ${candidate.lastName} has been recommended for ${vacancy.title} and will be included in the detailed assessment group.`,
            priority: "Normal",
            status: "Unread",
            link: {
              entityType: "candidate",
              entityId: candidate.id,
              path: `/staff/candidates/${candidate.id}`,
            },
            deduplicationKey: `interview-recommendation-${recommendation.id}`,
          },
          context,
        );
      }
      return recommendation;
    } catch (error) {
      getApplicationDataServices().storage.replaceState(snapshot);
      throw error;
    }
  }

  private createApplicationReference(): string {
    const year = new Date().getFullYear().toString().slice(-2);
    const used = new Set(this.applicationRepo.list().map((application) => application.referenceId));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = Math.random().toString(16).slice(2, 6).toUpperCase();
      const reference = `APP-${year}-${suffix}`;
      if (!used.has(reference)) return reference;
    }
    throw new Error("Could not create a unique application reference.");
  }
}
