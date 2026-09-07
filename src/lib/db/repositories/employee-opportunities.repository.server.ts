import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { deleteObjectFile, saveObjectFile } from "../object-storage.server.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { departments, locations, positions } from "../schema/master-data.ts";
import {
  candidateApplications,
  candidateAssessmentInclusions,
  candidateCvRecords,
  candidatePreparationRuns,
  candidateRecommendations,
  candidates,
  recruitmentDocuments,
  vacancies,
} from "../schema/recruitment.ts";
import { auditEvents, backgroundJobs, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export interface EmployeeOpportunityVacancy {
  id: string;
  title: string;
  department: string;
  location: string;
  position: string;
  employmentType: string;
  summary: string;
  requirements: string[];
  mandatoryCriteria: string[];
  screeningQuestions: string[];
  acceptsInternalApplications: boolean;
  acceptsEmployeeReferrals: boolean;
}

export interface EmployeeOpportunityApplication {
  id: string;
  referenceId: string;
  vacancyId: string;
  vacancyTitle: string;
  submittedAt: string;
  status: string;
}

export interface EmployeeOpportunityReferral {
  id: string;
  candidateName: string;
  vacancyId?: string;
  vacancyTitle?: string;
  submittedAt: string;
  status: string;
}

export interface EmployeeOpportunitySnapshot {
  vacancies: EmployeeOpportunityVacancy[];
  applications: EmployeeOpportunityApplication[];
  referrals: EmployeeOpportunityReferral[];
}

type OpportunityActor = AuditActorContext & { userId: string; employeeId: string };

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^00/, "");
  return digits ? `+${digits}` : "";
}

function splitName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() ?? "VIA",
    lastName: parts.join(" ") || "Employee",
  };
}

function applicationReference(prefix: "INT" | "REF"): string {
  return `${prefix}-${new Date().getUTCFullYear().toString().slice(-2)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function activeEmployee(
  organisationId: string,
  actor: OpportunityActor,
  tx = getDatabaseClient(),
) {
  const [employee] = await tx
    .select({
      employee: employees,
      department: departments.name,
      position: positions.name,
      location: locations.name,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(positions, eq(positions.id, employees.positionId))
    .innerJoin(locations, eq(locations.id, employees.locationId))
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, actor.employeeId),
        inArray(employees.status, ["Active", "Onboarding"]),
        sql`${employees.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!employee) throw new Error("Your active VIA employee record could not be found.");
  return employee;
}

async function activeRecruitmentRecipients(organisationId: string, tx = getDatabaseClient()) {
  return tx
    .selectDistinct({ userId: users.id, employeeId: users.employeeId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.status, "Active"),
        inArray(roles.code, ["HR", "Super Admin"]),
        sql`${users.archivedAt} IS NULL`,
      ),
    );
}

async function activeRecruitmentOwner(organisationId: string, tx = getDatabaseClient()) {
  const [owner] = await tx
    .select({ employeeId: users.employeeId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.status, "Active"),
        inArray(roles.code, ["HR", "Super Admin"]),
        sql`${users.employeeId} IS NOT NULL`,
        sql`${users.archivedAt} IS NULL`,
      ),
    )
    .orderBy(sql`CASE WHEN ${roles.code} = 'HR' THEN 0 ELSE 1 END`, asc(users.createdAt))
    .limit(1);
  if (!owner?.employeeId) {
    throw new Error("No active HR owner is available for this submission.");
  }
  return owner.employeeId;
}

async function resolveCandidateIdentity(
  organisationId: string,
  email: string,
  phone: string,
  tx = getDatabaseClient(),
): Promise<string | undefined> {
  const matches = await tx
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(
        eq(candidates.organisationId, organisationId),
        or(eq(candidates.email, email), eq(candidates.phone, phone)),
        sql`${candidates.archivedAt} IS NULL`,
        sql`${candidates.mergedIntoId} IS NULL`,
      ),
    );
  const ids = [...new Set(matches.map((item) => item.id))];
  if (ids.length > 1) {
    throw new Error(
      "These details match more than one Candidate Pool profile. HR must resolve the duplicate records before submission.",
    );
  }
  return ids[0];
}

export async function listEmployeeOpportunitiesInDatabase(
  organisationId: string,
  actor: OpportunityActor,
): Promise<EmployeeOpportunitySnapshot> {
  const db = getDatabaseClient();
  await activeEmployee(organisationId, actor, db);
  const [vacancyRows, applicationRows, referralRows] = await Promise.all([
    db
      .select({
        id: vacancies.id,
        title: vacancies.title,
        department: departments.name,
        location: locations.name,
        position: positions.name,
        employmentType: sql<string>`(
          SELECT name FROM employment_types WHERE id = ${vacancies.employmentTypeId}
        )`,
        summary: vacancies.summary,
        requirements: vacancies.requirements,
        mandatoryCriteria: vacancies.mandatoryCriteria,
        screeningQuestions: vacancies.screeningQuestions,
        acceptsInternalApplications: vacancies.acceptsInternalApplications,
        acceptsEmployeeReferrals: vacancies.acceptsEmployeeReferrals,
      })
      .from(vacancies)
      .innerJoin(departments, eq(departments.id, vacancies.departmentId))
      .innerJoin(locations, eq(locations.id, vacancies.locationId))
      .innerJoin(positions, eq(positions.id, vacancies.positionId))
      .where(
        and(
          eq(vacancies.organisationId, organisationId),
          eq(vacancies.status, "Open"),
          sql`${vacancies.archivedAt} IS NULL`,
          or(
            eq(vacancies.acceptsInternalApplications, true),
            eq(vacancies.acceptsEmployeeReferrals, true),
          ),
        ),
      )
      .orderBy(asc(vacancies.title)),
    db
      .select({
        id: candidateApplications.id,
        referenceId: candidateApplications.referenceId,
        vacancyId: candidateApplications.vacancyId,
        vacancyTitle: vacancies.title,
        submittedAt: candidateApplications.createdAt,
        status: candidateApplications.status,
      })
      .from(candidateApplications)
      .innerJoin(vacancies, eq(vacancies.id, candidateApplications.vacancyId))
      .where(
        and(
          eq(candidateApplications.organisationId, organisationId),
          eq(candidateApplications.internalApplicantEmployeeId, actor.employeeId),
          sql`${candidateApplications.archivedAt} IS NULL`,
        ),
      )
      .orderBy(sql`${candidateApplications.createdAt} DESC`),
    db
      .select({
        id: candidateRecommendations.id,
        firstName: candidates.firstName,
        lastName: candidates.lastName,
        vacancyId: candidateRecommendations.vacancyId,
        vacancyTitle: vacancies.title,
        submittedAt: candidateRecommendations.createdAt,
        status: candidateRecommendations.sourceOutcome,
      })
      .from(candidateRecommendations)
      .innerJoin(candidates, eq(candidates.id, candidateRecommendations.candidateId))
      .leftJoin(vacancies, eq(vacancies.id, candidateRecommendations.vacancyId))
      .where(
        and(
          eq(candidateRecommendations.organisationId, organisationId),
          eq(candidateRecommendations.recommenderEmployeeId, actor.employeeId),
          sql`${candidateRecommendations.archivedAt} IS NULL`,
        ),
      )
      .orderBy(sql`${candidateRecommendations.createdAt} DESC`),
  ]);
  return {
    vacancies: vacancyRows.map((row) => ({
      ...row,
      mandatoryCriteria: row.mandatoryCriteria ?? [],
    })),
    applications: applicationRows.map((row) => ({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
    })),
    referrals: referralRows.map((row) => ({
      id: row.id,
      candidateName: `${row.firstName} ${row.lastName}`,
      ...(row.vacancyId ? { vacancyId: row.vacancyId } : {}),
      ...(row.vacancyTitle ? { vacancyTitle: row.vacancyTitle } : {}),
      submittedAt: row.submittedAt.toISOString(),
      status: row.status,
    })),
  };
}

interface CvUpload {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function submitInternalApplicationInDatabase(
  organisationId: string,
  input: {
    vacancyId: string;
    noticePeriod: string;
    coverNote?: string;
    screeningAnswers: Array<{ question: string; answer: string }>;
    cv: CvUpload;
  },
  actor: OpportunityActor,
): Promise<{ applicationId: string; referenceId: string; jobId: string }> {
  const db = getDatabaseClient();
  const person = await activeEmployee(organisationId, actor, db);
  const phone = normalizePhone(person.employee.phone ?? "");
  if (!phone) throw new Error("Add your phone number to My Profile before applying.");
  const [vacancy] = await db
    .select()
    .from(vacancies)
    .where(
      and(
        eq(vacancies.organisationId, organisationId),
        eq(vacancies.id, input.vacancyId),
        eq(vacancies.status, "Open"),
        eq(vacancies.acceptsInternalApplications, true),
        sql`${vacancies.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!vacancy) throw new Error("This position is not accepting internal applications.");
  const requiredQuestions = vacancy.screeningQuestions.map((question) => question.trim());
  const answerMap = new Map(
    input.screeningAnswers.map((item) => [item.question.trim(), item.answer.trim()]),
  );
  if (requiredQuestions.some((question) => !answerMap.get(question))) {
    throw new Error("Answer every vacancy question before submitting.");
  }
  const email = person.employee.workEmail.trim().toLowerCase();
  const linkedCandidateId = person.employee.candidateId ?? undefined;
  const candidateId =
    linkedCandidateId ??
    (await resolveCandidateIdentity(organisationId, email, phone, db)) ??
    randomUUID();
  const [duplicate] = await db
    .select({ id: candidateApplications.id })
    .from(candidateApplications)
    .where(
      and(
        eq(candidateApplications.organisationId, organisationId),
        eq(candidateApplications.candidateId, candidateId),
        eq(candidateApplications.vacancyId, vacancy.id),
        sql`${candidateApplications.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (duplicate) throw new Error("You have already applied for this position.");

  const applicationId = randomUUID();
  const cvRecordId = randomUUID();
  const documentId = randomUUID();
  const preparationRunId = randomUUID();
  const jobId = randomUUID();
  const referenceId = applicationReference("INT");
  const metadata = await saveObjectFile({
    id: documentId,
    organisationId,
    bytes: input.cv.bytes,
    name: input.cv.fileName,
    mimeType: input.cv.mimeType,
    owner: { entityType: "candidate-cv", entityId: cvRecordId },
    actor,
  });
  try {
    await db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const name = splitName(person.employee.legalName);
      const ownerEmployeeId = await activeRecruitmentOwner(organisationId, tx);
      const recipients = await activeRecruitmentRecipients(organisationId, tx);
      const [existingCandidate] = await tx
        .select({ id: candidates.id })
        .from(candidates)
        .where(and(eq(candidates.organisationId, organisationId), eq(candidates.id, candidateId)))
        .limit(1);
      await tx.insert(recruitmentDocuments).values({
        id: documentId,
        organisationId,
        name: input.cv.fileName,
        mimeType: input.cv.mimeType,
        size: input.cv.bytes.byteLength,
        checksum: metadata.checksum,
        ownerEntityType: "candidate-cv",
        ownerEntityId: cvRecordId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      if (existingCandidate) {
        await tx
          .update(candidates)
          .set({
            stage: "Applied",
            hrOwnerId: sql`COALESCE(${candidates.hrOwnerId}, ${ownerEmployeeId})`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidates.recordVersion} + 1`,
          })
          .where(eq(candidates.id, candidateId));
      } else {
        await tx.insert(candidates).values({
          id: candidateId,
          organisationId,
          ...name,
          email,
          phone,
          nationality: person.employee.nationality,
          location: person.location,
          currentCompany: "VIA International",
          currentTitle: person.position,
          stage: "Applied",
          source: "Internal Application",
          hrOwnerId: ownerEmployeeId,
          noticePeriod: input.noticePeriod.trim(),
          consentStatus: "Confirmed",
          consentUpdatedAt: now,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
      }
      await tx.insert(candidateApplications).values({
        id: applicationId,
        organisationId,
        referenceId,
        candidateId,
        vacancyId: vacancy.id,
        status: "New",
        cvFileId: documentId,
        coverNote: input.coverNote?.trim() || null,
        noticePeriod: input.noticePeriod.trim(),
        screeningAnswers: requiredQuestions.map((question) => ({
          question,
          answer: answerMap.get(question)!,
        })),
        source: "Internal Application",
        consentGiven: true,
        consentedAt: now,
        preparationStatus: "Queued",
        internalApplicantEmployeeId: actor.employeeId,
        submittedByEmployeeId: actor.employeeId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx.insert(candidateCvRecords).values({
        id: cvRecordId,
        organisationId,
        candidateId,
        applicationId,
        vacancyId: vacancy.id,
        fileId: documentId,
        originalFileName: input.cv.fileName,
        source: "Internal Application",
        receivedAt: now,
        processingStatus: "Uploaded",
        extractionMethod: "Candidate Provided",
        consentStatus: "Confirmed",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx.insert(candidatePreparationRuns).values({
        id: preparationRunId,
        organisationId,
        vacancyId: vacancy.id,
        vacancyRecordVersion: vacancy.recordVersion,
        candidateId,
        applicationId,
        cvRecordId,
        cvFileId: documentId,
        cvChecksum: metadata.checksum,
        status: "Queued",
        documentRoute: "Unknown",
        preparationMethod: "Python Service",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx
        .update(candidateApplications)
        .set({
          preparationRunId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(eq(candidateApplications.id, applicationId));
      await tx
        .update(candidates)
        .set({
          latestCvRecordId: cvRecordId,
          cvFileId: documentId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidates.recordVersion} + 1`,
        })
        .where(eq(candidates.id, candidateId));
      await tx.insert(backgroundJobs).values({
        id: jobId,
        organisationId,
        module: "recruitment",
        jobType: "candidate-cv-extraction",
        entityType: "candidate-cv",
        entityId: cvRecordId,
        status: "Queued",
        payload: { cvRecordId, documentId, applicationId, preparationRunId },
        maxAttempts: 5,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx
        .update(vacancies)
        .set({
          applicantCount: sql`${vacancies.applicantCount} + 1`,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${vacancies.recordVersion} + 1`,
        })
        .where(eq(vacancies.id, vacancy.id));
      for (const recipient of recipients) {
        await tx.insert(notifications).values({
          organisationId,
          recipientUserId: recipient.userId,
          type: "Internal Application",
          title: "Internal application received",
          message: `${person.employee.preferredName} applied for ${vacancy.title}.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `internal-application-${applicationId}`,
          link: {
            entityType: "candidate-application",
            entityId: applicationId,
            path: `/staff/candidates/${candidateId}`,
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
      }
      await tx.insert(notifications).values({
        organisationId,
        recipientUserId: actor.userId,
        type: "Application Submitted",
        title: "Your application was submitted",
        message: `Your application for ${vacancy.title} was received. Reference ${referenceId}.`,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `internal-application-confirmation-${applicationId}`,
        link: {
          entityType: "candidate-application",
          entityId: applicationId,
          path: "/staff/opportunities",
        },
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [actor.activeRole],
        action: "submit",
        module: "recruitment",
        entityType: "candidate-application",
        entityId: applicationId,
        afterSummary: { referenceId, vacancyId: vacancy.id, source: "Internal Application" },
        reason: "Employee submitted an internal application",
        riskLevel: "High",
      });
    });
  } catch (error) {
    await deleteObjectFile(organisationId, documentId, actor, "Internal application failed").catch(
      () => undefined,
    );
    throw error;
  }
  return { applicationId, referenceId, jobId };
}

export async function submitEmployeeReferralInDatabase(
  organisationId: string,
  input: {
    vacancyId?: string;
    candidate: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      location: string;
      currentCompany?: string;
      currentTitle?: string;
    };
    relationship: string;
    yearsKnown?: number;
    notes: string;
    candidateAware: boolean;
    cv: CvUpload;
  },
  actor: OpportunityActor,
): Promise<{
  recommendationId: string;
  candidateId: string;
  applicationId?: string;
  jobId: string;
}> {
  const db = getDatabaseClient();
  const person = await activeEmployee(organisationId, actor, db);
  if (!input.candidateAware)
    throw new Error("Confirm that the candidate knows their CV is being shared with VIA.");
  const email = input.candidate.email.trim().toLowerCase();
  const phone = normalizePhone(input.candidate.phone);
  if (!phone) throw new Error("Enter a valid candidate phone number.");
  const candidateId =
    (await resolveCandidateIdentity(organisationId, email, phone, db)) ?? randomUUID();
  const vacancy = input.vacancyId
    ? (
        await db
          .select()
          .from(vacancies)
          .where(
            and(
              eq(vacancies.organisationId, organisationId),
              eq(vacancies.id, input.vacancyId),
              eq(vacancies.status, "Open"),
              eq(vacancies.acceptsEmployeeReferrals, true),
              sql`${vacancies.archivedAt} IS NULL`,
            ),
          )
          .limit(1)
      )[0]
    : undefined;
  if (input.vacancyId && !vacancy)
    throw new Error("This position is not accepting employee referrals.");

  const [existingApplication] = vacancy
    ? await db
        .select({ id: candidateApplications.id })
        .from(candidateApplications)
        .where(
          and(
            eq(candidateApplications.organisationId, organisationId),
            eq(candidateApplications.candidateId, candidateId),
            eq(candidateApplications.vacancyId, vacancy.id),
            sql`${candidateApplications.archivedAt} IS NULL`,
          ),
        )
        .limit(1)
    : [];
  const recommendationId = randomUUID();
  const applicationId = existingApplication?.id ?? (vacancy ? randomUUID() : undefined);
  const cvRecordId = randomUUID();
  const documentId = randomUUID();
  const preparationRunId = vacancy && applicationId ? randomUUID() : undefined;
  const jobId = randomUUID();
  const metadata = await saveObjectFile({
    id: documentId,
    organisationId,
    bytes: input.cv.bytes,
    name: input.cv.fileName,
    mimeType: input.cv.mimeType,
    owner: { entityType: "candidate-cv", entityId: cvRecordId },
    actor,
  });
  try {
    await db.transaction(async (tx) => {
      const now = new Date().toISOString();
      const recipients = await activeRecruitmentRecipients(organisationId, tx);
      const ownerEmployeeId = await activeRecruitmentOwner(organisationId, tx);
      const [existingCandidate] = await tx
        .select({ id: candidates.id })
        .from(candidates)
        .where(and(eq(candidates.organisationId, organisationId), eq(candidates.id, candidateId)))
        .limit(1);
      await tx.insert(recruitmentDocuments).values({
        id: documentId,
        organisationId,
        name: input.cv.fileName,
        mimeType: input.cv.mimeType,
        size: input.cv.bytes.byteLength,
        checksum: metadata.checksum,
        ownerEntityType: "candidate-cv",
        ownerEntityId: cvRecordId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      if (existingCandidate) {
        await tx
          .update(candidates)
          .set({
            hrOwnerId: sql`COALESCE(${candidates.hrOwnerId}, ${ownerEmployeeId})`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidates.recordVersion} + 1`,
          })
          .where(eq(candidates.id, candidateId));
      } else {
        await tx.insert(candidates).values({
          id: candidateId,
          organisationId,
          firstName: input.candidate.firstName.trim(),
          lastName: input.candidate.lastName.trim(),
          email,
          phone,
          location: input.candidate.location.trim(),
          currentCompany: input.candidate.currentCompany?.trim() || null,
          currentTitle: input.candidate.currentTitle?.trim() || null,
          stage: vacancy ? "Applied" : "Sourced",
          source: "Employee Referral",
          recommender: person.employee.legalName,
          hrOwnerId: ownerEmployeeId,
          consentStatus: "Confirmed",
          consentUpdatedAt: now,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
      }
      if (vacancy && applicationId && !existingApplication) {
        await tx.insert(candidateApplications).values({
          id: applicationId,
          organisationId,
          referenceId: applicationReference("REF"),
          candidateId,
          vacancyId: vacancy.id,
          status: "New",
          cvFileId: documentId,
          noticePeriod: "To be confirmed",
          screeningAnswers: [],
          source: "Employee Referral",
          consentGiven: true,
          consentedAt: now,
          preparationStatus: "Queued",
          submittedByEmployeeId: actor.employeeId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
        await tx
          .update(vacancies)
          .set({
            applicantCount: sql`${vacancies.applicantCount} + 1`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${vacancies.recordVersion} + 1`,
          })
          .where(eq(vacancies.id, vacancy.id));
      }
      await tx.insert(candidateRecommendations).values({
        id: recommendationId,
        organisationId,
        candidateId,
        ...(vacancy ? { vacancyId: vacancy.id } : {}),
        recommenderType: "Employee Referral",
        recommenderName: person.employee.legalName,
        recommenderCompany: "VIA International",
        recommenderPosition: person.position,
        recommenderEmail: person.employee.workEmail,
        recommenderPhone: person.employee.phone,
        relationship: input.relationship.trim(),
        date: now.slice(0, 10),
        notes: input.notes.trim(),
        hrOwnerId: ownerEmployeeId,
        sourceOutcome: "Submitted",
        recommenderEmployeeId: actor.employeeId,
        candidateAware: true,
        yearsKnown: input.yearsKnown,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx.insert(candidateCvRecords).values({
        id: cvRecordId,
        organisationId,
        candidateId,
        ...(applicationId ? { applicationId } : {}),
        ...(vacancy ? { vacancyId: vacancy.id } : {}),
        fileId: documentId,
        originalFileName: input.cv.fileName,
        source: "Employee Referral",
        receivedAt: now,
        processingStatus: "Uploaded",
        extractionMethod: "Candidate Provided",
        consentStatus: "Confirmed",
        recommendationPending: false,
        recommendationId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      if (vacancy && applicationId && preparationRunId) {
        await tx.insert(candidatePreparationRuns).values({
          id: preparationRunId,
          organisationId,
          vacancyId: vacancy.id,
          vacancyRecordVersion: vacancy.recordVersion,
          candidateId,
          applicationId,
          cvRecordId,
          cvFileId: documentId,
          cvChecksum: metadata.checksum,
          status: "Queued",
          documentRoute: "Unknown",
          preparationMethod: "Python Service",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
        await tx
          .update(candidateApplications)
          .set({
            cvFileId: documentId,
            submittedByEmployeeId: actor.employeeId,
            preparationRunId,
            preparationStatus: "Queued",
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidateApplications.recordVersion} + 1`,
          })
          .where(eq(candidateApplications.id, applicationId));
      }
      await tx
        .update(candidates)
        .set({
          latestCvRecordId: cvRecordId,
          cvFileId: documentId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidates.recordVersion} + 1`,
        })
        .where(eq(candidates.id, candidateId));
      if (vacancy) {
        const [existingInclusion] = await tx
          .select({ id: candidateAssessmentInclusions.id })
          .from(candidateAssessmentInclusions)
          .where(
            and(
              eq(candidateAssessmentInclusions.organisationId, organisationId),
              eq(candidateAssessmentInclusions.vacancyId, vacancy.id),
              eq(candidateAssessmentInclusions.candidateId, candidateId),
              eq(candidateAssessmentInclusions.active, true),
            ),
          )
          .limit(1);
        if (existingInclusion) {
          await tx
            .update(candidateAssessmentInclusions)
            .set({
              source: "Recommended",
              cvRecordId,
              reason: input.notes.trim(),
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${candidateAssessmentInclusions.recordVersion} + 1`,
            })
            .where(eq(candidateAssessmentInclusions.id, existingInclusion.id));
        } else {
          await tx.insert(candidateAssessmentInclusions).values({
            organisationId,
            vacancyId: vacancy.id,
            candidateId,
            cvRecordId,
            source: "Recommended",
            reason: input.notes.trim(),
            active: true,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          });
        }
      }
      await tx.insert(backgroundJobs).values({
        id: jobId,
        organisationId,
        module: "recruitment",
        jobType: "candidate-cv-extraction",
        entityType: "candidate-cv",
        entityId: cvRecordId,
        status: "Queued",
        payload: { cvRecordId, documentId, applicationId, preparationRunId },
        maxAttempts: 5,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      for (const recipient of recipients) {
        await tx.insert(notifications).values({
          organisationId,
          recipientUserId: recipient.userId,
          type: "Employee Referral",
          title: "Employee referral received",
          message: `${person.employee.preferredName} recommended ${input.candidate.firstName.trim()} ${input.candidate.lastName.trim()}${vacancy ? ` for ${vacancy.title}` : " for future opportunities"}.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `employee-referral-${recommendationId}`,
          link: {
            entityType: "candidate-recommendation",
            entityId: recommendationId,
            path: `/staff/candidates/${candidateId}`,
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
      }
      await tx.insert(notifications).values({
        organisationId,
        recipientUserId: actor.userId,
        type: "Referral Submitted",
        title: "Your referral was submitted",
        message: `${input.candidate.firstName.trim()} ${input.candidate.lastName.trim()} was sent to HR for review.`,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `employee-referral-confirmation-${recommendationId}`,
        link: {
          entityType: "candidate-recommendation",
          entityId: recommendationId,
          path: "/staff/opportunities",
        },
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [actor.activeRole],
        action: "create",
        module: "recruitment",
        entityType: "candidate-recommendation",
        entityId: recommendationId,
        afterSummary: {
          candidateId,
          vacancyId: vacancy?.id,
          source: "Employee Referral",
          candidateAware: true,
        },
        reason: "Employee submitted a candidate referral",
        riskLevel: "High",
      });
    });
  } catch (error) {
    await deleteObjectFile(organisationId, documentId, actor, "Employee referral failed").catch(
      () => undefined,
    );
    throw error;
  }
  return {
    recommendationId,
    candidateId,
    ...(applicationId ? { applicationId } : {}),
    jobId,
  };
}
