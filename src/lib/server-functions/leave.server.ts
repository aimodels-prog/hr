import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import {
  approveLeaveRequestInDatabase,
  createLeaveRequestInDatabase,
  exportLeaveRequestsCsvInDatabase,
  listLeaveSnapshotForActor,
  readLeaveAttachmentInDatabase,
  requestLeaveChangeInDatabase,
  rolloverLeaveBalancesInDatabase,
  setEmployeeLeaveBalanceInDatabase,
  updateLeavePolicyInDatabase,
} from "../db/repositories/leave.repository.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
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

export const getLeaveSnapshotFn = createServerFn({ method: "GET" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return listLeaveSnapshotForActor(verified.organisationId, verified.actor);
  });

export const readLeaveAttachmentFn = createServerFn({ method: "GET" })
  .validator((input) =>
    z.object({ actor: Actor, requestId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const result = await readLeaveAttachmentInDatabase(
      verified.organisationId,
      data.requestId,
      verified.actor,
    );
    return { metadata: result.metadata, bytes: Array.from(result.bytes) };
  });

const UpdatePolicy = z
  .object({
    actor: Actor,
    policyId: z.string().uuid(),
    policy: z
      .object({
        recordVersion: z.number().int().positive(),
        description: z.string().trim().min(10).max(5000),
        isPaid: z.boolean(),
        payTiers: z
          .array(
            z
              .object({
                fromDay: z.number().int().positive(),
                toDay: z.number().int().positive(),
                payPercentage: z.number().min(0).max(100),
              })
              .strict(),
          )
          .optional(),
        baseEntitlementDays: z.number().min(0).max(1000),
        accrualMode: z.enum(["Upfront", "Monthly", "Per Pay Period", "Not Applicable"]),
        carryForwardLimit: z.number().min(0).max(1000),
        allowNegativeBalance: z.boolean(),
        maxNegativeBalance: z.number().positive().max(1000).optional(),
        requiresAttachment: z.boolean(),
        requiresHandoverContact: z.boolean(),
        countsTowardGratuity: z.boolean(),
        eligibility: z
          .object({
            genderRestriction: z.enum(["Male", "Female"]).optional(),
            omaniOnly: z.boolean().optional(),
            minimumServiceMonths: z.number().int().min(0).max(600).optional(),
          })
          .strict()
          .optional(),
        approvalChain: z.tuple([z.literal("Line Manager"), z.literal("HR")]),
        noticeRules: z
          .object({
            enabled: z.boolean(),
            shortLeaveMaxDays: z.number().int().min(0).max(365),
            shortLeaveNoticeDays: z.number().int().min(0).max(730),
            longLeaveNoticeDays: z.number().int().min(0).max(730),
          })
          .strict()
          .optional(),
        isEnabled: z.boolean(),
        consumesBalance: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const updateLeavePolicyFn = createServerFn({ method: "POST" })
  .validator((input) => UpdatePolicy.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await updateLeavePolicyInDatabase(
      verified.organisationId,
      data.policyId,
      {
        recordVersion: data.policy.recordVersion,
        description: data.policy.description,
        isPaid: data.policy.isPaid,
        ...(data.policy.payTiers ? { payTiers: data.policy.payTiers } : {}),
        baseEntitlementDays: data.policy.baseEntitlementDays,
        accrualMode: data.policy.accrualMode,
        carryForwardLimit: data.policy.carryForwardLimit,
        allowNegativeBalance: data.policy.allowNegativeBalance,
        ...(data.policy.maxNegativeBalance !== undefined
          ? { maxNegativeBalance: data.policy.maxNegativeBalance }
          : {}),
        requiresAttachment: data.policy.requiresAttachment,
        requiresHandoverContact: data.policy.requiresHandoverContact,
        countsTowardGratuity: data.policy.countsTowardGratuity,
        ...(data.policy.eligibility ? { eligibility: data.policy.eligibility } : {}),
        approvalChain: data.policy.approvalChain,
        ...(data.policy.noticeRules ? { noticeRules: data.policy.noticeRules } : {}),
        isEnabled: data.policy.isEnabled,
        consumesBalance: data.policy.consumesBalance,
      },
      verified.actor,
    );
    return listLeaveSnapshotForActor(verified.organisationId, verified.actor);
  });

const AdjustBalance = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    policyId: z.string().uuid(),
    newValue: z.number().min(-1000).max(10000),
    reason: z.string().trim().min(5).max(2000),
  })
  .strict();
export const adjustEmployeeLeaveBalanceFn = createServerFn({ method: "POST" })
  .validator((input) => AdjustBalance.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    await setEmployeeLeaveBalanceInDatabase(
      verified.organisationId,
      {
        employeeId: data.employeeId,
        policyId: data.policyId,
        newValue: data.newValue,
        reason: data.reason,
      },
      verified.actor,
    );
    return listLeaveSnapshotForActor(verified.organisationId, verified.actor);
  });

const ChangeLeave = z.discriminatedUnion("kind", [
  z.object({ actor: Actor, requestId: z.string().uuid(), kind: z.literal("withdraw") }).strict(),
  z
    .object({
      actor: Actor,
      requestId: z.string().uuid(),
      kind: z.literal("cancel"),
      reason: z.string().trim().min(5).max(2000),
    })
    .strict(),
  z
    .object({
      actor: Actor,
      requestId: z.string().uuid(),
      kind: z.literal("amend"),
      startDate: z.string().date(),
      endDate: z.string().date(),
      reason: z.string().trim().min(5).max(2000),
    })
    .strict(),
]);
export const requestLeaveChangeFn = createServerFn({ method: "POST" })
  .validator((input) => ChangeLeave.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    const action =
      data.kind === "withdraw"
        ? { kind: "withdraw" as const }
        : data.kind === "cancel"
          ? { kind: "cancel" as const, reason: data.reason }
          : {
              kind: "amend" as const,
              startDate: data.startDate,
              endDate: data.endDate,
              reason: data.reason,
            };
    await requestLeaveChangeInDatabase(
      verified.organisationId,
      data.requestId,
      action,
      verified.actor,
    );
    return listLeaveSnapshotForActor(verified.organisationId, verified.actor);
  });

const ExportLeave = z
  .object({
    actor: Actor,
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    status: z.string().trim().max(100).optional(),
    departmentId: z.string().uuid().optional(),
  })
  .strict();
export const exportLeaveRequestsFn = createServerFn({ method: "POST" })
  .validator((input) => ExportLeave.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return exportLeaveRequestsCsvInDatabase(
      verified.organisationId,
      {
        ...(data.startDate ? { startDate: data.startDate } : {}),
        ...(data.endDate ? { endDate: data.endDate } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.departmentId ? { departmentId: data.departmentId } : {}),
      },
      verified.actor,
    );
  });

const CreateLeave = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    policyId: z.string().uuid(),
    startDate: z.string().date(),
    endDate: z.string().date(),
    reason: z.string().trim().min(3).max(2000),
    isHalfDay: z.boolean().optional(),
    handoverContactId: z.string().uuid().optional(),
    attachmentFileId: z.string().uuid().optional(),
    attachment: z
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
export const createLeaveRequestFn = createServerFn({ method: "POST" })
  .validator((input) => CreateLeave.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    if (data.attachment && data.attachmentFileId)
      throw new Error("Submit one supporting attachment source only.");
    let uploadedFileId = data.attachmentFileId;
    if (data.attachment) {
      uploadedFileId = crypto.randomUUID();
      await saveObjectFile({
        id: uploadedFileId,
        organisationId: verified.organisationId,
        bytes: Uint8Array.from(data.attachment.bytes),
        name: data.attachment.fileName,
        mimeType: data.attachment.mimeType,
        owner: { entityType: "leave-request-evidence", entityId: data.employeeId },
        actor: verified.actor,
      });
    }
    try {
      return await createLeaveRequestInDatabase(
        verified.organisationId,
        {
          employeeId: data.employeeId,
          policyId: data.policyId,
          startDate: data.startDate,
          endDate: data.endDate,
          reason: data.reason,
          ...(data.isHalfDay !== undefined ? { isHalfDay: data.isHalfDay } : {}),
          ...(data.handoverContactId ? { handoverContactId: data.handoverContactId } : {}),
          ...(uploadedFileId ? { attachmentFileId: uploadedFileId } : {}),
        },
        verified.actor,
      );
    } catch (error) {
      if (data.attachment && uploadedFileId) {
        await deleteObjectFile(
          verified.organisationId,
          uploadedFileId,
          verified.actor,
          "Removed leave evidence after request submission failed",
        ).catch(() => undefined);
      }
      throw error;
    }
  });

const DecideLeave = z
  .object({
    actor: Actor,
    requestId: z.string().uuid(),
    decision: z.enum(["approve", "decline"]),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export const decideLeaveRequestFn = createServerFn({ method: "POST" })
  .validator((input) => DecideLeave.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return approveLeaveRequestInDatabase(
      verified.organisationId,
      data.requestId,
      verified.actor,
      data.decision,
      data.reason,
    );
  });

const Rollover = z
  .object({ actor: Actor, leaveYear: z.number().int().min(2000).max(2200) })
  .strict();
export const rolloverLeaveBalancesFn = createServerFn({ method: "POST" })
  .validator((input) => Rollover.parse(input))
  .handler(async ({ data }) => {
    const verified = await verify(data.actor);
    return rolloverLeaveBalancesInDatabase(verified.organisationId, data.leaveYear, verified.actor);
  });
