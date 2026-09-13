import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { assertIndependentOfferApprover } from "../../auth/offer-approval.ts";
import {
  validateManualOfferDelivery,
  type ManualOfferDelivery,
} from "../../auth/offer-delivery.ts";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { JobOfferStatus } from "../../data/types.ts";
import type { OnboardingTemplateTask } from "../../data/onboarding-types.ts";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import {
  departments,
  employmentTypes,
  grades,
  locations,
  positions,
} from "../schema/master-data.ts";
import {
  onboardingCases,
  onboardingTasks,
  onboardingTemplates,
} from "../schema/onboarding-offboarding.ts";
import {
  candidateApplications,
  candidateScoreRuns,
  candidates,
  hiringDecisions,
  interviewPanelists,
  interviewDispositions,
  interviewScorecards,
  interviews,
  interviewTemplates,
  jobOffers,
  shortlistSnapshots,
  vacancies,
  vacancyVersions,
} from "../schema/recruitment.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import { ensureCoreHrLifecycleTemplates } from "./core-hr-lifecycle.repository.server.ts";

type Database = ReturnType<typeof getDatabaseClient>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function recruiter(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can manage hiring decisions and offers.");
  if (!actor.userId || !actor.employeeId) throw new Error("A verified VIA employee is required.");
}

async function requireOfferManager(
  tx: Transaction | Database,
  org: string,
  userId: string,
  candidateId: string,
) {
  const [manager] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      employees,
      and(eq(employees.id, users.employeeId), eq(employees.organisationId, org)),
    )
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.id, userId),
        eq(users.status, "Active"),
        eq(employees.status, "Active"),
        sql`${users.archivedAt} IS NULL`,
        sql`${employees.archivedAt} IS NULL`,
        sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.organisation_id=${org} AND ur.user_id=${users.id} AND r.code='Line Manager')`,
        sql`NOT EXISTS (SELECT 1 FROM candidates c WHERE c.organisation_id=${org} AND c.id=${candidateId}
        AND (c.converted_to_employee_id=${employees.id} OR lower(c.email)=lower(${users.workspaceEmail})))`,
      ),
    )
    .limit(1);
  if (!manager) throw new Error("Select an active Line Manager who is not the candidate.");
}

async function notifyOfferReview(
  tx: Transaction,
  org: string,
  offerId: string,
  recipient: string,
  actor: AuditActorContext,
  title: string,
  version: number,
) {
  await tx
    .insert(notifications)
    .values({
      organisationId: org,
      recipientUserId: recipient,
      type: "offer-approval",
      title,
      message: "Open Offers to review the current offer and decision.",
      priority: "High",
      status: "Unread",
      deduplicationKey: `offer-${offerId}-${version}-${recipient}`,
      link: { entityType: "offer", entityId: offerId, path: "/staff/offers" },
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    })
    .onConflictDoNothing();
}

export async function listOfferManagersInDatabase(org: string, actor: AuditActorContext) {
  recruiter(actor);
  return getDatabaseClient()
    .select({ id: users.id, name: users.displayName, email: users.workspaceEmail })
    .from(users)
    .innerJoin(
      employees,
      and(eq(employees.id, users.employeeId), eq(employees.organisationId, org)),
    )
    .where(
      and(
        eq(users.organisationId, org),
        eq(users.status, "Active"),
        eq(employees.status, "Active"),
        sql`${users.archivedAt} IS NULL AND ${employees.archivedAt} IS NULL`,
        sql`${users.id} <> ${actor.userId}`,
        sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.organisation_id=${org} AND ur.user_id=${users.id} AND r.code='Line Manager')`,
      ),
    );
}

export async function listAssignedOfferReviewsInDatabase(org: string, actor: AuditActorContext) {
  if (!actor.userId || !actor.employeeId) throw new Error("A verified employee is required.");
  const rows = await getDatabaseClient()
    .select({ offer: jobOffers, firstName: candidates.firstName, lastName: candidates.lastName })
    .from(jobOffers)
    .innerJoin(
      candidates,
      and(eq(candidates.id, jobOffers.candidateId), eq(candidates.organisationId, org)),
    )
    .where(
      and(
        eq(jobOffers.organisationId, org),
        eq(jobOffers.approverUserId, actor.userId),
        eq(jobOffers.status, "Pending Approval"),
        sql`${jobOffers.archivedAt} IS NULL`,
        sql`${jobOffers.createdBy} <> ${actor.userId}`,
        sql`${jobOffers.approvalRequestedBy} <> ${actor.userId}`,
      ),
    );
  const result = [];
  for (const { offer, firstName, lastName } of rows) {
    try {
      assertIndependentOfferApprover(offer, actor.userId);
      await requireOfferManager(getDatabaseClient(), org, actor.userId, offer.candidateId);
    } catch {
      continue;
    }
    const interviewSummary = await getDatabaseClient()
      .select({
        stage: interviews.stageName,
        status: interviews.status,
        outcome: interviewDispositions.outcome,
        recommendation: interviewDispositions.reason,
      })
      .from(interviews)
      .leftJoin(
        interviewDispositions,
        and(
          eq(interviewDispositions.interviewId, interviews.id),
          eq(interviewDispositions.organisationId, org),
          sql`${interviewDispositions.archivedAt} IS NULL`,
        ),
      )
      .where(
        and(
          eq(interviews.organisationId, org),
          eq(interviews.candidateId, offer.candidateId),
          eq(interviews.vacancyId, offer.vacancyId),
          sql`${interviews.archivedAt} IS NULL`,
        ),
      );
    result.push({
      id: offer.id,
      recordVersion: offer.recordVersion,
      candidateName: `${firstName} ${lastName}`,
      interviewSummary,
      position: offer.position,
      grade: offer.grade,
      startDate: offer.startDate,
      location: offer.location,
      salary: decryptSensitiveJson<number>(offer.salaryEncrypted),
      currency: decryptSensitiveJson<string>(offer.currencyEncrypted),
      allowances: decryptSensitiveJson<string>(offer.allowancesEncrypted),
      benefits: decryptSensitiveJson<string>(offer.benefitsEncrypted),
      probation: offer.probation,
      conditions: offer.conditions,
    });
  }
  return result;
}

export async function reviewAssignedOfferInDatabase(
  org: string,
  offerId: string,
  expectedVersion: number,
  decision: "approve" | "return",
  comment: string,
  actor: AuditActorContext,
) {
  if (!actor.userId || !actor.employeeId) throw new Error("A verified employee is required.");
  const cleanReason = reason(comment);
  await getDatabaseClient().transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(jobOffers)
      .where(
        and(
          eq(jobOffers.organisationId, org),
          eq(jobOffers.id, offerId),
          sql`${jobOffers.archivedAt} IS NULL`,
        ),
      )
      .for("update")
      .limit(1);
    if (!offer || offer.status !== "Pending Approval" || offer.recordVersion !== expectedVersion)
      throw new Error("This offer changed or has already been reviewed. Refresh and try again.");
    assertIndependentOfferApprover(offer, actor.userId!);
    await requireOfferManager(tx, org, actor.userId!, offer.candidateId);
    const status = decision === "approve" ? "Approved" : "Draft";
    await tx
      .update(jobOffers)
      .set({
        status,
        approvedBy: decision === "approve" ? actor.userId : null,
        history: [
          ...(offer.history as unknown[]),
          {
            date: new Date().toISOString(),
            actor: actor.displayName,
            action: decision === "approve" ? "Manager approved offer" : "Manager returned offer",
            details: cleanReason,
          },
        ],
        updatedBy: actor.userId,
        updatedAt: new Date(),
        recordVersion: sql`${jobOffers.recordVersion}+1`,
      })
      .where(eq(jobOffers.id, offer.id));
    await audit(tx, org, actor, {
      action: `manager-${decision}`,
      entityType: "offer",
      entityId: offer.id,
      reason: cleanReason,
      before: { status: offer.status, recordVersion: offer.recordVersion },
      after: { status },
      risk: "Critical",
    });
    await notifyOfferReview(
      tx,
      org,
      offer.id,
      offer.approvalRequestedBy ?? offer.createdBy,
      actor,
      decision === "approve" ? "Offer approved by manager" : "Offer returned for changes",
      offer.recordVersion + 1,
    );
  });
}

function reason(value: string | undefined, minimum = 5): string {
  const clean = value?.trim() ?? "";
  if (clean.length < minimum) throw new Error("Enter a meaningful reason.");
  return clean;
}

async function audit(
  tx: Transaction,
  organisationId: string,
  actor: AuditActorContext,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    reason: string;
    before?: unknown;
    after?: unknown;
    risk?: "High" | "Critical";
  },
) {
  await tx.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [],
    action: input.action,
    module: "recruitment",
    entityType: input.entityType,
    entityId: input.entityId,
    beforeSummary: input.before,
    afterSummary: input.after,
    reason: input.reason,
    riskLevel: input.risk ?? "High",
  });
}

async function candidateDecisionScores(tx: Transaction, organisationId: string, vacancyId: string) {
  const [shortlist] = await tx
    .select()
    .from(shortlistSnapshots)
    .where(
      and(
        eq(shortlistSnapshots.organisationId, organisationId),
        eq(shortlistSnapshots.vacancyId, vacancyId),
        eq(shortlistSnapshots.status, "Finalized"),
      ),
    )
    .orderBy(desc(shortlistSnapshots.updatedAt))
    .limit(1);
  if (!shortlist) throw new Error("Finalise the shortlist before making a hiring decision.");
  const result: Array<{
    candidateId: string;
    overallScore: number;
    interviewScore: number;
    assessmentScore: number;
    missingInterview: boolean;
    criticalFailure: boolean;
  }> = [];
  for (const candidateId of shortlist.selectedCandidateIds) {
    const [assessment] = await tx
      .select()
      .from(candidateScoreRuns)
      .where(
        and(
          eq(candidateScoreRuns.organisationId, organisationId),
          eq(candidateScoreRuns.vacancyId, vacancyId),
          eq(candidateScoreRuns.candidateId, candidateId),
        ),
      )
      .orderBy(desc(candidateScoreRuns.createdAt))
      .limit(1);
    const completed = await tx
      .select({ interview: interviews, template: interviewTemplates })
      .from(interviews)
      .innerJoin(interviewTemplates, eq(interviewTemplates.id, interviews.templateId))
      .where(
        and(
          eq(interviews.organisationId, organisationId),
          eq(interviews.vacancyId, vacancyId),
          eq(interviews.candidateId, candidateId),
          eq(interviews.status, "Completed"),
        ),
      );
    let weightedInterview = 0;
    let interviewWeight = 0;
    let criticalFailure = false;
    for (const row of completed) {
      const panel = await tx
        .select({ userId: interviewPanelists.userId })
        .from(interviewPanelists)
        .where(eq(interviewPanelists.interviewId, row.interview.id));
      const scorecards = await tx
        .select()
        .from(interviewScorecards)
        .where(
          and(
            eq(interviewScorecards.interviewId, row.interview.id),
            eq(interviewScorecards.status, "Submitted"),
          ),
        );
      if (scorecards.length !== panel.length) continue;
      const criteria = row.template.criteria as Array<{
        id: string;
        weight: number;
        minimumScore?: number;
        isCritical?: boolean;
      }>;
      for (const scorecard of scorecards) {
        for (const score of scorecard.scores as Array<{ criterionId: string; score: number }>) {
          const criterion = criteria.find((item) => item.id === score.criterionId);
          const weight = criterion?.weight ?? 0;
          weightedInterview += score.score * 20 * weight;
          interviewWeight += weight;
          if (
            criterion?.isCritical &&
            criterion.minimumScore &&
            score.score < criterion.minimumScore
          )
            criticalFailure = true;
        }
      }
    }
    const interviewScore = interviewWeight ? weightedInterview / interviewWeight : 0;
    const assessmentScore = Number(assessment?.overallScore ?? 0);
    const aiWeight = completed.length ? Number(completed[0]!.template.aiDecisionWeight) : 40;
    const interviewDecisionWeight = completed.length
      ? Number(completed[0]!.template.interviewDecisionWeight)
      : 60;
    result.push({
      candidateId,
      assessmentScore,
      interviewScore,
      overallScore: Math.round(
        (assessmentScore * aiWeight + interviewScore * interviewDecisionWeight) / 100,
      ),
      missingInterview: !completed.length || interviewWeight === 0,
      criticalFailure,
    });
  }
  return result.sort(
    (a, b) =>
      Number(a.criticalFailure) - Number(b.criticalFailure) || b.overallScore - a.overallScore,
  );
}

export async function prepareManualInterviewHireInDatabase(
  organisationId: string,
  interviewId: string,
  details: {
    position: string;
    department: string;
    location: string;
    employmentType: string;
    grade: string;
  },
  directHireReason: string,
  actor: AuditActorContext,
): Promise<{ vacancyId: string; decisionId: string }> {
  recruiter(actor);
  const cleanReason = reason(directHireReason);
  const values = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, value.trim()]),
  ) as typeof details;
  if (Object.values(values).some((value) => !value))
    throw new Error("Select the position, department, location, employment type, and grade.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [interview] = await tx
      .select()
      .from(interviews)
      .where(and(eq(interviews.organisationId, organisationId), eq(interviews.id, interviewId)))
      .for("update")
      .limit(1);
    if (
      !interview ||
      interview.source !== "Manual / Offline" ||
      interview.manualOutcome !== "Selected"
    )
      throw new Error("The manual interview must have a Selected outcome before hiring.");
    const [existing] = await tx
      .select({ id: hiringDecisions.id, vacancyId: hiringDecisions.vacancyId })
      .from(hiringDecisions)
      .where(
        and(
          eq(hiringDecisions.organisationId, organisationId),
          eq(hiringDecisions.interviewId, interview.id),
          eq(hiringDecisions.status, "Finalized"),
        ),
      )
      .limit(1);
    if (existing) return { vacancyId: existing.vacancyId, decisionId: existing.id };

    const [panel, submitted] = await Promise.all([
      tx
        .select({ id: interviewPanelists.userId })
        .from(interviewPanelists)
        .where(eq(interviewPanelists.interviewId, interview.id)),
      tx
        .select({ id: interviewScorecards.panelUserId })
        .from(interviewScorecards)
        .where(
          and(
            eq(interviewScorecards.interviewId, interview.id),
            eq(interviewScorecards.status, "Submitted"),
          ),
        ),
    ]);
    if (!panel.length || new Set(submitted.map((item) => item.id)).size !== panel.length)
      throw new Error("Every assigned interviewer must submit their scorecard first.");

    let vacancyId = interview.vacancyId;
    if (!vacancyId) {
      const [[department], [location], [position], [grade], [employmentType]] = await Promise.all([
        tx
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(
              eq(departments.organisationId, organisationId),
              sql`lower(${departments.name}) = lower(${values.department})`,
              eq(departments.isActive, true),
              sql`${departments.archivedAt} IS NULL`,
            ),
          )
          .limit(1),
        tx
          .select({ id: locations.id })
          .from(locations)
          .where(
            and(
              eq(locations.organisationId, organisationId),
              sql`lower(${locations.name}) = lower(${values.location})`,
              eq(locations.isActive, true),
              sql`${locations.archivedAt} IS NULL`,
            ),
          )
          .limit(1),
        tx
          .select({ id: positions.id })
          .from(positions)
          .where(
            and(
              eq(positions.organisationId, organisationId),
              sql`lower(${positions.name}) = lower(${values.position})`,
              eq(positions.isActive, true),
              sql`${positions.archivedAt} IS NULL`,
            ),
          )
          .limit(1),
        tx
          .select({ id: grades.id })
          .from(grades)
          .where(
            and(
              eq(grades.organisationId, organisationId),
              sql`lower(${grades.name}) = lower(${values.grade})`,
              eq(grades.isActive, true),
              sql`${grades.archivedAt} IS NULL`,
            ),
          )
          .limit(1),
        tx
          .select({ id: employmentTypes.id })
          .from(employmentTypes)
          .where(
            and(
              eq(employmentTypes.organisationId, organisationId),
              sql`lower(${employmentTypes.name}) = lower(${values.employmentType})`,
              eq(employmentTypes.isActive, true),
              sql`${employmentTypes.archivedAt} IS NULL`,
            ),
          )
          .limit(1),
      ]);
      const departmentId = department?.id;
      const locationId = location?.id;
      const positionId = position?.id;
      const gradeId = grade?.id;
      const employmentTypeId = employmentType?.id;
      if (!departmentId || !locationId || !positionId || !gradeId || !employmentTypeId)
        throw new Error("One or more direct-hire details are not active in VIA Settings.");
      vacancyId = randomUUID();
      await tx.insert(vacancies).values({
        id: vacancyId,
        organisationId,
        title: `${values.position} - Direct Hire`,
        departmentId,
        locationId,
        positionId,
        gradeId,
        employmentTypeId,
        status: "Closed",
        summary: `Administrative hiring record created from manual interview ${interview.id}.`,
        responsibilities: [],
        requirements: [],
        applicantCount: 0,
        headcount: 1,
        salaryVisibleToPublic: false,
        hiringReason: "Selected through a recorded manual interview",
        education: "",
        minimumExperience: "",
        skills: { required: [], preferred: [] },
        certifications: [],
        languages: [],
        notes: cleanReason,
        screeningQuestions: [],
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await tx.insert(vacancyVersions).values({
        organisationId,
        vacancyId,
        versionNumber: 1,
        responsibilities: [],
        requirements: [],
        createdBy: actor.userId!,
      });
      await audit(tx, organisationId, actor, {
        action: "create",
        entityType: "vacancy",
        entityId: vacancyId,
        reason: cleanReason,
        after: { status: "Closed", source: "Manual Interview", interviewId: interview.id },
        risk: "Critical",
      });
    }

    const decisionId = randomUUID();
    await tx
      .update(interviews)
      .set({
        vacancyId,
        positionTitle: values.position,
        history: [
          ...(interview.history as Array<Record<string, string>>),
          {
            date: new Date().toISOString(),
            actor: actor.displayName,
            action: "Proceed to hire",
            details: cleanReason,
          },
        ],
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${interviews.recordVersion} + 1`,
      })
      .where(eq(interviews.id, interview.id));
    await tx.insert(hiringDecisions).values({
      id: decisionId,
      organisationId,
      vacancyId,
      systemRecommendedCandidateId: interview.candidateId,
      finalSelectedCandidateId: interview.candidateId,
      overrideReason: cleanReason,
      decisionSource: "Manual Interview",
      interviewId: interview.id,
      status: "Finalized",
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    });
    await tx
      .update(candidates)
      .set({
        stage: "Offer",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, interview.candidateId));
    await audit(tx, organisationId, actor, {
      action: "finalise",
      entityType: "hiring-decision",
      entityId: decisionId,
      reason: cleanReason,
      after: {
        source: "Manual Interview",
        interviewId: interview.id,
        candidateId: interview.candidateId,
        vacancyId,
      },
      risk: "Critical",
    });
    return { vacancyId, decisionId };
  });
}

export async function finaliseHiringDecisionInDatabase(
  organisationId: string,
  input: {
    vacancyId: string;
    selectedCandidateId: string;
    overrideReason?: string;
    waiverReason?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  recruiter(actor);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hiring:${input.vacancyId}`}))`);
    const [existing] = await tx
      .select({ id: hiringDecisions.id })
      .from(hiringDecisions)
      .where(
        and(
          eq(hiringDecisions.organisationId, organisationId),
          eq(hiringDecisions.vacancyId, input.vacancyId),
          eq(hiringDecisions.status, "Finalized"),
        ),
      )
      .limit(1);
    if (existing) throw new Error("A final hiring decision already exists for this vacancy.");
    const scores = await candidateDecisionScores(tx, organisationId, input.vacancyId);
    const selected = scores.find((item) => item.candidateId === input.selectedCandidateId);
    if (!selected) throw new Error("Select a candidate from the final shortlist.");
    const systemRecommendedCandidateId = scores[0]?.candidateId ?? null;
    if (scores.some((item) => item.missingInterview) && !input.waiverReason?.trim())
      throw new Error("A hiring decision with incomplete interviews requires a waiver reason.");
    if (selected.criticalFailure && !input.waiverReason?.trim())
      throw new Error("A critical interview criterion failed. Record an authorised waiver.");
    if (systemRecommendedCandidateId !== input.selectedCandidateId && !input.overrideReason?.trim())
      throw new Error(
        "Explain why HR is selecting a candidate other than the system recommendation.",
      );
    const id = randomUUID();
    await tx.insert(hiringDecisions).values({
      id,
      organisationId,
      vacancyId: input.vacancyId,
      systemRecommendedCandidateId,
      finalSelectedCandidateId: input.selectedCandidateId,
      overrideReason: input.overrideReason?.trim() || null,
      waiverReason: input.waiverReason?.trim() || null,
      decisionSource: "Standard Recruitment",
      status: "Finalized",
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    });
    await tx
      .update(candidates)
      .set({
        stage: "Offer",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, input.selectedCandidateId));
    await tx
      .update(candidateApplications)
      .set({
        status: "Offered",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidateApplications.recordVersion} + 1`,
      })
      .where(
        and(
          eq(candidateApplications.organisationId, organisationId),
          eq(candidateApplications.vacancyId, input.vacancyId),
          eq(candidateApplications.candidateId, input.selectedCandidateId),
        ),
      );
    const otherIds = scores
      .map((item) => item.candidateId)
      .filter((id) => id !== input.selectedCandidateId);
    if (otherIds.length)
      await tx
        .update(candidates)
        .set({
          stage: "On Hold",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidates.recordVersion} + 1`,
        })
        .where(
          and(eq(candidates.organisationId, organisationId), inArray(candidates.id, otherIds)),
        );
    await audit(tx, organisationId, actor, {
      action: "finalise",
      entityType: "hiring-decision",
      entityId: id,
      reason:
        input.overrideReason?.trim() ||
        input.waiverReason?.trim() ||
        "Finalised hiring decision from completed interview results",
      after: {
        systemRecommendedCandidateId,
        finalSelectedCandidateId: input.selectedCandidateId,
        scores,
      },
      risk: "Critical",
    });
    return id;
  });
}

export async function saveJobOfferInDatabase(
  organisationId: string,
  input: {
    id?: string;
    candidateId: string;
    vacancyId: string;
    template: string;
    position: string;
    grade: string;
    salary: number;
    currency: string;
    allowances: string;
    benefits: string;
    startDate: string;
    probation: string;
    location: string;
    conditions: string;
    responseDeadline?: string;
    expectedRecordVersion?: number;
    approverUserId?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  recruiter(actor);
  if (
    !input.template.trim() ||
    !input.position.trim() ||
    !input.grade.trim() ||
    !input.location.trim()
  )
    throw new Error("Template, position, grade and location are required.");
  if (!Number.isFinite(input.salary) || input.salary <= 0)
    throw new Error("Salary must be greater than zero.");
  if (!input.currency.trim()) throw new Error("Salary currency is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate))
    throw new Error("A valid start date is required.");
  if (input.responseDeadline && new Date(input.responseDeadline).getTime() < Date.now())
    throw new Error("Response deadline cannot be in the past.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [decision] = await tx
      .select()
      .from(hiringDecisions)
      .where(
        and(
          eq(hiringDecisions.organisationId, organisationId),
          eq(hiringDecisions.vacancyId, input.vacancyId),
          eq(hiringDecisions.finalSelectedCandidateId, input.candidateId),
          eq(hiringDecisions.status, "Finalized"),
        ),
      )
      .limit(1);
    if (!decision) throw new Error("Finalise the hiring decision before creating an offer.");
    if (input.approverUserId) {
      await requireOfferManager(tx, organisationId, input.approverUserId, input.candidateId);
      if (input.approverUserId === actor.userId)
        throw new Error("Select a different manager to approve your offer.");
    }
    const id = input.id ?? randomUUID();
    if (input.id) {
      const [before] = await tx
        .select()
        .from(jobOffers)
        .where(and(eq(jobOffers.organisationId, organisationId), eq(jobOffers.id, id)))
        .for("update")
        .limit(1);
      if (!before || before.status !== "Draft")
        throw new Error("Only a draft offer can be edited.");
      if (before.candidateId !== input.candidateId || before.vacancyId !== input.vacancyId)
        throw new Error("An offer's candidate and vacancy cannot be changed.");
      if (before.recordVersion !== input.expectedRecordVersion)
        throw new Error("This offer changed. Refresh and try again.");
      await tx
        .update(jobOffers)
        .set({
          template: input.template.trim(),
          approverUserId: input.approverUserId || null,
          approvedBy: null,
          approvalRequestedBy: null,
          position: input.position.trim(),
          grade: input.grade.trim(),
          salaryEncrypted: encryptSensitiveJson(input.salary),
          currencyEncrypted: encryptSensitiveJson(input.currency.trim()),
          allowancesEncrypted: encryptSensitiveJson(input.allowances.trim()),
          benefitsEncrypted: encryptSensitiveJson(input.benefits.trim()),
          startDate: input.startDate,
          probation: input.probation.trim(),
          location: input.location.trim(),
          conditions: input.conditions.trim(),
          responseDeadline: input.responseDeadline || null,
          history: [
            ...(before.history as unknown[]),
            {
              date: new Date().toISOString(),
              actor: actor.displayName,
              action: "Draft updated",
              preparedBy: actor.userId,
              details: "Offer terms updated.",
            },
          ],
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${jobOffers.recordVersion} + 1`,
        })
        .where(eq(jobOffers.id, id));
      await audit(tx, organisationId, actor, {
        action: "update",
        entityType: "offer",
        entityId: id,
        reason: "Updated draft offer terms",
        before: { recordVersion: before.recordVersion },
        after: { position: input.position, grade: input.grade, startDate: input.startDate },
      });
    } else {
      const [duplicate] = await tx
        .select({ id: jobOffers.id })
        .from(jobOffers)
        .where(
          and(
            eq(jobOffers.organisationId, organisationId),
            eq(jobOffers.candidateId, input.candidateId),
            eq(jobOffers.vacancyId, input.vacancyId),
            inArray(jobOffers.status, [
              "Draft",
              "Pending Approval",
              "Approved",
              "Ready to Send",
              "Sent",
              "Accepted",
            ]),
          ),
        )
        .limit(1);
      if (duplicate)
        throw new Error("An active offer already exists for this candidate and vacancy.");
      await tx.insert(jobOffers).values({
        id,
        organisationId,
        candidateId: input.candidateId,
        vacancyId: input.vacancyId,
        status: "Draft",
        approverUserId: input.approverUserId || null,
        template: input.template.trim(),
        position: input.position.trim(),
        grade: input.grade.trim(),
        salaryEncrypted: encryptSensitiveJson(input.salary),
        currencyEncrypted: encryptSensitiveJson(input.currency.trim()),
        allowancesEncrypted: encryptSensitiveJson(input.allowances.trim()),
        benefitsEncrypted: encryptSensitiveJson(input.benefits.trim()),
        startDate: input.startDate,
        probation: input.probation.trim(),
        location: input.location.trim(),
        conditions: input.conditions.trim(),
        responseDeadline: input.responseDeadline,
        history: [
          {
            date: new Date().toISOString(),
            actor: actor.displayName,
            action: "Created",
            preparedBy: actor.userId,
            details: "Draft offer created.",
          },
        ],
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await audit(tx, organisationId, actor, {
        action: "create",
        entityType: "offer",
        entityId: id,
        reason: "Created draft employment offer",
        after: {
          candidateId: input.candidateId,
          vacancyId: input.vacancyId,
          position: input.position,
          grade: input.grade,
          startDate: input.startDate,
        },
        risk: "Critical",
      });
    }
    return id;
  });
}

const OFFER_TRANSITIONS: Record<JobOfferStatus, JobOfferStatus[]> = {
  Draft: ["Pending Approval", "Withdrawn"],
  "Pending Approval": ["Approved", "Draft", "Withdrawn"],
  Approved: ["Draft", "Ready to Send", "Withdrawn"],
  "Ready to Send": ["Draft", "Sent", "Withdrawn"],
  Sent: ["Accepted", "Declined", "Expired", "Withdrawn"],
  Accepted: [],
  Declined: [],
  Expired: [],
  Withdrawn: [],
};

function addDays(dateValue: string, offset: number): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function convertAcceptedOffer(
  tx: Transaction,
  organisationId: string,
  offer: typeof jobOffers.$inferSelect,
  actor: AuditActorContext,
): Promise<{ employeeId: string; userId: string; onboardingCaseId: string }> {
  const [[candidate], [vacancy]] = await Promise.all([
    tx
      .select()
      .from(candidates)
      .where(
        and(eq(candidates.organisationId, organisationId), eq(candidates.id, offer.candidateId)),
      )
      .for("update")
      .limit(1),
    tx
      .select()
      .from(vacancies)
      .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, offer.vacancyId)))
      .limit(1),
  ]);
  if (!candidate || !vacancy) throw new Error("Candidate or vacancy record is missing.");
  if (candidate.convertedToEmployeeId || offer.convertedToEmployeeId)
    throw new Error("This accepted offer has already been converted.");
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`employee-number:${organisationId}`}))`,
  );
  const [count] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.organisationId, organisationId));
  const employeeId = randomUUID();
  const userId = randomUUID();
  const sequence = Number(count?.value ?? 0) + 1;
  const emailStem =
    `${candidate.firstName}.${candidate.lastName}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.|\.$/g, "") || `employee.${sequence}`;
  let workspaceEmail = `${emailStem}@via-int.com`;
  const [emailExists] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organisationId, organisationId), eq(users.workspaceEmail, workspaceEmail)))
    .limit(1);
  if (emailExists) workspaceEmail = `${emailStem}.${sequence}@via-int.com`;
  const employeeNumber = workspaceEmail;
  await tx.insert(employees).values({
    id: employeeId,
    organisationId,
    employeeNumber,
    legalName: `${candidate.firstName} ${candidate.lastName}`.trim(),
    preferredName: candidate.firstName,
    workEmail: workspaceEmail,
    personalEmail: candidate.email,
    phone: candidate.phone,
    departmentId: vacancy.departmentId,
    positionId: vacancy.positionId,
    gradeId: vacancy.gradeId,
    locationId: vacancy.locationId,
    employmentTypeId: vacancy.employmentTypeId,
    lineManagerId: vacancy.hiringManagerId,
    projectId: vacancy.projectId,
    country: candidate.location,
    startDate: offer.startDate,
    workspaceEmail,
    candidateId: candidate.id,
    offerId: offer.id,
    status: "Onboarding",
    staffEntryType: "New Employee",
    profileSetupStatus: "In Progress",
    nationality: candidate.nationality,
    createdBy: actor.userId!,
    updatedBy: actor.userId!,
  });
  await tx.insert(users).values({
    id: userId,
    organisationId,
    employeeId,
    displayName: `${candidate.firstName} ${candidate.lastName}`.trim(),
    workspaceEmail,
    status: "Active",
    createdBy: actor.userId!,
    updatedBy: actor.userId!,
  });
  const [employeeRole] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, "Employee"))
    .limit(1);
  if (!employeeRole) throw new Error("The Employee access role is not configured.");
  await tx
    .insert(userRoles)
    .values({
      organisationId,
      userId,
      roleId: employeeRole.id,
      assignedBy: actor.userId!,
      reason: "Employee access created from accepted offer",
    })
    .onConflictDoNothing();
  const [template] = await tx
    .select()
    .from(onboardingTemplates)
    .where(
      and(
        eq(onboardingTemplates.organisationId, organisationId),
        eq(onboardingTemplates.isActive, true),
        sql`${onboardingTemplates.archivedAt} IS NULL`,
      ),
    )
    .orderBy(desc(onboardingTemplates.updatedAt))
    .limit(1);
  if (!template) {
    throw new Error("An active onboarding checklist is required before accepting an offer.");
  }
  const onboardingCaseId = randomUUID();
  await tx.insert(onboardingCases).values({
    id: onboardingCaseId,
    organisationId,
    employeeId,
    kind: "New Hire Onboarding",
    templateId: template.id,
    status: "In Progress",
    progressPercentage: 0,
    isReadyForStartDate: false,
    assignedHRId: actor.employeeId,
    createdBy: actor.userId!,
    updatedBy: actor.userId!,
  });
  const configuredTasks = template.templateTasks as OnboardingTemplateTask[];
  const templateTasks = configuredTasks.some(
    (task) => task.selfServiceFormKey === "employment_details",
  )
    ? configuredTasks
    : [
        {
          id: "employment-details",
          title: "Confirm your employment details",
          group: "Employment Setup" as const,
          checkpoint: "Pre-Arrival" as const,
          ownerRole: "Employee" as const,
          offsetDaysFromStart: 0,
          isMandatory: true,
          requiresEvidence: false,
          selfServiceFormKey: "employment_details" as const,
        },
        ...configuredTasks,
      ];
  if (templateTasks.length === 0) {
    throw new Error("The active onboarding checklist has no tasks.");
  }
  const taskIdByTemplate = new Map(templateTasks.map((task) => [task.id, randomUUID()]));
  if (templateTasks.length)
    await tx.insert(onboardingTasks).values(
      templateTasks.map((task) => ({
        id: taskIdByTemplate.get(task.id)!,
        organisationId,
        caseId: onboardingCaseId,
        templateTaskId: task.id,
        title: task.title,
        taskGroup: task.group,
        checkpoint: task.checkpoint,
        ownerRole: task.ownerRole,
        assignedUserId:
          task.ownerRole === "Employee"
            ? userId
            : task.ownerRole === "HR"
              ? actor.userId
              : (task.assignedUserId ?? null),
        offsetDaysFromStart: task.offsetDaysFromStart,
        dueDate: addDays(offer.startDate, task.offsetDaysFromStart),
        isMandatory: task.isMandatory,
        requiresEvidence: task.requiresEvidence,
        instructions: task.instructions ?? null,
        dependsOnTaskIds: (task.dependsOnTaskIds ?? [])
          .map((id) => taskIdByTemplate.get(id))
          .filter(Boolean) as string[],
        selfServiceFormKey: task.selfServiceFormKey ?? null,
        documentType: task.documentType ?? null,
        verificationDocumentType: task.verificationDocumentType ?? null,
        requiresBankDetails: task.requiresBankDetails ?? false,
        status: "Pending" as const,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      })),
    );
  await tx
    .update(candidates)
    .set({
      stage: "Hired",
      convertedToEmployeeId: employeeId,
      updatedAt: new Date(),
      updatedBy: actor.userId,
      recordVersion: sql`${candidates.recordVersion} + 1`,
    })
    .where(eq(candidates.id, candidate.id));
  await tx
    .update(candidateApplications)
    .set({
      status: "Hired",
      updatedAt: new Date(),
      updatedBy: actor.userId,
      recordVersion: sql`${candidateApplications.recordVersion} + 1`,
    })
    .where(
      and(
        eq(candidateApplications.organisationId, organisationId),
        eq(candidateApplications.vacancyId, offer.vacancyId),
        eq(candidateApplications.candidateId, candidate.id),
      ),
    );
  await tx
    .update(jobOffers)
    .set({ convertedToEmployeeId: employeeId })
    .where(eq(jobOffers.id, offer.id));
  await tx.insert(notifications).values({
    organisationId,
    recipientUserId: userId,
    type: "Onboarding",
    title: "Welcome to VIA",
    message: "Your employee profile and onboarding checklist are ready.",
    priority: "High",
    status: "Unread",
    deduplicationKey: `onboarding-welcome-${employeeId}`,
    link: { entityType: "onboarding-case", entityId: onboardingCaseId },
    createdBy: actor.userId!,
    updatedBy: actor.userId!,
  });
  return { employeeId, userId, onboardingCaseId };
}

export async function transitionJobOfferInDatabase(
  organisationId: string,
  offerId: string,
  status: JobOfferStatus,
  transitionReason: string | undefined,
  actor: AuditActorContext,
  expectedRecordVersion?: number,
  manualDelivery?: ManualOfferDelivery,
): Promise<{ employeeId?: string; userId?: string; onboardingCaseId?: string }> {
  recruiter(actor);
  if (status === "Accepted") {
    await ensureCoreHrLifecycleTemplates(organisationId, actor);
  }
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(jobOffers)
      .where(and(eq(jobOffers.organisationId, organisationId), eq(jobOffers.id, offerId)))
      .for("update")
      .limit(1);
    if (!offer) throw new Error("Offer not found.");
    let dispatch: ReturnType<typeof validateManualOfferDelivery> | undefined;
    if (status === "Sent") {
      const [candidate] = await tx
        .select({ email: candidates.email })
        .from(candidates)
        .where(
          and(eq(candidates.organisationId, organisationId), eq(candidates.id, offer.candidateId)),
        )
        .limit(1);
      if (!candidate) throw new Error("Candidate not found.");
      dispatch = validateManualOfferDelivery(manualDelivery, candidate.email);
      if (Date.parse(dispatch.sentAt) < offer.createdAt.getTime())
        throw new Error("The sending time cannot be before this offer was created.");
    }
    if (status === "Approved")
      throw new Error("The assigned manager must approve this offer from Offer approvals.");
    if (expectedRecordVersion !== offer.recordVersion)
      throw new Error("This offer changed. Refresh and try again.");
    if (status === "Pending Approval") {
      if (!offer.approverUserId) throw new Error("Select and save an approval manager first.");
      await requireOfferManager(tx, organisationId, offer.approverUserId, offer.candidateId);
      assertIndependentOfferApprover(
        { ...offer, approvalRequestedBy: actor.userId! },
        offer.approverUserId,
      );
    }
    if (
      ["Ready to Send", "Sent"].includes(status) &&
      (!offer.approvedBy || offer.approvedBy !== offer.approverUserId)
    )
      throw new Error(
        "An independent manager must approve this offer before it can be sent. Return it to draft for approval.",
      );
    if (status === "Draft") reason(transitionReason);
    if (!OFFER_TRANSITIONS[offer.status].includes(status))
      throw new Error(`Offer cannot move from ${offer.status} to ${status}.`);
    const cleanReason = ["Declined", "Withdrawn"].includes(status)
      ? reason(transitionReason)
      : transitionReason?.trim() || `Moved offer to ${status}`;
    const now = new Date().toISOString();
    await tx
      .update(jobOffers)
      .set({
        status,
        approvalRequestedBy:
          status === "Pending Approval"
            ? actor.userId
            : status === "Draft"
              ? null
              : offer.approvalRequestedBy,
        approvedBy: status === "Draft" ? null : offer.approvedBy,
        sentDate: dispatch?.sentAt ?? offer.sentDate,
        declineReason: status === "Declined" ? cleanReason : offer.declineReason,
        deliveryReference: dispatch
          ? `manual:${dispatch.evidenceReference}`
          : offer.deliveryReference,
        history: [
          ...(offer.history as unknown[]),
          {
            date: now,
            actor: actor.displayName,
            action: `Status changed to ${status}`,
            details: cleanReason,
            ...(dispatch ? { deliveryMethod: "Manual sending attested by HR", ...dispatch } : {}),
          },
        ],
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${jobOffers.recordVersion} + 1`,
      })
      .where(eq(jobOffers.id, offer.id));
    const conversion =
      status === "Accepted" ? await convertAcceptedOffer(tx, organisationId, offer, actor) : {};
    if (status === "Pending Approval" && offer.approverUserId)
      await notifyOfferReview(
        tx,
        organisationId,
        offer.id,
        offer.approverUserId,
        actor,
        "Offer awaiting your approval",
        offer.recordVersion + 1,
      );
    await audit(tx, organisationId, actor, {
      action: `status-${status.toLowerCase().replaceAll(" ", "-")}`,
      entityType: "offer",
      entityId: offer.id,
      reason: cleanReason,
      before: { status: offer.status },
      after: { status, ...conversion },
      risk: status === "Accepted" ? "Critical" : "High",
    });
    return conversion;
  });
}

/**
 * Repairs an accepted legacy offer that predates automatic offer conversion.
 * New offers are converted by transitionJobOfferInDatabase when they become Accepted; this
 * entry point exists only so the recovery screen cannot recreate that workflow in browser state.
 */
export async function convertAcceptedJobOfferInDatabase(
  organisationId: string,
  offerId: string,
  actor: AuditActorContext,
): Promise<{ employeeId: string; userId: string; onboardingCaseId: string }> {
  recruiter(actor);
  await ensureCoreHrLifecycleTemplates(organisationId, actor);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(jobOffers)
      .where(and(eq(jobOffers.organisationId, organisationId), eq(jobOffers.id, offerId)))
      .for("update")
      .limit(1);
    if (!offer) throw new Error("Offer not found.");
    if (offer.status !== "Accepted")
      throw new Error("Only an accepted offer can be converted to an employee.");
    const conversion = await convertAcceptedOffer(tx, organisationId, offer, actor);
    await audit(tx, organisationId, actor, {
      action: "convert-accepted-offer",
      entityType: "offer",
      entityId: offer.id,
      reason: "Completed employee creation for a previously accepted offer",
      before: { convertedToEmployeeId: offer.convertedToEmployeeId },
      after: conversion,
      risk: "Critical",
    });
    return conversion;
  });
}

export async function generateJobOfferDocumentInDatabase(
  organisationId: string,
  offerId: string,
  actor: AuditActorContext,
): Promise<{ fileName: string; content: string }> {
  recruiter(actor);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ offer: jobOffers, candidate: candidates })
      .from(jobOffers)
      .innerJoin(candidates, eq(candidates.id, jobOffers.candidateId))
      .where(and(eq(jobOffers.organisationId, organisationId), eq(jobOffers.id, offerId)))
      .limit(1);
    if (!row) throw new Error("Offer not found.");
    const salary = decryptSensitiveJson<number>(row.offer.salaryEncrypted);
    const currency = decryptSensitiveJson<string>(row.offer.currencyEncrypted);
    const allowances = decryptSensitiveJson<string>(row.offer.allowancesEncrypted);
    const benefits = decryptSensitiveJson<string>(row.offer.benefitsEncrypted);
    const content = [
      "OFFICIAL JOB OFFER",
      "",
      `Candidate: ${row.candidate.firstName} ${row.candidate.lastName}`,
      `Position: ${row.offer.position}`,
      `Grade: ${row.offer.grade}`,
      `Location: ${row.offer.location}`,
      `Start date: ${row.offer.startDate}`,
      `Probation: ${row.offer.probation}`,
      "",
      "COMPENSATION",
      `Base salary: ${salary.toLocaleString()} ${currency}`,
      `Allowances: ${allowances}`,
      `Benefits: ${benefits}`,
      "",
      "CONDITIONS",
      row.offer.conditions,
      ...(row.offer.responseDeadline
        ? ["", `Please respond by: ${row.offer.responseDeadline}`]
        : []),
    ].join("\n");
    await audit(tx, organisationId, actor, {
      action: "export",
      entityType: "job-offer",
      entityId: row.offer.id,
      reason: "Generated the official offer document",
      after: { status: row.offer.status, format: "text/plain" },
      risk: "Critical",
    });
    return {
      fileName: `Job_Offer_${row.offer.position.replace(/[^a-z0-9]+/gi, "_")}.txt`,
      content,
    };
  });
}
