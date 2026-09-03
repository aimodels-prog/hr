import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import { deleteObjectFile, saveObjectFile } from "../db/object-storage.server.ts";
import {
  actOnPerformanceReviewInDatabase,
  archivePerformanceTemplateInDatabase,
  archiveGoalInDatabase,
  changePerformanceCycleStatusInDatabase,
  decideGoalInDatabase,
  listPerformanceForActor,
  readGoalEvidenceInDatabase,
  recordGoalProgressInDatabase,
  savePerformanceCycleInDatabase,
  savePerformanceTemplateInDatabase,
  saveGoalInDatabase,
  submitGoalsInDatabase,
  type ReviewAction as DatabaseReviewAction,
} from "../db/repositories/performance.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: actor.activeRole } };
}
const GoalInput = z.object({
  employeeId: z.string().uuid(),
  cycleId: z.string().uuid(),
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().min(3).max(4000),
  successMeasure: z.string().trim().min(3).max(2000),
  targetValue: z.string().trim().min(1).max(1000),
  startDate: z.string().date(),
  dueDate: z.string().date(),
  weight: z.number().int().min(1).max(100),
});
const TemplateSection = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(300),
    weight: z.number().int().min(1).max(100),
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            title: z.string().trim().min(1).max(300),
            description: z.string().trim().min(1).max(2000),
            evidencePrompt: z.string().trim().max(1000).optional(),
            weight: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const ReviewSection = z
  .object({
    templateSectionId: z.string().min(1),
    title: z.string(),
    weight: z.number(),
    selfSectionScore: z.number().optional(),
    managerSectionScore: z.number().optional(),
    items: z.array(
      z
        .object({
          templateItemId: z.string().min(1),
          title: z.string(),
          description: z.string(),
          evidencePrompt: z.string().optional(),
          weight: z.number(),
          selfRating: z.number().optional(),
          selfComment: z.string().optional(),
          managerRating: z.number().optional(),
          managerComment: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const ReviewAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("self"), sections: z.array(ReviewSection) }).strict(),
  z
    .object({
      type: z.literal("manager"),
      sections: z.array(ReviewSection),
      summary: z.string(),
      developmentPlan: z.string(),
    })
    .strict(),
  z.object({ type: z.literal("moderate"), comment: z.string() }).strict(),
  z.object({ type: z.literal("discussion"), heldAt: z.string(), notes: z.string() }).strict(),
  z
    .object({ type: z.literal("acknowledge"), agrees: z.boolean(), comment: z.string().optional() })
    .strict(),
  z.object({ type: z.literal("lock") }).strict(),
  z
    .object({
      type: z.literal("correct"),
      sections: z.array(ReviewSection),
      summary: z.string(),
      developmentPlan: z.string(),
      reason: z.string(),
    })
    .strict(),
]);
const Evidence = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
function evidenceBytes(input: z.infer<typeof Evidence>) {
  const bytes = Uint8Array.from(input.bytes);
  const valid =
    (input.mimeType === "application/pdf" &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46) ||
    (input.mimeType === "image/jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (input.mimeType === "image/png" &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47);
  if (!valid) throw new Error("The uploaded content does not match its file type.");
  return bytes;
}

export const getPerformanceSnapshotFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listPerformanceForActor(v.organisationId, v.actor);
  });

export const savePerformanceTemplateFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        templateId: z.string().uuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
        name: z.string().trim().min(3).max(300),
        description: z.string().trim().min(3).max(4000),
        isActive: z.boolean(),
        maxRating: z.number().int().min(1).max(10),
        sections: z.array(TemplateSection).min(1).max(20),
        employeeCanSeeManagerRatings: z.boolean(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return savePerformanceTemplateInDatabase(
      v.organisationId,
      {
        name: data.name,
        description: data.description,
        isActive: data.isActive,
        maxRating: data.maxRating,
        sections: data.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            weight: item.weight,
            ...(item.evidencePrompt ? { evidencePrompt: item.evidencePrompt } : {}),
          })),
        })),
        employeeCanSeeManagerRatings: data.employeeCanSeeManagerRatings,
        ...(data.templateId ? { templateId: data.templateId } : {}),
        ...(data.expectedVersion ? { expectedVersion: data.expectedVersion } : {}),
      },
      v.actor,
    );
  });

export const archivePerformanceTemplateFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, templateId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await archivePerformanceTemplateInDatabase(v.organisationId, data.templateId, v.actor);
  });

export const savePerformanceCycleFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        cycleId: z.string().uuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
        name: z.string().trim().min(3).max(300),
        templateId: z.string().uuid(),
        status: z.enum(["Draft", "Active"]),
        departments: z.array(z.string().uuid()).max(500),
        employmentTypes: z.array(z.string().uuid()).max(100),
        selfAssessmentDeadline: z.string().date(),
        managerReviewDeadline: z.string().date(),
        discussionDeadline: z.string().date(),
        objectiveSettingDeadline: z.string().date().optional(),
        requiresModeration: z.boolean(),
        employeeCanSeeManagerRatings: z.boolean().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return savePerformanceCycleInDatabase(
      v.organisationId,
      {
        name: data.name,
        templateId: data.templateId,
        status: data.status,
        departments: data.departments,
        employmentTypes: data.employmentTypes,
        selfAssessmentDeadline: data.selfAssessmentDeadline,
        managerReviewDeadline: data.managerReviewDeadline,
        discussionDeadline: data.discussionDeadline,
        requiresModeration: data.requiresModeration,
        ...(data.objectiveSettingDeadline
          ? { objectiveSettingDeadline: data.objectiveSettingDeadline }
          : {}),
        ...(data.employeeCanSeeManagerRatings === undefined
          ? {}
          : { employeeCanSeeManagerRatings: data.employeeCanSeeManagerRatings }),
        ...(data.cycleId ? { cycleId: data.cycleId } : {}),
        ...(data.expectedVersion ? { expectedVersion: data.expectedVersion } : {}),
      },
      v.actor,
    );
  });

export const changePerformanceCycleStatusFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        cycleId: z.string().uuid(),
        status: z.enum(["Active", "Completed"]),
        expectedVersion: z.number().int().positive(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await changePerformanceCycleStatusInDatabase(
      v.organisationId,
      data.cycleId,
      data.status,
      data.expectedVersion,
      v.actor,
    );
  });

export const actOnPerformanceReviewFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        reviewId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        action: ReviewAction,
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return actOnPerformanceReviewInDatabase(
      v.organisationId,
      data.reviewId,
      data.expectedVersion,
      data.action as unknown as DatabaseReviewAction,
      v.actor,
    );
  });

export const saveGoalFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        goal: GoalInput,
        goalId: z.string().uuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveGoalInDatabase(
      v.organisationId,
      {
        ...data.goal,
        ...(data.goalId ? { goalId: data.goalId } : {}),
        ...(data.expectedVersion ? { expectedVersion: data.expectedVersion } : {}),
      },
      v.actor,
    );
  });

export const submitGoalsFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, employeeId: z.string().uuid(), cycleId: z.string().uuid() })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await submitGoalsInDatabase(v.organisationId, data.employeeId, data.cycleId, v.actor);
  });

export const decideGoalFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        goalId: z.string().uuid(),
        decision: z.enum(["approve", "return", "complete"]),
        feedback: z.string().trim().max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await decideGoalInDatabase(
      v.organisationId,
      data.goalId,
      data.decision,
      data.feedback,
      v.actor,
    );
  });

export const archiveGoalFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, goalId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await archiveGoalInDatabase(v.organisationId, data.goalId, v.actor);
  });

export const recordGoalProgressFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        goalId: z.string().uuid(),
        progressPercent: z.number().int().min(0).max(100),
        comment: z.string().trim().min(3).max(4000),
        evidence: Evidence.optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    let evidenceFileId: string | undefined;
    if (data.evidence) {
      evidenceFileId = crypto.randomUUID();
      await saveObjectFile({
        id: evidenceFileId,
        organisationId: v.organisationId,
        bytes: evidenceBytes(data.evidence),
        name: data.evidence.fileName,
        mimeType: data.evidence.mimeType,
        owner: { entityType: "performance-goal", entityId: data.goalId },
        actor: v.actor,
      });
    }
    try {
      await recordGoalProgressInDatabase(
        v.organisationId,
        data.goalId,
        data.progressPercent,
        data.comment,
        evidenceFileId,
        v.actor,
      );
    } catch (error) {
      if (evidenceFileId)
        await deleteObjectFile(
          v.organisationId,
          evidenceFileId,
          v.actor,
          "Removed unattached performance evidence after progress update failure",
        ).catch(() => undefined);
      throw error;
    }
  });

export const readGoalEvidenceFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({ actor: Actor, goalId: z.string().uuid(), checkInId: z.string().uuid() })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const result = await readGoalEvidenceInDatabase(
      v.organisationId,
      data.goalId,
      data.checkInId,
      v.actor,
    );
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });
