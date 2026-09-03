import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import type {
  CriterionScore,
  InterviewDispositionOutcome,
  InterviewSlot,
  InterviewStatus,
  ManualInterviewOutcome,
  ScorecardCriterion,
  ScorecardRecommendation,
} from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { users } from "../schema/employee.ts";
import {
  candidateApplications,
  candidates,
  interviewDispositions,
  interviewPanelists,
  interviewScorecards,
  interviews,
  interviewTemplates,
  vacancies,
} from "../schema/recruitment.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type Database = ReturnType<typeof getDatabaseClient>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function requireRecruiter(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can manage interviews.");
  if (!actor.userId) throw new Error("A verified VIA user is required.");
}

function requireReason(reason: string, minimum = 5): string {
  const clean = reason.trim();
  if (clean.length < minimum) throw new Error("Enter a meaningful reason.");
  return clean;
}

function validSlot(slot: InterviewSlot): void {
  const start = new Date(slot.startTime).getTime();
  const end = new Date(slot.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error("Enter a valid interview start and end time.");
  if (!slot.timezone.trim()) throw new Error("Interview timezone is required.");
}

function historyEntry(actor: AuditActorContext, action: string, details: string) {
  return {
    date: new Date().toISOString(),
    actor: actor.displayName,
    action,
    details,
  };
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
    riskLevel?: "Low" | "Medium" | "High" | "Critical";
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
    riskLevel: input.riskLevel ?? "High",
  });
}

async function assertPanelUsers(
  tx: Transaction,
  organisationId: string,
  panelUserIds: string[],
): Promise<string[]> {
  const ids = [...new Set(panelUserIds)];
  if (!ids.length) throw new Error("At least one panel member is required.");
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, organisationId),
        inArray(users.id, ids),
        eq(users.status, "Active"),
      ),
    );
  if (rows.length !== ids.length) throw new Error("Every panel member must be an active VIA user.");
  return ids;
}

async function assertNoPanelConflict(
  tx: Transaction,
  organisationId: string,
  interviewId: string,
  panelUserIds: string[],
  slot: InterviewSlot,
): Promise<void> {
  validSlot(slot);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`interview:${organisationId}`}))`);
  const rows = await tx
    .select({ interview: interviews, panelUserId: interviewPanelists.userId })
    .from(interviews)
    .innerJoin(interviewPanelists, eq(interviewPanelists.interviewId, interviews.id))
    .where(
      and(
        eq(interviews.organisationId, organisationId),
        eq(interviews.status, "Scheduled"),
        inArray(interviewPanelists.userId, panelUserIds),
      ),
    );
  const start = new Date(slot.startTime).getTime();
  const end = new Date(slot.endTime).getTime();
  for (const row of rows) {
    if (row.interview.id === interviewId || !row.interview.confirmedSlot) continue;
    const other = row.interview.confirmedSlot as InterviewSlot;
    if (start < new Date(other.endTime).getTime() && new Date(other.startTime).getTime() < end)
      throw new Error("A panel member is already booked for another interview at this time.");
  }
}

export async function saveInterviewTemplateInDatabase(
  organisationId: string,
  input: {
    id?: string;
    name: string;
    criteria: ScorecardCriterion[];
    blindScoring: boolean;
    vacancyId?: string;
    stageName?: string;
    aiDecisionWeight: number;
    interviewDecisionWeight: number;
    expectedRecordVersion?: number;
  },
  actor: AuditActorContext,
): Promise<string> {
  requireRecruiter(actor);
  if (!input.name.trim()) throw new Error("Template name is required.");
  if (!input.criteria.length) throw new Error("Add at least one scoring criterion.");
  const criterionIds = new Set<string>();
  let totalWeight = 0;
  for (const criterion of input.criteria) {
    if (!criterion.id || criterionIds.has(criterion.id))
      throw new Error("Every scoring criterion must have a unique ID.");
    criterionIds.add(criterion.id);
    if (!criterion.name.trim() || criterion.weight <= 0)
      throw new Error("Every criterion needs a name and positive weight.");
    if (criterion.minimumScore && (criterion.minimumScore < 1 || criterion.minimumScore > 5))
      throw new Error("Minimum criterion scores must be between 1 and 5.");
    totalWeight += criterion.weight;
  }
  if (totalWeight !== 100) throw new Error("Scoring criteria weights must total 100%.");
  if (input.aiDecisionWeight + input.interviewDecisionWeight !== 100)
    throw new Error("Assessment and interview decision weights must total 100%.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    if (input.vacancyId) {
      const [vacancy] = await tx
        .select({ id: vacancies.id })
        .from(vacancies)
        .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, input.vacancyId)))
        .limit(1);
      if (!vacancy) throw new Error("Vacancy not found.");
    }
    const id = input.id ?? randomUUID();
    if (input.id) {
      const [before] = await tx
        .select()
        .from(interviewTemplates)
        .where(
          and(eq(interviewTemplates.organisationId, organisationId), eq(interviewTemplates.id, id)),
        )
        .for("update")
        .limit(1);
      if (!before || before.archivedAt) throw new Error("Interview template not found.");
      if (
        input.expectedRecordVersion !== undefined &&
        before.recordVersion !== input.expectedRecordVersion
      )
        throw new Error("This template changed. Refresh and try again.");
      await tx
        .update(interviewTemplates)
        .set({
          name: input.name.trim(),
          criteria: input.criteria,
          blindScoring: input.blindScoring,
          vacancyId: input.vacancyId ?? null,
          stageName: input.stageName?.trim() || null,
          aiDecisionWeight: String(input.aiDecisionWeight),
          interviewDecisionWeight: String(input.interviewDecisionWeight),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${interviewTemplates.recordVersion} + 1`,
        })
        .where(eq(interviewTemplates.id, id));
      await audit(tx, organisationId, actor, {
        action: "update",
        entityType: "interview-template",
        entityId: id,
        reason: "Updated interview scoring criteria",
        before: { name: before.name, criteria: before.criteria },
        after: { name: input.name.trim(), criteria: input.criteria },
      });
    } else {
      await tx.insert(interviewTemplates).values({
        id,
        organisationId,
        name: input.name.trim(),
        criteria: input.criteria,
        blindScoring: input.blindScoring,
        vacancyId: input.vacancyId,
        stageName: input.stageName?.trim() || null,
        aiDecisionWeight: String(input.aiDecisionWeight),
        interviewDecisionWeight: String(input.interviewDecisionWeight),
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      await audit(tx, organisationId, actor, {
        action: "create",
        entityType: "interview-template",
        entityId: id,
        reason: "Created interview scoring criteria",
        after: { name: input.name.trim(), criteria: input.criteria },
      });
    }
    return id;
  });
}

export async function archiveInterviewTemplateInDatabase(
  organisationId: string,
  templateId: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  requireRecruiter(actor);
  const cleanReason = requireReason(reason);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const active = await tx
      .select({ id: interviewTemplates.id })
      .from(interviewTemplates)
      .where(
        and(
          eq(interviewTemplates.organisationId, organisationId),
          sql`${interviewTemplates.archivedAt} IS NULL`,
        ),
      )
      .for("update");
    if (!active.some((item) => item.id === templateId)) throw new Error("Template not found.");
    if (active.length <= 1) throw new Error("At least one interview template must remain active.");
    const [inUse] = await tx
      .select({ id: interviews.id })
      .from(interviews)
      .where(
        and(
          eq(interviews.templateId, templateId),
          inArray(interviews.status, ["Proposed", "Awaiting Candidate", "Scheduled"]),
        ),
      )
      .limit(1);
    if (inUse) throw new Error("This template is assigned to an active interview.");
    await tx
      .update(interviewTemplates)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${interviewTemplates.recordVersion} + 1`,
      })
      .where(eq(interviewTemplates.id, templateId));
    await audit(tx, organisationId, actor, {
      action: "archive",
      entityType: "interview-template",
      entityId: templateId,
      reason: cleanReason,
    });
  });
}

export async function createInterviewInDatabase(
  organisationId: string,
  input: {
    candidateId: string;
    vacancyId?: string;
    templateId: string;
    source: "Scheduled Recruitment" | "Manual / Offline";
    stageName: string;
    durationMinutes: number;
    panelUserIds: string[];
    location: string;
    videoMethod: string;
    notes: string;
    proposedSlots?: InterviewSlot[];
    occurredAt?: string;
    timezone?: string;
    positionTitle?: string;
    projectName?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  requireRecruiter(actor);
  if (
    !input.stageName.trim() ||
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1
  )
    throw new Error("Interview stage and a valid duration are required.");
  if (input.source === "Scheduled Recruitment" && !input.vacancyId)
    throw new Error("A vacancy is required for a scheduled interview.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [[candidate], [template]] = await Promise.all([
      tx
        .select()
        .from(candidates)
        .where(
          and(eq(candidates.organisationId, organisationId), eq(candidates.id, input.candidateId)),
        )
        .limit(1),
      tx
        .select()
        .from(interviewTemplates)
        .where(
          and(
            eq(interviewTemplates.organisationId, organisationId),
            eq(interviewTemplates.id, input.templateId),
            sql`${interviewTemplates.archivedAt} IS NULL`,
          ),
        )
        .limit(1),
    ]);
    if (!candidate || candidate.archivedAt || candidate.mergedIntoId)
      throw new Error("Candidate not found.");
    if (!template) throw new Error("Select an active scorecard template.");
    if (input.vacancyId) {
      const [vacancy] = await tx
        .select({ id: vacancies.id })
        .from(vacancies)
        .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, input.vacancyId)))
        .limit(1);
      if (!vacancy) throw new Error("Vacancy not found.");
    }
    const panelUserIds = await assertPanelUsers(tx, organisationId, input.panelUserIds);
    const id = randomUUID();
    let occurredAt: string | null = null;
    let confirmedSlot: InterviewSlot | null = null;
    let status: InterviewStatus = "Proposed";
    let manualOutcome: ManualInterviewOutcome | null = null;
    if (input.source === "Manual / Offline") {
      const occurred = new Date(input.occurredAt ?? "");
      if (!Number.isFinite(occurred.getTime()) || occurred.getTime() > Date.now() + 5 * 60_000)
        throw new Error("A manual interview must have a valid past date and time.");
      if (!input.positionTitle?.trim()) throw new Error("Position discussed is required.");
      occurredAt = occurred.toISOString();
      confirmedSlot = {
        startTime: occurredAt,
        endTime: new Date(occurred.getTime() + input.durationMinutes * 60_000).toISOString(),
        timezone: input.timezone?.trim() || "UTC",
      };
      status = "Completed";
      manualOutcome = "Pending";
    } else {
      for (const slot of input.proposedSlots ?? []) validSlot(slot);
    }
    await tx.insert(interviews).values({
      id,
      organisationId,
      candidateId: input.candidateId,
      vacancyId: input.vacancyId,
      templateId: input.templateId,
      source: input.source,
      positionTitle: input.positionTitle?.trim() || null,
      projectName: input.projectName?.trim() || null,
      occurredAt,
      manualOutcome,
      stageName: input.stageName.trim(),
      durationMinutes: input.durationMinutes,
      location: input.location.trim() || "To be confirmed",
      videoMethod: input.videoMethod.trim() || "To be confirmed",
      notes: input.notes.trim(),
      status,
      confirmedSlot,
      proposedSlots: input.proposedSlots ?? [],
      history: [
        historyEntry(
          actor,
          input.source === "Manual / Offline" ? "Manual interview recorded" : "Created",
          input.source === "Manual / Offline"
            ? "Recorded an interview completed outside the portal."
            : "Interview created with proposed times.",
        ),
      ],
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    });
    await tx.insert(interviewPanelists).values(
      panelUserIds.map((userId) => ({
        organisationId,
        interviewId: id,
        userId,
        role: "Panel member",
      })),
    );
    for (const panelUserId of panelUserIds) {
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: panelUserId,
          type: "Interview",
          title:
            input.source === "Manual / Offline"
              ? "Interview scorecard required"
              : "Interview assigned",
          message: `You are on the panel for ${input.stageName.trim()}.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `interview-${id}-${panelUserId}`,
          link: { entityType: "interview", entityId: id },
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        })
        .onConflictDoNothing();
    }
    await tx
      .update(candidates)
      .set({
        stage: "Interview",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, candidate.id));
    if (input.vacancyId)
      await tx
        .update(candidateApplications)
        .set({
          status: "Interviewing",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(
          and(
            eq(candidateApplications.organisationId, organisationId),
            eq(candidateApplications.vacancyId, input.vacancyId),
            eq(candidateApplications.candidateId, input.candidateId),
          ),
        );
    await audit(tx, organisationId, actor, {
      action: "create",
      entityType: "interview",
      entityId: id,
      reason:
        input.source === "Manual / Offline"
          ? "Recorded manual interview"
          : "Created interview schedule",
      after: { candidateId: input.candidateId, vacancyId: input.vacancyId, panelUserIds, status },
      riskLevel: "High",
    });
    return id;
  });
}

const TRANSITIONS: Record<InterviewStatus, InterviewStatus[]> = {
  Proposed: ["Awaiting Candidate", "Scheduled", "Cancelled"],
  "Awaiting Candidate": ["Proposed", "Scheduled", "Cancelled"],
  Scheduled: ["Scheduled", "Completed", "Cancelled", "No Show"],
  Completed: [],
  Cancelled: [],
  "No Show": [],
};

export async function updateInterviewWorkflowInDatabase(
  organisationId: string,
  input: {
    interviewId: string;
    action:
      "send-slots" | "candidate-accepted" | "candidate-declined" | "reschedule" | "change-status";
    slot?: InterviewSlot;
    status?: InterviewStatus;
    reason: string;
    waiver?: boolean;
    expectedRecordVersion?: number;
  },
  actor: AuditActorContext,
): Promise<void> {
  requireRecruiter(actor);
  const cleanReason = requireReason(input.reason, input.waiver ? 10 : 3);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [interview] = await tx
      .select()
      .from(interviews)
      .where(
        and(eq(interviews.organisationId, organisationId), eq(interviews.id, input.interviewId)),
      )
      .for("update")
      .limit(1);
    if (!interview) throw new Error("Interview not found.");
    if (
      input.expectedRecordVersion !== undefined &&
      interview.recordVersion !== input.expectedRecordVersion
    )
      throw new Error("This interview changed. Refresh and try again.");
    const panel = await tx
      .select({ userId: interviewPanelists.userId })
      .from(interviewPanelists)
      .where(eq(interviewPanelists.interviewId, interview.id));
    const panelUserIds = panel.map((item) => item.userId);
    let status = interview.status;
    let confirmedSlot = interview.confirmedSlot as InterviewSlot | null;
    let candidateResponseStatus = interview.candidateResponseStatus;
    let actionLabel: string = input.action;
    if (input.action === "send-slots") {
      if (interview.status !== "Proposed" || !(interview.proposedSlots as unknown[]).length)
        throw new Error("Add proposed times before sending them to the candidate.");
      status = "Awaiting Candidate";
      candidateResponseStatus = "Pending";
    } else if (input.action === "candidate-declined") {
      if (interview.status !== "Awaiting Candidate")
        throw new Error("This interview is not awaiting a candidate response.");
      status = "Proposed";
      candidateResponseStatus = "Declined";
    } else if (input.action === "candidate-accepted" || input.action === "reschedule") {
      if (!input.slot) throw new Error("The confirmed interview time is required.");
      if (
        input.action === "candidate-accepted" &&
        interview.status !== "Awaiting Candidate" &&
        interview.status !== "Proposed"
      )
        throw new Error("This interview is not awaiting confirmation.");
      if (input.action === "reschedule" && interview.status !== "Scheduled")
        throw new Error("Only a scheduled interview can be rescheduled.");
      await assertNoPanelConflict(tx, organisationId, interview.id, panelUserIds, input.slot);
      confirmedSlot = input.slot;
      status = "Scheduled";
      candidateResponseStatus = null;
    } else {
      if (!input.status || !TRANSITIONS[interview.status].includes(input.status))
        throw new Error(
          `Interview cannot move from ${interview.status} to ${input.status ?? "that status"}.`,
        );
      if (input.status === "Completed" && !input.waiver) {
        const submitted = await tx
          .select({ panelUserId: interviewScorecards.panelUserId })
          .from(interviewScorecards)
          .where(
            and(
              eq(interviewScorecards.interviewId, interview.id),
              eq(interviewScorecards.status, "Submitted"),
            ),
          );
        if (new Set(submitted.map((item) => item.panelUserId)).size !== panelUserIds.length)
          throw new Error(
            "All panel scorecards must be submitted before completion, or HR must record a waiver.",
          );
      }
      status = input.status;
      if (status === "No Show") candidateResponseStatus = null;
      actionLabel = `status-${status.toLowerCase().replaceAll(" ", "-")}`;
    }
    const nextHistory = [
      ...(interview.history as Array<Record<string, string>>),
      historyEntry(actor, actionLabel, cleanReason),
    ];
    await tx
      .update(interviews)
      .set({
        status,
        confirmedSlot,
        candidateResponseStatus,
        history: nextHistory,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${interviews.recordVersion} + 1`,
      })
      .where(eq(interviews.id, interview.id));
    await audit(tx, organisationId, actor, {
      action: actionLabel,
      entityType: "interview",
      entityId: interview.id,
      reason: cleanReason,
      before: { status: interview.status, confirmedSlot: interview.confirmedSlot },
      after: { status, confirmedSlot },
      riskLevel: status === "Completed" || status === "No Show" ? "Critical" : "High",
    });
  });
}

export async function saveInterviewScorecardInDatabase(
  organisationId: string,
  input: {
    interviewId: string;
    scores: CriterionScore[];
    recommendation: ScorecardRecommendation | null;
    submit: boolean;
    expectedRecordVersion?: number;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.userId) throw new Error("A verified VIA user is required.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [interview] = await tx
      .select()
      .from(interviews)
      .where(
        and(eq(interviews.organisationId, organisationId), eq(interviews.id, input.interviewId)),
      )
      .limit(1);
    if (!interview || !interview.templateId)
      throw new Error("Interview or scorecard template not found.");
    const [panel] = await tx
      .select()
      .from(interviewPanelists)
      .where(
        and(
          eq(interviewPanelists.interviewId, interview.id),
          eq(interviewPanelists.userId, actor.userId!),
        ),
      )
      .limit(1);
    if (!panel) throw new Error("Only an assigned panel member can complete this scorecard.");
    const [template] = await tx
      .select()
      .from(interviewTemplates)
      .where(eq(interviewTemplates.id, interview.templateId))
      .limit(1);
    if (!template) throw new Error("Scorecard template not found.");
    const criteria = template.criteria as ScorecardCriterion[];
    const byCriterion = new Map(input.scores.map((score) => [score.criterionId, score]));
    for (const score of input.scores)
      if (
        !criteria.some((criterion) => criterion.id === score.criterionId) ||
        !Number.isInteger(score.score) ||
        score.score < 1 ||
        score.score > 5
      )
        throw new Error("A scorecard contains an invalid criterion or score.");
    if (input.submit) {
      if (!input.recommendation) throw new Error("Choose an overall recommendation.");
      for (const criterion of criteria) {
        const score = byCriterion.get(criterion.id);
        if (!score) throw new Error("Score every criterion before submitting.");
        if (criterion.requiresEvidence && score.evidence.trim().length < 3)
          throw new Error(`Add evidence for ${criterion.name}.`);
      }
    }
    const [existing] = await tx
      .select()
      .from(interviewScorecards)
      .where(
        and(
          eq(interviewScorecards.interviewId, interview.id),
          eq(interviewScorecards.panelUserId, actor.userId!),
        ),
      )
      .for("update")
      .limit(1);
    if (existing?.status === "Submitted")
      throw new Error("This scorecard is locked. HR must reopen it before correction.");
    if (
      existing &&
      input.expectedRecordVersion !== undefined &&
      existing.recordVersion !== input.expectedRecordVersion
    )
      throw new Error("This scorecard changed. Refresh and try again.");
    const id = existing?.id ?? randomUUID();
    const status = input.submit ? "Submitted" : "Draft";
    if (existing)
      await tx
        .update(interviewScorecards)
        .set({
          status,
          scores: input.scores,
          overallRecommendation: input.recommendation,
          submittedAt: input.submit ? new Date().toISOString() : null,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${interviewScorecards.recordVersion} + 1`,
        })
        .where(eq(interviewScorecards.id, id));
    else
      await tx.insert(interviewScorecards).values({
        id,
        organisationId,
        interviewId: interview.id,
        panelUserId: actor.userId!,
        status,
        scores: input.scores,
        overallRecommendation: input.recommendation,
        submittedAt: input.submit ? new Date().toISOString() : null,
        revisionHistory: [],
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
    await audit(tx, organisationId, actor, {
      action: input.submit ? "submit" : "save-draft",
      entityType: "interview-scorecard",
      entityId: id,
      reason: input.submit
        ? "Submitted panel interview scorecard"
        : "Saved panel interview scorecard draft",
      before: existing ? { status: existing.status } : undefined,
      after: { status, recommendation: input.recommendation },
      riskLevel: input.submit ? "Critical" : "Medium",
    });
    return id;
  });
}

export async function reopenInterviewScorecardInDatabase(
  organisationId: string,
  scorecardId: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  requireRecruiter(actor);
  const cleanReason = requireReason(reason, 10);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [scorecard] = await tx
      .select()
      .from(interviewScorecards)
      .where(
        and(
          eq(interviewScorecards.organisationId, organisationId),
          eq(interviewScorecards.id, scorecardId),
        ),
      )
      .for("update")
      .limit(1);
    if (!scorecard || scorecard.status !== "Submitted")
      throw new Error("Only a submitted scorecard can be reopened.");
    const revision = {
      date: new Date().toISOString(),
      actor: actor.displayName,
      reason: cleanReason,
      previousStatus: scorecard.status,
      previousScores: scorecard.scores,
      previousRecommendation: scorecard.overallRecommendation,
    };
    await tx
      .update(interviewScorecards)
      .set({
        status: "Draft",
        submittedAt: null,
        revisionHistory: [...(scorecard.revisionHistory as unknown[]), revision],
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${interviewScorecards.recordVersion} + 1`,
      })
      .where(eq(interviewScorecards.id, scorecard.id));
    await audit(tx, organisationId, actor, {
      action: "reopen",
      entityType: "interview-scorecard",
      entityId: scorecard.id,
      reason: cleanReason,
      before: { status: "Submitted" },
      after: { status: "Draft", revision },
      riskLevel: "Critical",
    });
  });
}

export async function recordInterviewDispositionInDatabase(
  organisationId: string,
  interviewId: string,
  input: {
    outcome: InterviewDispositionOutcome;
    reason: string;
    futureVacancyIds?: string[];
    suggestedRoleTitles?: string[];
  },
  actor: AuditActorContext,
): Promise<string> {
  requireRecruiter(actor);
  const cleanReason = requireReason(input.reason);
  const futureVacancyIds = [...new Set(input.futureVacancyIds ?? [])];
  const suggestedRoleTitles = [
    ...new Set((input.suggestedRoleTitles ?? []).map((item) => item.trim()).filter(Boolean)),
  ];
  if (
    input.outcome === "Recommend for Another Role" &&
    !futureVacancyIds.length &&
    !suggestedRoleTitles.length
  )
    throw new Error("Add the vacancy or role being recommended.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [interview] = await tx
      .select()
      .from(interviews)
      .where(and(eq(interviews.organisationId, organisationId), eq(interviews.id, interviewId)))
      .for("update")
      .limit(1);
    if (!interview || !["Completed", "No Show"].includes(interview.status))
      throw new Error("Complete the interview before recording its outcome.");
    if (futureVacancyIds.length) {
      const rows = await tx
        .select({ id: vacancies.id })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.organisationId, organisationId),
            inArray(vacancies.id, futureVacancyIds),
          ),
        );
      if (rows.length !== futureVacancyIds.length)
        throw new Error("A selected future vacancy is invalid.");
    }
    const [existing] = await tx
      .select()
      .from(interviewDispositions)
      .where(
        and(
          eq(interviewDispositions.organisationId, organisationId),
          eq(interviewDispositions.interviewId, interviewId),
        ),
      )
      .for("update")
      .limit(1);
    const id = existing?.id ?? randomUUID();
    const recordedAt = new Date().toISOString();
    const values = {
      outcome: input.outcome,
      reason: cleanReason,
      futureVacancyIds,
      suggestedRoleTitles,
      recordedAt,
      recordedByUserId: actor.userId!,
      updatedAt: new Date(),
      updatedBy: actor.userId!,
    };
    if (existing)
      await tx
        .update(interviewDispositions)
        .set({ ...values, recordVersion: sql`${interviewDispositions.recordVersion} + 1` })
        .where(eq(interviewDispositions.id, id));
    else
      await tx.insert(interviewDispositions).values({
        id,
        organisationId,
        interviewId,
        candidateId: interview.candidateId,
        vacancyId: interview.vacancyId,
        ...values,
        createdBy: actor.userId!,
      });
    const candidateStage =
      input.outcome === "Recommend for Offer"
        ? "Offer"
        : input.outcome === "Proceed to Next Interview"
          ? "Interview"
          : input.outcome === "Do Not Proceed"
            ? "Not Selected"
            : input.outcome === "Candidate Withdrew"
              ? "Withdrawn"
              : "On Hold";
    const [candidate] = await tx
      .select()
      .from(candidates)
      .where(eq(candidates.id, interview.candidateId))
      .for("update")
      .limit(1);
    if (!candidate) throw new Error("Candidate not found.");
    const pools = [...(candidate.talentPools ?? [])];
    if (input.outcome === "Future Consideration" && !pools.includes("Future Consideration"))
      pools.push("Future Consideration");
    for (const title of suggestedRoleTitles)
      if (!pools.includes(`Future role: ${title}`)) pools.push(`Future role: ${title}`);
    await tx
      .update(candidates)
      .set({
        stage: candidateStage,
        talentPools: pools,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, candidate.id));
    if (interview.vacancyId) {
      const applicationStatus =
        input.outcome === "Do Not Proceed"
          ? "Rejected"
          : input.outcome === "Candidate Withdrew"
            ? "Withdrawn"
            : input.outcome === "Proceed to Next Interview" ||
                input.outcome === "Recommend for Offer"
              ? "Interviewing"
              : "On Hold";
      await tx
        .update(candidateApplications)
        .set({
          status: applicationStatus,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${candidateApplications.recordVersion} + 1`,
        })
        .where(
          and(
            eq(candidateApplications.organisationId, organisationId),
            eq(candidateApplications.vacancyId, interview.vacancyId),
            eq(candidateApplications.candidateId, interview.candidateId),
          ),
        );
    }
    await audit(tx, organisationId, actor, {
      action: existing ? "correct-outcome" : "record-outcome",
      entityType: "interview-disposition",
      entityId: id,
      reason: cleanReason,
      before: existing ? { outcome: existing.outcome, reason: existing.reason } : undefined,
      after: { outcome: input.outcome, futureVacancyIds, suggestedRoleTitles },
      riskLevel: "Critical",
    });
    return id;
  });
}

export async function recordManualInterviewOutcomeInDatabase(
  organisationId: string,
  interviewId: string,
  outcome: Exclude<ManualInterviewOutcome, "Pending">,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  requireRecruiter(actor);
  const cleanReason = requireReason(reason);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [interview] = await tx
      .select()
      .from(interviews)
      .where(and(eq(interviews.organisationId, organisationId), eq(interviews.id, interviewId)))
      .for("update")
      .limit(1);
    if (!interview || interview.source !== "Manual / Offline")
      throw new Error("Manual interview not found.");
    if (outcome === "Selected") {
      const panel = await tx
        .select({ userId: interviewPanelists.userId })
        .from(interviewPanelists)
        .where(eq(interviewPanelists.interviewId, interview.id));
      const scores = await tx
        .select({ panelUserId: interviewScorecards.panelUserId })
        .from(interviewScorecards)
        .where(
          and(
            eq(interviewScorecards.interviewId, interview.id),
            eq(interviewScorecards.status, "Submitted"),
          ),
        );
      if (new Set(scores.map((item) => item.panelUserId)).size !== panel.length)
        throw new Error("All scorecards must be submitted before selection.");
    }
    await tx
      .update(interviews)
      .set({
        manualOutcome: outcome,
        manualDecisionReason: cleanReason,
        history: [
          ...(interview.history as unknown[]),
          historyEntry(actor, `Manual outcome: ${outcome}`, cleanReason),
        ],
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${interviews.recordVersion} + 1`,
      })
      .where(eq(interviews.id, interview.id));
    const stage =
      outcome === "Selected"
        ? "Offer"
        : outcome === "Hold"
          ? "On Hold"
          : outcome === "Reject"
            ? "Not Selected"
            : "Interview";
    await tx
      .update(candidates)
      .set({
        stage,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${candidates.recordVersion} + 1`,
      })
      .where(eq(candidates.id, interview.candidateId));
    await audit(tx, organisationId, actor, {
      action: "manual-outcome",
      entityType: "interview",
      entityId: interview.id,
      reason: cleanReason,
      before: { manualOutcome: interview.manualOutcome },
      after: { manualOutcome: outcome },
      riskLevel: "Critical",
    });
  });
}
