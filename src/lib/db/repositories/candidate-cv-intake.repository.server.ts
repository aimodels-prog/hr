import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { CandidateConsentStatus, CandidateCvSource } from "../../data/types.ts";
import { LocalCvExtractionProvider } from "../../integrations/cv-extraction.ts";
import { getDatabaseClient } from "../client.ts";
import { deleteObjectFile, readObjectFile, saveObjectFile } from "../object-storage.server.ts";
import {
  candidateApplications,
  candidateCvRecords,
  candidatePreparationRuns,
  candidates,
  recruitmentDocuments,
  vacancies,
} from "../schema/recruitment.ts";
import { auditEvents, backgroundJobs } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

export function buildCandidatePreliminaryAssessment(
  candidate: typeof candidates.$inferSelect,
  vacancy: typeof vacancies.$inferSelect,
  extractedFields: Record<string, unknown>,
) {
  const extractedSkills = Array.isArray(extractedFields["skills"])
    ? extractedFields["skills"].filter((item): item is string => typeof item === "string")
    : [];
  const profile = [
    candidate.currentTitle,
    candidate.currentCompany,
    candidate.location,
    ...(candidate.skills ?? []),
    ...(candidate.education ?? []),
    ...(candidate.certifications ?? []),
    ...(candidate.languages ?? []),
    ...extractedSkills,
    typeof extractedFields["currentTitle"] === "string" ? extractedFields["currentTitle"] : "",
    typeof extractedFields["currentCompany"] === "string" ? extractedFields["currentCompany"] : "",
  ]
    .filter(Boolean)
    .join(" ");
  const profileWords = new Set(words(profile));
  const criterionChecks = (vacancy.mandatoryCriteria ?? []).map((criterion) => {
    const criterionWords = words(criterion);
    const confirmed =
      criterionWords.length > 0 && criterionWords.every((word) => profileWords.has(word));
    return {
      criterion,
      status: confirmed ? ("Confirmed" as const) : ("Needs Review" as const),
      ...(confirmed ? { evidence: "Matched in the prepared CV and candidate profile." } : {}),
    };
  });
  const preparedSkills = [...new Set([...(candidate.skills ?? []), ...extractedSkills])];
  const matches = vacancy.skills.required.filter((required) =>
    words(required).every((word) => profileWords.has(word)),
  );
  const missing = vacancy.skills.required.filter((required) => !matches.includes(required));
  const requiredYears = Number(vacancy.minimumExperience.match(/\d+/)?.[0] ?? 0);
  const extractedYears =
    typeof extractedFields["yearsOfExperience"] === "number"
      ? extractedFields["yearsOfExperience"]
      : 0;
  const actualYears = Math.max(candidate.yearsOfExperience, extractedYears);
  const experienceScore = requiredYears ? Math.min(100, (actualYears / requiredYears) * 100) : 100;
  const compulsoryScore = criterionChecks.length
    ? (criterionChecks.filter((item) => item.status === "Confirmed").length /
        criterionChecks.length) *
      100
    : 100;
  const skillScore = vacancy.skills.required.length
    ? (matches.length / vacancy.skills.required.length) * 100
    : 100;
  const vacancyWords = new Set(
    words(
      [vacancy.title, vacancy.summary, ...vacancy.requirements, ...vacancy.skills.required].join(
        " ",
      ),
    ),
  );
  const semanticScore = vacancyWords.size
    ? Math.min(
        100,
        ([...vacancyWords].filter((word) => profileWords.has(word)).length / vacancyWords.size) *
          180,
      )
    : 100;
  const score = Math.round(
    compulsoryScore * 0.45 + experienceScore * 0.25 + skillScore * 0.2 + semanticScore * 0.1,
  );
  const unconfirmed = criterionChecks.some((item) => item.status === "Needs Review");
  const band = unconfirmed
    ? "Compulsory Criterion Not Confirmed"
    : missing.length
      ? "Needs HR Review"
      : score >= 80
        ? "Strong Match"
        : score >= 55
          ? "Potential Match"
          : "Needs HR Review";
  return {
    extractedProfile: { ...extractedFields, skills: preparedSkills },
    preliminaryScore: score,
    band,
    compulsoryChecks: criterionChecks,
    matchedSkills: matches,
    missingRequiredSkills: missing,
    evidence: [
      `${actualYears} years of experience assessed against ${vacancy.minimumExperience}.`,
      ...(matches.length ? [`Matched required skills: ${matches.join(", ")}.`] : []),
    ],
    status: band === "Strong Match" || band === "Potential Match" ? "Ready" : "Needs Review",
  };
}

export async function uploadCandidateCvIntakeToDatabase(
  organisationId: string,
  input: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    source: CandidateCvSource;
    receivedAt: string;
    consentStatus: CandidateConsentStatus;
    vacancyId?: string | undefined;
    notes?: string | undefined;
    isRecommended: boolean;
  },
  actor: AuditActorContext,
): Promise<{ cvRecordId: string; jobId: string }> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can add candidate CVs.");
  }
  if (!actor.userId) throw new Error("A verified VIA user is required.");
  const db = getDatabaseClient();
  if (input.vacancyId) {
    const [vacancy] = await db
      .select({ id: vacancies.id })
      .from(vacancies)
      .where(
        and(
          eq(vacancies.organisationId, organisationId),
          eq(vacancies.id, input.vacancyId),
          eq(vacancies.status, "Open"),
        ),
      )
      .limit(1);
    if (!vacancy) throw new Error("Select an open vacancy.");
  }
  const cvRecordId = randomUUID();
  const documentId = randomUUID();
  const jobId = randomUUID();
  const metadata = await saveObjectFile({
    id: documentId,
    organisationId,
    bytes: input.bytes,
    name: input.fileName,
    mimeType: input.mimeType,
    owner: { entityType: "candidate-cv", entityId: cvRecordId },
    actor,
  });
  try {
    await db.transaction(async (tx) => {
      await tx.insert(recruitmentDocuments).values({
        id: documentId,
        organisationId,
        name: input.fileName,
        mimeType: input.mimeType,
        size: input.bytes.byteLength,
        checksum: metadata.checksum,
        ownerEntityType: "candidate-cv",
        ownerEntityId: cvRecordId,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx.insert(candidateCvRecords).values({
        id: cvRecordId,
        organisationId,
        fileId: documentId,
        originalFileName: input.fileName,
        source: input.source,
        receivedAt: input.receivedAt,
        processingStatus: "Uploaded",
        extractionMethod: "Candidate Provided",
        consentStatus: input.consentStatus,
        ...(input.vacancyId ? { vacancyId: input.vacancyId } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        recommendationPending: input.isRecommended,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx.insert(backgroundJobs).values({
        id: jobId,
        organisationId,
        module: "recruitment",
        jobType: "candidate-cv-extraction",
        entityType: "candidate-cv",
        entityId: cvRecordId,
        status: "Queued",
        payload: { cvRecordId, documentId },
        maxAttempts: 5,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [actor.activeRole],
        action: "upload",
        module: "recruitment",
        entityType: "candidate-cv",
        entityId: cvRecordId,
        afterSummary: {
          fileId: documentId,
          fileName: input.fileName,
          source: input.source,
          vacancyId: input.vacancyId,
          recommended: input.isRecommended,
          processingStatus: "Queued",
        },
        reason: "Saved a directly received CV for processing",
        riskLevel: "High",
      });
    });
    return { cvRecordId, jobId };
  } catch (error) {
    await deleteObjectFile(
      organisationId,
      documentId,
      actor,
      "CV intake transaction failed; removed unattached file",
    ).catch(() => undefined);
    throw error;
  }
}

export async function processNextCandidateCvJob(
  workerId: string,
  requestedJobId?: string,
): Promise<boolean> {
  const db = getDatabaseClient();
  const job = await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        id,
        organisation_id AS "organisationId",
        entity_id AS "entityId",
        attempts,
        max_attempts AS "maxAttempts",
        updated_by AS "updatedBy"
      FROM background_jobs
      WHERE job_type = 'candidate-cv-extraction'
        AND (${requestedJobId ?? null}::uuid IS NULL OR id = ${requestedJobId ?? null}::uuid)
        AND (
          (status IN ('Queued', 'Retry Scheduled') AND next_attempt_at <= now())
          OR (status = 'Running' AND locked_at < now() - interval '15 minutes')
        )
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const row = result[0] as
      | Pick<
          typeof backgroundJobs.$inferSelect,
          "id" | "organisationId" | "entityId" | "attempts" | "maxAttempts" | "updatedBy"
        >
      | undefined;
    if (!row) return undefined;
    await tx
      .update(backgroundJobs)
      .set({
        status: "Running",
        attempts: sql`${backgroundJobs.attempts} + 1`,
        lockedAt: new Date(),
        lockedBy: workerId,
        updatedAt: new Date(),
        updatedBy: row.updatedBy,
        recordVersion: sql`${backgroundJobs.recordVersion} + 1`,
      })
      .where(eq(backgroundJobs.id, row.id));
    return { ...row, attempts: row.attempts + 1 };
  });
  if (!job) return false;
  try {
    const [cv] = await db
      .select()
      .from(candidateCvRecords)
      .where(
        and(
          eq(candidateCvRecords.organisationId, job.organisationId),
          eq(candidateCvRecords.id, job.entityId),
        ),
      )
      .limit(1);
    if (!cv) throw new Error("The queued CV record no longer exists.");
    await db
      .update(candidateCvRecords)
      .set({ processingStatus: "Extracting", updatedAt: new Date(), updatedBy: job.updatedBy })
      .where(eq(candidateCvRecords.id, cv.id));
    const stored = await readObjectFile(
      job.organisationId,
      cv.fileId,
      { displayName: "VIA HR Background Worker", activeRole: "Super Admin" },
      "Processed candidate CV extraction job",
    );
    const ownedBytes = Uint8Array.from(stored.bytes);
    const extraction = await new LocalCvExtractionProvider().extract({
      file: new Blob([ownedBytes.buffer], { type: stored.metadata.mimeType }),
      fileName: stored.metadata.name,
    });
    const [preparation] = await db
      .select()
      .from(candidatePreparationRuns)
      .where(
        and(
          eq(candidatePreparationRuns.organisationId, job.organisationId),
          eq(candidatePreparationRuns.cvRecordId, cv.id),
        ),
      )
      .limit(1);
    let prepared: ReturnType<typeof buildCandidatePreliminaryAssessment> | undefined;
    if (preparation) {
      const [[candidate], [vacancy]] = await Promise.all([
        db
          .select()
          .from(candidates)
          .where(
            and(
              eq(candidates.organisationId, job.organisationId),
              eq(candidates.id, preparation.candidateId),
            ),
          )
          .limit(1),
        db
          .select()
          .from(vacancies)
          .where(
            and(
              eq(vacancies.organisationId, job.organisationId),
              eq(vacancies.id, preparation.vacancyId),
            ),
          )
          .limit(1),
      ]);
      if (!candidate || !vacancy) throw new Error("Candidate preparation references are invalid.");
      if (vacancy.recordVersion !== preparation.vacancyRecordVersion)
        throw new Error("The vacancy changed while this CV was being prepared.");
      prepared = buildCandidatePreliminaryAssessment(
        candidate,
        vacancy,
        extraction.fields as Record<string, unknown>,
      );
    }
    await db.transaction(async (tx) => {
      await tx
        .update(candidateCvRecords)
        .set({
          processingStatus: "Awaiting HR Review",
          extractionMethod: extraction.method,
          extractedFields: extraction.fields,
          fieldConfidence: extraction.confidence,
          extractionWarnings: extraction.warnings,
          updatedAt: new Date(),
          updatedBy: job.updatedBy,
          recordVersion: sql`${candidateCvRecords.recordVersion} + 1`,
        })
        .where(eq(candidateCvRecords.id, cv.id));
      if (preparation && prepared) {
        const documentRoute =
          stored.metadata.mimeType.includes("word") ||
          stored.metadata.mimeType.includes("officedocument")
            ? "Word Document"
            : stored.metadata.mimeType.startsWith("image/")
              ? "OCR Required"
              : "Searchable PDF";
        await tx
          .update(candidatePreparationRuns)
          .set({
            ...prepared,
            preliminaryScore: String(prepared.preliminaryScore),
            documentRoute,
            preparationMethod: "Python Service",
            fieldConfidence: extraction.confidence,
            warnings: extraction.warnings,
            startedAt: preparation.startedAt ?? new Date().toISOString(),
            completedAt: new Date().toISOString(),
            failureReason: null,
            updatedAt: new Date(),
            updatedBy: job.updatedBy,
            recordVersion: sql`${candidatePreparationRuns.recordVersion} + 1`,
          })
          .where(eq(candidatePreparationRuns.id, preparation.id));
        await tx
          .update(candidateApplications)
          .set({
            preparationStatus: prepared.status,
            updatedAt: new Date(),
            updatedBy: job.updatedBy,
            recordVersion: sql`${candidateApplications.recordVersion} + 1`,
          })
          .where(eq(candidateApplications.id, preparation.applicationId));
      }
      await tx
        .update(backgroundJobs)
        .set({
          status: "Completed",
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
          updatedAt: new Date(),
          updatedBy: job.updatedBy,
          recordVersion: sql`${backgroundJobs.recordVersion} + 1`,
        })
        .where(eq(backgroundJobs.id, job.id));
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : "Unknown CV processing error";
    const failed = job.attempts >= job.maxAttempts;
    await db.transaction(async (tx) => {
      await tx
        .update(backgroundJobs)
        .set({
          status: failed ? "Failed" : "Retry Scheduled",
          nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
          updatedAt: new Date(),
          updatedBy: job.updatedBy,
          recordVersion: sql`${backgroundJobs.recordVersion} + 1`,
        })
        .where(eq(backgroundJobs.id, job.id));
      await tx
        .update(candidateCvRecords)
        .set({
          processingStatus: failed ? "Processing Failed" : "Uploaded",
          extractionWarnings: [message],
          updatedAt: new Date(),
          updatedBy: job.updatedBy,
          recordVersion: sql`${candidateCvRecords.recordVersion} + 1`,
        })
        .where(eq(candidateCvRecords.id, job.entityId));
    });
  }
  return true;
}

/** Confirm the HR-edited extraction and create/link the Candidate Pool record atomically. */
export async function finaliseCandidateCvIntakeInDatabase(
  organisationId: string,
  input: {
    cvRecordId: string;
    existingCandidateId?: string;
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
  actor: AuditActorContext,
): Promise<{ candidateId: string; applicationId?: string; cvRecordId: string }> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can confirm candidate CV details.");
  if (!actor.employeeId) throw new Error("A verified VIA employee is required.");
  const email = input.candidate.email.trim().toLowerCase();
  const phone = input.candidate.phone.trim();
  if (!input.candidate.firstName.trim() || !input.candidate.lastName.trim() || !email || !phone)
    throw new Error("Name, email and phone number are required.");
  if (!Number.isInteger(input.candidate.yearsOfExperience) || input.candidate.yearsOfExperience < 0)
    throw new Error("Years of experience must be zero or greater.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [cv] = await tx
      .select()
      .from(candidateCvRecords)
      .where(
        and(
          eq(candidateCvRecords.organisationId, organisationId),
          eq(candidateCvRecords.id, input.cvRecordId),
        ),
      )
      .limit(1);
    if (!cv) throw new Error("The CV intake record was not found.");
    if (cv.candidateId) throw new Error("This CV has already been confirmed.");
    if (!["Awaiting HR Review", "Ready"].includes(cv.processingStatus))
      throw new Error("Wait for CV processing to finish before confirming it.");
    const vacancyId = input.vacancyId ?? cv.vacancyId ?? undefined;
    if (vacancyId) {
      const [vacancy] = await tx
        .select({ id: vacancies.id })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.organisationId, organisationId),
            eq(vacancies.id, vacancyId),
            eq(vacancies.status, "Open"),
          ),
        )
        .limit(1);
      if (!vacancy) throw new Error("Select an open vacancy.");
      if (input.consentStatus !== "Confirmed")
        throw new Error(
          "Candidate consent must be confirmed before creating a vacancy application.",
        );
    }
    let candidateId = input.existingCandidateId;
    if (candidateId) {
      const [existing] = await tx
        .select({ id: candidates.id })
        .from(candidates)
        .where(and(eq(candidates.organisationId, organisationId), eq(candidates.id, candidateId)))
        .limit(1);
      if (!existing) throw new Error("The selected candidate no longer exists.");
      await tx
        .update(candidates)
        .set({
          firstName: input.candidate.firstName.trim(),
          lastName: input.candidate.lastName.trim(),
          email,
          phone,
          location: input.candidate.location.trim(),
          currentCompany: input.candidate.currentCompany?.trim() || null,
          currentTitle: input.candidate.currentTitle?.trim() || null,
          yearsOfExperience: input.candidate.yearsOfExperience,
          skills: input.candidate.skills ?? [],
          education: input.candidate.education ?? [],
          certifications: input.candidate.certifications ?? [],
          languages: input.candidate.languages ?? [],
          availability: input.candidate.availability?.trim() || null,
          workEligibility: input.candidate.workEligibility?.trim() || null,
          talentPools: input.candidate.talentPools ?? [],
          cvFileId: cv.fileId,
          latestCvRecordId: cv.id,
          consentStatus: input.consentStatus,
          consentUpdatedAt: new Date().toISOString(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidates.recordVersion} + 1`,
        })
        .where(eq(candidates.id, candidateId));
    } else {
      const duplicate = await tx
        .select({ id: candidates.id })
        .from(candidates)
        .where(
          and(
            eq(candidates.organisationId, organisationId),
            sql`(lower(${candidates.email}) = ${email} OR regexp_replace(${candidates.phone}, '\\D', '', 'g') = regexp_replace(${phone}, '\\D', '', 'g'))`,
          ),
        )
        .limit(1);
      if (duplicate.length) throw new Error("DUPLICATE_CANDIDATE_MATCH_FOUND");
      const newCandidateId = randomUUID();
      candidateId = newCandidateId;
      await tx.insert(candidates).values({
        id: newCandidateId,
        organisationId,
        firstName: input.candidate.firstName.trim(),
        lastName: input.candidate.lastName.trim(),
        email,
        phone,
        location: input.candidate.location.trim(),
        currentCompany: input.candidate.currentCompany?.trim(),
        currentTitle: input.candidate.currentTitle?.trim(),
        yearsOfExperience: input.candidate.yearsOfExperience,
        stage: vacancyId ? "Applied" : "Sourced",
        doNotContact: false,
        hrOwnerId: actor.employeeId,
        source: cv.source,
        skills: input.candidate.skills ?? [],
        education: input.candidate.education ?? [],
        certifications: input.candidate.certifications ?? [],
        languages: input.candidate.languages ?? [],
        availability: input.candidate.availability?.trim(),
        workEligibility: input.candidate.workEligibility?.trim(),
        talentPools: input.candidate.talentPools ?? [],
        cvFileId: cv.fileId,
        latestCvRecordId: cv.id,
        consentStatus: input.consentStatus,
        consentUpdatedAt: new Date().toISOString(),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof candidates.$inferInsert);
    }
    if (!candidateId) throw new Error("The candidate could not be created.");
    let applicationId: string | undefined;
    let preparationRunId: string | undefined;
    if (vacancyId) {
      const [existingApplication] = await tx
        .select({ id: candidateApplications.id })
        .from(candidateApplications)
        .where(
          and(
            eq(candidateApplications.candidateId, candidateId),
            eq(candidateApplications.vacancyId, vacancyId),
          ),
        )
        .limit(1);
      if (existingApplication) {
        applicationId = existingApplication.id;
        await tx
          .update(candidateApplications)
          .set({ cvFileId: cv.fileId, updatedAt: new Date(), updatedBy: actor.userId })
          .where(eq(candidateApplications.id, applicationId));
      } else {
        const newApplicationId = randomUUID();
        applicationId = newApplicationId;
        await tx.insert(candidateApplications).values({
          id: newApplicationId,
          organisationId,
          referenceId: `APP-${new Date().getFullYear()}-${applicationId.slice(0, 8).toUpperCase()}`,
          candidateId: candidateId!,
          vacancyId,
          status: "New",
          cvFileId: cv.fileId,
          noticePeriod: "To be confirmed",
          screeningAnswers: [],
          source: cv.source,
          consentGiven: true,
          consentedAt: new Date().toISOString(),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof candidateApplications.$inferInsert);
        await tx
          .update(vacancies)
          .set({
            applicantCount: sql`${vacancies.applicantCount} + 1`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
          })
          .where(eq(vacancies.id, vacancyId));
      }
    }
    if (vacancyId && applicationId) {
      const [[preparedCandidate], [preparedVacancy]] = await Promise.all([
        tx
          .select()
          .from(candidates)
          .where(and(eq(candidates.organisationId, organisationId), eq(candidates.id, candidateId)))
          .limit(1),
        tx
          .select()
          .from(vacancies)
          .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, vacancyId)))
          .limit(1),
      ]);
      if (!preparedCandidate || !preparedVacancy)
        throw new Error("The candidate or vacancy could not be prepared.");
      const result = buildCandidatePreliminaryAssessment(
        preparedCandidate,
        preparedVacancy,
        cv.extractedFields as Record<string, unknown>,
      );
      preparationRunId = randomUUID();
      await tx.insert(candidatePreparationRuns).values({
        id: preparationRunId,
        organisationId,
        vacancyId,
        vacancyRecordVersion: preparedVacancy.recordVersion,
        candidateId,
        applicationId,
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
        startedAt: cv.receivedAt,
        completedAt: new Date().toISOString(),
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx
        .update(candidateApplications)
        .set({
          preparationRunId,
          preparationStatus: result.status,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(eq(candidateApplications.id, applicationId));
    }
    await tx
      .update(candidateCvRecords)
      .set({
        candidateId,
        applicationId: applicationId ?? null,
        vacancyId: vacancyId ?? null,
        processingStatus: "Ready",
        consentStatus: input.consentStatus,
        reviewedAt: new Date().toISOString(),
        reviewedByUserId: actor.userId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidateCvRecords.recordVersion} + 1`,
      })
      .where(eq(candidateCvRecords.id, cv.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "confirm",
      module: "recruitment",
      entityType: "candidate-cv",
      entityId: cv.id,
      afterSummary: { candidateId, applicationId, vacancyId, preparationRunId },
      reason: "Confirmed extracted CV information and added it to the Candidate Pool",
      riskLevel: "High",
    });
    return { candidateId, ...(applicationId ? { applicationId } : {}), cvRecordId: cv.id };
  });
}
