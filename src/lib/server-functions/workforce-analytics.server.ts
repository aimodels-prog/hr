import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { getWorkforceAnalytics } from "../db/repositories/workforce-analytics.repository.server.ts";

export const getWorkforceAnalyticsFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({
        actorId: z.string().min(1),
        actorEmail: z.string().email().optional(),
        activeRole: z.enum(ROLE_VALUES),
        scope: z.enum(["self", "hr"]),
        days: z.union([z.literal(7), z.literal(30)]),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
    const result = await verifyServerActorRole(
      organisationId,
      data.actorId,
      undefined,
      data.actorEmail,
    );
    if (!result.verified || !result.actor?.roles.includes(data.activeRole))
      throw new Error("Your VIA access could not be verified.");
    return getWorkforceAnalytics(
      organisationId,
      { ...result.actor, activeRole: data.activeRole },
      data.scope,
      data.days,
    );
  });
