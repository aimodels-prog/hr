import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { EmployeeGoal, GoalDraftInput, GoalStatus } from "../../data/goal-service.ts";
import type {
  PerformanceReview,
  ReviewCycle,
  ReviewTemplate,
} from "../../data/performance-types.ts";
import { getDatabaseClient } from "../client.ts";
import { readObjectFile } from "../object-storage.server.ts";
import { fileMetadata } from "../schema/documents.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  employeeGoals,
  goalCheckIns,
  performanceCycles,
  performanceReviews,
  reviewTemplates,
} from "../schema/talent.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function role(actor: AuditActorContext) {
  return actor.activeRole ?? actor.roles?.[0] ?? "Employee";
}
function isHr(actor: AuditActorContext) {
  return ["HR", "Super Admin"].includes(role(actor));
}
function auditActor(actor: AuditActorContext) {
  return {
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: role(actor),
    actorRoles: actor.roles ?? [],
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
    databaseId: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    recordVersion: row.recordVersion,
  };
}

async function visibleEmployeeIds(org: string, actor: AuditActorContext) {
  if (isHr(actor)) return null;
  if (!actor.employeeId) throw new Error("Your employee profile is not connected.");
  if (role(actor) !== "Line Manager") return [actor.employeeId];
  const reports = await getDatabaseClient()
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, org),
        eq(employees.lineManagerId, actor.employeeId),
        isNull(employees.archivedAt),
      ),
    );
  return [actor.employeeId, ...reports.map((item) => item.id)];
}

export interface PerformanceSnapshot {
  templates: ReviewTemplate[];
  cycles: ReviewCycle[];
  reviews: PerformanceReview[];
  goals: EmployeeGoal[];
}

async function ensureDefaultTemplate(org: string, actor: AuditActorContext) {
  const db = getDatabaseClient();
  const [existing] = await db
    .select({ id: reviewTemplates.id })
    .from(reviewTemplates)
    .where(and(eq(reviewTemplates.organisationId, org), isNull(reviewTemplates.archivedAt)))
    .limit(1);
  if (existing) return;
  await db
    .insert(reviewTemplates)
    .values({
      organisationId: org,
      name: "VIA Annual Performance Review",
      description: "Objectives, delivery and VIA workplace behaviours.",
      isActive: true,
      maxRating: 5,
      employeeCanSeeManagerRatings: true,
      sections: [
        {
          id: "objectives",
          title: "Objectives and results",
          weight: 60,
          items: [
            {
              id: "objective-results",
              title: "Objective achievement",
              description: "Progress against the measurable objectives agreed for this cycle.",
              evidencePrompt: "State the result and supporting evidence.",
              weight: 100,
            },
          ],
        },
        {
          id: "workplace-contribution",
          title: "Workplace contribution",
          weight: 40,
          items: [
            {
              id: "collaboration",
              title: "Collaboration",
              description: "Works constructively across teams and shares responsibility.",
              weight: 50,
            },
            {
              id: "delivery",
              title: "Reliable delivery",
              description: "Delivers agreed work safely, accurately and on time.",
              weight: 50,
            },
          ],
        },
      ],
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    } as typeof reviewTemplates.$inferInsert)
    .onConflictDoNothing();
}

export async function listPerformanceForActor(
  org: string,
  actor: AuditActorContext,
): Promise<PerformanceSnapshot> {
  await ensureDefaultTemplate(org, actor);
  const db = getDatabaseClient();
  const scoped = await visibleEmployeeIds(org, actor);
  const noScope = scoped !== null && scoped.length === 0;
  const [templateRows, cycleRows, reviewRows, goalRows] = await Promise.all([
    db
      .select()
      .from(reviewTemplates)
      .where(and(eq(reviewTemplates.organisationId, org), isNull(reviewTemplates.archivedAt))),
    db
      .select()
      .from(performanceCycles)
      .where(and(eq(performanceCycles.organisationId, org), isNull(performanceCycles.archivedAt))),
    noScope
      ? []
      : db
          .select()
          .from(performanceReviews)
          .where(
            and(
              eq(performanceReviews.organisationId, org),
              or(isNull(performanceReviews.archivedAt), eq(performanceReviews.status, "Corrected")),
              ...(scoped ? [inArray(performanceReviews.employeeId, scoped)] : []),
            ),
          ),
    noScope
      ? []
      : db
          .select()
          .from(employeeGoals)
          .where(
            and(
              eq(employeeGoals.organisationId, org),
              isNull(employeeGoals.archivedAt),
              ...(scoped ? [inArray(employeeGoals.employeeId, scoped)] : []),
            ),
          ),
  ]);
  const checkIns = goalRows.length
    ? await db
        .select()
        .from(goalCheckIns)
        .where(
          and(
            eq(goalCheckIns.organisationId, org),
            inArray(
              goalCheckIns.goalId,
              goalRows.map((item) => item.id),
            ),
          ),
        )
    : [];
  const templates = templateRows.map((row) => ({
    ...base(row),
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    maxRating: row.maxRating,
    sections: row.sections as ReviewTemplate["sections"],
    employeeCanSeeManagerRatings: row.employeeCanSeeManagerRatings,
  }));
  const cycles = cycleRows.map((row) => ({
    ...base(row),
    name: row.name,
    templateId: row.templateId,
    status: row.status,
    departments: row.departments,
    employmentTypes: row.employmentTypes,
    selfAssessmentDeadline: row.selfAssessmentDeadline,
    managerReviewDeadline: row.managerReviewDeadline,
    discussionDeadline: row.discussionDeadline,
    ...(row.objectiveSettingDeadline
      ? { objectiveSettingDeadline: row.objectiveSettingDeadline }
      : {}),
    requiresModeration: row.requiresModeration,
    ...(row.employeeCanSeeManagerRatings === null
      ? {}
      : { employeeCanSeeManagerRatings: row.employeeCanSeeManagerRatings }),
  }));
  const reviews = reviewRows.map((row) => ({
    ...base(row),
    employeeId: row.employeeId,
    cycleId: row.cycleId,
    templateId: row.templateId,
    status: row.status as PerformanceReview["status"],
    sections: row.sections as PerformanceReview["sections"],
    ...(row.overallSelfScore === null ? {} : { overallSelfScore: Number(row.overallSelfScore) }),
    ...(row.overallManagerScore === null
      ? {}
      : { overallManagerScore: Number(row.overallManagerScore) }),
    ...(row.managerSummaryComment ? { managerSummaryComment: row.managerSummaryComment } : {}),
    ...(row.developmentPlan ? { developmentPlan: row.developmentPlan } : {}),
    ...(row.discussionHeldAt ? { discussionHeldAt: row.discussionHeldAt } : {}),
    ...(row.discussionRecordedAt ? { discussionRecordedAt: row.discussionRecordedAt } : {}),
    ...(row.discussionRecordedBy ? { discussionRecordedBy: row.discussionRecordedBy } : {}),
    ...(row.discussionNotes ? { discussionNotes: row.discussionNotes } : {}),
    ...(row.employeeAcknowledgedAt ? { employeeAcknowledgedAt: row.employeeAcknowledgedAt } : {}),
    ...(row.employeeAcknowledgementComment
      ? { employeeAcknowledgementComment: row.employeeAcknowledgementComment }
      : {}),
    ...(row.employeeAgreesWithReview === null
      ? {}
      : { employeeAgreesWithReview: row.employeeAgreesWithReview }),
    ...(row.moderatedAt ? { moderatedAt: row.moderatedAt } : {}),
    ...(row.moderatedBy ? { moderatedBy: row.moderatedBy } : {}),
    ...(row.moderationComment ? { moderationComment: row.moderationComment } : {}),
    ...(row.lockedAt ? { lockedAt: row.lockedAt } : {}),
    ...(row.lockedBy ? { lockedBy: row.lockedBy } : {}),
    ...(row.correctedReason ? { correctedReason: row.correctedReason } : {}),
    ...(row.originalReviewId ? { originalReviewId: row.originalReviewId } : {}),
  }));
  const goals = goalRows.map((row) => ({
    ...base(row),
    employeeId: row.employeeId,
    cycleId: row.cycleId,
    title: row.title,
    description: row.description,
    successMeasure: row.successMeasure,
    targetValue: row.targetValue,
    startDate: row.startDate,
    dueDate: row.dueDate,
    weight: row.weight,
    progressPercent: row.progressPercent,
    status: row.status as GoalStatus,
    ...(row.managerFeedback ? { managerFeedback: row.managerFeedback } : {}),
    ...(row.submittedAt ? { submittedAt: row.submittedAt } : {}),
    ...(row.submittedBy ? { submittedBy: row.submittedBy } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt } : {}),
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.completedBy ? { completedBy: row.completedBy } : {}),
    checkIns: checkIns
      .filter((item) => item.goalId === row.id)
      .map((item) => ({
        id: item.id,
        progressPercent: item.progressPercent,
        progressComment: item.progressComment,
        ...(item.evidenceFileId ? { evidenceFileId: item.evidenceFileId } : {}),
        createdAt: item.createdAt,
        createdBy: item.createdBy,
      })),
  }));
  const safeReviews = reviews.map((review) => {
    if (
      role(actor) !== "Employee" ||
      ["Acknowledgement Pending", "Acknowledged", "Locked", "Corrected"].includes(review.status)
    )
      return review;
    const {
      overallManagerScore: _overallManagerScore,
      managerSummaryComment: _managerSummaryComment,
      developmentPlan: _developmentPlan,
      moderationComment: _moderationComment,
      ...visible
    } = review;
    return {
      ...visible,
      sections: review.sections.map((section) => {
        const { managerSectionScore: _score, ...visibleSection } = section;
        return {
          ...visibleSection,
          items: section.items.map((item) => {
            const { managerRating: _rating, managerComment: _comment, ...visibleItem } = item;
            return visibleItem;
          }),
        };
      }),
    } as unknown as PerformanceReview;
  });
  if (actor.userId)
    await db.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "view",
      module: "performance",
      entityType: "performance-register",
      entityId: org,
      afterSummary: { reviewCount: reviews.length, goalCount: goals.length },
      reason: "Viewed permitted performance records",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  return { templates, cycles, reviews: safeReviews, goals };
}

function requireHr(actor: AuditActorContext) {
  if (!isHr(actor)) throw new Error("Only HR or Super Admin can manage performance cycles.");
}

function validateTemplate(
  input: Pick<ReviewTemplate, "name" | "description" | "maxRating" | "sections">,
) {
  if (input.name.trim().length < 3 || input.description.trim().length < 3)
    throw new Error("Enter a clear template name and description.");
  if (!Number.isInteger(input.maxRating) || input.maxRating < 1 || input.maxRating > 10)
    throw new Error("Maximum rating must be from 1 to 10.");
  if (
    !input.sections.length ||
    input.sections.reduce((sum, section) => sum + section.weight, 0) !== 100
  )
    throw new Error("Template section weights must total 100%.");
  for (const section of input.sections) {
    if (
      !section.title.trim() ||
      !section.items.length ||
      section.items.reduce((sum, item) => sum + item.weight, 0) !== 100
    )
      throw new Error("Every section needs a title and item weights totalling 100%.");
  }
}

export async function savePerformanceTemplateInDatabase(
  org: string,
  input: Pick<
    ReviewTemplate,
    "name" | "description" | "isActive" | "maxRating" | "sections" | "employeeCanSeeManagerRatings"
  > & { templateId?: string; expectedVersion?: number },
  actor: AuditActorContext,
) {
  requireHr(actor);
  validateTemplate(input);
  const db = getDatabaseClient();
  const id = input.templateId ?? randomUUID();
  await db.transaction(async (tx) => {
    const existing = input.templateId
      ? (
          await tx
            .select()
            .from(reviewTemplates)
            .where(
              and(
                eq(reviewTemplates.organisationId, org),
                eq(reviewTemplates.id, input.templateId),
              ),
            )
            .for("update")
            .limit(1)
        )[0]
      : undefined;
    if (
      existing &&
      input.expectedVersion !== undefined &&
      existing.recordVersion !== input.expectedVersion
    )
      throw new Error("This template changed after you opened it. Reload and try again.");
    const values = {
      name: input.name.trim(),
      description: input.description.trim(),
      isActive: input.isActive,
      maxRating: input.maxRating,
      sections: input.sections,
      employeeCanSeeManagerRatings: input.employeeCanSeeManagerRatings,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (existing)
      await tx
        .update(reviewTemplates)
        .set({ ...values, recordVersion: sql`${reviewTemplates.recordVersion} + 1` })
        .where(eq(reviewTemplates.id, id));
    else
      await tx.insert(reviewTemplates).values({
        id,
        organisationId: org,
        ...values,
        createdBy: actor.userId,
      } as typeof reviewTemplates.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: existing ? "update" : "create",
      module: "performance",
      entityType: "performance-template",
      entityId: id,
      afterSummary: { name: input.name.trim(), sectionCount: input.sections.length },
      reason: existing ? "Updated performance template" : "Created performance template",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function archivePerformanceTemplateInDatabase(
  org: string,
  templateId: string,
  actor: AuditActorContext,
) {
  requireHr(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(reviewTemplates)
      .where(and(eq(reviewTemplates.organisationId, org), eq(reviewTemplates.id, templateId)))
      .for("update")
      .limit(1);
    if (!template || template.archivedAt) throw new Error("Performance template not found.");
    const [used] = await tx
      .select({ id: performanceCycles.id })
      .from(performanceCycles)
      .where(eq(performanceCycles.templateId, templateId))
      .limit(1);
    if (used)
      throw new Error("This template is used by a review cycle and must remain in history.");
    if (template.isActive) {
      const active = await tx
        .select({ id: reviewTemplates.id })
        .from(reviewTemplates)
        .where(
          and(
            eq(reviewTemplates.organisationId, org),
            eq(reviewTemplates.isActive, true),
            isNull(reviewTemplates.archivedAt),
          ),
        );
      if (active.length <= 1)
        throw new Error("At least one active performance template must remain.");
    }
    await tx
      .update(reviewTemplates)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${reviewTemplates.recordVersion} + 1`,
      })
      .where(eq(reviewTemplates.id, templateId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "archive",
      module: "performance",
      entityType: "performance-template",
      entityId: templateId,
      beforeSummary: { name: template.name },
      reason: "Archived performance template",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

function cycleSections(
  template: typeof reviewTemplates.$inferSelect,
  goals: (typeof employeeGoals.$inferSelect)[] = [],
) {
  return (template.sections as ReviewTemplate["sections"]).map((section) => ({
    templateSectionId: section.id,
    title: section.title,
    weight: section.weight,
    items: (/objective|goal/i.test(section.title) && goals.length
      ? goals.map((goal) => ({
          id: `goal-${goal.id}`,
          title: goal.title,
          description: `${goal.description} Target: ${goal.targetValue}. Measure: ${goal.successMeasure}.`,
          evidencePrompt: "Summarise the result and supporting evidence.",
          weight: goal.weight,
        }))
      : section.items
    ).map((item) => ({
      templateItemId: item.id,
      title: item.title,
      description: item.description,
      ...(item.evidencePrompt ? { evidencePrompt: item.evidencePrompt } : {}),
      weight: item.weight,
    })),
  }));
}

async function launchCycle(
  tx: Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0],
  org: string,
  cycle: typeof performanceCycles.$inferSelect,
  actor: AuditActorContext,
) {
  const [template] = await tx
    .select()
    .from(reviewTemplates)
    .where(
      and(
        eq(reviewTemplates.organisationId, org),
        eq(reviewTemplates.id, cycle.templateId),
        eq(reviewTemplates.isActive, true),
        isNull(reviewTemplates.archivedAt),
      ),
    )
    .limit(1);
  if (!template) throw new Error("Select an active review template.");
  const population = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, org),
        inArray(employees.status, ["Active", "Probation", "Notice"]),
        isNull(employees.archivedAt),
        ...(cycle.departments.length ? [inArray(employees.departmentId, cycle.departments)] : []),
        ...(cycle.employmentTypes.length
          ? [inArray(employees.employmentTypeId, cycle.employmentTypes)]
          : []),
      ),
    );
  if (!population.length) throw new Error("No active employees match this cycle's population.");
  const cycleGoals = await tx
    .select()
    .from(employeeGoals)
    .where(
      and(
        eq(employeeGoals.organisationId, org),
        eq(employeeGoals.cycleId, cycle.id),
        inArray(employeeGoals.status, ["Active", "Completed"]),
        isNull(employeeGoals.archivedAt),
      ),
    );
  await tx
    .insert(performanceReviews)
    .values(
      population.map(
        (employee) =>
          ({
            organisationId: org,
            employeeId: employee.id,
            cycleId: cycle.id,
            templateId: template.id,
            status: cycle.objectiveSettingDeadline
              ? "Objectives Pending"
              : "Self Assessment Pending",
            sections: cycleSections(
              template,
              cycleGoals.filter((goal) => goal.employeeId === employee.id),
            ),
            createdBy: actor.userId,
            updatedBy: actor.userId,
          }) as typeof performanceReviews.$inferInsert,
      ),
    )
    .onConflictDoNothing();
}

export async function savePerformanceCycleInDatabase(
  org: string,
  input: Pick<
    ReviewCycle,
    | "name"
    | "templateId"
    | "status"
    | "departments"
    | "employmentTypes"
    | "selfAssessmentDeadline"
    | "managerReviewDeadline"
    | "discussionDeadline"
    | "requiresModeration"
  > & {
    objectiveSettingDeadline?: string;
    employeeCanSeeManagerRatings?: boolean;
    cycleId?: string;
    expectedVersion?: number;
  },
  actor: AuditActorContext,
) {
  requireHr(actor);
  if (
    input.name.trim().length < 3 ||
    input.selfAssessmentDeadline > input.managerReviewDeadline ||
    input.managerReviewDeadline > input.discussionDeadline ||
    (input.objectiveSettingDeadline &&
      input.objectiveSettingDeadline > input.selfAssessmentDeadline)
  )
    throw new Error("Check the cycle name and deadline order.");
  const db = getDatabaseClient();
  const id = input.cycleId ?? randomUUID();
  await db.transaction(async (tx) => {
    const existing = input.cycleId
      ? (
          await tx
            .select()
            .from(performanceCycles)
            .where(
              and(
                eq(performanceCycles.organisationId, org),
                eq(performanceCycles.id, input.cycleId),
              ),
            )
            .for("update")
            .limit(1)
        )[0]
      : undefined;
    if (existing && existing.status !== "Draft")
      throw new Error("Only a draft cycle can be edited.");
    if (
      existing &&
      input.expectedVersion !== undefined &&
      existing.recordVersion !== input.expectedVersion
    )
      throw new Error("This cycle changed after you opened it. Reload and try again.");
    const values = {
      name: input.name.trim(),
      templateId: input.templateId,
      status: input.status,
      departments: [...new Set(input.departments)],
      employmentTypes: [...new Set(input.employmentTypes)],
      selfAssessmentDeadline: input.selfAssessmentDeadline,
      managerReviewDeadline: input.managerReviewDeadline,
      discussionDeadline: input.discussionDeadline,
      objectiveSettingDeadline: input.objectiveSettingDeadline ?? null,
      requiresModeration: input.requiresModeration,
      employeeCanSeeManagerRatings: input.employeeCanSeeManagerRatings ?? null,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (existing)
      await tx
        .update(performanceCycles)
        .set({ ...values, recordVersion: sql`${performanceCycles.recordVersion} + 1` })
        .where(eq(performanceCycles.id, id));
    else
      await tx.insert(performanceCycles).values({
        id,
        organisationId: org,
        ...values,
        createdBy: actor.userId,
      } as typeof performanceCycles.$inferInsert);
    const [cycle] = await tx
      .select()
      .from(performanceCycles)
      .where(eq(performanceCycles.id, id))
      .limit(1);
    if (cycle?.status === "Active") await launchCycle(tx, org, cycle, actor);
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: existing ? "update" : "create",
      module: "performance",
      entityType: "performance-cycle",
      entityId: id,
      afterSummary: { name: input.name.trim(), status: input.status },
      reason: existing ? "Updated performance cycle" : "Created performance cycle",
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function changePerformanceCycleStatusInDatabase(
  org: string,
  cycleId: string,
  status: "Active" | "Completed",
  expectedVersion: number,
  actor: AuditActorContext,
) {
  requireHr(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycles)
      .where(and(eq(performanceCycles.organisationId, org), eq(performanceCycles.id, cycleId)))
      .for("update")
      .limit(1);
    if (!cycle || cycle.recordVersion !== expectedVersion)
      throw new Error("This cycle changed after you opened it. Reload and try again.");
    if (status === "Active" && cycle.status !== "Draft")
      throw new Error("Only a draft cycle can be launched.");
    if (status === "Completed") {
      if (cycle.status !== "Active") throw new Error("Only an active cycle can be completed.");
      const unfinished = await tx
        .select({ id: performanceReviews.id })
        .from(performanceReviews)
        .where(
          and(
            eq(performanceReviews.cycleId, cycleId),
            isNull(performanceReviews.archivedAt),
            sql`${performanceReviews.status} NOT IN ('Locked','Corrected')`,
          ),
        )
        .limit(1);
      if (unfinished.length)
        throw new Error("Every review must be finalised before completing the cycle.");
    }
    await tx
      .update(performanceCycles)
      .set({
        status,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${performanceCycles.recordVersion} + 1`,
      })
      .where(eq(performanceCycles.id, cycleId));
    if (status === "Active") await launchCycle(tx, org, { ...cycle, status }, actor);
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: status === "Active" ? "launch" : "complete",
      module: "performance",
      entityType: "performance-cycle",
      entityId: cycleId,
      beforeSummary: { status: cycle.status },
      afterSummary: { status },
      reason: status === "Active" ? "Launched performance cycle" : "Completed performance cycle",
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export type ReviewAction =
  | { type: "self"; sections: PerformanceReview["sections"] }
  | {
      type: "manager";
      sections: PerformanceReview["sections"];
      summary: string;
      developmentPlan: string;
    }
  | { type: "moderate"; comment: string }
  | { type: "discussion"; heldAt: string; notes: string }
  | { type: "acknowledge"; agrees: boolean; comment?: string }
  | { type: "lock" }
  | {
      type: "correct";
      sections: PerformanceReview["sections"];
      summary: string;
      developmentPlan: string;
      reason: string;
    };

function mergeReviewAssessment(
  current: PerformanceReview["sections"],
  proposed: PerformanceReview["sections"],
  kind: "self" | "manager" | "both",
  maxRating: number,
) {
  if (current.length !== proposed.length)
    throw new Error("The review structure has changed. Reload it before submitting.");
  return current.map((section) => {
    const incomingSection = proposed.find(
      (item) => item.templateSectionId === section.templateSectionId,
    );
    if (!incomingSection || incomingSection.items.length !== section.items.length)
      throw new Error("The review structure has changed. Reload it before submitting.");
    const items = section.items.map((item) => {
      const incoming = incomingSection.items.find(
        (candidate) => candidate.templateItemId === item.templateItemId,
      );
      if (!incoming)
        throw new Error("The review structure has changed. Reload it before submitting.");
      const next = { ...item };
      if (kind === "self" || kind === "both") {
        if (
          !Number.isFinite(incoming.selfRating) ||
          incoming.selfRating! < 1 ||
          incoming.selfRating! > maxRating ||
          (incoming.selfComment?.trim().length ?? 0) < 3
        )
          throw new Error("Complete every employee rating and comment.");
        next.selfRating = incoming.selfRating!;
        next.selfComment = incoming.selfComment!.trim();
      }
      if (kind === "manager" || kind === "both") {
        if (
          !Number.isFinite(incoming.managerRating) ||
          incoming.managerRating! < 1 ||
          incoming.managerRating! > maxRating ||
          (incoming.managerComment?.trim().length ?? 0) < 3
        )
          throw new Error("Complete every supervisor rating and comment.");
        next.managerRating = incoming.managerRating!;
        next.managerComment = incoming.managerComment!.trim();
      }
      return next;
    });
    const selfScore = items.every((item) => item.selfRating !== undefined)
      ? items.reduce((sum, item) => sum + (item.selfRating! * item.weight) / 100, 0)
      : undefined;
    const managerScore = items.every((item) => item.managerRating !== undefined)
      ? items.reduce((sum, item) => sum + (item.managerRating! * item.weight) / 100, 0)
      : undefined;
    return {
      ...section,
      items,
      ...(selfScore === undefined ? {} : { selfSectionScore: selfScore }),
      ...(managerScore === undefined ? {} : { managerSectionScore: managerScore }),
    };
  });
}

function overallScore(sections: PerformanceReview["sections"], kind: "self" | "manager") {
  const field = kind === "self" ? "selfSectionScore" : "managerSectionScore";
  if (!sections.every((section) => section[field] !== undefined)) return null;
  return sections.reduce((sum, section) => sum + (section[field]! * section.weight) / 100, 0);
}

export async function actOnPerformanceReviewInDatabase(
  org: string,
  reviewId: string,
  expectedVersion: number,
  action: ReviewAction,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  let resultingId = reviewId;
  await db.transaction(async (tx) => {
    const [review] = await tx
      .select()
      .from(performanceReviews)
      .where(and(eq(performanceReviews.organisationId, org), eq(performanceReviews.id, reviewId)))
      .for("update")
      .limit(1);
    if (!review || review.recordVersion !== expectedVersion)
      throw new Error("This review changed after you opened it. Reload and try again.");
    const [template] = await tx
      .select()
      .from(reviewTemplates)
      .where(eq(reviewTemplates.id, review.templateId))
      .limit(1);
    const [cycle] = await tx
      .select()
      .from(performanceCycles)
      .where(eq(performanceCycles.id, review.cycleId))
      .limit(1);
    const [employee] = await tx
      .select({ managerId: employees.lineManagerId })
      .from(employees)
      .where(eq(employees.id, review.employeeId))
      .limit(1);
    if (!template || !cycle || !employee) throw new Error("The review setup is incomplete.");
    const self = actor.employeeId === review.employeeId;
    const manager =
      role(actor) === "Line Manager" && actor.employeeId === employee.managerId && !self;
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: actor.userId,
      recordVersion: sql`${performanceReviews.recordVersion} + 1`,
    };
    if (action.type === "self") {
      if (!self || role(actor) !== "Employee" || review.status !== "Self Assessment Pending")
        throw new Error("Only the employee can submit this self-assessment now.");
      const sections = mergeReviewAssessment(
        review.sections as PerformanceReview["sections"],
        action.sections,
        "self",
        template.maxRating,
      );
      Object.assign(updates, {
        sections,
        overallSelfScore: String(overallScore(sections, "self")),
        status: "Manager Review Pending",
      });
    } else if (action.type === "manager") {
      if (!manager || review.status !== "Manager Review Pending")
        throw new Error("Only the employee's assigned supervisor can submit this review now.");
      if (action.summary.trim().length < 10 || action.developmentPlan.trim().length < 10)
        throw new Error("Enter a meaningful summary and development plan.");
      const sections = mergeReviewAssessment(
        review.sections as PerformanceReview["sections"],
        action.sections,
        "manager",
        template.maxRating,
      );
      Object.assign(updates, {
        sections,
        overallManagerScore: String(overallScore(sections, "manager")),
        managerSummaryComment: action.summary.trim(),
        developmentPlan: action.developmentPlan.trim(),
        status: cycle.requiresModeration ? "Moderation Pending" : "Discussion Pending",
      });
    } else if (action.type === "moderate") {
      if (
        !isHr(actor) ||
        review.status !== "Moderation Pending" ||
        action.comment.trim().length < 5
      )
        throw new Error("Only HR can complete moderation with a clear outcome.");
      Object.assign(updates, {
        status: "Discussion Pending",
        moderatedAt: new Date().toISOString(),
        moderatedBy: actor.userId,
        moderationComment: action.comment.trim(),
      });
    } else if (action.type === "discussion") {
      if (
        !manager ||
        review.status !== "Discussion Pending" ||
        action.notes.trim().length < 10 ||
        Number.isNaN(Date.parse(action.heldAt)) ||
        new Date(action.heldAt) > new Date()
      )
        throw new Error(
          "Only the assigned supervisor can record a completed discussion with valid notes and date.",
        );
      Object.assign(updates, {
        status: "Acknowledgement Pending",
        discussionHeldAt: new Date(action.heldAt).toISOString(),
        discussionRecordedAt: new Date().toISOString(),
        discussionRecordedBy: actor.userId,
        discussionNotes: action.notes.trim(),
      });
    } else if (action.type === "acknowledge") {
      if (
        !self ||
        role(actor) !== "Employee" ||
        review.status !== "Acknowledgement Pending" ||
        (!action.agrees && (action.comment?.trim().length ?? 0) < 5)
      )
        throw new Error("Only the employee can acknowledge this review; explain any disagreement.");
      Object.assign(updates, {
        status: "Acknowledged",
        employeeAcknowledgedAt: new Date().toISOString(),
        employeeAgreesWithReview: action.agrees,
        employeeAcknowledgementComment: action.comment?.trim() || null,
      });
    } else if (action.type === "lock") {
      if (!isHr(actor) || review.status !== "Acknowledged")
        throw new Error("Only HR or Super Admin can finalise an acknowledged review.");
      Object.assign(updates, {
        status: "Locked",
        lockedAt: new Date().toISOString(),
        lockedBy: actor.userId,
      });
    } else {
      if (!isHr(actor) || review.status !== "Locked" || action.reason.trim().length < 10)
        throw new Error(
          "Only HR or Super Admin can correct a locked review with a detailed reason.",
        );
      if (action.summary.trim().length < 10 || action.developmentPlan.trim().length < 10)
        throw new Error("A corrected review requires a summary and development plan.");
      const sections = mergeReviewAssessment(
        review.sections as PerformanceReview["sections"],
        action.sections,
        "both",
        template.maxRating,
      );
      resultingId = randomUUID();
      await tx
        .update(performanceReviews)
        .set({
          status: "Corrected",
          archivedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${performanceReviews.recordVersion} + 1`,
        })
        .where(eq(performanceReviews.id, reviewId));
      await tx.insert(performanceReviews).values({
        id: resultingId,
        organisationId: org,
        employeeId: review.employeeId,
        cycleId: review.cycleId,
        templateId: review.templateId,
        status: "Locked",
        sections,
        overallSelfScore: String(overallScore(sections, "self")),
        overallManagerScore: String(overallScore(sections, "manager")),
        managerSummaryComment: action.summary.trim(),
        developmentPlan: action.developmentPlan.trim(),
        discussionHeldAt: review.discussionHeldAt,
        discussionRecordedAt: review.discussionRecordedAt,
        discussionRecordedBy: review.discussionRecordedBy,
        discussionNotes: review.discussionNotes,
        employeeAcknowledgedAt: review.employeeAcknowledgedAt,
        employeeAcknowledgementComment: review.employeeAcknowledgementComment,
        employeeAgreesWithReview: review.employeeAgreesWithReview,
        moderatedAt: review.moderatedAt,
        moderatedBy: review.moderatedBy,
        moderationComment: review.moderationComment,
        lockedAt: new Date().toISOString(),
        lockedBy: actor.userId,
        correctedReason: action.reason.trim(),
        originalReviewId: reviewId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof performanceReviews.$inferInsert);
    }
    if (action.type !== "correct")
      await tx
        .update(performanceReviews)
        .set(updates as typeof performanceReviews.$inferInsert)
        .where(eq(performanceReviews.id, reviewId));
    const employeeUser = await tx
      .select({ userId: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.employeeId, review.employeeId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    const managerUser = employee.managerId
      ? await tx
          .select({ userId: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, org),
              eq(users.employeeId, employee.managerId),
              eq(users.status, "Active"),
            ),
          )
          .limit(1)
      : [];
    const hrUsers = await tx
      .selectDistinct({ userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.status, "Active"),
          inArray(roles.code, ["HR", "Super Admin"]),
        ),
      );
    const recipients =
      action.type === "self"
        ? managerUser
        : action.type === "manager" && cycle.requiresModeration
          ? hrUsers
          : action.type === "manager" || action.type === "moderate"
            ? managerUser
            : action.type === "acknowledge"
              ? hrUsers
              : employeeUser;
    const nextStatus = action.type === "correct" ? "Locked" : String(updates["status"]);
    for (const recipient of recipients) {
      await tx
        .insert(notifications)
        .values({
          organisationId: org,
          recipientUserId: recipient.userId,
          type: "performance-review",
          title: "Performance review updated",
          message: `The review has moved to ${nextStatus}.`,
          priority: ["Moderation Pending", "Acknowledged"].includes(nextStatus) ? "High" : "Normal",
          status: "Unread",
          deduplicationKey: `performance-review-${resultingId}-${action.type}-${review.recordVersion + 1}`,
          link: {
            entityType: "performance-review",
            entityId: resultingId,
            path:
              action.type === "discussion" || action.type === "lock" || action.type === "correct"
                ? `/staff/performance/reviews/${resultingId}`
                : "/staff/performance/team",
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: action.type,
      module: "performance",
      entityType: "performance-review",
      entityId: resultingId,
      beforeSummary: { reviewId, status: review.status, recordVersion: review.recordVersion },
      afterSummary: {
        resultingId,
        status: action.type === "correct" ? "Locked" : updates["status"],
      },
      reason:
        action.type === "correct"
          ? action.reason.trim()
          : `Completed performance ${action.type} stage`,
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
  return resultingId;
}

async function requireSelfOrManager(
  tx: Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0],
  org: string,
  employeeId: string,
  actor: AuditActorContext,
  selfOnly = false,
) {
  if (actor.employeeId === employeeId) return;
  if (selfOnly || role(actor) !== "Line Manager" || !actor.employeeId)
    throw new Error("You are not authorised for this employee's objectives.");
  const [employee] = await tx
    .select({ managerId: employees.lineManagerId })
    .from(employees)
    .where(and(eq(employees.organisationId, org), eq(employees.id, employeeId)))
    .limit(1);
  if (employee?.managerId !== actor.employeeId)
    throw new Error("Only the employee's assigned supervisor can take this action.");
}

function validateGoal(input: GoalDraftInput) {
  if (
    [input.title, input.description, input.successMeasure, input.targetValue].some(
      (value) => value.trim().length < 3,
    )
  )
    throw new Error("Complete the objective, description, success measure and target.");
  if (input.startDate > input.dueDate)
    throw new Error("Objective due date must be after its start date.");
  if (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 100)
    throw new Error("Objective weight must be from 1 to 100%.");
}

export async function saveGoalInDatabase(
  org: string,
  input: GoalDraftInput & { goalId?: string; expectedVersion?: number },
  actor: AuditActorContext,
) {
  validateGoal(input);
  if (!actor.employeeId || input.employeeId !== actor.employeeId)
    throw new Error("Employees can create or edit only their own objectives.");
  const db = getDatabaseClient();
  const id = input.goalId ?? randomUUID();
  await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(performanceCycles)
      .where(
        and(
          eq(performanceCycles.organisationId, org),
          eq(performanceCycles.id, input.cycleId),
          eq(performanceCycles.status, "Active"),
        ),
      )
      .limit(1);
    if (!cycle) throw new Error("Select an active performance cycle.");
    if (input.startDate > cycle.discussionDeadline || input.dueDate > cycle.discussionDeadline)
      throw new Error("Objective dates must fall within the performance cycle.");
    const existing = input.goalId
      ? (
          await tx
            .select()
            .from(employeeGoals)
            .where(and(eq(employeeGoals.organisationId, org), eq(employeeGoals.id, input.goalId)))
            .for("update")
            .limit(1)
        )[0]
      : undefined;
    if (existing && !["Draft", "Changes Requested"].includes(existing.status))
      throw new Error("This objective can no longer be edited.");
    if (
      existing &&
      input.expectedVersion !== undefined &&
      existing.recordVersion !== input.expectedVersion
    )
      throw new Error("This objective changed after you opened it. Reload and try again.");
    const other = await tx
      .select({ weight: employeeGoals.weight })
      .from(employeeGoals)
      .where(
        and(
          eq(employeeGoals.organisationId, org),
          eq(employeeGoals.employeeId, input.employeeId),
          eq(employeeGoals.cycleId, input.cycleId),
          isNull(employeeGoals.archivedAt),
          sql`${employeeGoals.id} <> ${id}`,
          sql`${employeeGoals.status} <> 'Cancelled'`,
        ),
      );
    if (other.reduce((sum, item) => sum + item.weight, input.weight) > 100)
      throw new Error("Objective weights cannot exceed 100% for a cycle.");
    const values = {
      employeeId: input.employeeId,
      cycleId: input.cycleId,
      title: input.title.trim(),
      description: input.description.trim(),
      successMeasure: input.successMeasure.trim(),
      targetValue: input.targetValue.trim(),
      startDate: input.startDate,
      dueDate: input.dueDate,
      weight: input.weight,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (existing)
      await tx
        .update(employeeGoals)
        .set({ ...values, recordVersion: sql`${employeeGoals.recordVersion} + 1` })
        .where(eq(employeeGoals.id, id));
    else
      await tx.insert(employeeGoals).values({
        id,
        organisationId: org,
        ...values,
        status: "Draft",
        progressPercent: 0,
        createdBy: actor.userId,
      } as typeof employeeGoals.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: existing ? "update" : "create",
      module: "performance",
      entityType: "employee-goal",
      entityId: id,
      afterSummary: {
        employeeId: input.employeeId,
        cycleId: input.cycleId,
        title: input.title.trim(),
        weight: input.weight,
      },
      reason: existing ? "Updated an objective" : "Created an objective",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function submitGoalsInDatabase(
  org: string,
  employeeId: string,
  cycleId: string,
  actor: AuditActorContext,
) {
  if (actor.employeeId !== employeeId)
    throw new Error("Employees can submit only their own objectives.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const goals = await tx
      .select()
      .from(employeeGoals)
      .where(
        and(
          eq(employeeGoals.organisationId, org),
          eq(employeeGoals.employeeId, employeeId),
          eq(employeeGoals.cycleId, cycleId),
          isNull(employeeGoals.archivedAt),
          sql`${employeeGoals.status} <> 'Cancelled'`,
        ),
      )
      .for("update");
    if (!goals.length || goals.reduce((sum, item) => sum + item.weight, 0) !== 100)
      throw new Error("Objective weights must total 100% before submission.");
    if (goals.some((item) => !["Draft", "Changes Requested"].includes(item.status)))
      throw new Error("Only a complete draft objective set can be submitted.");
    const [employee] = await tx
      .select({ managerId: employees.lineManagerId })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!employee?.managerId) throw new Error("Assign a supervisor before submitting objectives.");
    const [manager] = await tx
      .select({ userId: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.employeeId, employee.managerId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    const now = new Date().toISOString();
    await tx
      .update(employeeGoals)
      .set({
        status: "Pending Approval",
        submittedAt: now,
        submittedBy: actor.userId,
        managerFeedback: null,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employeeGoals.recordVersion} + 1`,
      })
      .where(
        and(
          eq(employeeGoals.employeeId, employeeId),
          eq(employeeGoals.cycleId, cycleId),
          inArray(
            employeeGoals.id,
            goals.map((item) => item.id),
          ),
        ),
      );
    if (manager)
      await tx
        .insert(notifications)
        .values({
          organisationId: org,
          recipientUserId: manager.userId,
          type: "performance-objectives",
          title: "Objectives awaiting approval",
          message: "A direct report submitted their objectives for review.",
          priority: "High",
          status: "Unread",
          deduplicationKey: `performance-goals-${employeeId}-${cycleId}`,
          link: {
            entityType: "performance-cycle",
            entityId: cycleId,
            path: "/staff/performance/team",
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "submit",
      module: "performance",
      entityType: "objective-set",
      entityId: cycleId,
      afterSummary: { employeeId, goalCount: goals.length },
      reason: "Submitted objectives for supervisor approval",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function decideGoalInDatabase(
  org: string,
  goalId: string,
  decision: "approve" | "return" | "complete",
  feedback: string | undefined,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [goal] = await tx
      .select()
      .from(employeeGoals)
      .where(and(eq(employeeGoals.organisationId, org), eq(employeeGoals.id, goalId)))
      .for("update")
      .limit(1);
    if (!goal) throw new Error("Objective not found.");
    await requireSelfOrManager(tx, org, goal.employeeId, actor);
    if (actor.employeeId === goal.employeeId)
      throw new Error("You cannot approve your own objective.");
    if (decision === "approve" && goal.status !== "Pending Approval")
      throw new Error("This objective is not awaiting approval.");
    if (decision === "complete" && goal.status !== "Completion Pending")
      throw new Error("This objective is not awaiting completion confirmation.");
    if (decision === "return" && !["Pending Approval", "Completion Pending"].includes(goal.status))
      throw new Error("This objective cannot be returned now.");
    if (decision === "return" && (feedback?.trim().length ?? 0) < 5)
      throw new Error("Explain what the employee should change.");
    const status: GoalStatus =
      decision === "approve"
        ? "Active"
        : decision === "complete"
          ? "Completed"
          : "Changes Requested";
    await tx
      .update(employeeGoals)
      .set({
        status,
        managerFeedback: feedback?.trim() ?? null,
        ...(decision === "approve"
          ? { approvedAt: new Date().toISOString(), approvedBy: actor.userId }
          : {}),
        ...(decision === "complete"
          ? {
              completedAt: new Date().toISOString(),
              completedBy: actor.userId,
              progressPercent: 100,
            }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employeeGoals.recordVersion} + 1`,
      })
      .where(eq(employeeGoals.id, goalId));
    if (decision === "approve") {
      const remaining = await tx
        .select({ id: employeeGoals.id })
        .from(employeeGoals)
        .where(
          and(
            eq(employeeGoals.organisationId, org),
            eq(employeeGoals.employeeId, goal.employeeId),
            eq(employeeGoals.cycleId, goal.cycleId),
            isNull(employeeGoals.archivedAt),
            sql`${employeeGoals.id} <> ${goalId}`,
            sql`${employeeGoals.status} NOT IN ('Active','Completed','Cancelled')`,
          ),
        )
        .limit(1);
      if (!remaining.length) {
        const [review] = await tx
          .select()
          .from(performanceReviews)
          .where(
            and(
              eq(performanceReviews.employeeId, goal.employeeId),
              eq(performanceReviews.cycleId, goal.cycleId),
              isNull(performanceReviews.archivedAt),
            ),
          )
          .for("update")
          .limit(1);
        if (review?.status === "Objectives Pending") {
          const [template] = await tx
            .select()
            .from(reviewTemplates)
            .where(eq(reviewTemplates.id, review.templateId))
            .limit(1);
          const activeGoals = await tx
            .select()
            .from(employeeGoals)
            .where(
              and(
                eq(employeeGoals.employeeId, goal.employeeId),
                eq(employeeGoals.cycleId, goal.cycleId),
                isNull(employeeGoals.archivedAt),
                sql`(${employeeGoals.status} IN ('Active','Completed') OR ${employeeGoals.id} = ${goalId})`,
              ),
            );
          if (template)
            await tx
              .update(performanceReviews)
              .set({
                status: "Self Assessment Pending",
                sections: cycleSections(
                  template,
                  activeGoals.map((item) =>
                    item.id === goalId ? { ...item, status: "Active" } : item,
                  ),
                ),
                updatedAt: new Date(),
                updatedBy: actor.userId,
                recordVersion: sql`${performanceReviews.recordVersion} + 1`,
              })
              .where(eq(performanceReviews.id, review.id));
        }
      }
    }
    const [recipient] = await tx
      .select({ userId: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.employeeId, goal.employeeId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    if (recipient)
      await tx
        .insert(notifications)
        .values({
          organisationId: org,
          recipientUserId: recipient.userId,
          type: "performance-objective-decision",
          title:
            decision === "return"
              ? "Objective returned for changes"
              : decision === "complete"
                ? "Objective completion confirmed"
                : "Objective approved",
          message: feedback?.trim() || `Your objective is now ${status.toLowerCase()}.`,
          priority: decision === "return" ? "High" : "Normal",
          status: "Unread",
          deduplicationKey: `performance-goal-${goalId}-${goal.recordVersion + 1}`,
          link: { entityType: "employee-goal", entityId: goalId, path: "/staff/me/performance" },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: decision,
      module: "performance",
      entityType: "employee-goal",
      entityId: goalId,
      beforeSummary: { status: goal.status },
      afterSummary: { status },
      reason: feedback?.trim() || `Objective ${decision}`,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function archiveGoalInDatabase(org: string, goalId: string, actor: AuditActorContext) {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [goal] = await tx
      .select()
      .from(employeeGoals)
      .where(and(eq(employeeGoals.organisationId, org), eq(employeeGoals.id, goalId)))
      .for("update")
      .limit(1);
    if (!goal) throw new Error("Objective not found.");
    if (goal.employeeId !== actor.employeeId)
      throw new Error("Employees can remove only their own objectives.");
    if (!["Draft", "Changes Requested"].includes(goal.status))
      throw new Error("Only a draft objective can be removed.");
    await tx
      .update(employeeGoals)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employeeGoals.recordVersion} + 1`,
      })
      .where(eq(employeeGoals.id, goalId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "archive",
      module: "performance",
      entityType: "employee-goal",
      entityId: goalId,
      beforeSummary: { title: goal.title, status: goal.status },
      reason: "Removed a draft objective",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function recordGoalProgressInDatabase(
  org: string,
  goalId: string,
  progressPercent: number,
  comment: string,
  evidenceFileId: string | undefined,
  actor: AuditActorContext,
) {
  if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100)
    throw new Error("Progress must be from 0 to 100%.");
  if (comment.trim().length < 3) throw new Error("Add a progress update.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [goal] = await tx
      .select()
      .from(employeeGoals)
      .where(and(eq(employeeGoals.organisationId, org), eq(employeeGoals.id, goalId)))
      .for("update")
      .limit(1);
    if (!goal || goal.status !== "Active")
      throw new Error("Only an active objective can be updated.");
    await requireSelfOrManager(tx, org, goal.employeeId, actor, true);
    if (evidenceFileId) {
      const [file] = await tx
        .select()
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, org),
            eq(fileMetadata.id, evidenceFileId),
            eq(fileMetadata.storageStatus, "Available"),
          ),
        )
        .limit(1);
      if (!file || file.ownerEntityType !== "performance-goal" || file.ownerEntityId !== goalId)
        throw new Error("The supporting file does not belong to this objective.");
    }
    const id = randomUUID();
    await tx.insert(goalCheckIns).values({
      id,
      organisationId: org,
      goalId,
      progressPercent,
      progressComment: comment.trim(),
      ...(evidenceFileId ? { evidenceFileId } : {}),
      createdBy: actor.userId!,
    });
    await tx
      .update(employeeGoals)
      .set({
        progressPercent,
        status: progressPercent === 100 ? "Completion Pending" : "Active",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${employeeGoals.recordVersion} + 1`,
      })
      .where(eq(employeeGoals.id, goalId));
    const [employee] = await tx
      .select({ managerId: employees.lineManagerId })
      .from(employees)
      .where(and(eq(employees.organisationId, org), eq(employees.id, goal.employeeId)))
      .limit(1);
    const notifyEmployeeId =
      actor.employeeId === goal.employeeId ? employee?.managerId : goal.employeeId;
    if (notifyEmployeeId) {
      const [recipient] = await tx
        .select({ userId: users.id })
        .from(users)
        .where(
          and(
            eq(users.organisationId, org),
            eq(users.employeeId, notifyEmployeeId),
            eq(users.status, "Active"),
          ),
        )
        .limit(1);
      if (recipient)
        await tx
          .insert(notifications)
          .values({
            organisationId: org,
            recipientUserId: recipient.userId,
            type: "performance-objective-progress",
            title: progressPercent === 100 ? "Objective ready for review" : "Objective updated",
            message: `${goal.title} is now ${progressPercent}% complete.`,
            priority: progressPercent === 100 ? "High" : "Normal",
            status: "Unread",
            deduplicationKey: `performance-goal-progress-${id}`,
            link: {
              entityType: "employee-goal",
              entityId: goalId,
              path:
                actor.employeeId === goal.employeeId
                  ? "/staff/performance/team"
                  : "/staff/me/performance",
            },
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof notifications.$inferInsert)
          .onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "check-in",
      module: "performance",
      entityType: "employee-goal",
      entityId: goalId,
      afterSummary: { progressPercent, evidenceFileId: evidenceFileId ?? null },
      reason: comment.trim(),
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function readGoalEvidenceInDatabase(
  org: string,
  goalId: string,
  checkInId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  const [goal] = await db
    .select()
    .from(employeeGoals)
    .where(and(eq(employeeGoals.organisationId, org), eq(employeeGoals.id, goalId)))
    .limit(1);
  if (!goal) throw new Error("Objective not found.");
  const scoped = await visibleEmployeeIds(org, actor);
  if (scoped && !scoped.includes(goal.employeeId))
    throw new Error("You are not authorised to view this objective evidence.");
  const [checkIn] = await db
    .select()
    .from(goalCheckIns)
    .where(
      and(
        eq(goalCheckIns.organisationId, org),
        eq(goalCheckIns.goalId, goalId),
        eq(goalCheckIns.id, checkInId),
      ),
    )
    .limit(1);
  if (!checkIn?.evidenceFileId) throw new Error("No supporting file is attached to this update.");
  return readObjectFile(
    org,
    checkIn.evidenceFileId,
    {
      ...(actor.userId ? { userId: actor.userId } : {}),
      ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      displayName: actor.displayName,
      activeRole: role(actor),
      ...(actor.roles ? { roles: actor.roles } : {}),
    },
    `Viewed evidence for performance objective ${goalId}`,
  );
}
