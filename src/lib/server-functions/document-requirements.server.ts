import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { documentRequirementSchema } from "../data/document-requirements.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  getDocumentRequirementSettings,
  getEmployeeRequirements,
  saveDocumentRequirementSettings,
} from "../db/repositories/document-requirements.repository.server.ts";
const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(input: z.infer<typeof Actor>) {
  const org = await resolveOrganisationIdForActor(input.actorId, input.actorEmail);
  const result = await verifyServerActorRole(org, input.actorId, undefined, input.actorEmail);
  if (!result.verified || !result.actor?.roles.includes(input.activeRole))
    throw new Error("Your access could not be verified.");
  return { org, actor: { ...result.actor, activeRole: input.activeRole } };
}
export const getDocumentRequirementsFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, employeeId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { org, actor } = await verify(data.actor);
    if (data.employeeId)
      return {
        definitions: await getEmployeeRequirements(org, data.employeeId, actor),
        version: 0,
      };
    if (!["HR", "Super Admin"].includes(actor.activeRole))
      throw new Error("Only HR can configure requirements.");
    return getDocumentRequirementSettings(org);
  });
export const saveDocumentRequirementsFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        definitions: z.array(documentRequirementSchema).max(200),
        version: z.number().int().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { org, actor } = await verify(data.actor);
    return saveDocumentRequirementSettings(org, data.definitions, data.version, actor);
  });
