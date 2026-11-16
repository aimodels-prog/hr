import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import { listDashboardMissingDocuments } from "../db/repositories/dashboard-document-checklist.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

export const getDashboardMissingDocumentsFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const organisationId = await resolveOrganisationIdForActor(
      data.actor.actorId,
      data.actor.actorEmail,
    );
    const verified = await verifyServerActorRole(
      organisationId,
      data.actor.actorId,
      undefined,
      data.actor.actorEmail,
    );
    if (!verified.verified || !verified.actor?.roles.includes(data.actor.activeRole))
      throw new Error("Your VIA access could not be verified.");
    return listDashboardMissingDocuments(organisationId, {
      ...verified.actor,
      activeRole: data.actor.activeRole,
    });
  });
