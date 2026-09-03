import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { locations } from "../schema/master-data.ts";
import {
  candidateApplications,
  candidateAssessmentBatches,
  candidateAssessmentInclusions,
  candidateCvRecords,
  candidateInterviewRecommendations,
  candidatePreparationRuns,
  candidateRecommendations,
  candidateScoreRuns,
  candidates,
  shortlistSnapshots,
  vacancies,
} from "../schema/recruitment.ts";
import { auditEvents } from "../schema/system.ts";
import { buildCandidatePreliminaryAssessment } from "./candidate-cv-intake.repository.server.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function recruiter(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can manage candidate screening.");
  if (!actor.userId) throw new Error("A verified VIA user is required.");
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export async function includeCandidateInAssessmentInDatabase(
  organisationId: string,
  input: {
    vacancyId: string;
    candidateId: string;
    cvRecordId: string;
    source: "Recommended" | "HR Added";
    reason: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  recruiter(actor);
  if (input.reason.trim().length < 5) throw new Error("Explain why this candidate is being added.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [[vacancy], [candidate], [cv]] = await Promise.all([
      tx
        .select()
        .from(vacancies)
        .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, input.vacancyId)))
        .limit(1),
      tx
        .select()
        .from(candidates)
        .where(
          and(eq(candidates.organisationId, organisationId), eq(candidates.id, input.candidateId)),
        )
        .limit(1),
      tx
        .select()
        .from(candidateCvRecords)
        .where(
          and(
            eq(candidateCvRecords.organisationId, organisationId),
            eq(candidateCvRecords.id, input.cvRecordId),
            eq(candidateCvRecords.candidateId, input.candidateId),
          ),
        )
        .limit(1),
    ]);
    if (!vacancy || vacancy.status === "Archived" || vacancy.status === "Closed")
      throw new Error("The vacancy is not available for screening.");
    if (!candidate || candidate.archivedAt || candidate.mergedIntoId)
      throw new Error("The candidate is not available.");
    if (candidate.doNotContact) throw new Error("This candidate is marked Do Not Contact.");
    if (!cv || cv.processingStatus !== "Ready")
      throw new Error("Select a CV that HR has reviewed and confirmed.");
    let [application] = await tx
      .select()
      .from(candidateApplications)
      .where(
        and(
          eq(candidateApplications.organisationId, organisationId),
          eq(candidateApplications.vacancyId, input.vacancyId),
          eq(candidateApplications.candidateId, input.candidateId),
        ),
      )
      .limit(1);
    if (!application) {
      const applicationId = randomUUID();
      await tx.insert(candidateApplications).values({
        id: applicationId,
        organisationId,
        referenceId: `APP-${new Date().getFullYear()}-${applicationId.slice(0, 8).toUpperCase()}`,
        candidateId: input.candidateId,
        vacancyId: input.vacancyId,
        status: "New",
        cvFileId: cv.fileId,
        noticePeriod: candidate.noticePeriod ?? "To be confirmed",
        screeningAnswers: [],
        source: input.source === "Recommended" ? "Recommendation" : "Candidate Pool",
        consentGiven: candidate.consentStatus === "Confirmed",
        consentedAt: candidate.consentUpdatedAt ?? new Date().toISOString(),
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      [application] = await tx
        .select()
        .from(candidateApplications)
        .where(eq(candidateApplications.id, applicationId))
        .limit(1);
      await tx
        .update(vacancies)
        .set({
          applicantCount: sql`${vacancies.applicantCount} + 1`,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${vacancies.recordVersion} + 1`,
        })
        .where(eq(vacancies.id, input.vacancyId));
    }
    if (!application) throw new Error("The vacancy application could not be created.");
    let [preparation] = await tx
      .select()
      .from(candidatePreparationRuns)
      .where(
        and(
          eq(candidatePreparationRuns.organisationId, organisationId),
          eq(candidatePreparationRuns.vacancyId, input.vacancyId),
          eq(candidatePreparationRuns.candidateId, input.candidateId),
          eq(candidatePreparationRuns.cvRecordId, input.cvRecordId),
          eq(candidatePreparationRuns.vacancyRecordVersion, vacancy.recordVersion),
        ),
      )
      .orderBy(desc(candidatePreparationRuns.createdAt))
      .limit(1);
    if (!preparation || !["Ready", "Needs Review"].includes(preparation.status)) {
      const result = buildCandidatePreliminaryAssessment(
        candidate,
        vacancy,
        cv.extractedFields as Record<string, unknown>,
      );
      const preparationId = randomUUID();
      await tx.insert(candidatePreparationRuns).values({
        id: preparationId,
        organisationId,
        vacancyId: input.vacancyId,
        vacancyRecordVersion: vacancy.recordVersion,
        candidateId: input.candidateId,
        applicationId: application.id,
        cvRecordId: cv.id,
        cvFileId: cv.fileId,
        status: result.status,
        documentRoute: cv.originalFileName.toLowerCase().endsWith(".docx")
          ? "Word Document"
          : "Searchable PDF",
        preparationMethod: "Python Service",
        extractedProfile: result.extractedProfile,
        fieldConfidence: cv.fieldConfidence,
        preliminaryScore: String(result.preliminaryScore),
        band: result.band,
        compulsoryChecks: result.compulsoryChecks,
        matchedSkills: result.matchedSkills,
        missingRequiredSkills: result.missingRequiredSkills,
        evidence: result.evidence,
        warnings: cv.extractionWarnings,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      [preparation] = await tx
        .select()
        .from(candidatePreparationRuns)
        .where(eq(candidatePreparationRuns.id, preparationId))
        .limit(1);
      await tx
        .update(candidateApplications)
        .set({
          preparationRunId: preparationId,
          preparationStatus: result.status,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(eq(candidateApplications.id, application.id));
    }
    const [existing] = await tx
      .select()
      .from(candidateAssessmentInclusions)
      .where(
        and(
          eq(candidateAssessmentInclusions.organisationId, organisationId),
          eq(candidateAssessmentInclusions.vacancyId, input.vacancyId),
          eq(candidateAssessmentInclusions.candidateId, input.candidateId),
          eq(candidateAssessmentInclusions.active, true),
        ),
      )
      .for("update")
      .limit(1);
    const id = existing?.id ?? randomUUID();
    if (existing)
      await tx
        .update(candidateAssessmentInclusions)
        .set({
          cvRecordId: cv.id,
          source: input.source,
          reason: input.reason.trim(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateAssessmentInclusions.recordVersion} + 1`,
        })
        .where(eq(candidateAssessmentInclusions.id, id));
    else
      await tx.insert(candidateAssessmentInclusions).values({
        id,
        organisationId,
        vacancyId: input.vacancyId,
        candidateId: input.candidateId,
        cvRecordId: cv.id,
        source: input.source,
        reason: input.reason.trim(),
        active: true,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: existing ? "update" : "include",
      module: "recruitment",
      entityType: "candidate-assessment-inclusion",
      entityId: id,
      afterSummary: { ...input, applicationId: application.id, preparationRunId: preparation?.id },
      reason: input.reason.trim(),
      riskLevel: "High",
    });
    return id;
  });
}

export async function createAssessmentBatchInDatabase(
  organisationId: string,
  vacancyId: string,
  targetSize: number,
  actor: AuditActorContext,
): Promise<string> {
  recruiter(actor);
  if (!Number.isInteger(targetSize) || targetSize < 1 || targetSize > 10)
    throw new Error("Choose between 1 and 10 candidates.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [vacancy] = await tx
      .select()
      .from(vacancies)
      .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, vacancyId)))
      .for("update")
      .limit(1);
    if (!vacancy) throw new Error("Vacancy not found.");
    const runs = await tx
      .select()
      .from(candidatePreparationRuns)
      .where(
        and(
          eq(candidatePreparationRuns.organisationId, organisationId),
          eq(candidatePreparationRuns.vacancyId, vacancyId),
          eq(candidatePreparationRuns.vacancyRecordVersion, vacancy.recordVersion),
          inArray(candidatePreparationRuns.status, ["Ready", "Needs Review"]),
        ),
      )
      .orderBy(
        desc(candidatePreparationRuns.preliminaryScore),
        desc(candidatePreparationRuns.createdAt),
      );
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!latest.has(run.candidateId)) latest.set(run.candidateId, run);
    const ranked = [...latest.values()].sort(
      (a, b) => Number(b.preliminaryScore ?? -1) - Number(a.preliminaryScore ?? -1),
    );
    if (ranked.length < targetSize)
      throw new Error(`Only ${ranked.length} prepared candidates are available.`);
    const inclusions = await tx
      .select()
      .from(candidateAssessmentInclusions)
      .where(
        and(
          eq(candidateAssessmentInclusions.organisationId, organisationId),
          eq(candidateAssessmentInclusions.vacancyId, vacancyId),
          eq(candidateAssessmentInclusions.active, true),
        ),
      );
    const recommended = unique(
      inclusions.filter((item) => item.source === "Recommended").map((item) => item.candidateId),
    ).filter((id) => latest.has(id));
    const hrAdded = unique(
      inclusions.filter((item) => item.source === "HR Added").map((item) => item.candidateId),
    ).filter((id) => latest.has(id));
    const pinned = unique([...recommended, ...hrAdded]);
    if (pinned.length > targetSize)
      throw new Error(`${pinned.length} pinned candidates require a larger assessment group.`);
    const selected = [
      ...pinned,
      ...ranked.map((run) => run.candidateId).filter((id) => !pinned.includes(id)),
    ].slice(0, targetSize);
    const [draft] = await tx
      .select()
      .from(candidateAssessmentBatches)
      .where(
        and(
          eq(candidateAssessmentBatches.organisationId, organisationId),
          eq(candidateAssessmentBatches.vacancyId, vacancyId),
          eq(candidateAssessmentBatches.status, "Draft"),
        ),
      )
      .for("update")
      .limit(1);
    const id = draft?.id ?? randomUUID();
    const values = {
      vacancyRecordVersion: vacancy.recordVersion,
      targetSize,
      rankedCandidateIds: ranked.map((run) => run.candidateId),
      selectedCandidateIds: selected,
      recommendedCandidateIds: recommended.filter((id) => selected.includes(id)),
      hrAddedCandidateIds: hrAdded.filter((id) => selected.includes(id)),
      preparationRunIds: selected.map((id) => latest.get(id)!.id),
      detailedScoreIds: [],
      status: "Draft",
      updatedAt: new Date(),
      updatedBy: actor.userId!,
    };
    if (draft)
      await tx
        .update(candidateAssessmentBatches)
        .set({ ...values, recordVersion: sql`${candidateAssessmentBatches.recordVersion} + 1` })
        .where(eq(candidateAssessmentBatches.id, id));
    else
      await tx.insert(candidateAssessmentBatches).values({
        id,
        organisationId,
        vacancyId,
        ...values,
        createdBy: actor.userId!,
      });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: draft ? "update" : "create",
      module: "recruitment",
      entityType: "candidate-assessment-batch",
      entityId: id,
      afterSummary: { targetSize, selectedCandidateIds: selected, pinnedCandidateIds: pinned },
      reason: "Selected the group for detailed assessment",
      riskLevel: "High",
    });
    return id;
  });
}

export async function updateAssessmentSelectionInDatabase(
  organisationId: string,
  batchId: string,
  candidateIds: string[],
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  recruiter(actor);
  if (reason.trim().length < 5) throw new Error("Explain why the assessment group is changing.");
  const selected = unique(candidateIds);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(candidateAssessmentBatches)
      .where(
        and(
          eq(candidateAssessmentBatches.organisationId, organisationId),
          eq(candidateAssessmentBatches.id, batchId),
        ),
      )
      .for("update")
      .limit(1);
    if (!batch || batch.status !== "Draft") throw new Error("Only a draft group can be changed.");
    if (selected.length !== batch.targetSize)
      throw new Error(`Choose exactly ${batch.targetSize} candidates.`);
    if (selected.some((id) => !batch.rankedCandidateIds.includes(id)))
      throw new Error("Every selected candidate must have a completed preliminary assessment.");
    const inclusions = await tx
      .select({ candidateId: candidateAssessmentInclusions.candidateId })
      .from(candidateAssessmentInclusions)
      .where(
        and(
          eq(candidateAssessmentInclusions.organisationId, organisationId),
          eq(candidateAssessmentInclusions.vacancyId, batch.vacancyId),
          eq(candidateAssessmentInclusions.active, true),
        ),
      );
    const pinned = unique(inclusions.map((item) => item.candidateId));
    if (pinned.some((id) => !selected.includes(id)))
      throw new Error("Recommended and HR-added candidates must remain selected.");
    const runs = await tx
      .select()
      .from(candidatePreparationRuns)
      .where(
        and(
          eq(candidatePreparationRuns.organisationId, organisationId),
          eq(candidatePreparationRuns.vacancyId, batch.vacancyId),
          eq(candidatePreparationRuns.vacancyRecordVersion, batch.vacancyRecordVersion),
          inArray(candidatePreparationRuns.candidateId, selected),
          inArray(candidatePreparationRuns.status, ["Ready", "Needs Review"]),
        ),
      )
      .orderBy(desc(candidatePreparationRuns.createdAt));
    const runIds = selected.map((candidateId) => {
      const run = runs.find((item) => item.candidateId === candidateId);
      if (!run) throw new Error("A selected candidate is no longer ready for assessment.");
      return run.id;
    });
    await tx
      .update(candidateAssessmentBatches)
      .set({
        selectedCandidateIds: selected,
        preparationRunIds: runIds,
        recommendedCandidateIds: batch.recommendedCandidateIds.filter((id) =>
          selected.includes(id),
        ),
        hrAddedCandidateIds: batch.hrAddedCandidateIds.filter((id) => selected.includes(id)),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidateAssessmentBatches.recordVersion} + 1`,
      })
      .where(eq(candidateAssessmentBatches.id, batch.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "update-selection",
      module: "recruitment",
      entityType: "candidate-assessment-batch",
      entityId: batch.id,
      beforeSummary: { selectedCandidateIds: batch.selectedCandidateIds },
      afterSummary: { selectedCandidateIds: selected, pinnedCandidateIds: pinned },
      reason: reason.trim(),
      riskLevel: "High",
    });
  });
}

export async function runDetailedAssessmentInDatabase(
  organisationId: string,
  batchId: string,
  actor: AuditActorContext,
): Promise<string> {
  recruiter(actor);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(candidateAssessmentBatches)
      .where(
        and(
          eq(candidateAssessmentBatches.organisationId, organisationId),
          eq(candidateAssessmentBatches.id, batchId),
        ),
      )
      .for("update")
      .limit(1);
    if (!batch || batch.status !== "Draft") throw new Error("Assessment group is not available.");
    if (batch.selectedCandidateIds.length !== batch.targetSize)
      throw new Error("The assessment group is incomplete.");
    const [vacancy] = await tx
      .select({ vacancy: vacancies, locationName: locations.name })
      .from(vacancies)
      .innerJoin(locations, eq(locations.id, vacancies.locationId))
      .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, batch.vacancyId)))
      .limit(1);
    if (!vacancy || vacancy.vacancy.recordVersion !== batch.vacancyRecordVersion)
      throw new Error("The vacancy changed. Create a new assessment group.");
    const inclusions = await tx
      .select({ candidateId: candidateAssessmentInclusions.candidateId })
      .from(candidateAssessmentInclusions)
      .where(
        and(
          eq(candidateAssessmentInclusions.organisationId, organisationId),
          eq(candidateAssessmentInclusions.vacancyId, batch.vacancyId),
          eq(candidateAssessmentInclusions.active, true),
        ),
      );
    const pinned = unique(inclusions.map((item) => item.candidateId));
    if (pinned.some((id) => !batch.selectedCandidateIds.includes(id)))
      throw new Error("The group is missing a recommended or HR-added candidate.");
    const scoreIds: string[] = [];
    const ranked: Array<{ candidateId: string; score: number }> = [];
    for (const candidateId of batch.selectedCandidateIds) {
      const [[candidate], [application], [run]] = await Promise.all([
        tx
          .select()
          .from(candidates)
          .where(and(eq(candidates.organisationId, organisationId), eq(candidates.id, candidateId)))
          .limit(1),
        tx
          .select()
          .from(candidateApplications)
          .where(
            and(
              eq(candidateApplications.organisationId, organisationId),
              eq(candidateApplications.vacancyId, batch.vacancyId),
              eq(candidateApplications.candidateId, candidateId),
            ),
          )
          .limit(1),
        tx
          .select()
          .from(candidatePreparationRuns)
          .where(
            and(
              eq(candidatePreparationRuns.organisationId, organisationId),
              eq(candidatePreparationRuns.vacancyId, batch.vacancyId),
              eq(candidatePreparationRuns.candidateId, candidateId),
              inArray(candidatePreparationRuns.id, batch.preparationRunIds),
            ),
          )
          .limit(1),
      ]);
      if (!candidate || !application || !run || !["Ready", "Needs Review"].includes(run.status))
        throw new Error("A selected candidate is no longer ready for assessment.");
      const preliminary = Number(run.preliminaryScore ?? 0);
      const experience = Math.min(100, Math.max(0, preliminary));
      const locationScore = candidate.location
        .toLowerCase()
        .includes(vacancy.locationName.toLowerCase())
        ? 100
        : 60;
      const confirmed = (run.compulsoryChecks as Array<{ status?: string }>).filter(
        (item) => item.status === "Confirmed",
      ).length;
      const totalCriteria = (run.compulsoryChecks as unknown[]).length;
      const profile = totalCriteria ? Math.round((confirmed / totalCriteria) * 100) : preliminary;
      const overall = Math.round(experience * 0.55 + profile * 0.35 + locationScore * 0.1);
      const scoreId = randomUUID();
      scoreIds.push(scoreId);
      ranked.push({ candidateId, score: overall });
      await tx.insert(candidateScoreRuns).values({
        id: scoreId,
        organisationId,
        vacancyId: batch.vacancyId,
        candidateId,
        applicationId: application.id,
        cvRecordId: run.cvRecordId,
        cvFileId: run.cvFileId,
        vacancyRecordVersion: batch.vacancyRecordVersion,
        assessmentBatchId: batch.id,
        timestamp: new Date().toISOString(),
        modelRulesVersion: "VIA-DETERMINISTIC-1",
        vacancyVersion: String(batch.vacancyRecordVersion),
        overallScore: String(overall),
        categoryScores: { Experience: experience, Location: locationScore, Profile: profile },
        strengths: [
          ...(run.matchedSkills.length ? [`Matched skills: ${run.matchedSkills.join(", ")}.`] : []),
          ...(run.compulsoryChecks as Array<{ criterion: string; status: string }>)
            .filter((item) => item.status === "Confirmed")
            .map((item) => `Confirmed: ${item.criterion}.`),
        ],
        risks: [
          ...run.missingRequiredSkills.map((skill) => `Required skill not confirmed: ${skill}.`),
          ...(run.compulsoryChecks as Array<{ criterion: string; status: string }>)
            .filter((item) => item.status !== "Confirmed")
            .map((item) => `Compulsory criterion needs review: ${item.criterion}.`),
        ],
        missingData: run.warnings,
        evidence:
          run.evidence.join(" ") ||
          "Assessment is based on the confirmed application and prepared CV profile.",
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx
        .update(candidateApplications)
        .set({
          assessmentScoreId: scoreId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(eq(candidateApplications.id, application.id));
      await tx
        .update(candidates)
        .set({
          stage: "Screened",
          aiScoreRange: `${overall}/100`,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidates.recordVersion} + 1`,
        })
        .where(eq(candidates.id, candidate.id));
      await tx
        .update(candidateInterviewRecommendations)
        .set({
          assessmentScoreId: scoreId,
          assessmentSource: "Automatic Assessment",
          status: "Ready to Schedule",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateInterviewRecommendations.recordVersion} + 1`,
        })
        .where(
          and(
            eq(candidateInterviewRecommendations.organisationId, organisationId),
            eq(candidateInterviewRecommendations.vacancyId, batch.vacancyId),
            eq(candidateInterviewRecommendations.candidateId, candidateId),
            eq(candidateInterviewRecommendations.status, "Ready for Assessment"),
          ),
        );
    }
    ranked.sort((a, b) => b.score - a.score);
    await tx
      .update(candidateAssessmentBatches)
      .set({
        status: "Assessment Completed",
        detailedScoreIds: scoreIds,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidateAssessmentBatches.recordVersion} + 1`,
      })
      .where(eq(candidateAssessmentBatches.id, batch.id));
    const shortlistId = randomUUID();
    await tx.insert(shortlistSnapshots).values({
      id: shortlistId,
      organisationId,
      vacancyId: batch.vacancyId,
      targetSize: batch.targetSize,
      rankedCandidateIds: ranked.map((item) => item.candidateId),
      selectedCandidateIds: batch.selectedCandidateIds,
      pinnedCandidateIds: pinned,
      unselectedAction: null,
      overrides: [],
      status: "Draft",
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "complete-assessment",
      module: "recruitment",
      entityType: "candidate-assessment-batch",
      entityId: batch.id,
      afterSummary: {
        scoreIds,
        rankedCandidateIds: ranked.map((item) => item.candidateId),
        shortlistId,
      },
      reason: "Completed deterministic assessment for the HR-selected group",
      riskLevel: "High",
    });
    return shortlistId;
  });
}

export async function saveShortlistDraftInDatabase(
  organisationId: string,
  input: {
    vacancyId: string;
    targetSize: number;
    selectedCandidateIds: string[];
    overrideReasons: Array<{ candidateId: string; reason: string }>;
  },
  actor: AuditActorContext,
): Promise<string> {
  recruiter(actor);
  const selected = unique(input.selectedCandidateIds);
  if (
    !Number.isInteger(input.targetSize) ||
    input.targetSize < 1 ||
    input.targetSize > 10 ||
    selected.length !== input.targetSize
  )
    throw new Error("Choose exactly the approved shortlist size between 1 and 10.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(candidateAssessmentBatches)
      .where(
        and(
          eq(candidateAssessmentBatches.organisationId, organisationId),
          eq(candidateAssessmentBatches.vacancyId, input.vacancyId),
          eq(candidateAssessmentBatches.status, "Assessment Completed"),
        ),
      )
      .orderBy(desc(candidateAssessmentBatches.createdAt))
      .limit(1);
    if (!batch || batch.targetSize !== input.targetSize)
      throw new Error("Complete the current detailed assessment group first.");
    const scores = await tx
      .select({
        candidateId: candidateScoreRuns.candidateId,
        score: candidateScoreRuns.overallScore,
      })
      .from(candidateScoreRuns)
      .where(
        and(
          eq(candidateScoreRuns.organisationId, organisationId),
          eq(candidateScoreRuns.assessmentBatchId, batch.id),
        ),
      )
      .orderBy(desc(candidateScoreRuns.overallScore));
    const ranked = scores.map((item) => item.candidateId);
    if (selected.some((id) => !ranked.includes(id)))
      throw new Error("Only assessed candidates can be shortlisted.");
    const pinned = unique([...batch.recommendedCandidateIds, ...batch.hrAddedCandidateIds]);
    if (pinned.some((id) => !selected.includes(id)))
      throw new Error("Recommended and HR-added candidates must remain shortlisted.");
    const top = ranked.slice(0, input.targetSize);
    const reasons = new Map(
      input.overrideReasons.map((item) => [item.candidateId, item.reason.trim()]),
    );
    const overrides: Array<{
      candidateId: string;
      type: "excluded_top" | "included_low";
      reason: string;
    }> = [];
    for (const id of top)
      if (!selected.includes(id))
        overrides.push({ candidateId: id, type: "excluded_top", reason: reasons.get(id) ?? "" });
    for (const id of selected)
      if (!top.includes(id))
        overrides.push({ candidateId: id, type: "included_low", reason: reasons.get(id) ?? "" });
    if (overrides.some((item) => item.reason.length < 5))
      throw new Error("A clear reason is required for every ranking override.");
    const [draft] = await tx
      .select()
      .from(shortlistSnapshots)
      .where(
        and(
          eq(shortlistSnapshots.organisationId, organisationId),
          eq(shortlistSnapshots.vacancyId, input.vacancyId),
          eq(shortlistSnapshots.status, "Draft"),
        ),
      )
      .for("update")
      .limit(1);
    const id = draft?.id ?? randomUUID();
    const values = {
      targetSize: input.targetSize,
      rankedCandidateIds: ranked,
      selectedCandidateIds: selected,
      pinnedCandidateIds: pinned,
      overrides,
      updatedAt: new Date(),
      updatedBy: actor.userId!,
    };
    if (draft)
      await tx
        .update(shortlistSnapshots)
        .set({ ...values, recordVersion: sql`${shortlistSnapshots.recordVersion} + 1` })
        .where(eq(shortlistSnapshots.id, id));
    else
      await tx.insert(shortlistSnapshots).values({
        id,
        organisationId,
        vacancyId: input.vacancyId,
        ...values,
        unselectedAction: null,
        status: "Draft",
        createdBy: actor.userId!,
      });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "save-draft",
      module: "recruitment",
      entityType: "shortlist",
      entityId: id,
      beforeSummary: draft ? { selectedCandidateIds: draft.selectedCandidateIds } : undefined,
      afterSummary: { selectedCandidateIds: selected, pinnedCandidateIds: pinned, overrides },
      reason: "Saved shortlist draft",
      riskLevel: "High",
    });
    return id;
  });
}

export async function finaliseShortlistInDatabase(
  organisationId: string,
  shortlistId: string,
  unselectedAction: "On Hold" | "Not Selected",
  actor: AuditActorContext,
): Promise<void> {
  recruiter(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [snapshot] = await tx
      .select()
      .from(shortlistSnapshots)
      .where(
        and(
          eq(shortlistSnapshots.organisationId, organisationId),
          eq(shortlistSnapshots.id, shortlistId),
        ),
      )
      .for("update")
      .limit(1);
    if (!snapshot || snapshot.status !== "Draft")
      throw new Error("Shortlist is not available for finalisation.");
    if (snapshot.selectedCandidateIds.length !== snapshot.targetSize)
      throw new Error("The shortlist is incomplete.");
    const inclusions = await tx
      .select({ candidateId: candidateAssessmentInclusions.candidateId })
      .from(candidateAssessmentInclusions)
      .where(
        and(
          eq(candidateAssessmentInclusions.organisationId, organisationId),
          eq(candidateAssessmentInclusions.vacancyId, snapshot.vacancyId),
          eq(candidateAssessmentInclusions.active, true),
        ),
      );
    const pinned = unique(inclusions.map((item) => item.candidateId));
    if (pinned.some((id) => !snapshot.selectedCandidateIds.includes(id)))
      throw new Error("A recommended or HR-added candidate is missing from the shortlist.");
    const applications = await tx
      .select()
      .from(candidateApplications)
      .where(
        and(
          eq(candidateApplications.organisationId, organisationId),
          eq(candidateApplications.vacancyId, snapshot.vacancyId),
        ),
      )
      .for("update");
    for (const application of applications) {
      if (["Hired", "Offered", "Withdrawn"].includes(application.status)) continue;
      const selected = snapshot.selectedCandidateIds.includes(application.candidateId);
      const applicationStatus = selected
        ? "Shortlisted"
        : unselectedAction === "On Hold"
          ? "On Hold"
          : "Rejected";
      await tx
        .update(candidateApplications)
        .set({
          status: applicationStatus,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(eq(candidateApplications.id, application.id));
      if (selected)
        await tx
          .update(candidates)
          .set({
            stage: "Shortlisted",
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidates.recordVersion} + 1`,
          })
          .where(eq(candidates.id, application.candidateId));
      else {
        const [otherActive] = await tx
          .select({ id: candidateApplications.id })
          .from(candidateApplications)
          .where(
            and(
              eq(candidateApplications.organisationId, organisationId),
              eq(candidateApplications.candidateId, application.candidateId),
              ne(candidateApplications.vacancyId, snapshot.vacancyId),
              inArray(candidateApplications.status, [
                "New",
                "Shortlisted",
                "Interviewing",
                "Offered",
              ]),
            ),
          )
          .limit(1);
        if (!otherActive)
          await tx
            .update(candidates)
            .set({
              stage: unselectedAction,
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${candidates.recordVersion} + 1`,
            })
            .where(eq(candidates.id, application.candidateId));
      }
    }
    await tx
      .update(shortlistSnapshots)
      .set({
        status: "Finalized",
        unselectedAction,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${shortlistSnapshots.recordVersion} + 1`,
      })
      .where(eq(shortlistSnapshots.id, snapshot.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "finalise",
      module: "recruitment",
      entityType: "shortlist",
      entityId: snapshot.id,
      beforeSummary: { status: snapshot.status },
      afterSummary: {
        status: "Finalized",
        selectedCandidateIds: snapshot.selectedCandidateIds,
        unselectedAction,
      },
      reason: "Finalised shortlist and updated vacancy application stages atomically",
      riskLevel: "Critical",
    });
  });
}
