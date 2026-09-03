import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import {
  archiveInterviewTemplateInDatabase,
  createInterviewInDatabase,
  recordInterviewDispositionInDatabase,
  recordManualInterviewOutcomeInDatabase,
  reopenInterviewScorecardInDatabase,
  saveInterviewScorecardInDatabase,
  saveInterviewTemplateInDatabase,
  updateInterviewWorkflowInDatabase,
} from "../db/repositories/recruitment-interview.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { ROLE_VALUES } from "../data/types.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

async function verifiedActor(data: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
  const verified = await verifyServerActorRole(
    organisationId,
    data.actorId,
    undefined,
    data.actorEmail,
  );
  if (!verified.verified || !verified.actor?.roles.includes(data.activeRole))
    throw new Error("Your VIA session is not authorised for this action.");
  return { organisationId, actor: { ...verified.actor, activeRole: data.activeRole } };
}

const Criterion = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000),
  requiresEvidence: z.boolean(),
  weight: z.number().positive().max(100),
  minimumScore: z.number().int().min(1).max(5).optional(),
  isCritical: z.boolean().optional(),
});

export const saveInterviewTemplateFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(200),
        criteria: z.array(Criterion).min(1).max(50),
        blindScoring: z.boolean(),
        vacancyId: z.string().uuid().optional(),
        stageName: z.string().trim().max(200).optional(),
        aiDecisionWeight: z.number().min(0).max(100),
        interviewDecisionWeight: z.number().min(0).max(100),
        expectedRecordVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    return saveInterviewTemplateInDatabase(
      verified.organisationId,
      JSON.parse(JSON.stringify({ ...data, actor: undefined })),
      verified.actor,
    );
  });

export const archiveInterviewTemplateFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, templateId: z.string().uuid(), reason: z.string().trim().min(5) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    await archiveInterviewTemplateInDatabase(
      verified.organisationId,
      data.templateId,
      data.reason,
      verified.actor,
    );
  });

const Slot = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  timezone: z.string().trim().min(1).max(100),
});

export const createInterviewFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        candidateId: z.string().uuid(),
        vacancyId: z.string().uuid().optional(),
        templateId: z.string().uuid(),
        source: z.enum(["Scheduled Recruitment", "Manual / Offline"]),
        stageName: z.string().trim().min(1).max(200),
        durationMinutes: z.number().int().min(1).max(1440),
        panelUserIds: z.array(z.string().uuid()).min(1).max(50),
        location: z.string().trim().max(500),
        videoMethod: z.string().trim().max(200),
        notes: z.string().trim().max(5000),
        proposedSlots: z.array(Slot).max(20).optional(),
        occurredAt: z.string().datetime().optional(),
        timezone: z.string().trim().max(100).optional(),
        positionTitle: z.string().trim().max(200).optional(),
        projectName: z.string().trim().max(200).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    const { actor: _actor, ...input } = data;
    return createInterviewInDatabase(
      verified.organisationId,
      JSON.parse(JSON.stringify(input)),
      verified.actor,
    );
  });

export const updateInterviewWorkflowFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        interviewId: z.string().uuid(),
        action: z.enum([
          "send-slots",
          "candidate-accepted",
          "candidate-declined",
          "reschedule",
          "change-status",
        ]),
        slot: Slot.optional(),
        status: z
          .enum([
            "Proposed",
            "Awaiting Candidate",
            "Scheduled",
            "Completed",
            "Cancelled",
            "No Show",
          ])
          .optional(),
        reason: z.string().trim().min(3).max(2000),
        waiver: z.boolean().optional(),
        expectedRecordVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    const { actor: _actor, ...input } = data;
    await updateInterviewWorkflowInDatabase(
      verified.organisationId,
      JSON.parse(JSON.stringify(input)),
      verified.actor,
    );
  });

const CriterionScore = z.object({
  criterionId: z.string().min(1).max(100),
  score: z.number().int().min(1).max(5),
  evidence: z.string().max(5000),
});

export const saveInterviewScorecardFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        interviewId: z.string().uuid(),
        scores: z.array(CriterionScore).max(50),
        recommendation: z.enum(["Strong Yes", "Yes", "Unsure", "No"]).nullable(),
        submit: z.boolean(),
        expectedRecordVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    return saveInterviewScorecardInDatabase(
      verified.organisationId,
      {
        interviewId: data.interviewId,
        scores: data.scores,
        recommendation: data.recommendation,
        submit: data.submit,
        ...(data.expectedRecordVersion
          ? { expectedRecordVersion: data.expectedRecordVersion }
          : {}),
      },
      verified.actor,
    );
  });

export const reopenInterviewScorecardFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, scorecardId: z.string().uuid(), reason: z.string().trim().min(10) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    await reopenInterviewScorecardInDatabase(
      verified.organisationId,
      data.scorecardId,
      data.reason,
      verified.actor,
    );
  });

export const recordInterviewDispositionFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        interviewId: z.string().uuid(),
        outcome: z.enum([
          "Proceed to Next Interview",
          "Recommend for Offer",
          "Future Consideration",
          "Recommend for Another Role",
          "Place on Hold",
          "Do Not Proceed",
          "Candidate Withdrew",
          "No Show",
        ]),
        reason: z.string().trim().min(5).max(2000),
        futureVacancyIds: z.array(z.string().uuid()).max(50).optional(),
        suggestedRoleTitles: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    return recordInterviewDispositionInDatabase(
      verified.organisationId,
      data.interviewId,
      {
        outcome: data.outcome,
        reason: data.reason,
        ...(data.futureVacancyIds ? { futureVacancyIds: data.futureVacancyIds } : {}),
        ...(data.suggestedRoleTitles ? { suggestedRoleTitles: data.suggestedRoleTitles } : {}),
      },
      verified.actor,
    );
  });

export const recordManualInterviewOutcomeFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        interviewId: z.string().uuid(),
        outcome: z.enum(["Selected", "Hold", "Reject", "Proceed"]),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifiedActor(data.actor);
    await recordManualInterviewOutcomeInDatabase(
      verified.organisationId,
      data.interviewId,
      data.outcome,
      data.reason,
      verified.actor,
    );
  });
