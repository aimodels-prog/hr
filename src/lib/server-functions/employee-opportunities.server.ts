import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import {
  listEmployeeOpportunitiesInDatabase,
  submitEmployeeReferralInDatabase,
  submitInternalApplicationInDatabase,
} from "../db/repositories/employee-opportunities.repository.server.ts";
import { processNextCandidateCvJob } from "../db/repositories/candidate-cv-intake.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { validatePublicCv } from "../recruitment/public-application-validation.server.ts";

const Actor = z
  .object({
    actorId: z.string().min(1),
    actorEmail: z.string().email().optional(),
    activeRole: z.enum(ROLE_VALUES),
  })
  .strict();

async function verifyEmployeeActor(input: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(input.actorId, input.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    input.actorId,
    undefined,
    input.actorEmail,
  );
  if (
    !result.verified ||
    !result.actor?.userId ||
    !result.actor.employeeId ||
    !result.actor.roles.includes(input.activeRole)
  ) {
    throw new Error("Your active VIA employee account could not be verified.");
  }
  return {
    organisationId,
    actor: {
      ...result.actor,
      userId: result.actor.userId,
      employeeId: result.actor.employeeId,
      activeRole: input.activeRole,
    },
  };
}

const Cv = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().max(150),
    fileBase64: z.string().min(1).max(14_000_000),
  })
  .strict();

function validatedCv(input: z.infer<typeof Cv>) {
  const bytes = Buffer.from(input.fileBase64, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("CV must be no larger than 10 MB.");
  return {
    fileName: input.fileName,
    mimeType: validatePublicCv(input.fileName, input.mimeType, bytes),
    bytes,
  };
}

export const getEmployeeOpportunitiesFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    return listEmployeeOpportunitiesInDatabase(verified.organisationId, verified.actor);
  });

export const submitInternalApplicationFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        vacancyId: z.string().uuid(),
        noticePeriod: z.string().trim().min(1).max(200),
        coverNote: z.string().trim().max(5000).optional(),
        screeningAnswers: z
          .array(
            z
              .object({
                question: z.string().trim().min(1).max(1000),
                answer: z.string().trim().min(1).max(3000),
              })
              .strict(),
          )
          .max(30),
        cv: Cv,
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    const result = await submitInternalApplicationInDatabase(
      verified.organisationId,
      {
        vacancyId: data.vacancyId,
        noticePeriod: data.noticePeriod,
        ...(data.coverNote ? { coverNote: data.coverNote } : {}),
        screeningAnswers: data.screeningAnswers,
        cv: validatedCv(data.cv),
      },
      verified.actor,
    );
    void processNextCandidateCvJob(
      `internal-application:${result.applicationId}`,
      result.jobId,
    ).catch(() => undefined);
    return result;
  });

export const submitEmployeeReferralFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        vacancyId: z.string().uuid().optional(),
        candidate: z
          .object({
            firstName: z.string().trim().min(1).max(100),
            lastName: z.string().trim().min(1).max(100),
            email: z.string().trim().email().max(320),
            phone: z.string().trim().min(5).max(50),
            location: z.string().trim().min(1).max(200),
            currentCompany: z.string().trim().max(200).optional(),
            currentTitle: z.string().trim().max(200).optional(),
          })
          .strict(),
        relationship: z.string().trim().min(2).max(500),
        yearsKnown: z.number().int().min(0).max(80).optional(),
        notes: z.string().trim().min(10).max(5000),
        candidateAware: z.literal(true),
        cv: Cv,
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verifyEmployeeActor(data.actor);
    const result = await submitEmployeeReferralInDatabase(
      verified.organisationId,
      {
        ...(data.vacancyId ? { vacancyId: data.vacancyId } : {}),
        candidate: {
          firstName: data.candidate.firstName,
          lastName: data.candidate.lastName,
          email: data.candidate.email,
          phone: data.candidate.phone,
          location: data.candidate.location,
          ...(data.candidate.currentCompany
            ? { currentCompany: data.candidate.currentCompany }
            : {}),
          ...(data.candidate.currentTitle ? { currentTitle: data.candidate.currentTitle } : {}),
        },
        relationship: data.relationship,
        ...(data.yearsKnown !== undefined ? { yearsKnown: data.yearsKnown } : {}),
        notes: data.notes,
        candidateAware: data.candidateAware,
        cv: validatedCv(data.cv),
      },
      verified.actor,
    );
    void processNextCandidateCvJob(
      `employee-referral:${result.recommendationId}`,
      result.jobId,
    ).catch(() => undefined);
    return result;
  });
