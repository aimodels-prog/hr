import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { timeAwayDate, timeAwayInput, TIME_AWAY_TREATMENTS } from "../data/time-away.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  listTimeAway,
  recordTimeAway,
  decideTimeAway,
} from "../db/repositories/time-away.repository.server.ts";
const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const org = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(org, actor.actorId, undefined, actor.actorEmail);
  if (!result.verified || !result.actor?.userId || !result.actor.roles.includes(actor.activeRole))
    throw new Error("Sign in with an authorised VIA account.");
  return { org, actor: { ...result.actor, activeRole: actor.activeRole } };
}
export const listTimeAwayFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor, date: timeAwayDate }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listTimeAway(v.org, data.date, v.actor);
  });
export const recordTimeAwayFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, record: timeAwayInput }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return recordTimeAway(v.org, data.record, v.actor);
  });
export const decideTimeAwayFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        id: z.string().uuid(),
        version: z.number().int().positive(),
        action: z.enum(["Approve", "Reject", "Cancel"]),
        treatment: z.enum(TIME_AWAY_TREATMENTS).optional(),
        note: z.string().trim().max(500).default(""),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return decideTimeAway(v.org, data, v.actor);
  });
