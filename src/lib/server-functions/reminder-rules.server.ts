import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ReminderRulesSchema } from "../data/reminder-rules.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  getReminderRules,
  saveReminderRules,
} from "../db/repositories/reminder-rules.repository.server.ts";
const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(["HR", "Super Admin"]),
});
async function verify(input: z.infer<typeof Actor>) {
  const org = await resolveOrganisationIdForActor(input.actorId, input.actorEmail);
  const result = await verifyServerActorRole(org, input.actorId, undefined, input.actorEmail);
  if (!result.verified || !result.actor?.roles.includes(input.activeRole))
    throw new Error("HR access is required.");
  return { org, actor: { ...result.actor, activeRole: input.activeRole } };
}
export const getReminderRulesFn = createServerFn({ method: "POST" })
  .validator((input) => Actor.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data);
    return getReminderRules(v.org);
  });
export const saveReminderRulesFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, rules: ReminderRulesSchema }).parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveReminderRules(v.org, data.rules, v.actor);
  });
