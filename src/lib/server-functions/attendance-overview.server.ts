import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { ROLE_VALUES } from "../data/types.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  getTodayAttendanceOverview,
  sendAttendanceFollowUp,
  getAttendanceFollowUpTime,
  saveAttendanceFollowUpTime,
} from "../db/repositories/attendance-overview.repository.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const org = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(org, actor.actorId, undefined, actor.actorEmail);
  if (!result.verified || !result.actor?.roles.includes(actor.activeRole))
    throw new Error("Sign in with an authorised VIA account.");
  return { org, actor: { ...result.actor, activeRole: actor.activeRole } };
}

export const getTodayAttendanceOverviewFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return getTodayAttendanceOverview(v.org, v.actor);
  });

export const sendAttendanceFollowUpFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, employeeId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return sendAttendanceFollowUp(v.org, data.employeeId, v.actor);
  });

export const getAttendanceFollowUpTimeFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return getAttendanceFollowUpTime(v.org, v.actor);
  });

export const saveAttendanceFollowUpTimeFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, time: z.string().regex(/^(0[8-9]|1[0-2]):[0-5]\d$/) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveAttendanceFollowUpTime(v.org, data.time, v.actor);
  });
