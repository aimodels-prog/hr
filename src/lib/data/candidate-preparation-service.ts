import { LocalCvExtractionProvider, type CvExtractionProvider } from "../integrations/index.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { LocalRepository } from "./repository.ts";
import { LocalScoringService } from "./scoring-service.ts";
import { ShortlistService } from "./shortlist-service.ts";
import type {
  ActorContext,
  Candidate,
  CandidateApplication,
  CandidateAssessmentBatch,
  CandidateAssessmentInclusion,
  CandidateCriterionCheck,
  CandidateCvExtractedFields,
  CandidateCvRecord,
  CandidateInterviewRecommendation,
  CandidatePreparationBand,
  CandidatePreparationRun,
  CandidateScoreRun,
  Vacancy,
} from "./types.ts";
import { SYSTEM_ACTOR } from "./types.ts";

const MIN_ASSESSMENT_SIZE = 1;
const MAX_ASSESSMENT_SIZE = 10;

function isHr(context: ActorContext): boolean {
  return (
    context.actor.userId === SYSTEM_ACTOR.userId ||
    context.actor.activeRole === "HR" ||
    context.actor.activeRole === "Super Admin"
  );
}

function assertHr(context: ActorContext, action: string, entityId: string): void {
  if (isHr(context)) return;
  recordAccessDenied(getApplicationDataServices().audit, {
    context,
    action,
    module: "recruitment",
    entityType: "candidate-preparation",
    entityId,
  });
  throw new Error("Only HR or Super Admin can manage candidate preparation and assessment.");
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function includesCriterion(candidateText: string, criterion: string): boolean {
  const criterionTokens = tokens(criterion);
  if (criterionTokens.length === 0) return false;
  const textTokens = new Set(tokens(candidateText));
  const matched = criterionTokens.filter((token) => textTokens.has(token)).length;
  return matched / criterionTokens.length >= 0.75;
}

function documentRoute(mimeType: string, extractionFound: boolean) {
  if (mimeType.startsWith("text/")) return "Direct Text" as const;
  if (mimeType.includes("word") || mimeType.includes("officedocument")) {
    return "Word Document" as const;
  }
  if (mimeType === "application/pdf") {
    return extractionFound ? ("Searchable PDF" as const) : ("OCR Required" as const);
  }
  return "Unknown" as const;
}

function applicationReference(): string {
  const year = new Date().getFullYear().toString().slice(-2);
  return `APP-${year}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export class CandidatePreparationService {
  private readonly candidateRepo: LocalRepository<Candidate>;
  private readonly applicationRepo: LocalRepository<CandidateApplication>;
  private readonly cvRepo: LocalRepository<CandidateCvRecord>;
  private readonly vacancyRepo: LocalRepository<Vacancy>;
  private readonly preparationRepo: LocalRepository<CandidatePreparationRun>;
  private readonly inclusionRepo: LocalRepository<CandidateAssessmentInclusion>;
  private readonly batchRepo: LocalRepository<CandidateAssessmentBatch>;
  private readonly scoreRepo: LocalRepository<CandidateScoreRun>;
  private readonly recommendationRepo: LocalRepository<CandidateInterviewRecommendation>;
  private readonly scoring = new LocalScoringService();

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
    this.cvRepo = new LocalRepository("candidate_cv_records", storage, audit, {
      module: "candidates",
      entityType: "candidate-cv",
    });
    this.vacancyRepo = new LocalRepository("vacancies", storage, audit, {
      module: "recruitment",
      entityType: "vacancy",
    });
    this.preparationRepo = new LocalRepository("candidate_preparation_runs", storage, audit, {
      module: "recruitment",
      entityType: "candidate-preparation",
    });
    this.inclusionRepo = new LocalRepository("candidate_assessment_inclusions", storage, audit, {
      module: "recruitment",
      entityType: "assessment-inclusion",
    });
    this.batchRepo = new LocalRepository("candidate_assessment_batches", storage, audit, {
      module: "recruitment",
      entityType: "assessment-batch",
    });
    this.scoreRepo = new LocalRepository("candidate_scores", storage, audit, {
      module: "candidates",
      entityType: "candidate-score",
    });
    this.recommendationRepo = new LocalRepository(
      "candidate_interview_recommendations",
      storage,
      audit,
      { module: "recruitment", entityType: "interview-recommendation" },
    );
  }

  private serverActor(context: ActorContext) {
    const user = getApplicationDataServices()
      .storage.readCollection<{ id: string; workspaceEmail?: string }>("users")
      .find((item) => item.id === context.actor.userId);
    return {
      actorId: context.actor.userId,
      ...(context.actor.workspaceEmail || user?.workspaceEmail
        ? { actorEmail: context.actor.workspaceEmail ?? user?.workspaceEmail }
        : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    };
  }

  private databaseVacancyId(vacancyId: string): string {
    const vacancy = this.vacancyRepo.getById(vacancyId, { includeArchived: true });
    const databaseId =
      vacancy?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(vacancyId) ? vacancyId : undefined);
    if (!databaseId) throw new Error("This vacancy is not linked to PostgreSQL.");
    return databaseId;
  }

  private async refreshFromDatabase(context: ActorContext): Promise<void> {
    const { CandidateService } = await import("./candidate-service.ts");
    await new CandidateService().hydrateCompatibilityCache(context);
  }

  async refreshPreparedCandidatesAsync(
    vacancyId: string,
    context: ActorContext,
  ): Promise<CandidatePreparationRun[]> {
    await this.refreshFromDatabase(context);
    return this.getRunsForVacancy(vacancyId, context);
  }

  async includeCandidateAsync(
    input: Parameters<CandidatePreparationService["includeCandidate"]>[0],
    context: ActorContext,
  ): Promise<void> {
    const { includeCandidateInAssessmentFn } =
      await import("../server-functions/candidate.server.ts");
    await includeCandidateInAssessmentFn({
      data: {
        actor: this.serverActor(context),
        vacancyId: this.databaseVacancyId(input.vacancyId),
        candidateId: input.candidateId,
        cvRecordId: input.cvRecordId,
        source: input.source,
        reason: input.reason,
      },
    });
    await this.refreshFromDatabase(context);
  }

  async createAssessmentBatchAsync(
    vacancyId: string,
    targetSize: number,
    context: ActorContext,
  ): Promise<CandidateAssessmentBatch> {
    const { createAssessmentBatchFn } = await import("../server-functions/candidate.server.ts");
    const id = await createAssessmentBatchFn({
      data: {
        actor: this.serverActor(context),
        vacancyId: this.databaseVacancyId(vacancyId),
        targetSize,
      },
    });
    await this.refreshFromDatabase(context);
    const batch = this.batchRepo.getById(id);
    if (!batch) throw new Error("The assessment group could not be refreshed.");
    return batch;
  }

  async updateAssessmentSelectionAsync(
    batchId: string,
    selectedCandidateIds: string[],
    reason: string,
    context: ActorContext,
  ): Promise<CandidateAssessmentBatch> {
    const { updateAssessmentSelectionFn } = await import("../server-functions/candidate.server.ts");
    await updateAssessmentSelectionFn({
      data: {
        actor: this.serverActor(context),
        batchId,
        candidateIds: selectedCandidateIds,
        reason,
      },
    });
    await this.refreshFromDatabase(context);
    const batch = this.batchRepo.getById(batchId);
    if (!batch) throw new Error("The assessment group could not be refreshed.");
    return batch;
  }

  async runDetailedAssessmentAsync(
    batchId: string,
    context: ActorContext,
  ): Promise<CandidateAssessmentBatch> {
    const { runDetailedAssessmentFn } = await import("../server-functions/candidate.server.ts");
    await runDetailedAssessmentFn({ data: { actor: this.serverActor(context), batchId } });
    await this.refreshFromDatabase(context);
    const batch = this.batchRepo.getById(batchId);
    if (!batch) throw new Error("The assessment result could not be refreshed.");
    return batch;
  }

  queueApplication(
    applicationId: string,
    cvRecordId: string,
    context: ActorContext = { actor: SYSTEM_ACTOR },
  ): CandidatePreparationRun {
    assertHr(context, "candidate_preparation_queue_denied", applicationId);
    const application = this.applicationRepo.getById(applicationId);
    const cvRecord = this.cvRepo.getById(cvRecordId);
    if (!application || !cvRecord) throw new Error("Application or CV record not found.");
    if (
      application.candidateId !== cvRecord.candidateId ||
      (cvRecord.vacancyId && application.vacancyId !== cvRecord.vacancyId)
    ) {
      throw new Error("The CV, candidate and vacancy application do not match.");
    }
    const vacancy = this.vacancyRepo.getById(application.vacancyId);
    if (!vacancy) throw new Error("Vacancy not found.");
    const existing = this.preparationRepo
      .list()
      .find(
        (run) =>
          run.applicationId === application.id &&
          run.cvRecordId === cvRecord.id &&
          run.vacancyRecordVersion === vacancy.recordVersion &&
          run.status !== "Processing Failed",
      );
    if (existing) return existing;

    const run = this.preparationRepo.create(
      {
        vacancyId: vacancy.id,
        vacancyRecordVersion: vacancy.recordVersion,
        candidateId: application.candidateId,
        applicationId: application.id,
        cvRecordId: cvRecord.id,
        cvFileId: cvRecord.fileId,
        status: "Queued",
        documentRoute: "Unknown",
        preparationMethod: "Local Preparation",
        extractedProfile: {},
        fieldConfidence: {},
        compulsoryChecks: [],
        matchedSkills: [],
        missingRequiredSkills: [],
        evidence: [],
        warnings: [],
      },
      { ...context, reason: context.reason || "Queued CV preparation after application" },
    );
    this.applicationRepo.update(
      application.id,
      { preparationRunId: run.id, preparationStatus: "Queued" },
      { ...context, reason: "Queued application preparation" },
    );
    return run;
  }

  async processRun(
    runId: string,
    context: ActorContext = { actor: SYSTEM_ACTOR },
  ): Promise<CandidatePreparationRun> {
    assertHr(context, "candidate_preparation_process_denied", runId);
    let run = this.preparationRepo.getById(runId);
    if (!run) throw new Error("Preparation run not found.");
    if (run.status === "Ready" || run.status === "Needs Review") return run;
    const candidate = this.candidateRepo.getById(run.candidateId);
    const application = this.applicationRepo.getById(run.applicationId);
    const vacancy = this.vacancyRepo.getById(run.vacancyId);
    const cvRecord = this.cvRepo.getById(run.cvRecordId);
    if (!candidate || !application || !vacancy || !cvRecord) {
      throw new Error("Preparation cannot continue because a linked record is missing.");
    }

    run = this.preparationRepo.update(
      run.id,
      { status: "Processing", startedAt: new Date().toISOString(), failureReason: undefined },
      { ...context, reason: "Started CV preparation" },
    );
    this.applicationRepo.update(
      application.id,
      { preparationStatus: "Processing" },
      { ...context, reason: "Started application preparation" },
    );

    try {
      const { files } = getApplicationDataServices();
      const [metadata, blob] = await Promise.all([
        files.getMetadata(cvRecord.fileId),
        files.getBlob(cvRecord.fileId),
      ]);
      if (!metadata || !blob) throw new Error("The original CV file could not be opened.");

      const reusable = metadata.checksum
        ? this.preparationRepo
            .list()
            .filter(
              (item) =>
                item.id !== run!.id &&
                item.cvChecksum === metadata.checksum &&
                (item.status === "Ready" || item.status === "Needs Review"),
            )
            .sort((a, b) => b.completedAt?.localeCompare(a.completedAt || "") || 0)[0]
        : undefined;

      const extraction = reusable
        ? {
            fields: reusable.extractedProfile,
            confidence: reusable.fieldConfidence,
            warnings: [...reusable.warnings],
            method: "Local Preview" as const,
          }
        : await this.extractor.extract({ file: blob, fileName: metadata.name });

      const extractedProfile: CandidateCvExtractedFields = {
        ...extraction.fields,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        phone: candidate.phone,
        location: candidate.location,
        currentCompany: candidate.currentCompany || extraction.fields.currentCompany,
        currentTitle: candidate.currentTitle || extraction.fields.currentTitle,
        yearsOfExperience: candidate.yearsOfExperience,
      };
      const profileText = [
        candidate.currentTitle,
        candidate.currentCompany,
        ...(candidate.skills ?? []),
        ...(candidate.education ?? []),
        ...(candidate.certifications ?? []),
        ...(candidate.languages ?? []),
        extraction.fields.currentTitle,
        extraction.fields.currentCompany,
        ...(extraction.fields.skills ?? []),
        ...(extraction.fields.education ?? []),
        ...(extraction.fields.certifications ?? []),
        ...(extraction.fields.languages ?? []),
        ...application.screeningAnswers.flatMap((answer) => [answer.question, answer.answer]),
      ]
        .filter(Boolean)
        .join(" ");
      const compulsoryChecks: CandidateCriterionCheck[] = (vacancy.mandatoryCriteria ?? []).map(
        (criterion) => ({
          criterion,
          status: includesCriterion(profileText, criterion) ? "Confirmed" : "Needs Review",
          ...(includesCriterion(profileText, criterion)
            ? { evidence: "Matched in the prepared CV or application information." }
            : {}),
        }),
      );
      const requiredSkills = vacancy.skills.required;
      const preparedSkills = unique([
        ...(candidate.skills ?? []),
        ...(extraction.fields.skills ?? []),
      ]);
      const matchedSkills = requiredSkills.filter((required) =>
        preparedSkills.some((skill) => includesCriterion(skill, required)),
      );
      const missingRequiredSkills = requiredSkills.filter(
        (required) => !matchedSkills.includes(required),
      );
      const requiredYears = Number(vacancy.minimumExperience.match(/\d+/)?.[0] || 0);
      const actualYears = candidate.yearsOfExperience || extraction.fields.yearsOfExperience || 0;
      const experienceScore =
        requiredYears > 0 ? Math.min(100, Math.round((actualYears / requiredYears) * 100)) : 100;
      const compulsoryScore =
        compulsoryChecks.length > 0
          ? Math.round(
              (compulsoryChecks.filter((check) => check.status === "Confirmed").length /
                compulsoryChecks.length) *
                100,
            )
          : 100;
      const skillScore =
        requiredSkills.length > 0
          ? Math.round((matchedSkills.length / requiredSkills.length) * 100)
          : 100;
      const roleTokens = new Set(
        tokens(
          [
            vacancy.title,
            vacancy.summary,
            ...vacancy.requirements,
            ...vacancy.skills.required,
          ].join(" "),
        ),
      );
      const profileTokens = new Set(tokens(profileText));
      const semanticMatches = [...roleTokens].filter((token) => profileTokens.has(token)).length;
      const semanticScore =
        roleTokens.size > 0
          ? Math.min(100, Math.round((semanticMatches / roleTokens.size) * 180))
          : 100;
      const preliminaryScore = Math.round(
        compulsoryScore * 0.45 + experienceScore * 0.25 + skillScore * 0.2 + semanticScore * 0.1,
      );
      const unconfirmed = compulsoryChecks.some((check) => check.status === "Needs Review");
      const route = reusable
        ? ("Reuse Prepared CV" as const)
        : documentRoute(metadata.mimeType, Object.keys(extraction.fields).length > 0);
      const warnings = unique([
        ...extraction.warnings,
        ...(route === "OCR Required"
          ? ["This scanned or image-based CV is waiting for the production OCR provider."]
          : []),
      ]);
      let band: CandidatePreparationBand;
      if (route === "OCR Required" && preparedSkills.length === 0) band = "Processing Problem";
      else if (unconfirmed) band = "Compulsory Criterion Not Confirmed";
      else if (warnings.length > 0 || missingRequiredSkills.length > 0) band = "Needs HR Review";
      else if (preliminaryScore >= 80) band = "Strong Match";
      else if (preliminaryScore >= 55) band = "Potential Match";
      else band = "Needs HR Review";
      const status =
        band === "Strong Match" || band === "Potential Match" ? "Ready" : "Needs Review";

      const updated = this.preparationRepo.update(
        run.id,
        {
          cvChecksum: metadata.checksum,
          status,
          documentRoute: route,
          extractedProfile,
          fieldConfidence: {
            ...extraction.confidence,
            firstName: 1,
            lastName: 1,
            email: 1,
            phone: 1,
            location: 1,
            yearsOfExperience: 1,
          },
          preliminaryScore,
          band,
          compulsoryChecks,
          matchedSkills,
          missingRequiredSkills,
          evidence: unique([
            `${actualYears} years of experience recorded against ${vacancy.minimumExperience}.`,
            ...(matchedSkills.length > 0
              ? [`Matched required skills: ${matchedSkills.join(", ")}.`]
              : []),
          ]),
          warnings,
          reusedFromPreparationRunId: reusable?.id,
          completedAt: new Date().toISOString(),
        },
        { ...context, reason: "Completed inexpensive CV preparation and preliminary ranking" },
      );
      this.applicationRepo.update(
        application.id,
        { preparationRunId: updated.id, preparationStatus: status },
        { ...context, reason: "Updated application preparation result" },
      );
      this.cvRepo.update(
        cvRecord.id,
        {
          extractedFields: extractedProfile,
          fieldConfidence: updated.fieldConfidence,
          extractionWarnings: warnings,
          extractionMethod: extraction.method,
          processingStatus:
            cvRecord.source === "Careers Portal" ? "Awaiting HR Review" : cvRecord.processingStatus,
        },
        { ...context, reason: "Stored reusable CV preparation information" },
      );
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "CV preparation failed.";
      this.applicationRepo.update(
        application.id,
        { preparationStatus: "Processing Failed" },
        { ...context, reason: "Recorded application preparation failure" },
      );
      return this.preparationRepo.update(
        run.id,
        {
          status: "Processing Failed",
          band: "Processing Problem",
          failureReason: message,
          warnings: [message],
          completedAt: new Date().toISOString(),
        },
        { ...context, reason: "Recorded CV preparation failure" },
      );
    }
  }

  async processQueuedForVacancy(
    vacancyId: string,
    context: ActorContext,
  ): Promise<CandidatePreparationRun[]> {
    assertHr(context, "candidate_preparation_batch_denied", vacancyId);
    const queued = this.preparationRepo
      .list()
      .filter(
        (run) =>
          run.vacancyId === vacancyId &&
          (run.status === "Queued" || run.status === "Processing Failed"),
      );
    return Promise.all(queued.map((run) => this.processRun(run.id, context)));
  }

  /**
   * Resume work that was safely written before a browser refresh or tab closure. A run left in
   * Processing is treated as interrupted because browser-only work cannot continue after the
   * JavaScript context disappears. Processing is idempotent: the same run is updated, not copied.
   */
  async resumePendingRuns(
    context: ActorContext = { actor: SYSTEM_ACTOR },
  ): Promise<CandidatePreparationRun[]> {
    assertHr(context, "candidate_preparation_resume_denied", "pending");
    const pending = this.preparationRepo
      .list()
      .filter((run) => run.status === "Queued" || run.status === "Processing");
    const results: CandidatePreparationRun[] = [];
    for (const run of pending) {
      results.push(await this.processRun(run.id, context));
    }
    return results;
  }

  async prepareVacancyApplications(
    vacancyId: string,
    context: ActorContext,
  ): Promise<CandidatePreparationRun[]> {
    assertHr(context, "candidate_preparation_batch_denied", vacancyId);
    const applications = this.applicationRepo
      .list()
      .filter((application) => application.vacancyId === vacancyId);
    for (const application of applications) {
      const cvRecord = this.cvRepo
        .list()
        .filter(
          (record) =>
            record.candidateId === application.candidateId &&
            (record.applicationId === application.id || record.fileId === application.cvFileId),
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
      if (!cvRecord) continue;
      this.queueApplication(application.id, cvRecord.id, context);
    }
    await this.processQueuedForVacancy(vacancyId, context);
    return this.getRunsForVacancy(vacancyId, context);
  }

  getRunsForVacancy(vacancyId: string, context: ActorContext): CandidatePreparationRun[] {
    assertHr(context, "candidate_preparation_view_denied", vacancyId);
    return this.preparationRepo
      .list()
      .filter((run) => run.vacancyId === vacancyId)
      .sort((a, b) => (b.preliminaryScore ?? -1) - (a.preliminaryScore ?? -1));
  }

  getLatestRunForApplication(applicationId: string): CandidatePreparationRun | undefined {
    return this.preparationRepo
      .list()
      .filter((run) => run.applicationId === applicationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  getInclusions(vacancyId: string, context: ActorContext): CandidateAssessmentInclusion[] {
    assertHr(context, "assessment_inclusion_view_denied", vacancyId);
    return this.inclusionRepo.list().filter((item) => item.vacancyId === vacancyId && item.active);
  }

  async includeCandidate(
    input: {
      vacancyId: string;
      candidateId: string;
      cvRecordId: string;
      source: CandidateAssessmentInclusion["source"];
      reason: string;
    },
    context: ActorContext,
  ): Promise<{ inclusion: CandidateAssessmentInclusion; application: CandidateApplication }> {
    assertHr(context, "assessment_inclusion_denied", input.candidateId);
    if (input.reason.trim().length < 5) throw new Error("Record why this candidate is included.");
    const candidate = this.candidateRepo.getById(input.candidateId);
    const vacancy = this.vacancyRepo.getById(input.vacancyId);
    const cvRecord = this.cvRepo.getById(input.cvRecordId);
    if (!candidate || !vacancy || !cvRecord) throw new Error("Candidate, vacancy or CV not found.");
    if (candidate.doNotContact) throw new Error("This candidate is marked Do Not Contact.");
    if (candidate.consentStatus !== "Confirmed") {
      throw new Error("Candidate consent must be confirmed before including them.");
    }
    if (cvRecord.candidateId !== candidate.id) throw new Error("Select this candidate's CV.");
    let application = this.applicationRepo
      .list()
      .find((item) => item.candidateId === candidate.id && item.vacancyId === vacancy.id);
    if (!application) {
      application = this.applicationRepo.create(
        {
          referenceId: applicationReference(),
          candidateId: candidate.id,
          vacancyId: vacancy.id,
          status: "New",
          cvFileId: cvRecord.fileId,
          noticePeriod: candidate.noticePeriod || "To be confirmed",
          screeningAnswers: [],
          source: input.source === "Recommended" ? "HR Recommendation" : "Candidate Pool",
          consentGiven: true,
          consentedAt: candidate.consentUpdatedAt || new Date().toISOString(),
        },
        { ...context, reason: `Created application from ${input.source}` },
      );
      this.vacancyRepo.update(
        vacancy.id,
        { applicantCount: (vacancy.applicantCount || 0) + 1 },
        context,
      );
    }
    const existing = this.inclusionRepo
      .list()
      .find(
        (item) =>
          item.vacancyId === vacancy.id &&
          item.candidateId === candidate.id &&
          item.source === input.source &&
          item.active,
      );
    const inclusion =
      existing ||
      this.inclusionRepo.create(
        {
          vacancyId: vacancy.id,
          candidateId: candidate.id,
          cvRecordId: cvRecord.id,
          source: input.source,
          reason: input.reason.trim(),
          active: true,
        },
        { ...context, reason: input.reason.trim() },
      );
    const run = this.queueApplication(application.id, cvRecord.id, context);
    await this.processRun(run.id, context);
    return { inclusion, application };
  }

  createAssessmentBatch(
    vacancyId: string,
    targetSize: number,
    context: ActorContext,
  ): CandidateAssessmentBatch {
    assertHr(context, "assessment_batch_create_denied", vacancyId);
    if (
      !Number.isInteger(targetSize) ||
      targetSize < MIN_ASSESSMENT_SIZE ||
      targetSize > MAX_ASSESSMENT_SIZE
    ) {
      throw new Error(
        `Choose between ${MIN_ASSESSMENT_SIZE} and ${MAX_ASSESSMENT_SIZE} candidates.`,
      );
    }
    const vacancy = this.vacancyRepo.getById(vacancyId);
    if (!vacancy) throw new Error("Vacancy not found.");
    const runs = this.getRunsForVacancy(vacancyId, context).filter(
      (run) =>
        run.vacancyRecordVersion === vacancy.recordVersion &&
        (run.status === "Ready" || run.status === "Needs Review"),
    );
    const latestByCandidate = new Map<string, CandidatePreparationRun>();
    for (const run of runs) {
      if (!latestByCandidate.has(run.candidateId)) latestByCandidate.set(run.candidateId, run);
    }
    const ranked = [...latestByCandidate.values()].sort(
      (a, b) => (b.preliminaryScore ?? -1) - (a.preliminaryScore ?? -1),
    );
    if (ranked.length < targetSize) {
      throw new Error(
        `Only ${ranked.length} prepared candidate${ranked.length === 1 ? " is" : "s are"} available.`,
      );
    }
    const inclusions = this.getInclusions(vacancyId, context);
    const recommended = unique(
      inclusions.filter((item) => item.source === "Recommended").map((item) => item.candidateId),
    );
    const hrAdded = unique(
      inclusions.filter((item) => item.source === "HR Added").map((item) => item.candidateId),
    );
    const pinned = unique([...recommended, ...hrAdded]).filter((candidateId) =>
      latestByCandidate.has(candidateId),
    );
    if (pinned.length > targetSize) {
      throw new Error(
        `${pinned.length} recommended or HR-added candidates are pinned. Increase the assessment number.`,
      );
    }
    const selected = [
      ...pinned,
      ...ranked
        .map((run) => run.candidateId)
        .filter((candidateId) => !pinned.includes(candidateId)),
    ].slice(0, targetSize);
    const existing = this.batchRepo
      .list()
      .find((batch) => batch.vacancyId === vacancyId && batch.status === "Draft");
    const payload = {
      vacancyId,
      vacancyRecordVersion: vacancy.recordVersion,
      targetSize,
      rankedCandidateIds: ranked.map((run) => run.candidateId),
      selectedCandidateIds: selected,
      recommendedCandidateIds: recommended.filter((id) => selected.includes(id)),
      hrAddedCandidateIds: hrAdded.filter((id) => selected.includes(id)),
      preparationRunIds: selected.map((id) => latestByCandidate.get(id)!.id),
      detailedScoreIds: [],
      status: "Draft" as const,
    };
    return existing
      ? this.batchRepo.update(existing.id, payload, {
          ...context,
          reason: "Updated the detailed-assessment group",
        })
      : this.batchRepo.create(payload, {
          ...context,
          reason: "Created the detailed-assessment group",
        });
  }

  updateAssessmentSelection(
    batchId: string,
    selectedCandidateIds: string[],
    reason: string,
    context: ActorContext,
  ): CandidateAssessmentBatch {
    assertHr(context, "assessment_batch_update_denied", batchId);
    if (reason.trim().length < 5) throw new Error("Record why the assessment group was changed.");
    const batch = this.batchRepo.getById(batchId);
    if (!batch || batch.status !== "Draft")
      throw new Error("Only a draft assessment group can be changed.");
    const selected = unique(selectedCandidateIds);
    if (selected.length !== batch.targetSize) {
      throw new Error(`Choose exactly ${batch.targetSize} candidates.`);
    }
    if (selected.some((candidateId) => !batch.rankedCandidateIds.includes(candidateId))) {
      throw new Error("Every selected person must have a completed preliminary review.");
    }
    const pinned = unique([...batch.recommendedCandidateIds, ...batch.hrAddedCandidateIds]);
    if (pinned.some((candidateId) => !selected.includes(candidateId))) {
      throw new Error("Recommended and HR-added candidates must remain in the assessment group.");
    }
    const latestRuns = this.getRunsForVacancy(batch.vacancyId, context);
    const preparationRunIds = selected.map((candidateId) => {
      const run = latestRuns.find(
        (item) =>
          item.candidateId === candidateId &&
          item.vacancyRecordVersion === batch.vacancyRecordVersion &&
          (item.status === "Ready" || item.status === "Needs Review"),
      );
      if (!run) throw new Error("A selected candidate is no longer ready for assessment.");
      return run.id;
    });
    return this.batchRepo.update(
      batch.id,
      { selectedCandidateIds: selected, preparationRunIds },
      { ...context, reason: reason.trim() },
    );
  }

  runDetailedAssessment(batchId: string, context: ActorContext): CandidateAssessmentBatch {
    assertHr(context, "detailed_assessment_denied", batchId);
    const services = getApplicationDataServices();
    const snapshot = services.storage.exportState();
    try {
      const batch = this.batchRepo.getById(batchId);
      if (!batch || batch.status !== "Draft") throw new Error("Assessment group is not available.");
      const vacancy = this.vacancyRepo.getById(batch.vacancyId);
      if (!vacancy) throw new Error("Vacancy not found.");
      if (vacancy.recordVersion !== batch.vacancyRecordVersion) {
        throw new Error("The vacancy requirements changed. Prepare a new assessment group.");
      }
      if (batch.selectedCandidateIds.length !== batch.targetSize) {
        throw new Error("The assessment group must contain exactly the number chosen by HR.");
      }
      const scoreIds: string[] = [];
      const scores: CandidateScoreRun[] = [];
      for (const candidateId of batch.selectedCandidateIds) {
        const candidate = this.candidateRepo.getById(candidateId);
        const application = this.applicationRepo
          .list()
          .find((item) => item.candidateId === candidateId && item.vacancyId === vacancy.id);
        const run = this.preparationRepo
          .list()
          .find(
            (item) => batch.preparationRunIds.includes(item.id) && item.candidateId === candidateId,
          );
        if (!candidate || !application || !run) {
          throw new Error("A selected candidate is no longer ready for assessment.");
        }
        if (run.status !== "Ready" && run.status !== "Needs Review") {
          throw new Error("A selected candidate's CV preparation is not complete.");
        }
        const baseScore = this.scoring.scoreCandidate(candidate, vacancy, application, context);
        const confirmedCriteria = run.compulsoryChecks
          .filter((check) => check.status === "Confirmed")
          .map((check) => check.criterion);
        const unconfirmedCriteria = run.compulsoryChecks
          .filter((check) => check.status !== "Confirmed")
          .map((check) => check.criterion);
        const scorePayload = {
          ...baseScore,
          strengths: [
            ...baseScore.strengths,
            ...confirmedCriteria.map(
              (criterion) => `Compulsory criterion confirmed: ${criterion}.`,
            ),
          ],
          risks: [
            ...baseScore.risks,
            ...unconfirmedCriteria.map(
              (criterion) => `Compulsory criterion requires HR confirmation: ${criterion}.`,
            ),
          ],
          missingData: [
            ...baseScore.missingData,
            ...unconfirmedCriteria.map((criterion) => `Evidence not confirmed for: ${criterion}.`),
          ],
          evidence: [baseScore.evidence, ...run.evidence].filter(Boolean).join(" "),
        };
        const score = this.scoreRepo.create(
          {
            ...scorePayload,
            applicationId: application.id,
            cvRecordId: run.cvRecordId,
            cvFileId: run.cvFileId,
            vacancyRecordVersion: vacancy.recordVersion,
            assessmentBatchId: batch.id,
          },
          { ...context, reason: "Completed detailed assessment for HR-selected candidate" },
        );
        scoreIds.push(score.id);
        scores.push(score);
        this.applicationRepo.update(
          application.id,
          { assessmentScoreId: score.id },
          { ...context, reason: "Linked detailed assessment to application" },
        );
        const recommendation = this.recommendationRepo
          .list()
          .find(
            (item) =>
              item.candidateId === candidate.id &&
              item.vacancyId === vacancy.id &&
              item.status === "Ready for Assessment",
          );
        if (recommendation) {
          this.recommendationRepo.update(
            recommendation.id,
            {
              assessmentScoreId: score.id,
              assessmentSource: "Automatic Assessment",
              status: "Ready to Schedule",
            },
            { ...context, reason: "Completed the recommended candidate's detailed assessment" },
          );
        }
        this.candidateRepo.update(
          candidate.id,
          { stage: "Screened", aiScoreRange: `${score.overallScore}/100` },
          { ...context, reason: "Completed detailed vacancy assessment" },
        );
      }
      const completed = this.batchRepo.update(
        batch.id,
        { status: "Assessment Completed", detailedScoreIds: scoreIds },
        { ...context, reason: "Completed detailed assessment group" },
      );
      const rankedScores = scores.sort((a, b) => b.overallScore - a.overallScore);
      new ShortlistService().saveDraft(
        {
          vacancyId: vacancy.id,
          targetSize: batch.targetSize,
          rankedCandidateIds: rankedScores.map((score) => score.candidateId),
          selectedCandidateIds: [...batch.selectedCandidateIds],
          pinnedCandidateIds: unique([
            ...batch.recommendedCandidateIds,
            ...batch.hrAddedCandidateIds,
          ]),
          unselectedAction: null,
          overrides: [],
          status: "Draft",
        },
        { ...context, reason: "Prepared shortlist review from the selected assessment group" },
      );
      return completed;
    } catch (error) {
      services.storage.replaceState(snapshot);
      throw error;
    }
  }

  getLatestBatch(vacancyId: string, context: ActorContext): CandidateAssessmentBatch | undefined {
    assertHr(context, "assessment_batch_view_denied", vacancyId);
    return this.batchRepo
      .list()
      .filter((batch) => batch.vacancyId === vacancyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }
}
