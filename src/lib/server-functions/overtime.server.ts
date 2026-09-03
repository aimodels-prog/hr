import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import {
  assignOvertimeToPayrollInDatabase,
  correctOvertimeClaimInDatabase,
  createOvertimeClaimInDatabase,
  decideOvertimeClaimInDatabase,
  exportPayrollOvertimeLedgerInDatabase,
  listOvertimeClaimsForActor,
  listPayrollOvertimeLedgerInDatabase,
  readOvertimeEvidenceInDatabase,
} from "../db/repositories/overtime.repository.server.ts";
import { ROLE_VALUES } from "../data/types.ts";
import { deleteObjectFile, saveObjectFile } from "../db/object-storage.server.ts";

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
const Claim = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    date: z.string().date(),
    hours: z.number().positive().max(24),
    reason: z.string().trim().min(3).max(2000),
    compensationType: z.enum(["Payment", "TOIL"]),
    projectId: z.string().uuid().optional(),
    costCentreId: z.string().uuid(),
    activityCodeId: z.string().uuid(),
    locationId: z.string().uuid(),
    evidenceFileId: z.string().uuid().optional(),
    evidence: z
      .object({
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        bytes: z
          .array(z.number().int().min(0).max(255))
          .min(1)
          .max(10 * 1024 * 1024),
      })
      .strict()
      .optional(),
  })
  .strict();
export const createOvertimeClaimFn = createServerFn({ method: "POST" })
  .validator((input) => Claim.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    if (data.evidence && data.evidenceFileId)
      throw new Error("Submit one overtime evidence source only.");
    let evidenceFileId = data.evidenceFileId;
    if (data.evidence) {
      evidenceFileId = crypto.randomUUID();
      await saveObjectFile({
        id: evidenceFileId,
        organisationId: v.organisationId,
        bytes: Uint8Array.from(data.evidence.bytes),
        name: data.evidence.fileName,
        mimeType: data.evidence.mimeType,
        owner: { entityType: "overtime-claim-evidence", entityId: data.employeeId },
        actor: v.actor,
      });
    }
    try {
      return await createOvertimeClaimInDatabase(
        v.organisationId,
        {
          employeeId: data.employeeId,
          date: data.date,
          hours: data.hours,
          reason: data.reason,
          compensationType: data.compensationType,
          costCentreId: data.costCentreId,
          activityCodeId: data.activityCodeId,
          locationId: data.locationId,
          ...(data.projectId ? { projectId: data.projectId } : {}),
          ...(evidenceFileId ? { evidenceFileId } : {}),
        },
        v.actor,
      );
    } catch (error) {
      if (data.evidence && evidenceFileId)
        await deleteObjectFile(
          v.organisationId,
          evidenceFileId,
          v.actor,
          "Removed overtime evidence after claim submission failed",
        ).catch(() => undefined);
      throw error;
    }
  });

export const getOvertimeClaimsFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listOvertimeClaimsForActor(v.organisationId, v.actor);
  });

const Correction = z
  .object({
    actor: Actor,
    claimId: z.string().uuid(),
    hours: z.number().positive().max(12),
    reason: z.string().trim().min(5).max(2000),
    evidenceFileId: z.string().uuid().optional(),
    evidence: Claim.shape.evidence,
  })
  .strict();
export const correctOvertimeClaimFn = createServerFn({ method: "POST" })
  .validator((input) => Correction.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    if (data.evidence && data.evidenceFileId)
      throw new Error("Submit one correction evidence source only.");
    const claims = await listOvertimeClaimsForActor(v.organisationId, v.actor);
    const claim = claims.find((item) => item.id === data.claimId);
    if (!claim) throw new Error("Overtime claim not found.");
    let evidenceFileId = data.evidenceFileId;
    if (data.evidence) {
      evidenceFileId = crypto.randomUUID();
      await saveObjectFile({
        id: evidenceFileId,
        organisationId: v.organisationId,
        bytes: Uint8Array.from(data.evidence.bytes),
        name: data.evidence.fileName,
        mimeType: data.evidence.mimeType,
        owner: { entityType: "overtime-claim-evidence", entityId: claim.employeeId },
        actor: v.actor,
      });
    }
    try {
      return await correctOvertimeClaimInDatabase(
        v.organisationId,
        data.claimId,
        { hours: data.hours, reason: data.reason, ...(evidenceFileId ? { evidenceFileId } : {}) },
        v.actor,
      );
    } catch (error) {
      if (data.evidence && evidenceFileId)
        await deleteObjectFile(
          v.organisationId,
          evidenceFileId,
          v.actor,
          "Removed overtime correction evidence after submission failed",
        ).catch(() => undefined);
      throw error;
    }
  });

export const readOvertimeEvidenceFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z.object({ actor: Actor, claimId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const result = await readOvertimeEvidenceInDatabase(v.organisationId, data.claimId, v.actor);
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });

export const getPayrollOvertimeLedgerFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listPayrollOvertimeLedgerInDatabase(v.organisationId, v.actor);
  });

export const exportPayrollOvertimeLedgerFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        filters: z
          .object({
            search: z.string().max(200).optional(),
            view: z.enum(["all", "ready", "included", "time-off", "exceptions"]).optional(),
            dateFrom: z.string().date().optional(),
            dateTo: z.string().date().optional(),
            payrollPeriodId: z.union([z.string().uuid(), z.literal("unassigned")]).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const filters = data.filters
      ? {
          ...(data.filters.search !== undefined ? { search: data.filters.search } : {}),
          ...(data.filters.view !== undefined ? { view: data.filters.view } : {}),
          ...(data.filters.dateFrom !== undefined ? { dateFrom: data.filters.dateFrom } : {}),
          ...(data.filters.dateTo !== undefined ? { dateTo: data.filters.dateTo } : {}),
          ...(data.filters.payrollPeriodId !== undefined
            ? { payrollPeriodId: data.filters.payrollPeriodId }
            : {}),
        }
      : undefined;
    return exportPayrollOvertimeLedgerInDatabase(v.organisationId, v.actor, filters);
  });

export const assignOvertimeToPayrollFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        claimIds: z.array(z.string().uuid()).min(1).max(1000),
        payrollPeriodId: z.string().uuid(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return assignOvertimeToPayrollInDatabase(
      v.organisationId,
      data.claimIds,
      data.payrollPeriodId,
      v.actor,
    );
  });
const Decide = z
  .object({
    actor: Actor,
    claimId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const decideOvertimeClaimFn = createServerFn({ method: "POST" })
  .validator((input) => Decide.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return decideOvertimeClaimInDatabase(
      v.organisationId,
      data.claimId,
      data.decision,
      data.notes,
      v.actor,
    );
  });
