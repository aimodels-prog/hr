import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { listSensitiveHrReviewsForActor } from "../db/repositories/sensitive-hr-review.repository.server.ts";
import { decideEmploymentDetailsInDatabase } from "../db/repositories/core-hr-lifecycle.repository.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.literal("Employee"),
});

async function verify(input: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(input.actorId, input.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    input.actorId,
    undefined,
    input.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes("Employee") || !result.actor.employeeId)
    throw new Error("Your VIA employee account could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: "Employee" as const } };
}

export const getIndependentSensitiveReviewsFn = createServerFn({ method: "GET" })
  .validator((input: { actor: z.infer<typeof Actor> }) =>
    z.object({ actor: Actor }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const result = await verify(data.actor);
    return listSensitiveHrReviewsForActor(result.organisationId, result.actor);
  });

export const decideIndependentEmploymentFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      actor: z.infer<typeof Actor>;
      employeeId: string;
      decision: "Confirmed" | "Changes Requested";
      note: string;
    }) =>
      z
        .object({
          actor: Actor,
          employeeId: z.string().uuid(),
          decision: z.enum(["Confirmed", "Changes Requested"]),
          note: z.string().trim().max(1000),
        })
        .strict()
        .parse(input),
  )
  .handler(async ({ data }) => {
    const result = await verify(data.actor);
    await decideEmploymentDetailsInDatabase(
      result.organisationId,
      {
        employeeId: data.employeeId,
        decision: data.decision,
        note: data.note,
      },
      result.actor,
    );
    return { ok: true };
  });
