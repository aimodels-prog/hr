import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import {
  convertAcceptedJobOfferInDatabase,
  finaliseHiringDecisionInDatabase,
  generateJobOfferDocumentInDatabase,
  prepareManualInterviewHireInDatabase,
  saveJobOfferInDatabase,
  transitionJobOfferInDatabase,
  listOfferManagersInDatabase,
  listAssignedOfferReviewsInDatabase,
  reviewAssignedOfferInDatabase,
} from "../db/repositories/recruitment-offer.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { ROLE_VALUES } from "../data/types.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

async function authenticated(data: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
  const verified = await verifyServerActorRole(
    organisationId,
    data.actorId,
    undefined,
    data.actorEmail,
  );
  if (!verified.verified || !verified.actor?.roles.includes(data.activeRole))
    throw new Error("Only HR or a Super Admin can manage hiring decisions and offers.");
  return { organisationId, actor: { ...verified.actor, activeRole: data.activeRole } };
}
async function recruiter(data: z.infer<typeof Actor>) {
  const result = await authenticated(data);
  if (!["HR", "Super Admin"].includes(data.activeRole))
    throw new Error("Only HR can manage offers.");
  return result;
}

export const listOfferManagersFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await recruiter(data.actor);
    return listOfferManagersInDatabase(v.organisationId, v.actor);
  });
export const listAssignedOfferReviewsFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await authenticated(data.actor);
    return listAssignedOfferReviewsInDatabase(v.organisationId, v.actor);
  });
export const reviewAssignedOfferFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        offerId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        decision: z.enum(["approve", "return"]),
        comment: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await authenticated(data.actor);
    await reviewAssignedOfferInDatabase(
      v.organisationId,
      data.offerId,
      data.expectedVersion,
      data.decision,
      data.comment,
      v.actor,
    );
    return { success: true };
  });

export const finaliseHiringDecisionFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        vacancyId: z.string().uuid(),
        selectedCandidateId: z.string().uuid(),
        overrideReason: z.string().trim().min(5).max(2000).optional(),
        waiverReason: z.string().trim().min(10).max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await recruiter(data.actor);
    return finaliseHiringDecisionInDatabase(
      verified.organisationId,
      {
        vacancyId: data.vacancyId,
        selectedCandidateId: data.selectedCandidateId,
        ...(data.overrideReason ? { overrideReason: data.overrideReason } : {}),
        ...(data.waiverReason ? { waiverReason: data.waiverReason } : {}),
      },
      verified.actor,
    );
  });

const Offer = z.object({
  actor: Actor,
  id: z.string().uuid().optional(),
  candidateId: z.string().uuid(),
  vacancyId: z.string().uuid(),
  template: z.string().trim().min(1).max(500),
  position: z.string().trim().min(1).max(200),
  grade: z.string().trim().min(1).max(100),
  salary: z.number().positive(),
  currency: z.string().trim().min(1).max(10),
  allowances: z.string().trim().max(5000),
  benefits: z.string().trim().max(5000),
  startDate: z.string().date(),
  probation: z.string().trim().max(500),
  location: z.string().trim().min(1).max(200),
  conditions: z.string().trim().max(5000),
  responseDeadline: z.string().datetime().optional(),
  expectedRecordVersion: z.number().int().positive().optional(),
  approverUserId: z.string().uuid().optional(),
});

export const saveJobOfferFn = createServerFn({ method: "POST" })
  .validator((input) => Offer.strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await recruiter(data.actor);
    const { actor: _actor, ...offer } = data;
    return saveJobOfferInDatabase(
      verified.organisationId,
      JSON.parse(JSON.stringify(offer)),
      verified.actor,
    );
  });

export const transitionJobOfferFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        offerId: z.string().uuid(),
        status: z.enum([
          "Draft",
          "Pending Approval",
          "Approved",
          "Ready to Send",
          "Sent",
          "Accepted",
          "Declined",
          "Expired",
          "Withdrawn",
        ]),
        reason: z.string().trim().max(2000).optional(),
        expectedRecordVersion: z.number().int().positive(),
        manualDelivery: z
          .object({
            recipientEmail: z.string().email(),
            sentAt: z.string().datetime(),
            evidenceReference: z.string().max(2000),
            confirmed: z.literal(true),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await recruiter(data.actor);
    return transitionJobOfferInDatabase(
      verified.organisationId,
      data.offerId,
      data.status,
      data.reason,
      verified.actor,
      data.expectedRecordVersion,
      data.manualDelivery,
    );
  });

export const convertAcceptedJobOfferFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, offerId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await recruiter(data.actor);
    return convertAcceptedJobOfferInDatabase(verified.organisationId, data.offerId, verified.actor);
  });

export const generateJobOfferDocumentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, offerId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await recruiter(data.actor);
    return generateJobOfferDocumentInDatabase(
      verified.organisationId,
      data.offerId,
      verified.actor,
    );
  });

export const prepareManualInterviewHireFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        interviewId: z.string().uuid(),
        details: z
          .object({
            position: z.string().trim().min(1).max(200),
            department: z.string().trim().min(1).max(200),
            location: z.string().trim().min(1).max(200),
            employmentType: z.string().trim().min(1).max(200),
            grade: z.string().trim().min(1).max(200),
          })
          .strict(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await recruiter(data.actor);
    return prepareManualInterviewHireInDatabase(
      verified.organisationId,
      data.interviewId,
      data.details,
      data.reason,
      verified.actor,
    );
  });
