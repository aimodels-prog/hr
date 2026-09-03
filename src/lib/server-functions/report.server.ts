import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import {
  archiveReportViewInDatabase,
  exportReportCsvInDatabase,
  generateReportInDatabase,
  listAvailableReportsForActor,
  listSavedReportViewsInDatabase,
  saveReportViewInDatabase,
} from "../db/repositories/report.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});

const Filters = z
  .object({
    search: z.string().max(200).default(""),
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(""))
      .default(""),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .or(z.literal(""))
      .default(""),
    department: z.string().max(120).default("all"),
    status: z.string().max(120).default("all"),
  })
  .strict()
  .superRefine((value, context) => {
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

export const getAvailableReportsFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listAvailableReportsForActor(verified.actor);
  });

export const generateReportFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, reportId: z.string().min(1), filters: Filters })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return generateReportInDatabase(
      verified.organisationId,
      data.reportId,
      data.filters,
      verified.actor,
    );
  });

export const exportReportCsvFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({ actor: Actor, reportId: z.string().min(1), filters: Filters })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return exportReportCsvInDatabase(
      verified.organisationId,
      data.reportId,
      data.filters,
      verified.actor,
    );
  });

export const getSavedReportViewsFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({ actor: Actor, reportId: z.string().min(1) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const available = listAvailableReportsForActor(verified.actor);
    if (!available.some((report) => report.id === data.reportId))
      await generateReportInDatabase(
        verified.organisationId,
        data.reportId,
        { search: "", dateFrom: "", dateTo: "", department: "all", status: "all" },
        verified.actor,
      );
    return listSavedReportViewsInDatabase(
      verified.organisationId,
      verified.actor.userId,
      data.reportId,
    );
  });

export const saveReportViewFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        reportId: z.string().min(1),
        name: z.string().trim().min(2).max(60),
        filters: Filters,
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return saveReportViewInDatabase(
      verified.organisationId,
      data.reportId,
      data.name,
      data.filters,
      verified.actor,
    );
  });

export const deleteReportViewFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, viewId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await archiveReportViewInDatabase(verified.organisationId, data.viewId, verified.actor);
    return { ok: true };
  });
