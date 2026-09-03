import "@tanstack/react-start/server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type {
  CandidateStage,
  ContactChannel,
  ContactOutcome,
  MaritalStatus,
  RecommenderType,
  VisaStatus,
} from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { encryptSensitiveJson } from "../encryption.server.ts";
import { employees, users } from "../schema/employee.ts";
import { projects } from "../schema/master-data.ts";
import {
  candidateApplications,
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
  interviews,
  jobOffers,
  vacancies,
} from "../schema/recruitment.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function assertRecruiter(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage candidates.");
  }
}

async function candidateInOrganisation(
  organisationId: string,
  candidateId: string,
  tx = getDatabaseClient(),
) {
  const [candidate] = await tx
    .select()
    .from(candidates)
    .where(and(eq(candidates.organisationId, organisationId), eq(candidates.id, candidateId)))
    .limit(1);
  if (!candidate || candidate.archivedAt) throw new Error("Candidate not found.");
  return candidate;
}

export interface CandidateDetailsInput {
  email: string;
  phone: string;
  currentTitle?: string | undefined;
  currentCompany?: string | undefined;
  yearsOfExperience: number;
  nationality?: string | undefined;
  location: string;
  projectId?: string | undefined;
  projectName?: string | undefined;
  projectType?: string | undefined;
  shortlistStatus?: string | undefined;
  trackerStatus?: string | undefined;
  visaStatus?: VisaStatus | undefined;
  maritalStatus?: MaritalStatus | undefined;
  noticePeriod?: string | undefined;
  currentSalary?: string | undefined;
  expectedSalary?: string | undefined;
  acceptedSalary?: string | undefined;
  interviewDate?: string | undefined;
  remarks?: string | undefined;
}

export async function updateCandidateDetailsInDatabase(
  organisationId: string,
  candidateId: string,
  input: CandidateDetailsInput,
  actor: AuditActorContext,
  reason: string,
): Promise<void> {
  assertRecruiter(actor);
  if (!actor.userId) throw new Error("A verified VIA user is required.");
  const email = input.email.trim().toLowerCase();
  const phoneDigits = input.phone.replace(/\D/g, "").replace(/^00/, "");
  if (!phoneDigits) throw new Error("Enter a valid contact number.");
  const phone = `+${phoneDigits}`;
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const before = await candidateInOrganisation(organisationId, candidateId, tx);
    const [conflict] = await tx
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(
          eq(candidates.organisationId, organisationId),
          sql`${candidates.id} <> ${candidateId}`,
          sql`(${candidates.email} = ${email} OR ${candidates.phone} = ${phone})`,
        ),
      )
      .limit(1);
    if (conflict)
      throw new Error("Another Candidate Pool profile already uses this email or phone.");
    if (input.projectId) {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organisationId, organisationId),
            eq(projects.id, input.projectId),
            eq(projects.isActive, true),
          ),
        )
        .limit(1);
      if (!project) throw new Error("Select an active project.");
    }
    await tx
      .update(candidates)
      .set({
        email,
        phone,
        currentTitle: input.currentTitle?.trim() || null,
        currentCompany: input.currentCompany?.trim() || null,
        yearsOfExperience: input.yearsOfExperience,
        nationality: input.nationality?.trim() || null,
        location: input.location.trim(),
        projectId: input.projectId || null,
        projectName: input.projectName?.trim() || null,
        projectType: input.projectType?.trim() || null,
        shortlistStatus: input.shortlistStatus?.trim() || null,
        trackerStatus: input.trackerStatus?.trim() || null,
        visaStatus: input.visaStatus || null,
        maritalStatus: input.maritalStatus || null,
        noticePeriod: input.noticePeriod?.trim() || null,
        currentSalaryEncrypted: input.currentSalary
          ? encryptSensitiveJson(input.currentSalary.trim())
          : null,
        expectedSalaryEncrypted: input.expectedSalary
          ? encryptSensitiveJson(input.expectedSalary.trim())
          : null,
        acceptedSalaryEncrypted: input.acceptedSalary
          ? encryptSensitiveJson(input.acceptedSalary.trim())
          : null,
        interviewDate: input.interviewDate || null,
        remarks: input.remarks?.trim() || null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, candidateId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update",
      module: "recruitment",
      entityType: "candidate",
      entityId: candidateId,
      beforeSummary: {
        email: before.email,
        phone: before.phone,
        currentTitle: before.currentTitle,
        currentCompany: before.currentCompany,
        location: before.location,
        projectId: before.projectId,
        salaryDetails: "Restricted",
      },
      afterSummary: {
        email,
        phone,
        currentTitle: input.currentTitle,
        currentCompany: input.currentCompany,
        location: input.location,
        projectId: input.projectId,
        salaryDetails: "Restricted",
      },
      reason,
      riskLevel: "High",
    });
  });
}

export async function mergeCandidatesInDatabase(
  organisationId: string,
  primaryId: string,
  duplicateId: string,
  actor: AuditActorContext,
  reason: string,
): Promise<void> {
  assertRecruiter(actor);
  if (!actor.userId) throw new Error("A verified VIA user is required.");
  if (primaryId === duplicateId) throw new Error("A candidate cannot be merged into itself.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM candidates WHERE id IN (${primaryId}, ${duplicateId}) FOR UPDATE`,
    );
    const primary = await candidateInOrganisation(organisationId, primaryId, tx);
    const duplicate = await candidateInOrganisation(organisationId, duplicateId, tx);
    if (primary.mergedIntoId || duplicate.mergedIntoId) {
      throw new Error("A candidate already involved in another merge cannot be merged again.");
    }
    const primaryApplications = await tx
      .select({ id: candidateApplications.id, vacancyId: candidateApplications.vacancyId })
      .from(candidateApplications)
      .where(eq(candidateApplications.candidateId, primaryId));
    const primaryVacancies = new Set(primaryApplications.map((record) => record.vacancyId));
    const duplicateApplications = await tx
      .select({ id: candidateApplications.id, vacancyId: candidateApplications.vacancyId })
      .from(candidateApplications)
      .where(eq(candidateApplications.candidateId, duplicateId));
    for (const application of duplicateApplications) {
      if (primaryVacancies.has(application.vacancyId)) {
        await tx
          .update(candidateApplications)
          .set({
            archivedAt: new Date(),
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidateApplications.recordVersion} + 1`,
          })
          .where(eq(candidateApplications.id, application.id));
      } else {
        await tx
          .update(candidateApplications)
          .set({ candidateId: primaryId, updatedAt: new Date(), updatedBy: actor.userId })
          .where(eq(candidateApplications.id, application.id));
      }
    }
    for (const table of [
      candidateContacts,
      candidateRecommendations,
      candidateCvRecords,
      candidatePreparationRuns,
      candidateAssessmentInclusions,
      candidateScoreRuns,
      candidateInterviewRecommendations,
      interviews,
      interviewDispositions,
      jobOffers,
    ] as const) {
      await tx
        .update(table)
        .set({ candidateId: primaryId, updatedAt: new Date(), updatedBy: actor.userId })
        .where(eq(table.candidateId, duplicateId));
    }
    await tx
      .update(hiringDecisions)
      .set({
        systemRecommendedCandidateId: sql`CASE WHEN ${hiringDecisions.systemRecommendedCandidateId} = ${duplicateId} THEN ${primaryId}::uuid ELSE ${hiringDecisions.systemRecommendedCandidateId} END`,
        finalSelectedCandidateId: sql`CASE WHEN ${hiringDecisions.finalSelectedCandidateId} = ${duplicateId} THEN ${primaryId}::uuid ELSE ${hiringDecisions.finalSelectedCandidateId} END`,
        updatedAt: new Date(),
        updatedBy: actor.userId,
      })
      .where(
        sql`${hiringDecisions.systemRecommendedCandidateId} = ${duplicateId} OR ${hiringDecisions.finalSelectedCandidateId} = ${duplicateId}`,
      );
    const primaryChanges = {
      ...(!primary.hrOwnerId && duplicate.hrOwnerId ? { hrOwnerId: duplicate.hrOwnerId } : {}),
      ...(!primary.linkedInUrl && duplicate.linkedInUrl
        ? { linkedInUrl: duplicate.linkedInUrl }
        : {}),
      ...(!primary.cvFileId && duplicate.cvFileId ? { cvFileId: duplicate.cvFileId } : {}),
      ...(!primary.latestCvRecordId && duplicate.latestCvRecordId
        ? { latestCvRecordId: duplicate.latestCvRecordId }
        : {}),
      updatedAt: new Date(),
      updatedBy: actor.userId,
      recordVersion: sql`${candidates.recordVersion} + 1`,
    };
    await tx.update(candidates).set(primaryChanges).where(eq(candidates.id, primaryId));
    await tx
      .update(candidates)
      .set({
        stage: "Archived",
        mergedIntoId: primaryId,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, duplicateId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "merge",
      module: "recruitment",
      entityType: "candidate",
      entityId: duplicateId,
      beforeSummary: { duplicateId, primaryId },
      afterSummary: { mergedIntoId: primaryId },
      reason,
      riskLevel: "Critical",
    });
  });
}

export async function updateCandidateStageInDatabase(
  organisationId: string,
  candidateId: string,
  stage: CandidateStage,
  actor: AuditActorContext,
  reason: string,
): Promise<void> {
  assertRecruiter(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const before = await candidateInOrganisation(organisationId, candidateId, tx);
    if (before.stage === stage) return;
    await tx
      .update(candidates)
      .set({
        stage,
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, candidateId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "change-stage",
      module: "recruitment",
      entityType: "candidate",
      entityId: candidateId,
      beforeSummary: { stage: before.stage },
      afterSummary: { stage },
      reason,
      riskLevel: "Medium",
    });
  });
}

export async function reassignCandidateOwnerInDatabase(
  organisationId: string,
  candidateId: string,
  ownerUserId: string,
  actor: AuditActorContext,
  reason: string,
): Promise<void> {
  assertRecruiter(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const before = await candidateInOrganisation(organisationId, candidateId, tx);
    const [owner] = await tx
      .select({ employeeId: users.employeeId })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.id, ownerUserId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    if (!owner?.employeeId) throw new Error("Select an active VIA user as the HR owner.");
    await tx
      .update(candidates)
      .set({
        hrOwnerId: owner.employeeId,
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, candidateId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "reassign-owner",
      module: "recruitment",
      entityType: "candidate",
      entityId: candidateId,
      beforeSummary: { hrOwnerId: before.hrOwnerId },
      afterSummary: { hrOwnerId: owner.employeeId },
      reason,
      riskLevel: "High",
    });
  });
}

export async function logCandidateContactInDatabase(
  organisationId: string,
  input: {
    candidateId: string;
    channel: ContactChannel;
    date: string;
    vacancyId?: string | undefined;
    outcome: ContactOutcome;
    notes: string;
    nextFollowUpDate?: string | undefined;
  },
  actor: AuditActorContext,
): Promise<string> {
  assertRecruiter(actor);
  if (!actor.userId) throw new Error("A verified VIA user is required.");
  const actorUserId = actor.userId;
  const contactDate = new Date(`${input.date}T00:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    Number.isNaN(contactDate.getTime()) ||
    contactDate.toISOString().slice(0, 10) !== input.date ||
    input.date > today
  )
    throw new Error("Enter a valid contact date that is not in the future.");
  if (input.nextFollowUpDate) {
    const followUp = new Date(`${input.nextFollowUpDate}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.nextFollowUpDate) ||
      Number.isNaN(followUp.getTime()) ||
      followUp.toISOString().slice(0, 10) !== input.nextFollowUpDate ||
      input.nextFollowUpDate < input.date
    )
      throw new Error("The follow-up date cannot be before the contact date.");
  }
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const candidate = await candidateInOrganisation(organisationId, input.candidateId, tx);
    if (candidate.doNotContact && input.outcome !== "Do Not Contact") {
      throw new Error("This candidate is marked Do Not Contact.");
    }
    if (input.vacancyId) {
      const [vacancy] = await tx
        .select({ id: vacancies.id })
        .from(vacancies)
        .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, input.vacancyId)))
        .limit(1);
      if (!vacancy) throw new Error("Select a valid vacancy.");
    }
    const [contact] = await tx
      .insert(candidateContacts)
      .values({
        organisationId,
        candidateId: input.candidateId,
        channel: input.channel,
        date: input.date,
        contactedByUserId: actorUserId,
        ...(input.vacancyId ? { vacancyId: input.vacancyId } : {}),
        outcome: input.outcome,
        notes: input.notes.trim(),
        ...(input.nextFollowUpDate ? { nextFollowUpDate: input.nextFollowUpDate } : {}),
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: candidateContacts.id });
    if (!contact) throw new Error("The contact could not be recorded.");
    const isLatestContact =
      !candidate.lastContactAt ||
      contactDate.getTime() >= new Date(candidate.lastContactAt).getTime();
    await tx
      .update(candidates)
      .set({
        ...(isLatestContact
          ? {
              lastContactAt: contactDate.toISOString(),
              followUpStatus: input.nextFollowUpDate
                ? `Follow up ${input.nextFollowUpDate}`
                : input.outcome,
            }
          : {}),
        doNotContact: input.outcome === "Do Not Contact" ? true : candidate.doNotContact,
        updatedAt: new Date(),
        updatedBy: actorUserId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, input.candidateId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "record-contact",
      module: "recruitment",
      entityType: "candidate-contact",
      entityId: contact.id,
      afterSummary: { ...input, notes: input.notes.trim() },
      reason: "Recorded candidate contact activity",
      riskLevel: "Medium",
    });
    if (input.nextFollowUpDate) {
      const ownerEmployeeId = candidate.hrOwnerId ?? actor.employeeId;
      if (ownerEmployeeId) {
        const [recipient] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(eq(users.organisationId, organisationId), eq(users.employeeId, ownerEmployeeId)),
          )
          .limit(1);
        if (recipient) {
          await tx.insert(notifications).values({
            organisationId,
            recipientUserId: recipient.id,
            type: "Candidate Follow-up",
            title: "Candidate follow-up due",
            message: `Follow up with ${candidate.firstName} ${candidate.lastName}.`,
            priority: "Normal",
            status: "Unread",
            dueAt: `${input.nextFollowUpDate}T09:00:00Z`,
            deduplicationKey: `candidate-follow-up-${contact.id}`,
            link: { entityType: "candidate", entityId: candidate.id },
            createdBy: actorUserId,
            updatedBy: actorUserId,
          });
        }
      }
    }
    return contact.id;
  });
}

export async function addCandidateRecommendationInDatabase(
  organisationId: string,
  input: {
    candidateId: string;
    vacancyId?: string | undefined;
    recommenderType: RecommenderType;
    recommenderName: string;
    recommenderCompany?: string | undefined;
    recommenderPosition?: string | undefined;
    recommenderEmail: string;
    recommenderPhone?: string | undefined;
    relationship?: string | undefined;
    date: string;
    notes: string;
    commercialTerms?: string | undefined;
  },
  actor: AuditActorContext,
): Promise<string> {
  assertRecruiter(actor);
  if (!actor.userId || !actor.employeeId) throw new Error("A linked HR employee is required.");
  if (!input.recommenderEmail.trim() && !input.recommenderPhone?.trim()) {
    throw new Error("Enter the recommender's email or phone number.");
  }
  const actorUserId = actor.userId;
  const actorEmployeeId = actor.employeeId;
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await candidateInOrganisation(organisationId, input.candidateId, tx);
    const [owner] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, actorEmployeeId)))
      .limit(1);
    if (!owner) throw new Error("The HR owner is not linked to an employee record.");
    const [recommendation] = await tx
      .insert(candidateRecommendations)
      .values({
        organisationId,
        candidateId: input.candidateId,
        ...(input.vacancyId ? { vacancyId: input.vacancyId } : {}),
        recommenderType: input.recommenderType,
        recommenderName: input.recommenderName.trim(),
        ...(input.recommenderCompany ? { recommenderCompany: input.recommenderCompany } : {}),
        ...(input.recommenderPosition ? { recommenderPosition: input.recommenderPosition } : {}),
        recommenderEmail: input.recommenderEmail.trim().toLowerCase(),
        ...(input.recommenderPhone ? { recommenderPhone: input.recommenderPhone } : {}),
        ...(input.relationship ? { relationship: input.relationship } : {}),
        date: input.date,
        notes: input.notes.trim(),
        hrOwnerId: owner.id,
        ...(input.commercialTerms ? { commercialTerms: input.commercialTerms } : {}),
        sourceOutcome: "In Progress",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning({ id: candidateRecommendations.id });
    if (!recommendation) throw new Error("The recommendation could not be saved.");
    if (input.vacancyId) {
      const [application] = await tx
        .select({ id: candidateApplications.id })
        .from(candidateApplications)
        .where(
          and(
            eq(candidateApplications.organisationId, organisationId),
            eq(candidateApplications.candidateId, input.candidateId),
            eq(candidateApplications.vacancyId, input.vacancyId),
          ),
        )
        .limit(1);
      const [cv] = await tx
        .select({ id: candidateCvRecords.id })
        .from(candidateCvRecords)
        .where(
          and(
            eq(candidateCvRecords.organisationId, organisationId),
            eq(candidateCvRecords.candidateId, input.candidateId),
            eq(candidateCvRecords.vacancyId, input.vacancyId),
          ),
        )
        .orderBy(desc(candidateCvRecords.createdAt))
        .limit(1);
      if (!application || !cv)
        throw new Error("Create the candidate's vacancy application and prepared CV first.");
      const [existingInclusion] = await tx
        .select({ id: candidateAssessmentInclusions.id })
        .from(candidateAssessmentInclusions)
        .where(
          and(
            eq(candidateAssessmentInclusions.organisationId, organisationId),
            eq(candidateAssessmentInclusions.vacancyId, input.vacancyId),
            eq(candidateAssessmentInclusions.candidateId, input.candidateId),
            eq(candidateAssessmentInclusions.active, true),
          ),
        )
        .limit(1);
      if (existingInclusion)
        await tx
          .update(candidateAssessmentInclusions)
          .set({
            source: "Recommended",
            reason: input.notes.trim() || `Recommended by ${input.recommenderName.trim()}`,
            cvRecordId: cv.id,
            updatedAt: new Date(),
            updatedBy: actorUserId,
            recordVersion: sql`${candidateAssessmentInclusions.recordVersion} + 1`,
          })
          .where(eq(candidateAssessmentInclusions.id, existingInclusion.id));
      else
        await tx.insert(candidateAssessmentInclusions).values({
          organisationId,
          vacancyId: input.vacancyId,
          candidateId: input.candidateId,
          cvRecordId: cv.id,
          source: "Recommended",
          reason: input.notes.trim() || `Recommended by ${input.recommenderName.trim()}`,
          active: true,
          createdBy: actorUserId,
          updatedBy: actorUserId,
        });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId,
      actorEmployeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "create",
      module: "recruitment",
      entityType: "candidate-recommendation",
      entityId: recommendation.id,
      afterSummary: { ...input, commercialTerms: input.commercialTerms ? "Restricted" : undefined },
      reason: "Recorded candidate recommendation source",
      riskLevel: "High",
    });
    return recommendation.id;
  });
}

export async function exportCandidatesFromDatabase(
  organisationId: string,
  candidateIds: string[],
  actor: AuditActorContext,
  reason: string,
): Promise<string> {
  assertRecruiter(actor);
  if (!actor.userId) throw new Error("A verified VIA user is required.");
  const db = getDatabaseClient();
  const rows = candidateIds.length
    ? await db
        .select({
          id: candidates.id,
          firstName: candidates.firstName,
          lastName: candidates.lastName,
          email: candidates.email,
          phone: candidates.phone,
          location: candidates.location,
          currentCompany: candidates.currentCompany,
          currentTitle: candidates.currentTitle,
          yearsOfExperience: candidates.yearsOfExperience,
          stage: candidates.stage,
          source: candidates.source,
        })
        .from(candidates)
        .where(
          and(eq(candidates.organisationId, organisationId), inArray(candidates.id, candidateIds)),
        )
    : [];
  const escape = (value: unknown) => {
    const raw = String(value ?? "");
    const safe = /^[=+@]/.test(raw) || /^-[A-Za-z]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const headers = [
    "Name",
    "Email",
    "Phone",
    "Location",
    "Company",
    "Current title",
    "Experience",
    "Stage",
    "Source",
  ];
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((row) =>
      [
        `${row.firstName} ${row.lastName}`,
        row.email,
        row.phone,
        row.location,
        row.currentCompany,
        row.currentTitle,
        row.yearsOfExperience,
        row.stage,
        row.source,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\r\n");
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [actor.activeRole],
    action: "export",
    module: "recruitment",
    entityType: "candidate",
    entityId: actor.userId,
    afterSummary: { candidateIds: rows.map((row) => row.id), fields: headers },
    reason,
    riskLevel: "High",
  });
  return csv;
}
