import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import {
  listNotificationsForUserInDatabase,
  setAllNotificationStatusesInDatabase,
  setNotificationStatusInDatabase,
} from "../db/repositories/notification.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: actor.activeRole } };
}

export const getMyNotificationsFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listNotificationsForUserInDatabase(verified.organisationId, verified.actor.userId);
  });

export const setMyNotificationStatusFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        notificationId: z.string().uuid(),
        status: z.enum(["Unread", "Read", "Dismissed"]),
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return setNotificationStatusInDatabase(
      verified.organisationId,
      data.notificationId,
      data.status,
      verified.actor,
      data.expectedVersion,
    );
  });

export const setAllMyNotificationStatusesFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, status: z.enum(["Read", "Dismissed"]) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return setAllNotificationStatusesInDatabase(
      verified.organisationId,
      data.status,
      verified.actor,
    );
  });
