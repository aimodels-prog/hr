import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  CV_PROCESSOR_VERSION,
  calculateCvSemanticSimilarities,
  calculateCvSemanticSimilarity,
} from "../../integrations/cv-processing.server.ts";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import {
  candidateApplications,
  candidateAssessmentInclusions,
  candidateCvExtractions,
  candidateCvRecords,
  candidateInterviewRecommendations,
  candidatePreparationRuns,
  candidateRecommendations,
  candidates,
  candidateVacancyMatches,
  recruitmentDocuments,
  vacancies,
} from "../schema/recruitment.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { users } from "../schema/employee.ts";
import {
  buildCandidatePreliminaryAssessment,
  buildCvSemanticTexts,
} from "./candidate-cv-intake.repository.server.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type RecruiterActor = AuditActorContext & { userId: string };
type DatabaseWriter = Pick<ReturnType<typeof getDatabaseClient>, "select" | "insert">;

export interface CandidatePoolMatchView {
  id: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  recordVersion: number;
  vacancyId: string;
  vacancyRecordVersion: number;
  candidateId: string;
  candidateName: string;
  email: string;
  currentTitle?: string;
  cvRecordId: string;
  preliminaryScore: number;
  band: string;
  compulsoryChecks: Array<{
    criterion: string;
    status: "Confirmed" | "Needs Review";
    evidence?: string | undefined;
  }>;
  matchedSkills: string[];
  missingRequiredSkills: string[];
  evidence: string[];
  warnings: string[];
  rankingModel: string;
  status: "Suggested" | "Added to Screening" | "Dismissed";
  generatedAt: string;
}

function assertRecruiter(actor: AuditActorContext): asserts actor is RecruiterActor {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can review referrals and Candidate Pool matches.");
  if (!actor.userId) throw new Error("A verified VIA user is required.");
}

function recommendationReference(): string {
  return `REF-${new Date().getUTCFullYear().toString().slice(-2)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function notifyReferrer(
  tx: DatabaseWriter,
  organisationId: string,
  recommenderEmployeeId: string | null,
  recommendationId: string,
  title: string,
  message: string,
  actorUserId: string,
) {
  if (!recommenderEmployeeId) return;
  const [recipient] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.employeeId, recommenderEmployeeId),
        eq(users.status, "Active"),
        sql`${users.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!recipient) return;
  await tx.insert(notifications).values({
    organisationId,
    recipientUserId: recipient.id,
    type: "Referral Review",
    title,
    message,
    priority: "Normal",
    status: "Unread",
    deduplicationKey: `employee-referral-review-${recommendationId}`,
    link: {
      entityType: "candidate-recommendation",
      entityId: recommendationId,
      path: "/staff/opportunities",
    },
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
}

export async function reviewEmployeeReferralInDatabase(
  organisationId: string,
  input: {
    recommendationId: string;
    decision: "Approve" | "Decline";
    reason: string;
  },
  actor: AuditActorContext,
): Promise<{ candidateId: string; interviewRecommendationId?: string }> {
  assertRecruiter(actor);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new Error("Record a clear reason for the referral decision.");
  const db = getDatabaseClient();
  const [record] = await db
    .select({ recommendation: candidateRecommendations, candidate: candidates, vacancy: vacancies })
    .from(candidateRecommendations)
    .innerJoin(candidates, eq(candidates.id, candidateRecommendations.candidateId))
    .leftJoin(vacancies, eq(vacancies.id, candidateRecommendations.vacancyId))
    .where(
      and(
        eq(candidateRecommendations.organisationId, organisationId),
        eq(candidateRecommendations.id, input.recommendationId),
        eq(candidateRecommendations.recommenderType, "Employee Referral"),
        sql`${candidateRecommendations.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!record) throw new Error("The employee referral was not found.");
  if (record.recommendation.reviewStatus !== "Pending HR Review")
    throw new Error("This referral has already been reviewed.");

  if (input.decision === "Decline") {
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(candidateRecommendations)
        .where(
          and(
            eq(candidateRecommendations.organisationId, organisationId),
            eq(candidateRecommendations.id, input.recommendationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!locked || locked.reviewStatus !== "Pending HR Review")
        throw new Error("This referral has already been reviewed.");
      await tx
        .update(candidateRecommendations)
        .set({
          reviewStatus: "Declined",
          reviewedAt: new Date().toISOString(),
          reviewedByUserId: actor.userId,
          reviewReason: reason,
          sourceOutcome: "Declined by HR",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateRecommendations.recordVersion} + 1`,
        })
        .where(eq(candidateRecommendations.id, locked.id));
      if (locked.vacancyId) {
        await tx
          .update(candidateAssessmentInclusions)
          .set({
            active: false,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidateAssessmentInclusions.recordVersion} + 1`,
          })
          .where(
            and(
              eq(candidateAssessmentInclusions.organisationId, organisationId),
              eq(candidateAssessmentInclusions.vacancyId, locked.vacancyId),
              eq(candidateAssessmentInclusions.candidateId, locked.candidateId),
              eq(candidateAssessmentInclusions.source, "Recommended"),
            ),
          );
        await tx
          .update(candidateInterviewRecommendations)
          .set({
            status: "Withdrawn",
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidateInterviewRecommendations.recordVersion} + 1`,
          })
          .where(
            and(
              eq(candidateInterviewRecommendations.organisationId, organisationId),
              eq(candidateInterviewRecommendations.vacancyId, locked.vacancyId),
              eq(candidateInterviewRecommendations.candidateId, locked.candidateId),
              ne(candidateInterviewRecommendations.status, "Interview Scheduled"),
            ),
          );
        await tx
          .update(candidateApplications)
          .set({
            status: "Rejected",
            screeningDecision: `Employee referral declined: ${reason}`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidateApplications.recordVersion} + 1`,
          })
          .where(
            and(
              eq(candidateApplications.organisationId, organisationId),
              eq(candidateApplications.vacancyId, locked.vacancyId),
              eq(candidateApplications.candidateId, locked.candidateId),
              eq(candidateApplications.source, "Employee Referral"),
              locked.recommenderEmployeeId
                ? eq(candidateApplications.submittedByEmployeeId, locked.recommenderEmployeeId)
                : sql`false`,
            ),
          );
      }
      await notifyReferrer(
        tx,
        organisationId,
        locked.recommenderEmployeeId,
        locked.id,
        "Referral reviewed",
        `${record.candidate.firstName} ${record.candidate.lastName} was not progressed for this opportunity. The Candidate Pool record has been retained.`,
        actor.userId,
      );
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [],
        action: "decline",
        module: "recruitment",
        entityType: "candidate-recommendation",
        entityId: locked.id,
        beforeSummary: { reviewStatus: locked.reviewStatus },
        afterSummary: { reviewStatus: "Declined", candidateRetained: true },
        reason,
        riskLevel: "High",
      });
      return { candidateId: locked.candidateId };
    });
  }

  if (!record.vacancy) throw new Error("Select a vacancy before approving this referral.");
  if (!record.recommendation.candidateAware)
    throw new Error("The candidate must know that their CV was shared before HR can approve it.");
  if (record.candidate.doNotContact)
    throw new Error("This candidate is marked Do Not Contact and cannot be progressed.");
  if (record.vacancy.status !== "Open")
    throw new Error("Only an open vacancy can accept an approved referral.");
  const [cv] = await db
    .select({ cv: candidateCvRecords, checksum: recruitmentDocuments.checksum })
    .from(candidateCvRecords)
    .innerJoin(recruitmentDocuments, eq(recruitmentDocuments.id, candidateCvRecords.fileId))
    .where(
      and(
        eq(candidateCvRecords.organisationId, organisationId),
        eq(candidateCvRecords.recommendationId, record.recommendation.id),
        eq(candidateCvRecords.candidateId, record.candidate.id),
      ),
    )
    .orderBy(desc(candidateCvRecords.createdAt))
    .limit(1);
  if (!cv || cv.cv.processingStatus !== "Ready")
    throw new Error("Wait for the CV processing to finish before approving this referral.");
  if (!cv.checksum) throw new Error("The referral CV has no integrity checksum.");
  const [extraction] = await db
    .select({ semanticTextEncrypted: candidateCvExtractions.semanticTextEncrypted })
    .from(candidateCvExtractions)
    .where(
      and(
        eq(candidateCvExtractions.organisationId, organisationId),
        eq(candidateCvExtractions.checksum, cv.checksum),
        eq(candidateCvExtractions.processorVersion, CV_PROCESSOR_VERSION),
      ),
    )
    .limit(1);
  const approvedVacancy = record.vacancy;
  const semanticTexts = buildCvSemanticTexts(
    record.candidate,
    approvedVacancy,
    cv.cv.extractedFields as Record<string, unknown>,
  );
  const semantic = await calculateCvSemanticSimilarity({
    vacancyText: semanticTexts.vacancyText,
    candidateText: extraction?.semanticTextEncrypted
      ? decryptSensitiveJson<string>(extraction.semanticTextEncrypted)
      : semanticTexts.candidateText,
  });
  const prepared = buildCandidatePreliminaryAssessment(
    record.candidate,
    approvedVacancy,
    cv.cv.extractedFields as Record<string, unknown>,
    semantic,
  );

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(candidateRecommendations)
      .where(
        and(
          eq(candidateRecommendations.organisationId, organisationId),
          eq(candidateRecommendations.id, input.recommendationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!locked || locked.reviewStatus !== "Pending HR Review")
      throw new Error("This referral has already been reviewed.");
    const [currentVacancy] = await tx
      .select()
      .from(vacancies)
      .where(
        and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, approvedVacancy.id)),
      )
      .for("update")
      .limit(1);
    if (!currentVacancy || currentVacancy.status !== "Open")
      throw new Error("The vacancy is no longer open.");
    if (currentVacancy.recordVersion !== approvedVacancy.recordVersion)
      throw new Error(
        "The vacancy changed during review. Review the latest criteria and try again.",
      );

    let [application] = await tx
      .select()
      .from(candidateApplications)
      .where(
        and(
          eq(candidateApplications.organisationId, organisationId),
          eq(candidateApplications.vacancyId, currentVacancy.id),
          eq(candidateApplications.candidateId, locked.candidateId),
          sql`${candidateApplications.archivedAt} IS NULL`,
        ),
      )
      .for("update")
      .limit(1);
    if (!application) {
      const applicationId = randomUUID();
      await tx.insert(candidateApplications).values({
        id: applicationId,
        organisationId,
        referenceId: recommendationReference(),
        candidateId: locked.candidateId,
        vacancyId: currentVacancy.id,
        status: "Shortlisted",
        cvFileId: cv.cv.fileId,
        noticePeriod: record.candidate.noticePeriod ?? "To be confirmed",
        screeningAnswers: [],
        source: "Employee Referral",
        consentGiven: true,
        consentedAt: record.candidate.consentUpdatedAt ?? new Date().toISOString(),
        screeningDecision: `Employee referral approved by HR: ${reason}`,
        submittedByEmployeeId: locked.recommenderEmployeeId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      [application] = await tx
        .select()
        .from(candidateApplications)
        .where(eq(candidateApplications.id, applicationId))
        .limit(1);
    }
    if (!application) throw new Error("The approved referral application could not be created.");

    const [existingPreparation] = await tx
      .select()
      .from(candidatePreparationRuns)
      .where(
        and(
          eq(candidatePreparationRuns.organisationId, organisationId),
          eq(candidatePreparationRuns.vacancyId, currentVacancy.id),
          eq(candidatePreparationRuns.candidateId, locked.candidateId),
          eq(candidatePreparationRuns.cvRecordId, cv.cv.id),
          eq(candidatePreparationRuns.vacancyRecordVersion, currentVacancy.recordVersion),
        ),
      )
      .orderBy(desc(candidatePreparationRuns.createdAt))
      .limit(1);
    const preparationId = existingPreparation?.id ?? randomUUID();
    if (!existingPreparation) {
      await tx.insert(candidatePreparationRuns).values({
        id: preparationId,
        organisationId,
        vacancyId: currentVacancy.id,
        vacancyRecordVersion: currentVacancy.recordVersion,
        candidateId: locked.candidateId,
        applicationId: application.id,
        cvRecordId: cv.cv.id,
        cvFileId: cv.cv.fileId,
        cvChecksum: cv.checksum,
        status: prepared.status,
        documentRoute: cv.cv.documentRoute,
        preparationMethod: "Python Service",
        rankingModel: prepared.rankingModel,
        extractedProfile: prepared.extractedProfile,
        fieldConfidence: cv.cv.fieldConfidence,
        preliminaryScore: String(prepared.preliminaryScore),
        band: prepared.band,
        compulsoryChecks: prepared.compulsoryChecks,
        matchedSkills: prepared.matchedSkills,
        missingRequiredSkills: prepared.missingRequiredSkills,
        evidence: prepared.evidence,
        warnings: cv.cv.extractionWarnings,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    }
    const [existingInclusion] = await tx
      .select()
      .from(candidateAssessmentInclusions)
      .where(
        and(
          eq(candidateAssessmentInclusions.organisationId, organisationId),
          eq(candidateAssessmentInclusions.vacancyId, currentVacancy.id),
          eq(candidateAssessmentInclusions.candidateId, locked.candidateId),
        ),
      )
      .for("update")
      .limit(1);
    if (existingInclusion) {
      await tx
        .update(candidateAssessmentInclusions)
        .set({
          cvRecordId: cv.cv.id,
          source: "Recommended",
          reason,
          active: true,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateAssessmentInclusions.recordVersion} + 1`,
        })
        .where(eq(candidateAssessmentInclusions.id, existingInclusion.id));
    } else {
      await tx.insert(candidateAssessmentInclusions).values({
        organisationId,
        vacancyId: currentVacancy.id,
        candidateId: locked.candidateId,
        cvRecordId: cv.cv.id,
        source: "Recommended",
        reason,
        active: true,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    }
    let [interviewRecommendation] = await tx
      .select()
      .from(candidateInterviewRecommendations)
      .where(
        and(
          eq(candidateInterviewRecommendations.organisationId, organisationId),
          eq(candidateInterviewRecommendations.vacancyId, currentVacancy.id),
          eq(candidateInterviewRecommendations.candidateId, locked.candidateId),
          ne(candidateInterviewRecommendations.status, "Withdrawn"),
        ),
      )
      .for("update")
      .limit(1);
    if (!interviewRecommendation) {
      const interviewRecommendationId = randomUUID();
      await tx.insert(candidateInterviewRecommendations).values({
        id: interviewRecommendationId,
        organisationId,
        candidateId: locked.candidateId,
        vacancyId: currentVacancy.id,
        applicationId: application.id,
        cvRecordId: cv.cv.id,
        recommendedByUserId: actor.userId,
        reason,
        assessmentSource: "Automatic Assessment",
        screeningDecision: "Run Assessment",
        status: "Ready to Schedule",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      [interviewRecommendation] = await tx
        .select()
        .from(candidateInterviewRecommendations)
        .where(eq(candidateInterviewRecommendations.id, interviewRecommendationId))
        .limit(1);
    }
    if (!interviewRecommendation)
      throw new Error("The interview consideration record could not be created.");
    await tx
      .update(candidateApplications)
      .set({
        status: "Shortlisted",
        cvFileId: cv.cv.fileId,
        hrInterviewRecommendationId: interviewRecommendation.id,
        preparationRunId: preparationId,
        preparationStatus: prepared.status,
        screeningDecision: `Employee referral approved by HR: ${reason}`,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidateApplications.recordVersion} + 1`,
      })
      .where(eq(candidateApplications.id, application.id));
    await tx
      .update(candidates)
      .set({
        stage: "Shortlisted",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, locked.candidateId));
    await tx
      .update(candidateRecommendations)
      .set({
        reviewStatus: "Approved for Interview",
        reviewedAt: new Date().toISOString(),
        reviewedByUserId: actor.userId,
        reviewReason: reason,
        sourceOutcome: "Approved for Interview",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidateRecommendations.recordVersion} + 1`,
      })
      .where(eq(candidateRecommendations.id, locked.id));
    await notifyReferrer(
      tx,
      organisationId,
      locked.recommenderEmployeeId,
      locked.id,
      "Referral approved by HR",
      `${record.candidate.firstName} ${record.candidate.lastName} was approved for interview consideration for ${currentVacancy.title}.`,
      actor.userId,
    );
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "approve",
      module: "recruitment",
      entityType: "candidate-recommendation",
      entityId: locked.id,
      beforeSummary: { reviewStatus: locked.reviewStatus },
      afterSummary: {
        reviewStatus: "Approved for Interview",
        applicationId: application.id,
        interviewRecommendationId: interviewRecommendation.id,
        preliminaryScore: prepared.preliminaryScore,
      },
      reason,
      riskLevel: "High",
    });
    return {
      candidateId: locked.candidateId,
      interviewRecommendationId: interviewRecommendation.id,
    };
  });
}

function asMatchView(
  row: typeof candidateVacancyMatches.$inferSelect,
  candidate: typeof candidates.$inferSelect,
): CandidatePoolMatchView {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    recordVersion: row.recordVersion,
    vacancyId: row.vacancyId,
    vacancyRecordVersion: row.vacancyRecordVersion,
    candidateId: row.candidateId,
    candidateName: `${candidate.firstName} ${candidate.lastName}`,
    email: candidate.email,
    ...(candidate.currentTitle ? { currentTitle: candidate.currentTitle } : {}),
    cvRecordId: row.cvRecordId,
    preliminaryScore: Number(row.preliminaryScore),
    band: row.band,
    compulsoryChecks: row.compulsoryChecks as CandidatePoolMatchView["compulsoryChecks"],
    matchedSkills: row.matchedSkills,
    missingRequiredSkills: row.missingRequiredSkills,
    evidence: row.evidence,
    warnings: row.warnings,
    rankingModel: row.rankingModel,
    status: row.status as CandidatePoolMatchView["status"],
    generatedAt: row.generatedAt,
  };
}

export async function listCandidatePoolMatchesInDatabase(
  organisationId: string,
  vacancyId: string,
  actor: AuditActorContext,
): Promise<CandidatePoolMatchView[]> {
  assertRecruiter(actor);
  const db = getDatabaseClient();
  const [vacancy] = await db
    .select({ recordVersion: vacancies.recordVersion })
    .from(vacancies)
    .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, vacancyId)))
    .limit(1);
  if (!vacancy) throw new Error("Vacancy not found.");
  const rows = await db
    .select({ match: candidateVacancyMatches, candidate: candidates })
    .from(candidateVacancyMatches)
    .innerJoin(candidates, eq(candidates.id, candidateVacancyMatches.candidateId))
    .where(
      and(
        eq(candidateVacancyMatches.organisationId, organisationId),
        eq(candidateVacancyMatches.vacancyId, vacancyId),
        eq(candidateVacancyMatches.vacancyRecordVersion, vacancy.recordVersion),
        eq(candidates.consentStatus, "Confirmed"),
        eq(candidates.doNotContact, false),
        sql`${candidates.archivedAt} IS NULL`,
        sql`${candidates.mergedIntoId} IS NULL`,
        ne(candidates.stage, "Hired"),
        ne(candidates.stage, "Archived"),
        ne(candidates.stage, "Withdrawn"),
        sql`(
          ${candidateVacancyMatches.status} = 'Added to Screening'
          OR NOT EXISTS (
            SELECT 1 FROM ${candidateApplications}
            WHERE ${candidateApplications.organisationId} = ${organisationId}
              AND ${candidateApplications.vacancyId} = ${vacancyId}
              AND ${candidateApplications.candidateId} = ${candidateVacancyMatches.candidateId}
              AND ${candidateApplications.archivedAt} IS NULL
          )
        )`,
      ),
    )
    .orderBy(desc(candidateVacancyMatches.preliminaryScore));
  return rows.map((row) => asMatchView(row.match, row.candidate));
}

export async function scanCandidatePoolForVacancyInDatabase(
  organisationId: string,
  vacancyId: string,
  actor: AuditActorContext,
): Promise<{
  matches: CandidatePoolMatchView[];
  eligibleCount: number;
  excludedApplicants: number;
}> {
  assertRecruiter(actor);
  const db = getDatabaseClient();
  const [vacancy] = await db
    .select()
    .from(vacancies)
    .where(
      and(
        eq(vacancies.organisationId, organisationId),
        eq(vacancies.id, vacancyId),
        inArray(vacancies.status, ["Open", "Paused"]),
        sql`${vacancies.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!vacancy) throw new Error("The vacancy is not available for Candidate Pool matching.");
  const existingApplications = await db
    .select({ candidateId: candidateApplications.candidateId })
    .from(candidateApplications)
    .where(
      and(
        eq(candidateApplications.organisationId, organisationId),
        eq(candidateApplications.vacancyId, vacancyId),
        sql`${candidateApplications.archivedAt} IS NULL`,
      ),
    );
  const applicantIds = new Set(existingApplications.map((item) => item.candidateId));
  const poolRows = await db
    .select({
      candidate: candidates,
      cv: candidateCvRecords,
      checksum: recruitmentDocuments.checksum,
      semanticTextEncrypted: candidateCvExtractions.semanticTextEncrypted,
    })
    .from(candidates)
    .innerJoin(candidateCvRecords, eq(candidateCvRecords.id, candidates.latestCvRecordId))
    .innerJoin(recruitmentDocuments, eq(recruitmentDocuments.id, candidateCvRecords.fileId))
    .leftJoin(
      candidateCvExtractions,
      and(
        eq(candidateCvExtractions.organisationId, organisationId),
        eq(candidateCvExtractions.checksum, recruitmentDocuments.checksum),
        eq(candidateCvExtractions.processorVersion, CV_PROCESSOR_VERSION),
      ),
    )
    .where(
      and(
        eq(candidates.organisationId, organisationId),
        eq(candidates.consentStatus, "Confirmed"),
        eq(candidates.doNotContact, false),
        eq(candidateCvRecords.processingStatus, "Ready"),
        sql`${candidates.archivedAt} IS NULL`,
        sql`${candidates.mergedIntoId} IS NULL`,
        sql`${candidateCvRecords.archivedAt} IS NULL`,
        ne(candidates.stage, "Hired"),
        ne(candidates.stage, "Archived"),
        ne(candidates.stage, "Withdrawn"),
      ),
    );
  const eligible = poolRows.filter((row) => !applicantIds.has(row.candidate.id));
  const excludedApplicantCount = poolRows.filter((row) =>
    applicantIds.has(row.candidate.id),
  ).length;
  if (eligible.length === 0) {
    await db.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "scan",
      module: "recruitment",
      entityType: "candidate-pool",
      entityId: vacancyId,
      afterSummary: {
        eligibleCandidates: 0,
        excludedExistingApplicants: excludedApplicantCount,
        vacancyRecordVersion: vacancy.recordVersion,
      },
      reason: "HR searched the Candidate Pool for role-specific matches",
      riskLevel: "High",
    });
    return {
      matches: await listCandidatePoolMatchesInDatabase(organisationId, vacancyId, actor),
      eligibleCount: 0,
      excludedApplicants: excludedApplicantCount,
    };
  }
  const preparedInputs = eligible.map((row) => {
    const texts = buildCvSemanticTexts(
      row.candidate,
      vacancy,
      row.cv.extractedFields as Record<string, unknown>,
    );
    return {
      row,
      vacancyText: texts.vacancyText,
      candidateText: row.semanticTextEncrypted
        ? decryptSensitiveJson<string>(row.semanticTextEncrypted)
        : texts.candidateText,
    };
  });
  const semanticScores = new Map<string, { score: number; model: string }>();
  for (let offset = 0; offset < preparedInputs.length; offset += 500) {
    const batch = preparedInputs.slice(offset, offset + 500);
    const result = await calculateCvSemanticSimilarities({
      vacancyText: batch[0]!.vacancyText,
      candidates: batch.map((item) => ({
        candidateId: item.row.candidate.id,
        candidateText: item.candidateText,
      })),
    });
    for (const item of result.results)
      semanticScores.set(item.candidateId, { score: item.score, model: result.model });
  }
  const generatedAt = new Date().toISOString();
  const assessments = preparedInputs.map(({ row }) => {
    const semantic = semanticScores.get(row.candidate.id);
    if (!semantic) throw new Error("A Candidate Pool semantic result is missing.");
    return {
      row,
      assessment: buildCandidatePreliminaryAssessment(
        row.candidate,
        vacancy,
        row.cv.extractedFields as Record<string, unknown>,
        semantic,
      ),
    };
  });
  await db.transaction(async (tx) => {
    for (const item of assessments) {
      const assessment = item.assessment;
      await tx
        .insert(candidateVacancyMatches)
        .values({
          organisationId,
          vacancyId,
          vacancyRecordVersion: vacancy.recordVersion,
          candidateId: item.row.candidate.id,
          cvRecordId: item.row.cv.id,
          preliminaryScore: String(assessment.preliminaryScore),
          band: assessment.band,
          compulsoryChecks: assessment.compulsoryChecks,
          matchedSkills: assessment.matchedSkills,
          missingRequiredSkills: assessment.missingRequiredSkills,
          evidence: assessment.evidence,
          warnings: item.row.cv.extractionWarnings,
          rankingModel: assessment.rankingModel,
          status: "Suggested",
          generatedAt,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [
            candidateVacancyMatches.organisationId,
            candidateVacancyMatches.vacancyId,
            candidateVacancyMatches.vacancyRecordVersion,
            candidateVacancyMatches.candidateId,
          ],
          set: {
            cvRecordId: item.row.cv.id,
            preliminaryScore: String(assessment.preliminaryScore),
            band: assessment.band,
            compulsoryChecks: assessment.compulsoryChecks,
            matchedSkills: assessment.matchedSkills,
            missingRequiredSkills: assessment.missingRequiredSkills,
            evidence: assessment.evidence,
            warnings: item.row.cv.extractionWarnings,
            rankingModel: assessment.rankingModel,
            generatedAt,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidateVacancyMatches.recordVersion} + 1`,
          },
        });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "scan",
      module: "recruitment",
      entityType: "candidate-pool",
      entityId: vacancyId,
      afterSummary: {
        eligibleCandidates: assessments.length,
        excludedExistingApplicants: excludedApplicantCount,
        vacancyRecordVersion: vacancy.recordVersion,
      },
      reason: "HR searched the Candidate Pool for role-specific matches",
      riskLevel: "High",
    });
  });
  return {
    matches: await listCandidatePoolMatchesInDatabase(organisationId, vacancyId, actor),
    eligibleCount: assessments.length,
    excludedApplicants: excludedApplicantCount,
  };
}
