import "@tanstack/react-start/server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import type {
  Candidate,
  CandidateApplication,
  CandidateAssessmentBatch,
  CandidateAssessmentInclusion,
  CandidateContact,
  CandidateCvRecord,
  CandidateInterviewRecommendation,
  CandidatePreparationRun,
  CandidateRecommendation,
  CandidateScoreRun,
  HiringDecisionSnapshot,
  InterviewDisposition,
  InterviewEvent,
  InterviewScorecard,
  InterviewTemplate,
  JobOffer,
  ShortlistSnapshot,
} from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import {
  candidateApplications,
  candidateAssessmentBatches,
  candidateAssessmentInclusions,
  candidateContacts,
  candidateCvRecords,
  candidateInterviewRecommendations,
  candidatePreparationRuns,
  candidateRecommendations,
  candidateScoreRuns,
  candidates,
  hiringDecisions,
  interviewDispositions,
  interviewPanelists,
  interviewScorecards,
  interviews,
  interviewTemplates,
  jobOffers,
  shortlistSnapshots,
} from "../schema/recruitment.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";

export interface RecruitmentReadSnapshot {
  candidates: Candidate[];
  applications: CandidateApplication[];
  candidateCvRecords: CandidateCvRecord[];
  candidatePreparationRuns: CandidatePreparationRun[];
  candidateAssessmentInclusions: CandidateAssessmentInclusion[];
  candidateAssessmentBatches: CandidateAssessmentBatch[];
  candidateScores: CandidateScoreRun[];
  candidateInterviewRecommendations: CandidateInterviewRecommendation[];
  candidateContacts: CandidateContact[];
  candidateRecommendations: CandidateRecommendation[];
  shortlistSnapshots: ShortlistSnapshot[];
  interviewTemplates: InterviewTemplate[];
  interviewEvents: InterviewEvent[];
  interviewDispositions: InterviewDisposition[];
  interviewScorecards: InterviewScorecard[];
  hiringDecisions: HiringDecisionSnapshot[];
  jobOffers: JobOffer[];
}

function emptyRecruitmentSnapshot(): RecruitmentReadSnapshot {
  return {
    candidates: [],
    applications: [],
    candidateCvRecords: [],
    candidatePreparationRuns: [],
    candidateAssessmentInclusions: [],
    candidateAssessmentBatches: [],
    candidateScores: [],
    candidateInterviewRecommendations: [],
    candidateContacts: [],
    candidateRecommendations: [],
    shortlistSnapshots: [],
    interviewTemplates: [],
    interviewEvents: [],
    interviewDispositions: [],
    interviewScorecards: [],
    hiringDecisions: [],
    jobOffers: [],
  };
}

function base(row: {
  id: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  archivedAt: Date | null;
  recordVersion: number;
}) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    recordVersion: row.recordVersion,
  };
}

function decryptOptional(value: string | null): string | undefined {
  return value ? decryptSensitiveJson<string>(value) : undefined;
}

export async function listRecruitmentReadSnapshot(
  organisationId: string,
): Promise<RecruitmentReadSnapshot> {
  const db = getDatabaseClient();
  const [
    candidateRows,
    applicationRows,
    cvRows,
    preparationRows,
    inclusionRows,
    batchRows,
    scoreRows,
    interviewRecommendationRows,
    contactRows,
    recommendationRows,
    shortlistRows,
    templateRows,
    interviewRows,
    panelRows,
    dispositionRows,
    scorecardRows,
    decisionRows,
    offerRows,
  ] = await Promise.all([
    db
      .select()
      .from(candidates)
      .where(eq(candidates.organisationId, organisationId))
      .orderBy(asc(candidates.createdAt)),
    db
      .select()
      .from(candidateApplications)
      .where(eq(candidateApplications.organisationId, organisationId))
      .orderBy(asc(candidateApplications.createdAt)),
    db
      .select()
      .from(candidateCvRecords)
      .where(eq(candidateCvRecords.organisationId, organisationId))
      .orderBy(asc(candidateCvRecords.createdAt)),
    db
      .select()
      .from(candidatePreparationRuns)
      .where(eq(candidatePreparationRuns.organisationId, organisationId))
      .orderBy(asc(candidatePreparationRuns.createdAt)),
    db
      .select()
      .from(candidateAssessmentInclusions)
      .where(eq(candidateAssessmentInclusions.organisationId, organisationId))
      .orderBy(asc(candidateAssessmentInclusions.createdAt)),
    db
      .select()
      .from(candidateAssessmentBatches)
      .where(eq(candidateAssessmentBatches.organisationId, organisationId))
      .orderBy(asc(candidateAssessmentBatches.createdAt)),
    db
      .select()
      .from(candidateScoreRuns)
      .where(eq(candidateScoreRuns.organisationId, organisationId))
      .orderBy(asc(candidateScoreRuns.createdAt)),
    db
      .select()
      .from(candidateInterviewRecommendations)
      .where(eq(candidateInterviewRecommendations.organisationId, organisationId))
      .orderBy(asc(candidateInterviewRecommendations.createdAt)),
    db
      .select()
      .from(candidateContacts)
      .where(eq(candidateContacts.organisationId, organisationId))
      .orderBy(asc(candidateContacts.createdAt)),
    db
      .select()
      .from(candidateRecommendations)
      .where(eq(candidateRecommendations.organisationId, organisationId))
      .orderBy(asc(candidateRecommendations.createdAt)),
    db
      .select()
      .from(shortlistSnapshots)
      .where(eq(shortlistSnapshots.organisationId, organisationId))
      .orderBy(asc(shortlistSnapshots.createdAt)),
    db
      .select()
      .from(interviewTemplates)
      .where(eq(interviewTemplates.organisationId, organisationId))
      .orderBy(asc(interviewTemplates.createdAt)),
    db
      .select()
      .from(interviews)
      .where(eq(interviews.organisationId, organisationId))
      .orderBy(asc(interviews.createdAt)),
    db
      .select()
      .from(interviewPanelists)
      .where(eq(interviewPanelists.organisationId, organisationId)),
    db
      .select()
      .from(interviewDispositions)
      .where(eq(interviewDispositions.organisationId, organisationId))
      .orderBy(asc(interviewDispositions.createdAt)),
    db
      .select()
      .from(interviewScorecards)
      .where(eq(interviewScorecards.organisationId, organisationId))
      .orderBy(asc(interviewScorecards.createdAt)),
    db
      .select()
      .from(hiringDecisions)
      .where(eq(hiringDecisions.organisationId, organisationId))
      .orderBy(asc(hiringDecisions.createdAt)),
    db
      .select()
      .from(jobOffers)
      .where(eq(jobOffers.organisationId, organisationId))
      .orderBy(asc(jobOffers.createdAt)),
  ]);
  return {
    candidates: candidateRows.map((row) => ({
      ...base(row),
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      ...(row.nationality ? { nationality: row.nationality } : {}),
      location: row.location,
      ...(row.currentCompany ? { currentCompany: row.currentCompany } : {}),
      ...(row.currentTitle ? { currentTitle: row.currentTitle } : {}),
      ...(row.linkedInUrl ? { linkedInUrl: row.linkedInUrl } : {}),
      ...(row.cvFileId ? { cvFileId: row.cvFileId } : {}),
      yearsOfExperience: row.yearsOfExperience,
      stage: row.stage,
      doNotContact: row.doNotContact,
      ...(row.hrOwnerId ? { hrOwnerId: row.hrOwnerId } : {}),
      ...(row.recommender ? { recommender: row.recommender } : {}),
      ...(row.visaStatus ? { visaStatus: row.visaStatus } : {}),
      ...(row.maritalStatus ? { maritalStatus: row.maritalStatus } : {}),
      ...(row.lastContactAt ? { lastContactAt: row.lastContactAt } : {}),
      ...(row.followUpStatus ? { followUpStatus: row.followUpStatus } : {}),
      ...(row.source ? { source: row.source } : {}),
      ...(row.aiScoreRange ? { aiScoreRange: row.aiScoreRange } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(row.projectName ? { projectName: row.projectName } : {}),
      ...(row.projectType ? { projectType: row.projectType } : {}),
      ...(row.shortlistStatus ? { shortlistStatus: row.shortlistStatus } : {}),
      ...(row.trackerStatus ? { trackerStatus: row.trackerStatus } : {}),
      ...(row.noticePeriod ? { noticePeriod: row.noticePeriod } : {}),
      ...(decryptOptional(row.currentSalaryEncrypted)
        ? { currentSalary: decryptOptional(row.currentSalaryEncrypted) }
        : {}),
      ...(decryptOptional(row.expectedSalaryEncrypted)
        ? { expectedSalary: decryptOptional(row.expectedSalaryEncrypted) }
        : {}),
      ...(decryptOptional(row.acceptedSalaryEncrypted)
        ? { acceptedSalary: decryptOptional(row.acceptedSalaryEncrypted) }
        : {}),
      ...(row.interviewDate ? { interviewDate: row.interviewDate } : {}),
      ...(row.remarks ? { remarks: row.remarks } : {}),
      ...(row.importProvenance ? { importProvenance: row.importProvenance } : {}),
      ...(row.originalImportValues ? { originalImportValues: row.originalImportValues } : {}),
      ...(row.convertedToEmployeeId ? { convertedToEmployeeId: row.convertedToEmployeeId } : {}),
      ...(row.mergedIntoId ? { mergedIntoId: row.mergedIntoId } : {}),
      ...(row.skills ? { skills: row.skills } : {}),
      ...(row.education ? { education: row.education } : {}),
      ...(row.certifications ? { certifications: row.certifications } : {}),
      ...(row.languages ? { languages: row.languages } : {}),
      ...(row.availability ? { availability: row.availability } : {}),
      ...(row.workEligibility ? { workEligibility: row.workEligibility } : {}),
      ...(row.talentPools ? { talentPools: row.talentPools } : {}),
      ...(row.consentStatus ? { consentStatus: row.consentStatus } : {}),
      ...(row.consentUpdatedAt ? { consentUpdatedAt: row.consentUpdatedAt } : {}),
      ...(row.latestCvRecordId ? { latestCvRecordId: row.latestCvRecordId } : {}),
    })),
    applications: applicationRows.map((row) => ({
      ...base(row),
      referenceId: row.referenceId,
      candidateId: row.candidateId,
      vacancyId: row.vacancyId,
      status: row.status,
      cvFileId: row.cvFileId,
      ...(row.coverNote ? { coverNote: row.coverNote } : {}),
      noticePeriod: row.noticePeriod,
      ...(decryptOptional(row.salaryExpectationEncrypted)
        ? { salaryExpectation: decryptOptional(row.salaryExpectationEncrypted) }
        : {}),
      screeningAnswers: row.screeningAnswers,
      source: row.source,
      consentGiven: row.consentGiven,
      consentedAt: row.consentedAt,
      ...(row.hrInterviewRecommendationId
        ? { hrInterviewRecommendationId: row.hrInterviewRecommendationId }
        : {}),
      ...(row.assessmentScoreId ? { assessmentScoreId: row.assessmentScoreId } : {}),
      ...(row.preparationRunId ? { preparationRunId: row.preparationRunId } : {}),
      ...(row.preparationStatus
        ? { preparationStatus: row.preparationStatus as CandidateApplication["preparationStatus"] }
        : {}),
      ...(row.screeningDecision
        ? { screeningDecision: row.screeningDecision as CandidateApplication["screeningDecision"] }
        : {}),
    })),
    candidateCvRecords: cvRows.map((row) => ({
      ...base(row),
      ...(row.candidateId ? { candidateId: row.candidateId } : {}),
      ...(row.applicationId ? { applicationId: row.applicationId } : {}),
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      fileId: row.fileId,
      originalFileName: row.originalFileName,
      source: row.source,
      receivedAt: row.receivedAt,
      processingStatus: row.processingStatus,
      extractionMethod: row.extractionMethod as CandidateCvRecord["extractionMethod"],
      extractedFields: row.extractedFields as CandidateCvRecord["extractedFields"],
      fieldConfidence: row.fieldConfidence as CandidateCvRecord["fieldConfidence"],
      extractionWarnings: row.extractionWarnings,
      consentStatus: row.consentStatus,
      ...(row.notes ? { notes: row.notes } : {}),
      ...(row.reviewedAt ? { reviewedAt: row.reviewedAt } : {}),
      ...(row.reviewedByUserId ? { reviewedByUserId: row.reviewedByUserId } : {}),
      ...(row.recommendationPending !== null
        ? { recommendationPending: row.recommendationPending }
        : {}),
      ...(row.recommendationId ? { recommendationId: row.recommendationId } : {}),
    })),
    candidatePreparationRuns: preparationRows.map((row) => ({
      ...base(row),
      vacancyId: row.vacancyId,
      vacancyRecordVersion: row.vacancyRecordVersion,
      candidateId: row.candidateId,
      applicationId: row.applicationId,
      cvRecordId: row.cvRecordId,
      cvFileId: row.cvFileId,
      ...(row.cvChecksum ? { cvChecksum: row.cvChecksum } : {}),
      status: row.status as CandidatePreparationRun["status"],
      documentRoute: row.documentRoute as CandidatePreparationRun["documentRoute"],
      preparationMethod: row.preparationMethod as CandidatePreparationRun["preparationMethod"],
      extractedProfile: row.extractedProfile as CandidatePreparationRun["extractedProfile"],
      fieldConfidence: row.fieldConfidence as CandidatePreparationRun["fieldConfidence"],
      ...(row.preliminaryScore !== null ? { preliminaryScore: Number(row.preliminaryScore) } : {}),
      ...(row.band ? { band: row.band as CandidatePreparationRun["band"] } : {}),
      compulsoryChecks: row.compulsoryChecks as CandidatePreparationRun["compulsoryChecks"],
      matchedSkills: row.matchedSkills,
      missingRequiredSkills: row.missingRequiredSkills,
      evidence: row.evidence,
      warnings: row.warnings,
      ...(row.reusedFromPreparationRunId
        ? { reusedFromPreparationRunId: row.reusedFromPreparationRunId }
        : {}),
      ...(row.startedAt ? { startedAt: row.startedAt } : {}),
      ...(row.completedAt ? { completedAt: row.completedAt } : {}),
      ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    })),
    candidateAssessmentInclusions: inclusionRows.map((row) => ({
      ...base(row),
      vacancyId: row.vacancyId,
      candidateId: row.candidateId,
      cvRecordId: row.cvRecordId,
      source: row.source as CandidateAssessmentInclusion["source"],
      reason: row.reason,
      active: row.active,
    })),
    candidateAssessmentBatches: batchRows.map((row) => ({
      ...base(row),
      vacancyId: row.vacancyId,
      vacancyRecordVersion: row.vacancyRecordVersion,
      targetSize: row.targetSize,
      rankedCandidateIds: row.rankedCandidateIds,
      selectedCandidateIds: row.selectedCandidateIds,
      recommendedCandidateIds: row.recommendedCandidateIds,
      hrAddedCandidateIds: row.hrAddedCandidateIds,
      preparationRunIds: row.preparationRunIds,
      detailedScoreIds: row.detailedScoreIds,
      status: row.status as CandidateAssessmentBatch["status"],
    })),
    candidateScores: scoreRows.map((row) => ({
      ...base(row),
      vacancyId: row.vacancyId,
      candidateId: row.candidateId,
      ...(row.applicationId ? { applicationId: row.applicationId } : {}),
      ...(row.cvRecordId ? { cvRecordId: row.cvRecordId } : {}),
      ...(row.cvFileId ? { cvFileId: row.cvFileId } : {}),
      ...(row.vacancyRecordVersion !== null
        ? { vacancyRecordVersion: row.vacancyRecordVersion }
        : {}),
      ...(row.assessmentBatchId ? { assessmentBatchId: row.assessmentBatchId } : {}),
      timestamp: row.timestamp,
      modelRulesVersion: row.modelRulesVersion,
      vacancyVersion: row.vacancyVersion,
      overallScore: Number(row.overallScore),
      categoryScores: row.categoryScores as CandidateScoreRun["categoryScores"],
      strengths: row.strengths,
      risks: row.risks,
      missingData: row.missingData,
      evidence: row.evidence,
    })),
    candidateInterviewRecommendations: interviewRecommendationRows.map((row) => ({
      ...base(row),
      candidateId: row.candidateId,
      vacancyId: row.vacancyId,
      applicationId: row.applicationId,
      ...(row.cvRecordId ? { cvRecordId: row.cvRecordId } : {}),
      recommendedByUserId: row.recommendedByUserId,
      reason: row.reason,
      ...(row.assessmentScoreId ? { assessmentScoreId: row.assessmentScoreId } : {}),
      ...(row.assessmentSource
        ? {
            assessmentSource:
              row.assessmentSource as CandidateInterviewRecommendation["assessmentSource"],
          }
        : {}),
      ...(row.screeningDecision
        ? {
            screeningDecision:
              row.screeningDecision as CandidateInterviewRecommendation["screeningDecision"],
          }
        : {}),
      status: row.status as CandidateInterviewRecommendation["status"],
    })),
    candidateContacts: contactRows.map((row) => ({
      ...base(row),
      candidateId: row.candidateId,
      channel: row.channel,
      date: row.date,
      contactedByUserId: row.contactedByUserId,
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      outcome: row.outcome,
      notes: row.notes,
      ...(row.nextFollowUpDate ? { nextFollowUpDate: row.nextFollowUpDate } : {}),
    })),
    candidateRecommendations: recommendationRows.map((row) => ({
      ...base(row),
      candidateId: row.candidateId,
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      recommenderType: row.recommenderType,
      recommenderName: row.recommenderName,
      ...(row.recommenderCompany ? { recommenderCompany: row.recommenderCompany } : {}),
      ...(row.recommenderPosition ? { recommenderPosition: row.recommenderPosition } : {}),
      recommenderEmail: row.recommenderEmail,
      ...(row.recommenderPhone ? { recommenderPhone: row.recommenderPhone } : {}),
      ...(row.relationship ? { relationship: row.relationship } : {}),
      date: row.date,
      notes: row.notes,
      hrOwnerId: row.hrOwnerId,
      ...(row.commercialTerms ? { commercialTerms: row.commercialTerms } : {}),
      sourceOutcome: row.sourceOutcome,
      ...(row.employeeId ? { employeeId: row.employeeId } : {}),
    })),
    shortlistSnapshots: shortlistRows.map((row) => ({
      ...base(row),
      vacancyId: row.vacancyId,
      targetSize: row.targetSize,
      rankedCandidateIds: row.rankedCandidateIds,
      selectedCandidateIds: row.selectedCandidateIds,
      ...(row.pinnedCandidateIds ? { pinnedCandidateIds: row.pinnedCandidateIds } : {}),
      unselectedAction: row.unselectedAction as ShortlistSnapshot["unselectedAction"],
      overrides: row.overrides as ShortlistSnapshot["overrides"],
      status: row.status as ShortlistSnapshot["status"],
    })),
    interviewTemplates: templateRows.map((row) => ({
      ...base(row),
      name: row.name,
      criteria: row.criteria as InterviewTemplate["criteria"],
      blindScoring: row.blindScoring,
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      ...(row.stageName ? { stageName: row.stageName } : {}),
      aiDecisionWeight: Number(row.aiDecisionWeight),
      interviewDecisionWeight: Number(row.interviewDecisionWeight),
    })),
    interviewEvents: interviewRows.map((row) => ({
      ...base(row),
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      candidateId: row.candidateId,
      ...(row.templateId ? { templateId: row.templateId } : {}),
      ...(row.source ? { source: row.source as InterviewEvent["source"] } : {}),
      ...(row.positionTitle ? { positionTitle: row.positionTitle } : {}),
      ...(row.projectName ? { projectName: row.projectName } : {}),
      ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}),
      ...(row.manualOutcome
        ? { manualOutcome: row.manualOutcome as InterviewEvent["manualOutcome"] }
        : {}),
      ...(row.manualDecisionReason ? { manualDecisionReason: row.manualDecisionReason } : {}),
      stageName: row.stageName,
      durationMinutes: row.durationMinutes,
      panelUserIds: panelRows
        .filter((panel) => panel.interviewId === row.id)
        .map((panel) => panel.userId),
      location: row.location,
      videoMethod: row.videoMethod,
      notes: row.notes,
      status: row.status,
      confirmedSlot: row.confirmedSlot as InterviewEvent["confirmedSlot"],
      proposedSlots: row.proposedSlots as InterviewEvent["proposedSlots"],
      ...(row.calendarEventReference ? { calendarEventReference: row.calendarEventReference } : {}),
      ...(row.meetingReference ? { meetingReference: row.meetingReference } : {}),
      ...(row.meetingJoinUrl ? { meetingJoinUrl: row.meetingJoinUrl } : {}),
      ...(row.invitationDeliveryReferences
        ? { invitationDeliveryReferences: row.invitationDeliveryReferences }
        : {}),
      ...(row.candidateResponseStatus
        ? {
            candidateResponseStatus:
              row.candidateResponseStatus as InterviewEvent["candidateResponseStatus"],
          }
        : {}),
      history: row.history as InterviewEvent["history"],
    })),
    interviewDispositions: dispositionRows.map((row) => ({
      ...base(row),
      interviewId: row.interviewId,
      candidateId: row.candidateId,
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      outcome: row.outcome,
      reason: row.reason,
      futureVacancyIds: row.futureVacancyIds,
      suggestedRoleTitles: row.suggestedRoleTitles,
      recordedAt: row.recordedAt,
      recordedByUserId: row.recordedByUserId,
    })),
    interviewScorecards: scorecardRows.map((row) => ({
      ...base(row),
      interviewId: row.interviewId,
      panelUserId: row.panelUserId,
      status: row.status as InterviewScorecard["status"],
      scores: row.scores as InterviewScorecard["scores"],
      overallRecommendation:
        row.overallRecommendation as InterviewScorecard["overallRecommendation"],
      submittedAt: row.submittedAt,
      revisionHistory: row.revisionHistory as InterviewScorecard["revisionHistory"],
    })),
    hiringDecisions: decisionRows.map((row) => ({
      ...base(row),
      vacancyId: row.vacancyId,
      systemRecommendedCandidateId: row.systemRecommendedCandidateId,
      finalSelectedCandidateId: row.finalSelectedCandidateId,
      ...(row.overrideReason ? { overrideReason: row.overrideReason } : {}),
      ...(row.waiverReason ? { waiverReason: row.waiverReason } : {}),
      ...(row.decisionSource
        ? { decisionSource: row.decisionSource as HiringDecisionSnapshot["decisionSource"] }
        : {}),
      ...(row.interviewId ? { interviewId: row.interviewId } : {}),
      status: row.status as HiringDecisionSnapshot["status"],
    })),
    jobOffers: offerRows.map((row) => ({
      ...base(row),
      candidateId: row.candidateId,
      vacancyId: row.vacancyId,
      status: row.status,
      template: row.template,
      position: row.position,
      grade: row.grade,
      salary: decryptSensitiveJson<number>(row.salaryEncrypted),
      currency: decryptSensitiveJson<string>(row.currencyEncrypted),
      allowances: decryptSensitiveJson<string>(row.allowancesEncrypted),
      benefits: decryptSensitiveJson<string>(row.benefitsEncrypted),
      startDate: row.startDate,
      probation: row.probation,
      location: row.location,
      conditions: row.conditions,
      ...(row.sentDate ? { sentDate: row.sentDate } : {}),
      ...(row.deliveryReference ? { deliveryReference: row.deliveryReference } : {}),
      ...(row.responseDeadline ? { responseDeadline: row.responseDeadline } : {}),
      ...(row.declineReason ? { declineReason: row.declineReason } : {}),
      history: row.history as JobOffer["history"],
      ...(row.convertedToEmployeeId ? { convertedToEmployeeId: row.convertedToEmployeeId } : {}),
    })),
  };
}

/**
 * Returns only interviews assigned to one panel member. This is deliberately a separate,
 * row-scoped query from the HR recruitment snapshot: panel members never load the candidate
 * pool, salaries, offers, recommendations, other candidates, or another panel member's draft.
 */
export async function listPanelInterviewReadSnapshot(
  organisationId: string,
  panelUserId: string,
): Promise<RecruitmentReadSnapshot> {
  const db = getDatabaseClient();
  const assignedPanels = await db
    .select({ interviewId: interviewPanelists.interviewId })
    .from(interviewPanelists)
    .where(
      and(
        eq(interviewPanelists.organisationId, organisationId),
        eq(interviewPanelists.userId, panelUserId),
      ),
    );
  const interviewIds = assignedPanels.map((row) => row.interviewId);
  if (interviewIds.length === 0) return emptyRecruitmentSnapshot();

  const interviewRows = await db
    .select()
    .from(interviews)
    .where(and(eq(interviews.organisationId, organisationId), inArray(interviews.id, interviewIds)))
    .orderBy(asc(interviews.createdAt));
  const candidateIds = [...new Set(interviewRows.map((row) => row.candidateId))];
  const templateIds = [
    ...new Set(
      interviewRows.map((row) => row.templateId).filter((id): id is string => Boolean(id)),
    ),
  ];

  const [candidateRows, templateRows, panelRows, scorecardRows] = await Promise.all([
    db
      .select({
        id: candidates.id,
        firstName: candidates.firstName,
        lastName: candidates.lastName,
        currentTitle: candidates.currentTitle,
        currentCompany: candidates.currentCompany,
        stage: candidates.stage,
        createdAt: candidates.createdAt,
        createdBy: candidates.createdBy,
        updatedAt: candidates.updatedAt,
        updatedBy: candidates.updatedBy,
        archivedAt: candidates.archivedAt,
        recordVersion: candidates.recordVersion,
      })
      .from(candidates)
      .where(
        and(eq(candidates.organisationId, organisationId), inArray(candidates.id, candidateIds)),
      ),
    templateIds.length
      ? db
          .select()
          .from(interviewTemplates)
          .where(
            and(
              eq(interviewTemplates.organisationId, organisationId),
              inArray(interviewTemplates.id, templateIds),
            ),
          )
      : Promise.resolve([]),
    db
      .select()
      .from(interviewPanelists)
      .where(
        and(
          eq(interviewPanelists.organisationId, organisationId),
          inArray(interviewPanelists.interviewId, interviewIds),
        ),
      ),
    db
      .select()
      .from(interviewScorecards)
      .where(
        and(
          eq(interviewScorecards.organisationId, organisationId),
          inArray(interviewScorecards.interviewId, interviewIds),
          eq(interviewScorecards.panelUserId, panelUserId),
        ),
      )
      .orderBy(asc(interviewScorecards.createdAt)),
  ]);

  return {
    ...emptyRecruitmentSnapshot(),
    candidates: candidateRows.map((row) => ({
      ...base(row),
      firstName: row.firstName,
      lastName: row.lastName,
      // Contact and compensation fields are intentionally not selected for interview panelists.
      email: "",
      phone: "",
      location: "",
      ...(row.currentCompany ? { currentCompany: row.currentCompany } : {}),
      ...(row.currentTitle ? { currentTitle: row.currentTitle } : {}),
      yearsOfExperience: 0,
      stage: row.stage,
      doNotContact: false,
    })),
    interviewTemplates: templateRows.map((row) => ({
      ...base(row),
      name: row.name,
      criteria: row.criteria as InterviewTemplate["criteria"],
      blindScoring: row.blindScoring,
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      ...(row.stageName ? { stageName: row.stageName } : {}),
      aiDecisionWeight: Number(row.aiDecisionWeight),
      interviewDecisionWeight: Number(row.interviewDecisionWeight),
    })),
    interviewEvents: interviewRows.map((row) => ({
      ...base(row),
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      candidateId: row.candidateId,
      ...(row.templateId ? { templateId: row.templateId } : {}),
      ...(row.source ? { source: row.source as InterviewEvent["source"] } : {}),
      ...(row.positionTitle ? { positionTitle: row.positionTitle } : {}),
      ...(row.projectName ? { projectName: row.projectName } : {}),
      ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}),
      ...(row.manualOutcome
        ? { manualOutcome: row.manualOutcome as InterviewEvent["manualOutcome"] }
        : {}),
      ...(row.manualDecisionReason ? { manualDecisionReason: row.manualDecisionReason } : {}),
      stageName: row.stageName,
      durationMinutes: row.durationMinutes,
      panelUserIds: panelRows
        .filter((panel) => panel.interviewId === row.id)
        .map((panel) => panel.userId),
      location: row.location,
      videoMethod: row.videoMethod,
      notes: row.notes,
      status: row.status,
      confirmedSlot: row.confirmedSlot as InterviewEvent["confirmedSlot"],
      proposedSlots: row.proposedSlots as InterviewEvent["proposedSlots"],
      ...(row.calendarEventReference ? { calendarEventReference: row.calendarEventReference } : {}),
      ...(row.meetingReference ? { meetingReference: row.meetingReference } : {}),
      ...(row.meetingJoinUrl ? { meetingJoinUrl: row.meetingJoinUrl } : {}),
      ...(row.invitationDeliveryReferences
        ? { invitationDeliveryReferences: row.invitationDeliveryReferences }
        : {}),
      ...(row.candidateResponseStatus
        ? {
            candidateResponseStatus:
              row.candidateResponseStatus as InterviewEvent["candidateResponseStatus"],
          }
        : {}),
      history: row.history as InterviewEvent["history"],
    })),
    interviewScorecards: scorecardRows.map((row) => ({
      ...base(row),
      interviewId: row.interviewId,
      panelUserId: row.panelUserId,
      status: row.status as InterviewScorecard["status"],
      scores: row.scores as InterviewScorecard["scores"],
      overallRecommendation:
        row.overallRecommendation as InterviewScorecard["overallRecommendation"],
      submittedAt: row.submittedAt,
      revisionHistory: row.revisionHistory as InterviewScorecard["revisionHistory"],
    })),
  };
}
