import {
  type ActorContext,
  type Candidate,
  type CandidateApplication,
  type CandidateContact,
  type CandidateCvRecord,
  type ContactChannel,
  type ContactOutcome,
  type CandidateRecommendation,
  type RecommenderType,
  type CandidateScoreRun,
  type InterviewEvent,
  type JobOffer,
} from "./types.ts";
import { LocalRepository } from "./repository.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import { NotificationService } from "./notification-service.ts";
import { VacancyService } from "./vacancy-service.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { CandidatePoolService } from "./candidate-pool-service.ts";

export interface SubmitApplicationPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality?: string | undefined;
  location: string;
  currentCompany?: string | undefined;
  currentTitle?: string | undefined;
  yearsOfExperience: number;
  noticePeriod: string;
  salaryExpectation?: string | undefined;
  screeningAnswers: { question: string; answer: string }[];
  coverNote?: string | undefined;
  cvFileId: string;
  vacancyId: string;
  consent: boolean;
}

// Digits only, so "+968 9123 4567", "968-9123-4567", and "00968 9123 4567" are all recognised as
// the same underlying number instead of creating three separate candidate records.
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").replace(/^00/, "").replace(/^968/, "");
}

export class CandidateService {
  private candidateRepo: LocalRepository<Candidate>;
  private applicationRepo: LocalRepository<CandidateApplication>;
  private contactRepo: LocalRepository<CandidateContact>;
  private recommendationRepo: LocalRepository<CandidateRecommendation>;
  private scoreRepo: LocalRepository<CandidateScoreRun>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.candidateRepo = new LocalRepository<Candidate>("candidates", storage, audit, {
      module: "candidates",
      entityType: "candidate",
    });
    this.applicationRepo = new LocalRepository<CandidateApplication>(
      "applications",
      storage,
      audit,
      {
        module: "applications",
        entityType: "candidate-application",
      },
    );
    this.contactRepo = new LocalRepository<CandidateContact>("candidate_contacts", storage, audit, {
      module: "candidates",
      entityType: "candidate-contact",
    });
    this.recommendationRepo = new LocalRepository<CandidateRecommendation>(
      "candidate_recommendations",
      storage,
      audit,
      {
        module: "candidates",
        entityType: "candidate-recommendation",
      },
    );
    this.scoreRepo = new LocalRepository<CandidateScoreRun>("candidate_scores", storage, audit, {
      module: "candidates",
      entityType: "candidate-score",
    });
  }

  async hydrateCompatibilityCache(context: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const { getRecruitmentSnapshotFn } = await import("../server-functions/candidate.server.ts");
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      databaseId?: string;
      workspaceEmail?: string;
    }>("users");
    const employees = getApplicationDataServices().storage.readCollection<{
      id: string;
      databaseId?: string;
    }>("employees");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    const snapshot = await getRecruitmentSnapshotFn({
      data: {
        actorId: context.actor.userId,
        ...(actorEmail ? { actorEmail } : {}),
        activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
      },
    });
    const employeeIdMap = new Map(
      employees.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    const userIdMap = new Map(
      users.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    const { storage } = getApplicationDataServices();
    const vacancyIdMap = new Map(
      storage
        .readCollection<{ id: string; databaseId?: string }>("vacancies")
        .filter((item) => item.databaseId)
        .map((item) => [item.databaseId!, item.id]),
    );
    const localVacancyId = (id: string) => vacancyIdMap.get(id) ?? id;
    storage.writeCollection(
      "candidates",
      snapshot.candidates.map((candidate) => ({
        ...candidate,
        ...(candidate.hrOwnerId
          ? { hrOwnerId: employeeIdMap.get(candidate.hrOwnerId) ?? candidate.hrOwnerId }
          : {}),
        ...(candidate.convertedToEmployeeId
          ? {
              convertedToEmployeeId:
                employeeIdMap.get(candidate.convertedToEmployeeId) ??
                candidate.convertedToEmployeeId,
            }
          : {}),
      })),
    );
    storage.writeCollection(
      "applications",
      snapshot.applications.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "candidate_cv_records",
      snapshot.candidateCvRecords.map((record) => ({
        ...record,
        ...(record.vacancyId ? { vacancyId: localVacancyId(record.vacancyId) } : {}),
      })),
    );
    storage.writeCollection(
      "candidate_preparation_runs",
      snapshot.candidatePreparationRuns.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "candidate_assessment_inclusions",
      snapshot.candidateAssessmentInclusions.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "candidate_assessment_batches",
      snapshot.candidateAssessmentBatches.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "candidate_scores",
      snapshot.candidateScores.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "candidate_interview_recommendations",
      snapshot.candidateInterviewRecommendations.map((recommendation) => ({
        ...recommendation,
        vacancyId: localVacancyId(recommendation.vacancyId),
        recommendedByUserId:
          userIdMap.get(recommendation.recommendedByUserId) ?? recommendation.recommendedByUserId,
      })),
    );
    storage.writeCollection(
      "candidate_contacts",
      snapshot.candidateContacts.map((contact) => ({
        ...contact,
        ...(contact.vacancyId ? { vacancyId: localVacancyId(contact.vacancyId) } : {}),
        contactedByUserId: userIdMap.get(contact.contactedByUserId) ?? contact.contactedByUserId,
      })),
    );
    storage.writeCollection(
      "candidate_recommendations",
      snapshot.candidateRecommendations.map((recommendation) => ({
        ...recommendation,
        ...(recommendation.vacancyId
          ? { vacancyId: localVacancyId(recommendation.vacancyId) }
          : {}),
        hrOwnerId: employeeIdMap.get(recommendation.hrOwnerId) ?? recommendation.hrOwnerId,
        ...(recommendation.employeeId
          ? {
              employeeId: employeeIdMap.get(recommendation.employeeId) ?? recommendation.employeeId,
            }
          : {}),
      })),
    );
    storage.writeCollection(
      "shortlist_snapshots",
      snapshot.shortlistSnapshots.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "interview_templates",
      snapshot.interviewTemplates.map((record) => ({
        ...record,
        ...(record.vacancyId ? { vacancyId: localVacancyId(record.vacancyId) } : {}),
      })),
    );
    storage.writeCollection(
      "interview_events",
      snapshot.interviewEvents.map((record) => ({
        ...record,
        ...(record.vacancyId ? { vacancyId: localVacancyId(record.vacancyId) } : {}),
        panelUserIds: record.panelUserIds.map((id) => userIdMap.get(id) ?? id),
      })),
    );
    storage.writeCollection(
      "interview_dispositions",
      snapshot.interviewDispositions.map((record) => ({
        ...record,
        ...(record.vacancyId ? { vacancyId: localVacancyId(record.vacancyId) } : {}),
        futureVacancyIds: record.futureVacancyIds.map(localVacancyId),
        recordedByUserId: userIdMap.get(record.recordedByUserId) ?? record.recordedByUserId,
      })),
    );
    storage.writeCollection(
      "interview_scorecards",
      snapshot.interviewScorecards.map((record) => ({
        ...record,
        panelUserId: userIdMap.get(record.panelUserId) ?? record.panelUserId,
      })),
    );
    storage.writeCollection(
      "hiring_decisions",
      snapshot.hiringDecisions.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
      })),
    );
    storage.writeCollection(
      "job_offers",
      snapshot.jobOffers.map((record) => ({
        ...record,
        vacancyId: localVacancyId(record.vacancyId),
        ...(record.convertedToEmployeeId
          ? {
              convertedToEmployeeId:
                employeeIdMap.get(record.convertedToEmployeeId) ?? record.convertedToEmployeeId,
            }
          : {}),
      })),
    );
    window.dispatchEvent(new CustomEvent("via_hr:data_changed"));
  }

  private actorServerData(context: ActorContext) {
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      workspaceEmail?: string;
    }>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    };
  }

  private databaseVacancyId(id?: string): string | undefined {
    if (!id) return undefined;
    const vacancy = getApplicationDataServices()
      .storage.readCollection<{ id: string; databaseId?: string }>("vacancies")
      .find((item) => item.id === id || item.databaseId === id);
    return vacancy?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
  }

  async updateCandidateStageAsync(
    candidateId: string,
    stage: Candidate["stage"],
    context: ActorContext,
  ): Promise<void> {
    const { updateCandidateStageFn } = await import("../server-functions/candidate.server.ts");
    await updateCandidateStageFn({
      data: {
        actor: this.actorServerData(context),
        candidateId,
        stage,
        reason: context.reason || `Changed candidate stage to ${stage}`,
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async reassignOwnerAsync(
    candidateId: string,
    ownerUserId: string,
    context: ActorContext,
  ): Promise<void> {
    const owner = getApplicationDataServices()
      .storage.readCollection<{ id: string; databaseId?: string }>("users")
      .find((user) => user.id === ownerUserId || user.databaseId === ownerUserId);
    if (!owner?.databaseId)
      throw new Error("The selected HR owner is not connected to the database.");
    const { reassignCandidateOwnerFn } = await import("../server-functions/candidate.server.ts");
    await reassignCandidateOwnerFn({
      data: {
        actor: this.actorServerData(context),
        candidateId,
        ownerUserId: owner.databaseId,
        reason: context.reason || "Reassigned candidate ownership",
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async updateCandidateDetailsAsync(
    candidateId: string,
    details: Partial<Candidate>,
    context: ActorContext,
  ): Promise<void> {
    if (
      !details.email ||
      !details.phone ||
      !details.location ||
      details.yearsOfExperience === undefined
    ) {
      throw new Error("Email, phone, location and experience are required.");
    }
    const project = details.projectId
      ? getApplicationDataServices()
          .storage.readCollection<{ id: string; databaseId?: string }>("projects")
          .find((item) => item.id === details.projectId || item.databaseId === details.projectId)
      : undefined;
    if (details.projectId && !project?.databaseId) {
      throw new Error("The selected project is not connected to the database.");
    }
    const { updateCandidateDetailsFn } = await import("../server-functions/candidate.server.ts");
    await updateCandidateDetailsFn({
      data: {
        actor: this.actorServerData(context),
        candidateId,
        reason: context.reason || "Updated candidate recruitment details",
        details: {
          email: details.email,
          phone: details.phone,
          yearsOfExperience: details.yearsOfExperience,
          location: details.location,
          ...(details.currentTitle ? { currentTitle: details.currentTitle } : {}),
          ...(details.currentCompany ? { currentCompany: details.currentCompany } : {}),
          ...(details.nationality ? { nationality: details.nationality } : {}),
          ...(project?.databaseId ? { projectId: project.databaseId } : {}),
          ...(details.projectName ? { projectName: details.projectName } : {}),
          ...(details.projectType ? { projectType: details.projectType } : {}),
          ...(details.shortlistStatus ? { shortlistStatus: details.shortlistStatus } : {}),
          ...(details.trackerStatus ? { trackerStatus: details.trackerStatus } : {}),
          ...(details.visaStatus ? { visaStatus: details.visaStatus } : {}),
          ...(details.maritalStatus ? { maritalStatus: details.maritalStatus } : {}),
          ...(details.noticePeriod ? { noticePeriod: details.noticePeriod } : {}),
          ...(details.currentSalary ? { currentSalary: details.currentSalary } : {}),
          ...(details.expectedSalary ? { expectedSalary: details.expectedSalary } : {}),
          ...(details.acceptedSalary ? { acceptedSalary: details.acceptedSalary } : {}),
          ...(details.interviewDate ? { interviewDate: details.interviewDate } : {}),
          ...(details.remarks ? { remarks: details.remarks } : {}),
        },
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async mergeCandidatesAsync(
    primaryId: string,
    duplicateId: string,
    context: ActorContext,
  ): Promise<void> {
    const { mergeCandidatesFn } = await import("../server-functions/candidate.server.ts");
    await mergeCandidatesFn({
      data: {
        actor: this.actorServerData(context),
        primaryId,
        duplicateId,
        reason: context.reason || `Merged duplicate candidate ${duplicateId} into ${primaryId}`,
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async logContactAsync(
    payload: Parameters<CandidateService["logContact"]>[0],
    context: ActorContext,
  ): Promise<void> {
    const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now()) {
      throw new Error("Enter a valid contact date that is not in the future.");
    }
    const vacancyId = this.databaseVacancyId(payload.vacancyId);
    const { logCandidateContactFn } = await import("../server-functions/candidate.server.ts");
    await logCandidateContactFn({
      data: {
        actor: this.actorServerData(context),
        contact: {
          candidateId: payload.candidateId,
          channel: payload.channel,
          date: occurredAt.toISOString().slice(0, 10),
          ...(vacancyId ? { vacancyId } : {}),
          outcome: payload.outcome,
          notes: payload.notes,
          ...(payload.nextFollowUpDate ? { nextFollowUpDate: payload.nextFollowUpDate } : {}),
        },
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async addRecommendationAsync(
    payload: Parameters<CandidateService["addRecommendation"]>[0],
    context: ActorContext,
  ): Promise<void> {
    const vacancyId = this.databaseVacancyId(payload.vacancyId);
    const { addCandidateRecommendationFn } =
      await import("../server-functions/candidate.server.ts");
    await addCandidateRecommendationFn({
      data: {
        actor: this.actorServerData(context),
        recommendation: {
          candidateId: payload.candidateId,
          ...(vacancyId ? { vacancyId } : {}),
          recommenderType: payload.recommenderType,
          recommenderName: payload.recommenderName,
          ...(payload.recommenderCompany ? { recommenderCompany: payload.recommenderCompany } : {}),
          ...(payload.recommenderPosition
            ? { recommenderPosition: payload.recommenderPosition }
            : {}),
          recommenderEmail: payload.recommenderEmail,
          ...(payload.recommenderPhone ? { recommenderPhone: payload.recommenderPhone } : {}),
          ...(payload.relationship ? { relationship: payload.relationship } : {}),
          date: payload.date.slice(0, 10),
          notes: payload.notes,
          ...(payload.commercialTerms ? { commercialTerms: payload.commercialTerms } : {}),
        },
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  async exportCandidatesAsync(candidateIds: string[], context: ActorContext): Promise<string> {
    const { exportCandidatesFn } = await import("../server-functions/candidate.server.ts");
    return exportCandidatesFn({
      data: {
        actor: this.actorServerData(context),
        candidateIds,
        reason: context.reason || "Exported the selected Candidate Pool records",
      },
    });
  }

  getCandidateRepository() {
    return this.candidateRepo;
  }

  private requireCandidateView(context: ActorContext, action: string, entityId: string): void {
    if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") return;
    recordAccessDenied(getApplicationDataServices().audit, {
      module: "candidates",
      entityType: "candidate",
      entityId,
      action,
      context,
    });
    throw new Error("Only HR or Super Admin can view candidate records.");
  }

  getCandidate(id: string, context: ActorContext) {
    this.requireCandidateView(context, "candidate_view_denied", id);
    return this.candidateRepo.getById(id);
  }

  updateCandidateStage(candidateId: string, stage: Candidate["stage"], context: ActorContext) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate",
        entityId: candidateId,
        action: "candidate_stage_change_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can change a candidate stage.");
    }
    return this.candidateRepo.update(candidateId, { stage }, context);
  }

  reassignOwner(candidateId: string, newOwnerUserId: string, context: ActorContext) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate",
        entityId: candidateId,
        action: "candidate_owner_reassign_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can reassign candidate ownership.");
    }
    const candidate = this.candidateRepo.getById(candidateId);
    if (!candidate) throw new Error("Candidate not found");
    const owner = getApplicationDataServices()
      .storage.readCollection<{ id: string; status: string; roles: string[] }>("users")
      .find((user) => user.id === newOwnerUserId);
    if (
      !owner ||
      owner.status !== "Active" ||
      (!owner.roles.includes("HR") && !owner.roles.includes("Super Admin"))
    ) {
      throw new Error("Select an active HR or Super Admin user as the candidate owner.");
    }
    return this.candidateRepo.update(
      candidateId,
      { hrOwnerId: newOwnerUserId },
      { ...context, reason: context.reason || "Reassigned candidate ownership" },
    );
  }

  // Merging folds every child record (applications, contacts, recommendations, scores, plus the
  // interview and offer collections owned by other services) onto the surviving candidate, then
  // archives the duplicate with a mergedIntoId pointer rather than deleting it outright - old
  // links (audit entries, notification history) still need somewhere to resolve to.
  mergeCandidates(primaryId: string, duplicateId: string, context: ActorContext) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate",
        entityId: duplicateId,
        action: "candidate_merge_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can merge candidates.");
    }
    if (primaryId === duplicateId) {
      throw new Error("Cannot merge a candidate into itself.");
    }
    const primary = this.candidateRepo.getById(primaryId);
    const duplicate = this.candidateRepo.getById(duplicateId);
    if (!primary || !duplicate) throw new Error("Both candidates must exist to merge.");
    if (primary.mergedIntoId) throw new Error("The primary candidate has itself been merged.");
    if (duplicate.mergedIntoId) throw new Error("This candidate has already been merged.");

    const mergeReason = context.reason || `Merged into candidate ${primaryId}`;
    const mergeContext = { ...context, reason: mergeReason };

    for (const app of this.applicationRepo.list().filter((a) => a.candidateId === duplicateId)) {
      const sameVacancyApplication = this.applicationRepo
        .list()
        .find(
          (primaryApplication) =>
            primaryApplication.candidateId === primaryId &&
            primaryApplication.vacancyId === app.vacancyId,
        );
      if (sameVacancyApplication) {
        this.applicationRepo.archive(app.id, {
          ...mergeContext,
          reason: `Archived duplicate application during candidate merge; retained ${sameVacancyApplication.referenceId}`,
        });
      } else {
        this.applicationRepo.update(app.id, { candidateId: primaryId }, mergeContext);
      }
    }
    for (const contact of this.contactRepo.list().filter((c) => c.candidateId === duplicateId)) {
      this.contactRepo.update(contact.id, { candidateId: primaryId }, mergeContext);
    }
    for (const rec of this.recommendationRepo.list().filter((r) => r.candidateId === duplicateId)) {
      this.recommendationRepo.update(rec.id, { candidateId: primaryId }, mergeContext);
    }
    for (const score of this.scoreRepo.list().filter((s) => s.candidateId === duplicateId)) {
      this.scoreRepo.update(score.id, { candidateId: primaryId }, mergeContext);
    }

    const { storage, audit } = getApplicationDataServices();
    const interviewRepo = new LocalRepository<InterviewEvent>("interview_events", storage, audit, {
      module: "recruitment",
      entityType: "interview",
    });
    for (const interview of interviewRepo.list().filter((i) => i.candidateId === duplicateId)) {
      interviewRepo.update(interview.id, { candidateId: primaryId }, mergeContext);
    }
    const offerRepo = new LocalRepository<JobOffer>("job_offers", storage, audit, {
      module: "recruitment",
      entityType: "offer",
    });
    for (const offer of offerRepo.list().filter((o) => o.candidateId === duplicateId)) {
      offerRepo.update(offer.id, { candidateId: primaryId }, mergeContext);
    }

    // Fill gaps on the surviving record from the duplicate, without overwriting anything the
    // survivor already has.
    const fillable: Partial<Candidate> = {};
    if (!primary.hrOwnerId && duplicate.hrOwnerId) fillable.hrOwnerId = duplicate.hrOwnerId;
    if (!primary.linkedInUrl && duplicate.linkedInUrl) fillable.linkedInUrl = duplicate.linkedInUrl;
    if (!primary.cvFileId && duplicate.cvFileId) fillable.cvFileId = duplicate.cvFileId;
    if (!primary.currentCompany && duplicate.currentCompany)
      fillable.currentCompany = duplicate.currentCompany;
    if (!primary.currentTitle && duplicate.currentTitle)
      fillable.currentTitle = duplicate.currentTitle;
    if (Object.keys(fillable).length > 0) {
      this.candidateRepo.update(primaryId, fillable, mergeContext);
    }

    this.candidateRepo.update(
      duplicateId,
      { stage: "Archived", mergedIntoId: primaryId },
      mergeContext,
    );

    return this.candidateRepo.getById(primaryId)!;
  }

  updateApplicationStatus(
    candidateId: string,
    vacancyId: string,
    status: CandidateApplication["status"],
    context: ActorContext,
  ) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "application",
        entityId: candidateId,
        action: "application_status_change_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can change an application status.");
    }
    return this.applicationRepo
      .list()
      .filter(
        (application) =>
          application.candidateId === candidateId && application.vacancyId === vacancyId,
      )
      .map((application) => this.applicationRepo.update(application.id, { status }, context));
  }

  getApplicationRepository() {
    return this.applicationRepo;
  }

  /**
   * Submits an application for a candidate.
   * If the candidate already exists by email, it links to them instead of creating a new one.
   * Checks for duplicate applications to the same vacancy to prevent spam/accidental resubmission.
   */
  async submitApplication(
    payload: SubmitApplicationPayload,
    source: string = "Career Portal",
  ): Promise<{ referenceId: string; candidateId: string }> {
    if (!payload.consent) {
      throw new Error(
        "Privacy consent is required before an application can be submitted. This is enforced here, not only in the form, so no application can ever be recorded without it.",
      );
    }

    const context: ActorContext = {
      actor: SYSTEM_ACTOR,
      reason: "Public career portal application submission",
    };

    // 1. Verify Vacancy is Open
    const vacancyService = new VacancyService();
    const vacancy = vacancyService.getVacancyRepository().getById(payload.vacancyId);
    if (!vacancy || vacancy.status !== "Open") {
      throw new Error("This vacancy is no longer open for applications.");
    }

    // 1b. Verify the CV file was actually uploaded and exists - a caller could otherwise submit
    // an application referencing an ID that was never saved, or one belonging to someone else.
    const cvMetadata = await getApplicationDataServices().files.getMetadata(payload.cvFileId);
    if (!cvMetadata) {
      throw new Error(
        "The uploaded CV could not be found. Please re-upload your CV and try again.",
      );
    }
    const applicationSnapshot = getApplicationDataServices().storage.exportState();

    // 2. Resolve Candidate - match by email OR normalized phone, since the same person applying
    // with a slightly different email but the same real phone number should still be recognised
    // as the same candidate rather than silently creating a duplicate record.
    const normalizedPayloadPhone = normalizePhone(payload.phone);
    let candidate = this.candidateRepo
      .list()
      .find(
        (c) =>
          c.email.toLowerCase() === payload.email.toLowerCase() ||
          (normalizedPayloadPhone && normalizePhone(c.phone) === normalizedPayloadPhone),
      );

    if (candidate) {
      // 3. Check for exact duplicate application
      const existingApp = this.applicationRepo
        .list()
        .find((app) => app.candidateId === candidate!.id && app.vacancyId === payload.vacancyId);
      if (existingApp) {
        throw new Error("DUPLICATE_APPLICATION"); // We throw a specific error code to show a safe message on UI
      }

      // A returning candidate may legitimately have changed their telephone number, location,
      // employer or title since the previous application. Reconcile the profile from the new,
      // consented submission and let the repository audit show exactly what changed.
      const reconciled: Partial<Candidate> = {
        firstName: payload.firstName.trim(),
        lastName: payload.lastName.trim(),
        email: payload.email.trim(),
        phone: payload.phone.trim(),
        location: payload.location.trim(),
        yearsOfExperience: payload.yearsOfExperience,
        noticePeriod: payload.noticePeriod.trim(),
        ...(payload.nationality?.trim() ? { nationality: payload.nationality.trim() } : {}),
        ...(payload.currentCompany?.trim()
          ? { currentCompany: payload.currentCompany.trim() }
          : {}),
        ...(payload.currentTitle?.trim() ? { currentTitle: payload.currentTitle.trim() } : {}),
        ...(payload.salaryExpectation?.trim()
          ? { expectedSalary: payload.salaryExpectation.trim() }
          : {}),
      };
      candidate = this.candidateRepo.update(candidate.id, reconciled, {
        ...context,
        reason: "Reconciled candidate profile from a new consented application",
      });
    } else {
      // Create new candidate
      candidate = this.candidateRepo.create(
        {
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
          phone: payload.phone,
          nationality: payload.nationality,
          location: payload.location,
          currentCompany: payload.currentCompany,
          currentTitle: payload.currentTitle,
          yearsOfExperience: payload.yearsOfExperience,
          stage: "Applied",
          doNotContact: false,
          source: source,
        },
        context,
      );
    }

    // 4. Generate Reference ID - retry on the (rare) chance of a random collision with an
    // existing application reference, rather than trusting randomness alone to be unique.
    const year = new Date().getFullYear().toString().slice(-2);
    const existingReferences = new Set(this.applicationRepo.list().map((app) => app.referenceId));
    let referenceId = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const randomHex = Math.random().toString(16).slice(2, 6).toUpperCase();
      const candidateReference = `APP-${year}-${randomHex}`;
      if (!existingReferences.has(candidateReference)) {
        referenceId = candidateReference;
        break;
      }
    }
    if (!referenceId) {
      throw new Error("Could not generate a unique application reference. Please try again.");
    }

    // 5. Create Application
    const application = this.applicationRepo.create(
      {
        referenceId,
        candidateId: candidate.id,
        vacancyId: payload.vacancyId,
        status: "New",
        cvFileId: payload.cvFileId,
        coverNote: payload.coverNote,
        noticePeriod: payload.noticePeriod,
        salaryExpectation: payload.salaryExpectation,
        screeningAnswers: payload.screeningAnswers,
        source,
        consentGiven: true,
        consentedAt: new Date().toISOString(),
      },
      context,
    );

    // Keep the original file as a versioned Candidate Pool CV record. Extraction is enrichment,
    // not a prerequisite for saving the application, and HR reviews all proposed CV fields before
    // they can change the confirmed candidate profile.
    let cvRecord: CandidateCvRecord;
    try {
      cvRecord = await new CandidatePoolService().registerPortalCv({ candidate, application });
      await getApplicationDataServices().files.updateOwner(
        payload.cvFileId,
        { entityType: "candidate-cv", entityId: cvRecord.id },
        { ...context, reason: "Linked the original CV to its Candidate Pool record" },
      );
    } catch (error) {
      const { storage, audit } = getApplicationDataServices();
      storage.replaceState(applicationSnapshot);
      audit.record({
        context,
        action: "rollback",
        module: "applications",
        entityType: "candidate-application",
        entityId: application.id,
        reason: `Application was not retained because the CV could not be registered: ${error instanceof Error ? error.message : "unknown error"}`,
        riskLevel: "High",
      });
      throw error;
    }

    // 6. Update Vacancy Applicant Count
    vacancyService.getVacancyRepository().update(
      vacancy.id,
      {
        applicantCount: (vacancy.applicantCount || 0) + 1,
      },
      context,
    );

    // 7. Notify HR Owner / Hiring Manager
    try {
      const { notifications, storage } = getApplicationDataServices();
      // assignedOwnerId/hiringManagerId are Employee IDs (they're populated from the employee
      // picker on the vacancy form), but notifications are addressed by User ID - resolve the
      // employee to the user account that logs in for them before sending.
      const ownerEmployeeId = vacancy.assignedOwnerId || vacancy.hiringManagerId;
      const notificationRecipient = ownerEmployeeId
        ? storage
            .readCollection<{ id: string; employeeId?: string }>("users")
            .find((user) => user.employeeId === ownerEmployeeId)?.id
        : undefined;
      if (notificationRecipient) {
        notifications.create(
          {
            recipientUserId: notificationRecipient,
            type: "New Application",
            title: "New Application",
            message: `New application received for ${vacancy.title} (${candidate.firstName} ${candidate.lastName})`,
            priority: "Normal",
            status: "Unread",
            link: { entityType: "vacancy", entityId: vacancy.id },
            deduplicationKey: `app-${application.id}`,
          },
          context,
        );
      }
    } catch (e) {
      console.error("Failed to send notification for new application", e);
    }

    // The applicant receives confirmation as soon as the structured records and original CV are
    // safe. Inexpensive preparation continues in the background and never blocks submission or
    // invokes the detailed scoring provider.
    // Load the processor only after the application module has finished initialising. This avoids
    // a CandidateService -> Preparation -> Shortlist -> CandidateService module cycle while still
    // awaiting the durable queue write before returning the applicant's confirmation.
    const { CandidatePreparationService } = await import("./candidate-preparation-service.ts");
    const preparation = new CandidatePreparationService();
    const run = preparation.queueApplication(application.id, cvRecord.id, {
      actor: SYSTEM_ACTOR,
      reason: "Automatically queued preparation after portal submission",
    });
    void preparation
      .processRun(run.id, {
        actor: SYSTEM_ACTOR,
        reason: "Automatically prepared a newly submitted CV",
      })
      .catch((error) => {
        getApplicationDataServices().audit.record({
          context,
          action: "candidate_preparation_background_failure",
          module: "recruitment",
          entityType: "candidate-application",
          entityId: application.id,
          reason: error instanceof Error ? error.message : "Background preparation failed",
          riskLevel: "Medium",
        });
      });

    return { referenceId, candidateId: candidate.id };
  }

  // Exporting candidate data to a file is a distinct, auditable action from merely viewing it in
  // the app - it takes salary and contact data outside the system entirely, so it is restricted
  // and logged the same way a compensation report would be, not treated as a free side effect of
  // the list page.
  exportCandidates(candidateIds: string[], context: ActorContext): string {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate-export",
        entityId: "bulk",
        action: "candidate_export_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can export candidate data.");
    }
    const selected = this.candidateRepo
      .list()
      .filter((candidate) => candidateIds.includes(candidate.id));
    const headers = [
      "ID",
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Location",
      "Position",
      "Experience",
      "Stage",
      "Source",
      "Notice Period",
      "Visa Status",
      "Do Not Contact",
      "Last Contact",
      "HR Owner",
    ];
    const rows = selected.map((candidate) => [
      candidate.id,
      candidate.firstName,
      candidate.lastName,
      candidate.email,
      candidate.phone,
      candidate.location,
      candidate.currentTitle || "",
      candidate.yearsOfExperience,
      candidate.stage,
      candidate.source || "",
      candidate.noticePeriod || "",
      candidate.visaStatus || "",
      candidate.doNotContact ? "Yes" : "No",
      candidate.lastContactAt || "",
      candidate.hrOwnerId || "",
    ]);
    const escapeCell = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");

    getApplicationDataServices().audit.record({
      context,
      action: "candidate_csv_export",
      module: "candidates",
      entityType: "candidate-export",
      entityId: "bulk",
      after: {
        candidateCount: selected.length,
        candidateIds: selected.map((candidate) => candidate.id),
        fields: headers,
        compensationIncluded: false,
      },
      riskLevel: "High",
    });
    return csv;
  }

  getDetailedCandidates(context: ActorContext) {
    this.requireCandidateView(context, "candidate_list_view_denied", "all");
    const candidates = this.candidateRepo.list();
    const apps = this.applicationRepo.list();
    const contacts = this.contactRepo.list();
    const recommendations = this.recommendationRepo.list();

    // Sync notifications while we're loading detailed candidates (acts as a background sync)
    this.syncOverdueNotifications(candidates, contacts);

    return candidates.map((candidate) => ({
      ...candidate,
      applications: apps.filter((a) => a.candidateId === candidate.id),
      contacts: contacts
        .filter((c) => c.candidateId === candidate.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
      recommendations: recommendations
        .filter((r) => r.candidateId === candidate.id)
        .map((recommendation) => this.redactRecommendation(recommendation, context))
        .sort((a, b) => b.date.localeCompare(a.date)),
    }));
  }

  private syncOverdueNotifications(candidates: Candidate[], contacts: CandidateContact[]) {
    try {
      const { notifications } = getApplicationDataServices();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existingNotifs = notifications.list();

      for (const candidate of candidates) {
        if (candidate.doNotContact) continue;
        // Only the most recent contact log can represent a genuinely pending follow-up - logging
        // any newer contact (even one with no follow-up date of its own) means the candidate was
        // actually followed up with, so an older contact's stale nextFollowUpDate no longer
        // applies. Scanning for "any contact that happens to have a date set" instead of the
        // latest one is what let a resolved follow-up keep showing as overdue.
        const mostRecent = contacts
          .filter((c) => c.candidateId === candidate.id)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        const pending = mostRecent?.nextFollowUpDate ? mostRecent : undefined;
        if (pending && new Date(pending.nextFollowUpDate!) < today) {
          // Overdue! Check if we already notified
          const title = `Overdue Follow-up: ${candidate.firstName} ${candidate.lastName}`;
          if (
            !existingNotifs.find(
              (notification) => notification.title === title && notification.status !== "Dismissed",
            )
          ) {
            notifications.create(
              {
                recipientUserId: candidate.hrOwnerId || SYSTEM_ACTOR.userId,
                title,
                message: `A scheduled follow-up from ${new Date(pending.nextFollowUpDate!).toLocaleDateString()} is overdue.`,
                type: "Task",
                priority: "High",
                status: "Unread",
                link: {
                  entityType: "candidate",
                  entityId: candidate.id,
                  path: `/staff/candidates/${candidate.id}`,
                },
              },
              { actor: SYSTEM_ACTOR },
            );
          }
        }
      }
    } catch (e) {
      // Ignore if services aren't fully initialized
    }
  }

  logContact(
    payload: {
      candidateId: string;
      channel: ContactChannel;
      vacancyId?: string;
      outcome: ContactOutcome;
      notes: string;
      nextFollowUpDate?: string;
      occurredAt?: string;
    },
    context: ActorContext,
  ) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate",
        entityId: payload.candidateId,
        action: "log_contact_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can log candidate contact.");
    }
    const candidate = this.candidateRepo.getById(payload.candidateId);
    if (!candidate) throw new Error("Candidate not found");
    if (candidate.doNotContact && payload.outcome !== "Do Not Contact") {
      throw new Error("Cannot contact a candidate marked as Do Not Contact");
    }
    let contactDate = new Date().toISOString();
    if (payload.occurredAt) {
      const parsed = new Date(payload.occurredAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid contact date.");
      }
      if (parsed.getTime() > Date.now()) {
        throw new Error("Contact date cannot be in the future.");
      }
      contactDate = parsed.toISOString();
    }

    const contact = this.contactRepo.create(
      {
        candidateId: payload.candidateId,
        channel: payload.channel,
        date: contactDate,
        contactedByUserId: context.actor.userId,
        vacancyId: payload.vacancyId,
        outcome: payload.outcome,
        notes: payload.notes,
        nextFollowUpDate: payload.nextFollowUpDate,
      },
      context,
    );

    // Update candidate
    const updates: Partial<Candidate> = {
      lastContactAt: contact.date,
      followUpStatus: payload.nextFollowUpDate
        ? "Scheduled"
        : payload.outcome === "No Answer" || payload.outcome === "Follow-up Required"
          ? "Pending"
          : "None",
    };
    if (payload.outcome === "Do Not Contact") {
      updates.doNotContact = true;
    }
    this.candidateRepo.update(candidate.id, updates, context);

    return contact;
  }

  getContactsForCandidate(candidateId: string, context: ActorContext) {
    this.requireCandidateView(context, "candidate_contacts_view_denied", candidateId);
    return this.contactRepo
      .list()
      .filter((c) => c.candidateId === candidateId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  getContactQueue(context: ActorContext) {
    this.requireCandidateView(context, "candidate_contact_queue_view_denied", "all");
    const contacts = this.contactRepo.list();
    const candidates = this.getDetailedCandidates(context);

    // Create a rich queue of candidates that need follow up or have been contacted
    return candidates.map((candidate) => {
      // candidate.contacts is already sorted newest-first (see getDetailedCandidates above). Only
      // the newest contact log can represent a genuinely pending follow-up - if it has no
      // nextFollowUpDate, the candidate was followed up with and any older, now-stale
      // nextFollowUpDate no longer applies, even if an earlier contact happened to have one set.
      const latestContact = candidate.contacts[0];
      const pendingFollowUp = latestContact?.nextFollowUpDate ? latestContact : undefined;

      let queueStatus = "Never Contacted";
      if (candidate.doNotContact) queueStatus = "Do Not Contact";
      else if (pendingFollowUp) {
        const due = new Date(pendingFollowUp.nextFollowUpDate!);
        const today = new Date();
        if (due.toDateString() === today.toDateString()) queueStatus = "Due Today";
        else if (due < today) queueStatus = "Overdue";
        else queueStatus = "Upcoming";
      } else if (latestContact || candidate.lastContactAt) {
        queueStatus = "Recently Contacted";
      }

      return {
        ...candidate,
        queueStatus,
        latestContact,
        pendingFollowUp,
      };
    });
  }

  // --- Recommendations ---
  addRecommendation(
    payload: Omit<
      CandidateRecommendation,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
    >,
    context: ActorContext,
  ) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate",
        entityId: payload.candidateId,
        action: "add_recommendation_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can record candidate recommendations.");
    }
    const candidate = this.candidateRepo.getById(payload.candidateId);
    if (!candidate) throw new Error("Candidate not found");
    if (!payload.recommenderName.trim()) {
      throw new Error("Enter the name of the person who recommended this candidate.");
    }
    if (!payload.recommenderEmail.trim() && !payload.recommenderPhone?.trim()) {
      throw new Error("Enter the recommender's email or phone number.");
    }
    if (
      payload.recommenderEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.recommenderEmail.trim())
    ) {
      throw new Error("Enter a valid recommender email address.");
    }

    // Create recommendation
    const rec = this.recommendationRepo.create(payload, context);

    // If candidate has no source, set it
    if (!candidate.source || candidate.source === "Direct") {
      this.candidateRepo.update(candidate.id, { source: payload.recommenderType }, context);
    }

    return rec;
  }

  // Used by the top-level "Add Recommended Candidate" entry point so HR can check for an
  // existing match by email or phone before deciding whether to link to that record or create a
  // fresh one - the same lookup submitApplication does, exposed here for a human to review
  // instead of resolving it silently.
  findDuplicateCandidates(email: string, phone: string, context: ActorContext): Candidate[] {
    this.requireCandidateView(context, "candidate_duplicate_search_denied", "possible-match");
    const normalizedPhone = normalizePhone(phone);
    return this.candidateRepo
      .list()
      .filter(
        (c) =>
          !c.mergedIntoId &&
          (c.email.toLowerCase() === email.toLowerCase() ||
            (normalizedPhone && normalizePhone(c.phone) === normalizedPhone)),
      );
  }

  createRecommendedCandidate(
    candidateFields: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      location: string;
      currentCompany?: string | undefined;
      currentTitle?: string | undefined;
      yearsOfExperience: number;
    },
    recommendationFields: Omit<
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
    linkToCandidateId?: string,
    forceCreateNew?: boolean,
  ) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "candidates",
        entityType: "candidate",
        entityId: "new",
        action: "add_recommended_candidate_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can add a recommended candidate.");
    }

    let candidateId: string;
    if (linkToCandidateId) {
      const existing = this.candidateRepo.getById(linkToCandidateId);
      if (!existing) throw new Error("The selected existing candidate no longer exists.");
      candidateId = existing.id;
    } else {
      const duplicates = this.findDuplicateCandidates(
        candidateFields.email,
        candidateFields.phone,
        context,
      );
      if (duplicates.length > 0 && !forceCreateNew) {
        throw new Error(
          "DUPLICATE_CANDIDATE_MATCH_FOUND: review the existing match(es) before creating a new candidate.",
        );
      }
      const created = this.candidateRepo.create(
        {
          ...candidateFields,
          stage: "Sourced",
          doNotContact: false,
          source: recommendationFields.recommenderType,
        },
        context,
      );
      candidateId = created.id;
    }

    const rec = this.recommendationRepo.create({ ...recommendationFields, candidateId }, context);
    return { candidateId, recommendation: rec };
  }

  linkRecommendationsToEmployee(candidateId: string, employeeId: string, context: ActorContext) {
    return this.recommendationRepo
      .list()
      .filter((recommendation) => recommendation.candidateId === candidateId)
      .map((recommendation) =>
        this.recommendationRepo.update(
          recommendation.id,
          { employeeId, sourceOutcome: "Hired" },
          { ...context, reason: context.reason || "Linked recommendation to converted employee" },
        ),
      );
  }

  getRecommendationsForCandidate(candidateId: string, context: ActorContext) {
    this.requireCandidateView(context, "candidate_recommendations_view_denied", candidateId);
    return this.recommendationRepo
      .list()
      .filter((recommendation) => recommendation.candidateId === candidateId)
      .map((recommendation) => this.redactRecommendation(recommendation, context));
  }

  private redactRecommendation(recommendation: CandidateRecommendation, context?: ActorContext) {
    const role = context?.actor.activeRole ?? context?.actor.roles[0];
    const canViewCommercial = role === "HR" || role === "Accounts" || role === "Super Admin";
    if (canViewCommercial || !recommendation.commercialTerms) return recommendation;
    const { commercialTerms: _restricted, ...visible } = recommendation;
    return visible as CandidateRecommendation;
  }

  getRecommenderProfiles(context: ActorContext) {
    this.requireCandidateView(context, "recommender_profiles_view_denied", "all");
    const allRecs = this.recommendationRepo
      .list()
      .map((recommendation) => this.redactRecommendation(recommendation, context));
    const candidates = this.candidateRepo.list();

    const profiles = new Map<
      string,
      {
        key: string;
        email: string;
        phone?: string | undefined;
        name: string;
        company?: string | undefined;
        type: RecommenderType;
        totalIntroduced: number;
        totalHired: number;
        activeProcess: number;
        recommendations: CandidateRecommendation[];
      }
    >();

    for (const rec of allRecs) {
      const normalizedEmail = rec.recommenderEmail.trim().toLowerCase();
      const normalizedPhone = normalizePhone(rec.recommenderPhone || "");
      const matchedProfile = Array.from(profiles.entries()).find(
        ([, profile]) =>
          (normalizedEmail && profile.email.toLowerCase() === normalizedEmail) ||
          (normalizedPhone && normalizePhone(profile.phone || "") === normalizedPhone),
      );
      const key =
        matchedProfile?.[0] ||
        normalizedEmail ||
        normalizedPhone ||
        `${rec.recommenderName}-${rec.recommenderCompany || ""}`.trim().toLowerCase();
      if (!profiles.has(key)) {
        profiles.set(key, {
          key,
          email: rec.recommenderEmail,
          phone: rec.recommenderPhone,
          name: rec.recommenderName,
          company: rec.recommenderCompany,
          type: rec.recommenderType,
          totalIntroduced: 0,
          totalHired: 0,
          activeProcess: 0,
          recommendations: [],
        });
      }

      const p = profiles.get(key)!;
      if (!p.email && rec.recommenderEmail) p.email = rec.recommenderEmail;
      if (!p.phone && rec.recommenderPhone) p.phone = rec.recommenderPhone;
      p.recommendations.push(rec);
      p.totalIntroduced++;

      const candidate = candidates.find((c) => c.id === rec.candidateId);
      if (candidate) {
        if (candidate.stage === "Hired") p.totalHired++;
        else if (["Shortlisted", "Interview", "Offer"].includes(candidate.stage)) p.activeProcess++;
      }
    }

    return Array.from(profiles.values()).sort((a, b) => b.totalIntroduced - a.totalIntroduced);
  }

  // --- Scoring ---
  getScoresForCandidate(candidateId: string, context: ActorContext): CandidateScoreRun[] {
    this.requireCandidateView(context, "candidate_scores_view_denied", candidateId);
    return this.scoreRepo
      .list()
      .filter((s) => s.candidateId === candidateId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  getLatestScoresForVacancy(vacancyId: string, context: ActorContext): CandidateScoreRun[] {
    this.requireCandidateView(context, "vacancy_scores_view_denied", vacancyId);
    const allScores = this.scoreRepo.list().filter((s) => s.vacancyId === vacancyId);

    // Group by candidateId and get the latest
    const latestMap = new Map<string, CandidateScoreRun>();
    for (const score of allScores) {
      const existing = latestMap.get(score.candidateId);
      if (!existing || new Date(score.timestamp) > new Date(existing.timestamp)) {
        latestMap.set(score.candidateId, score);
      }
    }

    return Array.from(latestMap.values()).sort((a, b) => b.overallScore - a.overallScore);
  }
}
