import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import { deleteObjectFile, saveObjectFile } from "../db/object-storage.server.ts";
import {
  acknowledgePayrollExceptionInDatabase,
  approvePayrollPeriodInDatabase,
  addPayrollAdjustmentInDatabase,
  collectPayrollInputsInDatabase,
  createPayrollPeriodInDatabase,
  exportPayrollPeriodInDatabase,
  listPayrollPeriodsInDatabase,
  lockPayrollPeriodInDatabase,
  reopenPayrollPeriodInDatabase,
  readPayrollAdjustmentEvidenceInDatabase,
} from "../db/repositories/payroll.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
const Evidence = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
function verifiedEvidence(input: z.infer<typeof Evidence>) {
  const bytes = Uint8Array.from(input.bytes);
  const valid =
    (input.mimeType === "application/pdf" &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46) ||
    (input.mimeType === "image/jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (input.mimeType === "image/png" &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47);
  if (!valid) throw new Error("The uploaded content does not match its file type.");
  return bytes;
}
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

export const getPayrollPeriodsFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listPayrollPeriodsInDatabase(v.organisationId, v.actor);
  });
export const createPayrollPeriodFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        name: z.string().trim().min(1).max(200),
        startDate: z.string().date(),
        endDate: z.string().date(),
        cutoffDate: z.string().date(),
        paymentDate: z.string().date(),
        notes: z.string().trim().max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return createPayrollPeriodInDatabase(
      v.organisationId,
      {
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        cutoffDate: data.cutoffDate,
        paymentDate: data.paymentDate,
        ...(data.notes ? { notes: data.notes } : {}),
      },
      v.actor,
    );
  });
export const addPayrollAdjustmentFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        periodId: z.string().uuid(),
        employeeId: z.string().uuid(),
        type: z.enum(["Allowance", "Deduction", "Correction"]),
        amount: z.number().positive(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        reason: z.string().trim().min(3).max(2000),
        evidence: Evidence,
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const evidenceFileId = crypto.randomUUID();
    await saveObjectFile({
      id: evidenceFileId,
      organisationId: v.organisationId,
      bytes: verifiedEvidence(data.evidence),
      name: data.evidence.fileName,
      mimeType: data.evidence.mimeType,
      owner: { entityType: "payroll-adjustment-evidence", entityId: data.employeeId },
      actor: v.actor,
    });
    try {
      return await addPayrollAdjustmentInDatabase(
        v.organisationId,
        data.periodId,
        {
          employeeId: data.employeeId,
          type: data.type,
          amount: data.amount,
          currency: data.currency,
          reason: data.reason,
          evidenceFileId,
        },
        v.actor,
      );
    } catch (error) {
      await deleteObjectFile(
        v.organisationId,
        evidenceFileId,
        v.actor,
        "Removed unattached payroll evidence after adjustment failure",
      ).catch(() => undefined);
      throw error;
    }
  });
export const readPayrollAdjustmentEvidenceFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z.object({ actor: Actor, adjustmentId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const result = await readPayrollAdjustmentEvidenceInDatabase(
      v.organisationId,
      data.adjustmentId,
      v.actor,
    );
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });
export const collectPayrollInputsFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, periodId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await collectPayrollInputsInDatabase(v.organisationId, data.periodId, v.actor);
  });
export const acknowledgePayrollExceptionFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        periodId: z.string().uuid(),
        exceptionId: z.string().uuid(),
        notes: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await acknowledgePayrollExceptionInDatabase(
      v.organisationId,
      data.periodId,
      data.exceptionId,
      data.notes,
      v.actor,
    );
  });
export const lockPayrollPeriodFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, periodId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await lockPayrollPeriodInDatabase(v.organisationId, data.periodId, v.actor);
  });

export const approvePayrollPeriodFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        periodId: z.string().uuid(),
        reason: z.string().trim().max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await approvePayrollPeriodInDatabase(v.organisationId, data.periodId, data.reason, v.actor);
  });
export const reopenPayrollPeriodFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        periodId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await reopenPayrollPeriodInDatabase(v.organisationId, data.periodId, data.reason, v.actor);
  });
export const exportPayrollPeriodFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, periodId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return exportPayrollPeriodInDatabase(v.organisationId, data.periodId, v.actor);
  });
