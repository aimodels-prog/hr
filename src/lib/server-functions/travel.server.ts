import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { ROLE_VALUES } from "../data/types.ts";
import { deleteObjectFile, saveObjectFile } from "../db/object-storage.server.ts";
import {
  assignTravelReimbursementsToPayrollInDatabase,
  closeTravelReimbursementInDatabase,
  createTravelRequestInDatabase,
  decideTravelRequestInDatabase,
  listTravelRequestsForActor,
  readTravelFileInDatabase,
  submitTravelExpensesInDatabase,
  withdrawTravelRequestInDatabase,
} from "../db/repositories/travel.repository.server.ts";
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
const Upload = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
    bytes: z
      .array(z.number().int().min(0).max(255))
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();

function verifiedUpload(upload: z.infer<typeof Upload>) {
  const bytes = Uint8Array.from(upload.bytes);
  const signatureValid =
    (upload.mimeType === "application/pdf" &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46) ||
    (upload.mimeType === "image/jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (upload.mimeType === "image/png" &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47);
  if (!signatureValid) throw new Error("The uploaded content does not match its file type.");
  return bytes;
}

export const getTravelRequestsFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listTravelRequestsForActor(v.organisationId, v.actor);
  });

export const createTravelRequestFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        employeeId: z.string().uuid(),
        purpose: z.string().trim().min(3).max(2000),
        destination: z.string().trim().min(2).max(500),
        startDate: z.string().date(),
        endDate: z.string().date(),
        estTransport: z.number().nonnegative(),
        estAccommodation: z.number().nonnegative(),
        estPerDiem: z.number().nonnegative(),
        estOther: z.number().nonnegative(),
        currencyId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        costCentreId: z.string().uuid().optional(),
        notes: z.string().trim().max(4000).optional(),
        evidence: Upload.optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    let evidenceFileId: string | undefined;
    if (data.evidence) {
      evidenceFileId = crypto.randomUUID();
      await saveObjectFile({
        id: evidenceFileId,
        organisationId: v.organisationId,
        bytes: verifiedUpload(data.evidence),
        name: data.evidence.fileName,
        mimeType: data.evidence.mimeType,
        owner: { entityType: "travel-request-evidence", entityId: data.employeeId },
        actor: v.actor,
      });
    }
    try {
      return await createTravelRequestInDatabase(
        v.organisationId,
        {
          employeeId: data.employeeId,
          purpose: data.purpose,
          destination: data.destination,
          startDate: data.startDate,
          endDate: data.endDate,
          estTransport: data.estTransport,
          estAccommodation: data.estAccommodation,
          estPerDiem: data.estPerDiem,
          estOther: data.estOther,
          currencyId: data.currencyId,
          ...(data.projectId ? { projectId: data.projectId } : {}),
          ...(data.costCentreId ? { costCentreId: data.costCentreId } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
          ...(evidenceFileId ? { evidenceFileId } : {}),
        },
        v.actor,
      );
    } catch (error) {
      if (evidenceFileId)
        await deleteObjectFile(
          v.organisationId,
          evidenceFileId,
          v.actor,
          "Removed unattached travel evidence after submission failure",
        ).catch(() => undefined);
      throw error;
    }
  });

export const withdrawTravelRequestFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, requestId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await withdrawTravelRequestInDatabase(v.organisationId, data.requestId, v.actor);
  });

export const decideTravelRequestFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestId: z.string().uuid(),
        stage: z.enum(["Manager", "HR", "Accounts"]),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await decideTravelRequestInDatabase(
      v.organisationId,
      data.requestId,
      data.stage,
      data.decision,
      data.reason,
      v.actor,
    );
  });

const Expense = z
  .object({
    id: z.string().uuid(),
    category: z.enum(["Transport", "Accommodation", "Per Diem", "Other"]),
    amount: z.number().positive(),
    currencyId: z.string().uuid(),
    exchangeRate: z.number().positive().optional(),
    reference: z.string().trim().min(1).max(500),
    date: z.string().date(),
    notes: z.string().trim().max(2000).optional(),
    receipt: Upload,
  })
  .strict();

export const submitTravelExpensesFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestId: z.string().uuid(),
        lines: z.array(Expense).min(1).max(100),
        varianceExplanation: z.string().trim().max(4000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const totalUploadBytes = data.lines.reduce(
      (total, line) => total + line.receipt.bytes.length,
      0,
    );
    if (totalUploadBytes > 25 * 1024 * 1024)
      throw new Error("The combined receipt upload must be 25 MB or smaller.");
    const uploaded: string[] = [];
    try {
      const lines = [];
      for (const line of data.lines) {
        const receiptFileId = crypto.randomUUID();
        await saveObjectFile({
          id: receiptFileId,
          organisationId: v.organisationId,
          bytes: verifiedUpload(line.receipt),
          name: line.receipt.fileName,
          mimeType: line.receipt.mimeType,
          owner: { entityType: "travel-expense-receipt", entityId: line.id },
          actor: v.actor,
        });
        uploaded.push(receiptFileId);
        lines.push({
          id: line.id,
          category: line.category,
          amount: line.amount,
          currencyId: line.currencyId,
          ...(line.exchangeRate !== undefined ? { exchangeRate: line.exchangeRate } : {}),
          reference: line.reference,
          date: line.date,
          ...(line.notes ? { notes: line.notes } : {}),
          receiptFileId,
        });
      }
      await submitTravelExpensesInDatabase(
        v.organisationId,
        data.requestId,
        lines,
        data.varianceExplanation,
        v.actor,
      );
    } catch (error) {
      for (const fileId of uploaded)
        await deleteObjectFile(
          v.organisationId,
          fileId,
          v.actor,
          "Removed unattached receipt after expense submission failure",
        ).catch(() => undefined);
      throw error;
    }
  });

export const closeTravelReimbursementFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestId: z.string().uuid(),
        decision: z.enum(["close", "reject"]),
        notes: z.string().trim().max(2000).optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await closeTravelReimbursementInDatabase(
      v.organisationId,
      data.requestId,
      data.decision,
      data.notes,
      v.actor,
    );
  });

export const readTravelFileFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestId: z.string().uuid(),
        expenseLineId: z.string().uuid().optional(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const result = await readTravelFileInDatabase(
      v.organisationId,
      data.requestId,
      data.expenseLineId,
      v.actor,
    );
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });

export const assignTravelReimbursementsToPayrollFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        requestIds: z.array(z.string().uuid()).min(1).max(1000),
        payrollPeriodId: z.string().uuid(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await assignTravelReimbursementsToPayrollInDatabase(
      v.organisationId,
      data.requestIds,
      data.payrollPeriodId,
      v.actor,
    );
  });
