import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, eq, or, sql } from "drizzle-orm";

import { encryptSensitiveJson } from "../encryption.server.ts";
import { getDatabaseClient } from "../client.ts";
import { deleteObjectFile, saveObjectFile } from "../object-storage.server.ts";
import {
  candidateApplications,
  candidateCvRecords,
  candidatePreparationRuns,
  candidates,
  recruitmentDocuments,
  vacancies,
} from "../schema/recruitment.ts";
import { users } from "../schema/employee.ts";
import { auditEvents, backgroundJobs, notifications } from "../schema/system.ts";

export interface PublicApplicationInput {
  vacancyId: string;
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
  consent: boolean;
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
}

const publicActor = {
  displayName: "Careers Portal Applicant",
  activeRole: "Applicant",
  roles: ["Applicant"],
};

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "").replace(/^00/, "");
  return digits ? `+${digits}` : "";
}

function referenceId(): string {
  return `APP-${new Date().getUTCFullYear().toString().slice(-2)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function submitPublicApplicationToDatabase(
  organisationId: string,
  input: PublicApplicationInput,
): Promise<{ referenceId: string; candidateId: string; applicationId: string; jobId: string }> {
  const db = getDatabaseClient();
  const email = input.email.trim().toLowerCase();
  const phone = normalizePhone(input.phone);
  if (!phone) throw new Error("Enter a valid phone number.");
  const [vacancy] = await db
    .select()
    .from(vacancies)
    .where(
      and(
        eq(vacancies.organisationId, organisationId),
        eq(vacancies.id, input.vacancyId),
        eq(vacancies.status, "Open"),
        sql`${vacancies.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!vacancy) throw new Error("This vacancy is no longer open for applications.");

  const identityMatches = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(
      and(
        eq(candidates.organisationId, organisationId),
        or(eq(candidates.email, email), eq(candidates.phone, phone)),
        sql`${candidates.archivedAt} IS NULL`,
      ),
    );
  const distinctCandidateIds = [...new Set(identityMatches.map((match) => match.id))];
  if (distinctCandidateIds.length > 1) {
    throw new Error("Your details match more than one existing profile. Please contact VIA HR.");
  }
  const existingCandidateId = distinctCandidateIds[0];
  if (existingCandidateId) {
    const [duplicate] = await db
      .select({ id: candidateApplications.id })
      .from(candidateApplications)
      .where(
        and(
          eq(candidateApplications.organisationId, organisationId),
          eq(candidateApplications.candidateId, existingCandidateId),
          eq(candidateApplications.vacancyId, vacancy.id),
          sql`${candidateApplications.archivedAt} IS NULL`,
        ),
      )
      .limit(1);
    if (duplicate) throw new Error("DUPLICATE_APPLICATION");
  }

  const candidateId = existingCandidateId ?? randomUUID();
  const applicationId = randomUUID();
  const cvRecordId = randomUUID();
  const documentId = randomUUID();
  const preparationRunId = randomUUID();
  const jobId = randomUUID();
  const submissionReference = referenceId();
  const createdBy = applicationId;
  await saveObjectFile({
    id: documentId,
    organisationId,
    bytes: input.fileBytes,
    name: input.fileName,
    mimeType: input.mimeType,
    owner: { entityType: "candidate-cv", entityId: cvRecordId },
    actor: { ...publicActor, activeRole: "Applicant" },
  });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(recruitmentDocuments).values({
        id: documentId,
        organisationId,
        name: input.fileName,
        mimeType: input.mimeType,
        size: input.fileBytes.byteLength,
        checksum: sql`(SELECT checksum FROM file_metadata WHERE id = ${documentId})`,
        ownerEntityType: "candidate-cv",
        ownerEntityId: cvRecordId,
        createdBy,
        updatedBy: createdBy,
      });

      if (existingCandidateId) {
        await tx
          .update(candidates)
          .set({
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            email,
            phone,
            nationality: input.nationality?.trim() || null,
            location: input.location.trim(),
            currentCompany: input.currentCompany?.trim() || null,
            currentTitle: input.currentTitle?.trim() || null,
            yearsOfExperience: input.yearsOfExperience,
            stage: "Applied",
            source: "Careers Portal",
            noticePeriod: input.noticePeriod.trim(),
            expectedSalaryEncrypted: input.salaryExpectation
              ? encryptSensitiveJson(input.salaryExpectation.trim())
              : null,
            cvFileId: documentId,
            consentStatus: input.consent ? "Confirmed" : "Privacy Notice Sent",
            consentUpdatedAt: new Date().toISOString(),
            updatedAt: new Date(),
            updatedBy: createdBy,
            recordVersion: sql`${candidates.recordVersion} + 1`,
          })
          .where(eq(candidates.id, candidateId));
      } else {
        await tx.insert(candidates).values({
          id: candidateId,
          organisationId,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email,
          phone,
          nationality: input.nationality?.trim() || null,
          location: input.location.trim(),
          currentCompany: input.currentCompany?.trim() || null,
          currentTitle: input.currentTitle?.trim() || null,
          yearsOfExperience: input.yearsOfExperience,
          stage: "Applied",
          source: "Careers Portal",
          noticePeriod: input.noticePeriod.trim(),
          expectedSalaryEncrypted: input.salaryExpectation
            ? encryptSensitiveJson(input.salaryExpectation.trim())
            : null,
          cvFileId: documentId,
          consentStatus: input.consent ? "Confirmed" : "Privacy Notice Sent",
          consentUpdatedAt: new Date().toISOString(),
          createdBy,
          updatedBy: createdBy,
        });
      }

      await tx.insert(candidateApplications).values({
        id: applicationId,
        organisationId,
        referenceId: submissionReference,
        candidateId,
        vacancyId: vacancy.id,
        status: "New",
        cvFileId: documentId,
        coverNote: input.coverNote?.trim() || null,
        noticePeriod: input.noticePeriod.trim(),
        salaryExpectationEncrypted: input.salaryExpectation
          ? encryptSensitiveJson(input.salaryExpectation.trim())
          : null,
        screeningAnswers: input.screeningAnswers,
        source: "Careers Portal",
        consentGiven: input.consent,
        consentedAt: new Date().toISOString(),
        preparationStatus: "Queued",
        createdBy,
        updatedBy: createdBy,
      });
      await tx.insert(candidateCvRecords).values({
        id: cvRecordId,
        organisationId,
        candidateId,
        applicationId,
        vacancyId: vacancy.id,
        fileId: documentId,
        originalFileName: input.fileName,
        source: "Careers Portal",
        receivedAt: new Date().toISOString(),
        processingStatus: "Uploaded",
        extractionMethod: "Candidate Provided",
        consentStatus: input.consent ? "Confirmed" : "Privacy Notice Sent",
        createdBy,
        updatedBy: createdBy,
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
        cvChecksum: sql`(SELECT checksum FROM file_metadata WHERE id = ${documentId})`,
        status: "Queued",
        documentRoute: "Unknown",
        preparationMethod: "Python Service",
        createdBy,
        updatedBy: createdBy,
      });
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
        createdBy,
        updatedBy: createdBy,
      });
      await tx
        .update(candidates)
        .set({ latestCvRecordId: cvRecordId })
        .where(eq(candidates.id, candidateId));
      await tx
        .update(candidateApplications)
        .set({ preparationRunId })
        .where(eq(candidateApplications.id, applicationId));
      await tx
        .update(vacancies)
        .set({
          applicantCount: sql`${vacancies.applicantCount} + 1`,
          updatedAt: new Date(),
          updatedBy: createdBy,
        })
        .where(eq(vacancies.id, vacancy.id));

      const recipientEmployeeId = vacancy.assignedOwnerId ?? vacancy.hiringManagerId;
      if (recipientEmployeeId) {
        const [recipient] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.employeeId, recipientEmployeeId),
            ),
          )
          .limit(1);
        if (recipient) {
          await tx.insert(notifications).values({
            organisationId,
            recipientUserId: recipient.id,
            type: "New Application",
            title: "New application received",
            message: `${input.firstName.trim()} ${input.lastName.trim()} applied for ${vacancy.title}.`,
            priority: "Normal",
            status: "Unread",
            deduplicationKey: `application-${applicationId}`,
            link: { entityType: "candidate-application", entityId: applicationId },
            createdBy,
            updatedBy: createdBy,
          });
        }
      }
      await tx.insert(auditEvents).values({
        organisationId,
        actorDisplayName: publicActor.displayName,
        activeRole: publicActor.activeRole,
        actorRoles: publicActor.roles,
        action: "submit",
        module: "recruitment",
        entityType: "candidate-application",
        entityId: applicationId,
        afterSummary: {
          referenceId: submissionReference,
          vacancyId: vacancy.id,
          candidateId,
          source: "Careers Portal",
          cvFileId: documentId,
          preparationStatus: "Queued",
        },
        reason: "Application submitted through the public careers portal",
        riskLevel: "High",
      });
    });
  } catch (error) {
    await deleteObjectFile(
      organisationId,
      documentId,
      { ...publicActor, activeRole: "Applicant" },
      "Application transaction did not complete; removed unattached CV",
    ).catch(() => undefined);
    throw error;
  }
  return { referenceId: submissionReference, candidateId, applicationId, jobId };
}
