import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { REQUEST_GROUPS, REQUEST_MODULES, isApprovalTask } from "../data/request-tracking.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { listTrackedRequests } from "../db/repositories/request-tracking.repository.server.ts";
import { listTasksForActorInDatabase } from "../db/repositories/task.repository.server.ts";
const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const verified = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!verified.verified || !verified.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...verified.actor, activeRole: actor.activeRole } };
}
export const getTrackedRequestsFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        scope: z.enum(["my", "organisation"]),
        page: z.number().int().min(1).max(100000),
        query: z.string().max(160).optional(),
        module: z.enum(["All", ...REQUEST_MODULES]).optional(),
        group: z.enum(REQUEST_GROUPS).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listTrackedRequests(verified.organisationId, verified.actor, data);
  });
export const getApprovalInboxFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return (await listTasksForActorInDatabase(verified.organisationId, verified.actor)).filter(
      (task) =>
        isApprovalTask(task) &&
        (!task.subjectEmployeeId || task.subjectEmployeeId !== verified.actor.employeeId),
    );
  });
