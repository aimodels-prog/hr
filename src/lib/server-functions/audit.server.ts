import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import {
  checkAuditIntegrityInDatabase,
  exportAuditCsvInDatabase,
  listAuditEventsInDatabase,
} from "../db/repositories/audit.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

const Filters = z
  .object({
    global: z.boolean(),
    entityId: z.string().uuid().optional(),
    entityType: z.string().trim().min(1).max(100).optional(),
    search: z.string().trim().max(200).optional(),
    actorId: z.string().uuid().optional(),
    role: z.string().trim().max(60).optional(),
    module: z.string().trim().max(100).optional(),
    action: z.string().trim().max(100).optional(),
    risk: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.global && (!value.entityId || !value.entityType))
      context.addIssue({
        code: "custom",
        message: "A record is required for this activity history.",
      });
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)
      context.addIssue({
        code: "custom",
        message: "The from date must be on or before the to date.",
      });
  });

async function verify(actorInput: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(
    actorInput.actorId,
    actorInput.actorEmail,
  );
  const result = await verifyServerActorRole(
    organisationId,
    actorInput.actorId,
    undefined,
    actorInput.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(actorInput.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: actorInput.activeRole } };
}

export const getAuditEventsFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, filters: Filters }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listAuditEventsInDatabase(verified.organisationId, data.filters, verified.actor);
  });

export const getAuditIntegrityFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return checkAuditIntegrityInDatabase(verified.organisationId, verified.actor);
  });

export const exportAuditCsvFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, filters: Filters }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return exportAuditCsvInDatabase(verified.organisationId, data.filters, verified.actor);
  });
