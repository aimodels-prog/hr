import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type {
  EmployeeLeaveEntitlementOverride,
  LeavePolicy,
  LeaveRequest,
  LeaveTransaction,
} from "../../data/leave-types.ts";

import { getDatabaseClient } from "../client.ts";
import { readObjectFile } from "../object-storage.server.ts";
import {
  employeeLeaveEntitlementOverrides,
  employees,
  leaveBalances,
  leavePolicies,
  leaveRequests,
  leaveTransactions,
} from "../schema/index.ts";
import { fileMetadata } from "../schema/documents.ts";
import { departments, publicHolidays } from "../schema/master-data.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { roles, userRoles, users } from "../schema/employee.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function workingDays(
  start: string,
  end: string,
  holidays: Set<string>,
  configuredWorkingDays: number[],
  halfDay: boolean,
): number {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  let days = 0;
  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay();
    const key = cursor.toISOString().slice(0, 10);
    if (configuredWorkingDays.includes(weekday) && !holidays.has(key)) days += 1;
  }
  return halfDay ? 0.5 : days;
}

function recordFields(row: {
  id: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  archivedAt: Date | null;
  recordVersion: number;
}) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archivedAt: row.archivedAt?.toISOString(),
    recordVersion: row.recordVersion,
  };
}

function mapPolicy(row: typeof leavePolicies.$inferSelect): LeavePolicy {
  return {
    ...recordFields(row),
    code: row.code,
    name: row.name,
    type: row.type as LeavePolicy["type"],
    category: row.category as LeavePolicy["category"],
    ...(row.legalBasis ? { legalBasis: row.legalBasis } : {}),
    description: row.description,
    isPaid: row.isPaid,
    ...((row.payTiers as unknown[]).length
      ? { payTiers: row.payTiers as NonNullable<LeavePolicy["payTiers"]> }
      : {}),
    baseEntitlementDays: Number(row.baseEntitlementDays),
    scope: row.scope,
    accrualMode: row.accrualMode,
    carryForwardLimit: Number(row.carryForwardLimit),
    allowNegativeBalance: row.allowNegativeBalance,
    ...(row.maxNegativeBalance !== null
      ? { maxNegativeBalance: Number(row.maxNegativeBalance) }
      : {}),
    requiresAttachment: row.requiresAttachment,
    requiresHandoverContact: row.requiresHandoverContact,
    countsTowardGratuity: row.countsTowardGratuity,
    ...(row.eligibility
      ? { eligibility: row.eligibility as NonNullable<LeavePolicy["eligibility"]> }
      : {}),
    approvalChain: row.approvalChain,
    ...(row.noticeRules
      ? { noticeRules: row.noticeRules as NonNullable<LeavePolicy["noticeRules"]> }
      : {}),
    isEnabled: row.isEnabled,
    isStatutory: row.isStatutory,
    consumesBalance: row.consumesBalance,
  };
}

export interface LeaveDatabaseSnapshot {
  policies: LeavePolicy[];
  requests: LeaveRequest[];
  transactions: LeaveTransaction[];
  balances: Array<{
    id: string;
    employeeId: string;
    policyId: string;
    leaveYear: number;
    balanceDays: number;
    recordVersion: number;
  }>;
  entitlementOverrides: EmployeeLeaveEntitlementOverride[];
}

export async function listLeaveSnapshotForActor(
  organisationId: string,
  actor: AuditActorContext,
): Promise<LeaveDatabaseSnapshot> {
  const db = getDatabaseClient();
  const privileged = actor.activeRole === "HR" || actor.activeRole === "Super Admin";
  const payrollReader = actor.activeRole === "Accounts";
  let employeeIds: string[] = [];
  if (privileged || payrollReader) {
    employeeIds = (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.organisationId, organisationId), isNull(employees.archivedAt)))
    ).map((item) => item.id);
  } else if (actor.activeRole === "Line Manager" && actor.employeeId) {
    employeeIds = (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            or(eq(employees.id, actor.employeeId), eq(employees.lineManagerId, actor.employeeId)),
            isNull(employees.archivedAt),
          ),
        )
    ).map((item) => item.id);
  } else if (actor.employeeId) {
    employeeIds = [actor.employeeId];
  }
  const policyRows = await db
    .select()
    .from(leavePolicies)
    .where(and(eq(leavePolicies.organisationId, organisationId), isNull(leavePolicies.archivedAt)))
    .orderBy(asc(leavePolicies.name));
  if (!employeeIds.length) {
    return {
      policies: policyRows.map(mapPolicy),
      requests: [],
      transactions: [],
      balances: [],
      entitlementOverrides: [],
    };
  }
  const [requestRows, transactionRows, balanceRows, overrideRows] = await Promise.all([
    db
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.organisationId, organisationId),
          inArray(leaveRequests.employeeId, employeeIds),
          ...(payrollReader
            ? [inArray(leaveRequests.status, ["Approved", "Taken", "Cancellation Pending"])]
            : []),
          isNull(leaveRequests.archivedAt),
        ),
      )
      .orderBy(desc(leaveRequests.createdAt)),
    db
      .select()
      .from(leaveTransactions)
      .where(
        and(
          eq(leaveTransactions.organisationId, organisationId),
          inArray(leaveTransactions.employeeId, employeeIds),
          isNull(leaveTransactions.archivedAt),
        ),
      )
      .orderBy(desc(leaveTransactions.date), desc(leaveTransactions.createdAt)),
    db
      .select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.organisationId, organisationId),
          inArray(leaveBalances.employeeId, employeeIds),
          isNull(leaveBalances.archivedAt),
        ),
      ),
    db
      .select()
      .from(employeeLeaveEntitlementOverrides)
      .where(
        and(
          eq(employeeLeaveEntitlementOverrides.organisationId, organisationId),
          inArray(employeeLeaveEntitlementOverrides.employeeId, employeeIds),
          isNull(employeeLeaveEntitlementOverrides.archivedAt),
        ),
      ),
  ]);
  return {
    policies: policyRows.map(mapPolicy),
    requests: requestRows.map((row) => ({
      ...recordFields(row),
      employeeId: row.employeeId,
      policyId: row.policyId,
      startDate: row.startDate,
      endDate: row.endDate,
      isHalfDay: row.isHalfDay,
      workingDaysRequested: Number(row.workingDaysRequested),
      reason: payrollReader ? "Payroll leave record" : row.reason,
      ...(!payrollReader && row.handoverContactId
        ? { handoverContactId: row.handoverContactId }
        : {}),
      ...(!payrollReader && row.attachmentFileId ? { attachmentFileId: row.attachmentFileId } : {}),
      status: row.status,
      ...(row.refusalReason ? { refusalReason: row.refusalReason } : {}),
      ...(row.cancellationReason ? { cancellationReason: row.cancellationReason } : {}),
      ...(row.pendingAmendment
        ? {
            pendingAmendment: row.pendingAmendment as NonNullable<LeaveRequest["pendingAmendment"]>,
          }
        : {}),
      amendmentHistory: row.amendmentHistory as NonNullable<LeaveRequest["amendmentHistory"]>,
      ...((row.sickPayTiers as unknown[]).length
        ? { sickPayTiers: row.sickPayTiers as NonNullable<LeaveRequest["sickPayTiers"]> }
        : {}),
      chainApprovals: row.chainApprovals as LeaveRequest["chainApprovals"],
      policySnapshot: row.policySnapshot as LeaveRequest["policySnapshot"],
    })),
    transactions: transactionRows.map((row) => ({
      ...recordFields(row),
      employeeId: row.employeeId,
      policyId: row.policyId,
      date: row.date,
      transactionType: row.transactionType,
      days: Number(row.days),
      reason: payrollReader ? "Leave balance activity" : row.reason,
      ...(row.referenceId ? { referenceId: row.referenceId } : {}),
      actorUserId: row.actorUserId,
    })),
    balances: balanceRows.map((row) => ({
      id: row.id,
      employeeId: row.employeeId,
      policyId: row.policyId,
      leaveYear: row.leaveYear,
      balanceDays: Number(row.balanceDays),
      recordVersion: row.recordVersion,
    })),
    entitlementOverrides: overrideRows.map((row) => ({
      ...recordFields(row),
      employeeId: row.employeeId,
      policyId: row.policyId,
      days: Number(row.days),
      reason: row.reason,
      effectiveFrom: row.effectiveFrom,
    })),
  };
}

export async function readLeaveAttachmentInDatabase(
  organisationId: string,
  requestId: string,
  actor: AuditActorContext,
) {
  const db = getDatabaseClient();
  const [row] = await db
    .select({
      fileId: leaveRequests.attachmentFileId,
      employeeId: leaveRequests.employeeId,
      lineManagerId: employees.lineManagerId,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .where(
      and(
        eq(leaveRequests.organisationId, organisationId),
        eq(leaveRequests.id, requestId),
        isNull(leaveRequests.archivedAt),
      ),
    )
    .limit(1);
  if (!row?.fileId) throw new Error("This leave request has no supporting attachment.");
  const allowed =
    row.employeeId === actor.employeeId ||
    (actor.activeRole === "Line Manager" && row.lineManagerId === actor.employeeId) ||
    actor.activeRole === "HR" ||
    actor.activeRole === "Super Admin";
  if (!allowed) throw new Error("You do not have permission to open this leave attachment.");
  return readObjectFile(
    organisationId,
    row.fileId,
    actor,
    `Viewed supporting evidence for leave request ${requestId}`,
  );
}

export async function createLeaveRequestInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    policyId: string;
    startDate: string;
    endDate: string;
    reason: string;
    isHalfDay?: boolean;
    handoverContactId?: string;
    attachmentFileId?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId || actor.employeeId !== input.employeeId)
    throw new Error("Employees can only submit leave for themselves.");
  const db = getDatabaseClient();
  const requestId = randomUUID();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({
        id: employees.id,
        lineManagerId: employees.lineManagerId,
        locationId: employees.locationId,
        gender: employees.gender,
        nationality: employees.nationality,
        startDate: employees.startDate,
        status: employees.status,
      })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)))
      .limit(1);
    const [policy] = await tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.organisationId, organisationId),
          eq(leavePolicies.id, input.policyId),
          eq(leavePolicies.isEnabled, true),
        ),
      )
      .limit(1);
    if (!employee || !policy || ["Inactive", "Archived"].includes(employee.status))
      throw new Error("The employee or leave policy is not available.");
    if (input.endDate < input.startDate)
      throw new Error("Leave end date cannot be before the start date.");
    if (input.reason.trim().length < 3)
      throw new Error("Explain the reason for this leave request.");
    if (policy.requiresAttachment && !input.attachmentFileId)
      throw new Error(`Supporting evidence is required for ${policy.name}.`);
    if (policy.requiresHandoverContact && !input.handoverContactId)
      throw new Error(`Select a covering colleague for ${policy.name}.`);
    if (!employee.lineManagerId || employee.lineManagerId === employee.id)
      throw new Error("Ask HR to assign a valid supervisor before requesting leave.");
    if (input.handoverContactId) {
      const [handover] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            eq(employees.id, input.handoverContactId),
            sql`${employees.status} NOT IN ('Inactive', 'Archived')`,
          ),
        )
        .limit(1);
      if (!handover || handover.id === input.employeeId)
        throw new Error("Select an active colleague other than yourself for handover.");
    }
    if (input.attachmentFileId) {
      const [file] = await tx
        .select({
          id: fileMetadata.id,
          ownerEntityType: fileMetadata.ownerEntityType,
          ownerEntityId: fileMetadata.ownerEntityId,
          storageStatus: fileMetadata.storageStatus,
        })
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, organisationId),
            eq(fileMetadata.id, input.attachmentFileId),
          ),
        )
        .limit(1);
      if (
        !file ||
        file.storageStatus !== "Available" ||
        file.ownerEntityType !== "leave-request-evidence" ||
        file.ownerEntityId !== input.employeeId
      )
        throw new Error("The attachment does not belong to this employee.");
    }
    const [settings] = await tx
      .select({ workingDays: appSettings.workingDays })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (!settings?.workingDays.length)
      throw new Error("Organisation working days are not configured.");
    const holidays = await tx
      .select({ date: publicHolidays.holidayDate })
      .from(publicHolidays)
      .where(
        and(
          eq(publicHolidays.organisationId, organisationId),
          eq(publicHolidays.isActive, true),
          or(isNull(publicHolidays.locationId), eq(publicHolidays.locationId, employee.locationId)),
        ),
      );
    const days = workingDays(
      input.startDate,
      input.endDate,
      new Set(holidays.map((h) => h.date)),
      settings.workingDays,
      input.isHalfDay ?? false,
    );
    if (days <= 0) throw new Error("The selected dates contain no working days.");
    const eligibility = (policy.eligibility ?? {}) as {
      genderRestriction?: string;
      omaniOnly?: boolean;
      minimumServiceMonths?: number;
    };
    if (eligibility.genderRestriction && employee.gender !== eligibility.genderRestriction)
      throw new Error(`${policy.name} is not available for this employee.`);
    if (eligibility.omaniOnly && employee.nationality?.trim().toLowerCase() !== "omani")
      throw new Error(`${policy.name} is available only to Omani employees.`);
    if (eligibility.minimumServiceMonths !== undefined) {
      const now = new Date();
      const serviceMonths =
        (now.getUTCFullYear() - Number(employee.startDate.slice(0, 4))) * 12 +
        (now.getUTCMonth() + 1 - Number(employee.startDate.slice(5, 7)));
      if (serviceMonths < eligibility.minimumServiceMonths)
        throw new Error(`${policy.name} requires more completed service time.`);
    }
    const overlapping = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.organisationId, organisationId),
          eq(leaveRequests.employeeId, input.employeeId),
          sql`${leaveRequests.status} NOT IN ('Declined', 'Automatically Refused', 'Cancelled', 'Cancellation Approved')`,
          sql`${leaveRequests.startDate} <= ${input.endDate}`,
          sql`${leaveRequests.endDate} >= ${input.startDate}`,
          isNull(leaveRequests.archivedAt),
        ),
      )
      .limit(1);
    if (overlapping.length) throw new Error("These dates overlap another active leave request.");
    if (policy.consumesBalance) {
      if (policy.scope === "Once Per Service") {
        const used = await tx
          .select({ id: leaveRequests.id })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.employeeId, input.employeeId),
              eq(leaveRequests.policyId, input.policyId),
              sql`${leaveRequests.status} NOT IN ('Declined', 'Automatically Refused', 'Cancelled', 'Cancellation Approved')`,
            ),
          )
          .limit(1);
        if (used.length) throw new Error(`${policy.name} can be used only once during employment.`);
      }
      if (policy.scope === "Once Per Service" || policy.scope === "Per Event") {
        const [override] = await tx
          .select({ days: employeeLeaveEntitlementOverrides.days })
          .from(employeeLeaveEntitlementOverrides)
          .where(
            and(
              eq(employeeLeaveEntitlementOverrides.employeeId, input.employeeId),
              eq(employeeLeaveEntitlementOverrides.policyId, input.policyId),
              sql`${employeeLeaveEntitlementOverrides.effectiveFrom} <= ${input.startDate}`,
              isNull(employeeLeaveEntitlementOverrides.archivedAt),
            ),
          )
          .orderBy(desc(employeeLeaveEntitlementOverrides.effectiveFrom))
          .limit(1);
        const limit = Number(override?.days ?? policy.baseEntitlementDays);
        if (days > limit)
          throw new Error(`${policy.name} is limited to ${limit} day(s) per request.`);
      } else {
        const leaveYear = Number(input.startDate.slice(0, 4));
        const [balance] = await tx
          .select({ days: leaveBalances.balanceDays })
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.employeeId, input.employeeId),
              eq(leaveBalances.policyId, input.policyId),
              eq(leaveBalances.leaveYear, leaveYear),
            ),
          )
          .limit(1);
        const pendingRows = await tx
          .select({ days: leaveRequests.workingDaysRequested })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.employeeId, input.employeeId),
              eq(leaveRequests.policyId, input.policyId),
              sql`${leaveRequests.status} IN ('Pending Line Manager', 'Pending HR', 'Pending Super Admin', 'Amendment Pending Line Manager', 'Amendment Pending HR')`,
            ),
          );
        const projected =
          Number(balance?.days ?? 0) -
          pendingRows.reduce((sum, row) => sum + Number(row.days), 0) -
          days;
        const minimum = policy.allowNegativeBalance ? -Number(policy.maxNegativeBalance ?? 0) : 0;
        if (projected < minimum)
          throw new Error("There is not enough leave balance for this request.");
      }
    }
    const noticeDays = Math.ceil(
      (new Date(`${input.startDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
    );
    const noticeRules = policy.noticeRules as {
      enabled?: boolean;
      shortLeaveMaxDays?: number;
      shortLeaveNoticeDays?: number;
      longLeaveNoticeDays?: number;
    } | null;
    const noticeRule = noticeRules?.enabled
      ? days > Number(noticeRules.shortLeaveMaxDays ?? 5)
        ? Number(noticeRules.longLeaveNoticeDays ?? 60)
        : Number(noticeRules.shortLeaveNoticeDays ?? 14)
      : 0;
    const status =
      noticeRule > 0 && noticeDays < noticeRule ? "Automatically Refused" : "Pending Line Manager";
    const refusalReason =
      status === "Automatically Refused"
        ? `${policy.name} must be requested at least ${noticeRule} days in advance.`
        : undefined;
    await tx.insert(leaveRequests).values({
      id: requestId,
      organisationId,
      employeeId: input.employeeId,
      policyId: input.policyId,
      startDate: input.startDate,
      endDate: input.endDate,
      isHalfDay: input.isHalfDay ?? false,
      workingDaysRequested: String(days),
      reason: input.reason.trim(),
      handoverContactId: input.handoverContactId,
      attachmentFileId: input.attachmentFileId,
      status,
      refusalReason,
      chainApprovals: [
        { role: "Line Manager", status: "Pending" },
        { role: "HR", status: "Pending" },
      ],
      policySnapshot: {
        name: policy.name,
        type: policy.type,
        isPaid: policy.isPaid,
        baseEntitlementDays: Number(policy.baseEntitlementDays),
        accrualMode: policy.accrualMode,
      },
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof leaveRequests.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: status === "Automatically Refused" ? "auto-refuse" : "submit",
      module: "leave",
      entityType: "leave-request",
      entityId: requestId,
      afterSummary: { status, days },
      reason: refusalReason ?? "Submitted a leave request",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
    const recipientEmployeeId =
      status === "Automatically Refused" ? employee.id : employee.lineManagerId;
    const [recipient] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.employeeId, recipientEmployeeId),
          eq(users.status, "Active"),
        ),
      )
      .limit(1);
    if (recipient) {
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: recipient.id,
          type: status === "Automatically Refused" ? "leave_refused" : "leave_approval",
          title:
            status === "Automatically Refused"
              ? "Leave request could not be submitted"
              : "Leave request awaiting your review",
          message:
            refusalReason ??
            `A ${days}-day ${policy.name} request is awaiting your supervisor decision.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `leave-submission-${requestId}-${recipient.id}`,
          link: {
            entityType: "leave-request",
            entityId: requestId,
            path:
              status === "Automatically Refused"
                ? "/staff/me/leave-balances"
                : "/staff/leave-approvals",
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    }
    return requestId;
  });
}

export async function approveLeaveRequestInDatabase(
  organisationId: string,
  requestId: string,
  actor: AuditActorContext,
  decision: "approve" | "decline",
  reason?: string,
): Promise<void> {
  if (!actor.userId) throw new Error("A verified user is required for leave decisions.");
  const actorUserId = actor.userId;
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.organisationId, organisationId), eq(leaveRequests.id, requestId)))
      .for("update")
      .limit(1);
    if (!request) throw new Error("Leave request not found.");
    const [employee] = await tx
      .select({
        lineManagerId: employees.lineManagerId,
        locationId: employees.locationId,
        preferredName: employees.preferredName,
      })
      .from(employees)
      .where(
        and(eq(employees.organisationId, organisationId), eq(employees.id, request.employeeId)),
      )
      .limit(1);
    const [policy] = await tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.organisationId, organisationId),
          eq(leavePolicies.id, request.policyId),
        ),
      )
      .limit(1);
    if (!employee || !policy) throw new Error("The employee or leave policy is unavailable.");
    const role = actor.activeRole;
    const amendment =
      request.status === "Amendment Pending Line Manager" ||
      request.status === "Amendment Pending HR";
    const cancellation = request.status === "Cancellation Pending";
    const managerStage =
      request.status === "Pending Line Manager" ||
      request.status === "Amendment Pending Line Manager";
    const hrStage =
      request.status === "Pending HR" || request.status === "Amendment Pending HR" || cancellation;
    const isManager = role === "Line Manager" && actor.employeeId === employee?.lineManagerId;
    if (
      (managerStage && !isManager) ||
      (hrStage && role !== "HR" && role !== "Super Admin") ||
      (!managerStage && !hrStage)
    )
      throw new Error("You are not the assigned approver for this leave request.");
    if (actor.employeeId === request.employeeId)
      throw new Error("You cannot make a decision on your own leave request.");
    const pendingAmendment = request.pendingAmendment
      ? structuredClone(request.pendingAmendment as NonNullable<LeaveRequest["pendingAmendment"]>)
      : undefined;
    const sourceApprovals: LeaveRequest["chainApprovals"] = amendment
      ? (pendingAmendment?.chainApprovals ?? [])
      : (request.chainApprovals as LeaveRequest["chainApprovals"]);
    const chainApprovals = [...sourceApprovals];
    const currentStep = chainApprovals.find((step) =>
      managerStage ? step.role === "Line Manager" : step.role === "HR",
    );
    if (currentStep) {
      currentStep.status = decision === "approve" ? "Approved" : "Declined";
      currentStep.approvedBy = actorUserId;
      currentStep.date = new Date().toISOString();
    }
    let nextStatus: (typeof leaveRequests.$inferSelect)["status"];
    let requestUpdateExtras: Partial<typeof leaveRequests.$inferInsert> = {};
    if (decision === "decline") {
      if (!reason?.trim()) throw new Error("A reason is required when declining leave.");
      if (cancellation) {
        nextStatus = "Approved";
        requestUpdateExtras = {
          cancellationReason: `Cancellation request declined: ${reason.trim()}`,
        };
      } else if (amendment && pendingAmendment) {
        nextStatus = "Approved";
        requestUpdateExtras = {
          pendingAmendment: null,
          amendmentHistory: [
            ...((request.amendmentHistory ?? []) as NonNullable<LeaveRequest["amendmentHistory"]>),
            {
              previousStartDate: request.startDate,
              previousEndDate: request.endDate,
              previousWorkingDays: Number(request.workingDaysRequested),
              newStartDate: pendingAmendment.proposedStartDate,
              newEndDate: pendingAmendment.proposedEndDate,
              newWorkingDays: pendingAmendment.proposedWorkingDays,
              reason: pendingAmendment.reason,
              decidedAt: new Date().toISOString(),
              decidedBy: actorUserId,
              outcome: "Declined",
              decisionReason: reason.trim(),
            },
          ],
        };
      } else {
        nextStatus = "Declined";
      }
    } else if (managerStage) {
      nextStatus = amendment ? "Amendment Pending HR" : "Pending HR";
      if (amendment && pendingAmendment) {
        pendingAmendment.chainApprovals = chainApprovals;
        requestUpdateExtras = { pendingAmendment };
      }
    } else {
      nextStatus = cancellation ? "Cancellation Approved" : "Approved";
      const balanceChange = cancellation
        ? Number(request.workingDaysRequested)
        : amendment && pendingAmendment
          ? Number(request.workingDaysRequested) - pendingAmendment.proposedWorkingDays
          : -Number(request.workingDaysRequested);
      if (
        policy.consumesBalance &&
        (policy.scope === "Annual" || policy.scope === "Ledger") &&
        balanceChange !== 0
      ) {
        const minimum = policy.allowNegativeBalance ? -Number(policy.maxNegativeBalance ?? 0) : 0;
        const updated = await tx
          .update(leaveBalances)
          .set({
            balanceDays: sql`${leaveBalances.balanceDays} + ${balanceChange}`,
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${leaveBalances.recordVersion} + 1`,
          })
          .where(
            and(
              eq(leaveBalances.organisationId, organisationId),
              eq(leaveBalances.employeeId, request.employeeId),
              eq(leaveBalances.policyId, request.policyId),
              eq(leaveBalances.leaveYear, Number(request.startDate.slice(0, 4))),
              sql`${leaveBalances.balanceDays} + ${balanceChange} >= ${minimum}`,
            ),
          )
          .returning({ id: leaveBalances.id });
        if (!updated.length) throw new Error("There is not enough leave balance available.");
      }
      if (policy.consumesBalance && balanceChange !== 0) {
        await tx.insert(leaveTransactions).values({
          id: randomUUID(),
          organisationId,
          employeeId: request.employeeId,
          policyId: request.policyId,
          date: request.startDate,
          transactionType: cancellation
            ? "Cancellation Restoration"
            : amendment
              ? "Leave Amendment"
              : "Approved Leave",
          days: String(balanceChange),
          reason: cancellation
            ? `Cancellation approved: ${request.cancellationReason ?? "Employee request"}`
            : amendment
              ? `Leave dates changed: ${pendingAmendment?.reason ?? "Employee request"}`
              : `${policy.name} approved by HR`,
          referenceId: request.id,
          actorUserId: actor.userId,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof leaveTransactions.$inferInsert);
      }
      if (amendment && pendingAmendment) {
        requestUpdateExtras = {
          startDate: pendingAmendment.proposedStartDate,
          endDate: pendingAmendment.proposedEndDate,
          workingDaysRequested: String(pendingAmendment.proposedWorkingDays),
          pendingAmendment: null,
          amendmentHistory: [
            ...((request.amendmentHistory ?? []) as NonNullable<LeaveRequest["amendmentHistory"]>),
            {
              previousStartDate: request.startDate,
              previousEndDate: request.endDate,
              previousWorkingDays: Number(request.workingDaysRequested),
              newStartDate: pendingAmendment.proposedStartDate,
              newEndDate: pendingAmendment.proposedEndDate,
              newWorkingDays: pendingAmendment.proposedWorkingDays,
              reason: pendingAmendment.reason,
              decidedAt: new Date().toISOString(),
              decidedBy: actorUserId,
              outcome: "Approved",
            },
          ],
        };
      }
    }
    await tx
      .update(leaveRequests)
      .set({
        status: nextStatus,
        ...(amendment ? {} : { chainApprovals }),
        ...requestUpdateExtras,
        refusalReason:
          decision === "decline" && !cancellation && !amendment
            ? reason!.trim()
            : request.refusalReason,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${leaveRequests.recordVersion} + 1`,
      })
      .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, request.status)));

    const employeeUsers = await tx
      .select({ id: users.id, employeeId: users.employeeId })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.status, "Active"),
          nextStatus === "Approved"
            ? or(
                eq(users.employeeId, request.employeeId),
                eq(users.employeeId, request.handoverContactId ?? request.employeeId),
              )
            : eq(users.employeeId, request.employeeId),
        ),
      );
    let recipients = employeeUsers.map((item) => ({
      id: item.id,
      path: "/staff/me/leave-balances",
    }));
    if (nextStatus === "Pending HR" || nextStatus === "Amendment Pending HR") {
      recipients = (
        await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.status, "Active"),
              inArray(roles.code, ["HR", "Super Admin"]),
            ),
          )
      ).map((item) => ({ id: item.id, path: "/staff/leave-approvals" }));
    }
    if (nextStatus === "Approved") {
      const officeUsers = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(employees, eq(employees.id, users.employeeId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            eq(employees.locationId, employee.locationId),
            sql`${employees.id} <> ${request.employeeId}`,
          ),
        );
      recipients.push(...officeUsers.map((item) => ({ id: item.id, path: "/staff" })));
    }
    for (const recipient of new Map(recipients.map((item) => [item.id, item])).values()) {
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: recipient.id,
          type:
            nextStatus === "Approved"
              ? "leave_approved"
              : nextStatus === "Declined"
                ? "leave_declined"
                : nextStatus === "Cancellation Approved"
                  ? "leave_cancelled"
                  : "leave_approval",
          title:
            nextStatus === "Approved"
              ? amendment
                ? "Leave dates updated"
                : "Approved leave"
              : nextStatus === "Declined"
                ? "Leave request declined"
                : nextStatus === "Cancellation Approved"
                  ? "Leave cancellation approved"
                  : "Leave request awaiting HR confirmation",
          message:
            nextStatus === "Approved"
              ? `${employee.preferredName} will be away from ${request.startDate} to ${request.endDate}.`
              : nextStatus === "Cancellation Approved"
                ? `The approved leave from ${request.startDate} to ${request.endDate} has been cancelled.`
                : nextStatus === "Declined"
                  ? reason!.trim()
                  : `${employee.preferredName}'s leave request has supervisor approval and now needs HR confirmation.`,
          priority:
            nextStatus === "Pending HR" || nextStatus === "Amendment Pending HR"
              ? "High"
              : "Normal",
          status: "Unread",
          deduplicationKey: `leave-${nextStatus}-${request.id}-${recipient.id}`,
          link: { entityType: "leave-request", entityId: request.id, path: recipient.path },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: decision,
      module: "leave",
      entityType: "leave-request",
      entityId: requestId,
      beforeSummary: { status: request.status },
      afterSummary: { decision, status: nextStatus },
      reason: reason?.trim() ?? "Leave approval decision",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function updateLeavePolicyInDatabase(
  organisationId: string,
  policyId: string,
  updates: Pick<
    LeavePolicy,
    | "recordVersion"
    | "description"
    | "isPaid"
    | "payTiers"
    | "baseEntitlementDays"
    | "accrualMode"
    | "carryForwardLimit"
    | "allowNegativeBalance"
    | "maxNegativeBalance"
    | "requiresAttachment"
    | "requiresHandoverContact"
    | "countsTowardGratuity"
    | "eligibility"
    | "approvalChain"
    | "noticeRules"
    | "isEnabled"
    | "consumesBalance"
  >,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can change leave policies.");
  if (!actor.userId) throw new Error("A verified user is required.");
  if (updates.description.trim().length < 10) throw new Error("Add a clear policy explanation.");
  if (!Number.isFinite(updates.baseEntitlementDays) || updates.baseEntitlementDays < 0)
    throw new Error("The entitlement must be zero or greater.");
  if (!Number.isFinite(updates.carryForwardLimit) || updates.carryForwardLimit < 0)
    throw new Error("The carry-over limit must be zero or greater.");
  if (
    updates.approvalChain.length !== 2 ||
    updates.approvalChain[0] !== "Line Manager" ||
    updates.approvalChain[1] !== "HR"
  )
    throw new Error("Leave approval must follow Supervisor, then HR.");
  if (
    updates.allowNegativeBalance &&
    (!Number.isFinite(updates.maxNegativeBalance) || Number(updates.maxNegativeBalance) <= 0)
  )
    throw new Error("Enter a positive advance-leave limit.");
  if (updates.noticeRules?.enabled) {
    const values = [
      updates.noticeRules.shortLeaveMaxDays,
      updates.noticeRules.shortLeaveNoticeDays,
      updates.noticeRules.longLeaveNoticeDays,
    ];
    if (values.some((value) => !Number.isInteger(value) || value < 0))
      throw new Error("Notice periods must be whole numbers of zero or greater.");
    if (updates.noticeRules.longLeaveNoticeDays < updates.noticeRules.shortLeaveNoticeDays)
      throw new Error("Long-leave notice cannot be shorter than short-leave notice.");
  }
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.organisationId, organisationId),
          eq(leavePolicies.id, policyId),
          isNull(leavePolicies.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) throw new Error("Leave policy not found.");
    if (current.recordVersion !== updates.recordVersion)
      throw new Error("This policy changed after you opened it. Reload and try again.");
    if (current.isStatutory && !updates.isEnabled)
      throw new Error(`${current.name} is a statutory policy and cannot be turned off.`);
    const delta = updates.baseEntitlementDays - Number(current.baseEntitlementDays);
    await tx
      .update(leavePolicies)
      .set({
        description: updates.description.trim(),
        isPaid: updates.isPaid,
        payTiers: updates.payTiers ?? [],
        baseEntitlementDays: String(updates.baseEntitlementDays),
        accrualMode: updates.accrualMode,
        carryForwardLimit: String(updates.carryForwardLimit),
        allowNegativeBalance: updates.allowNegativeBalance,
        maxNegativeBalance: updates.allowNegativeBalance
          ? String(updates.maxNegativeBalance)
          : null,
        requiresAttachment: updates.requiresAttachment,
        requiresHandoverContact: updates.requiresHandoverContact,
        countsTowardGratuity: updates.countsTowardGratuity,
        eligibility: updates.eligibility ?? null,
        approvalChain: updates.approvalChain,
        noticeRules: updates.noticeRules ?? null,
        isEnabled: updates.isEnabled,
        consumesBalance: updates.consumesBalance,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${leavePolicies.recordVersion} + 1`,
      })
      .where(
        and(eq(leavePolicies.id, policyId), eq(leavePolicies.recordVersion, updates.recordVersion)),
      );
    if (delta !== 0 && current.scope === "Annual") {
      const year = new Date().getUTCFullYear();
      const balances = await tx
        .update(leaveBalances)
        .set({
          balanceDays: sql`${leaveBalances.balanceDays} + ${delta}`,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${leaveBalances.recordVersion} + 1`,
        })
        .where(
          and(
            eq(leaveBalances.organisationId, organisationId),
            eq(leaveBalances.policyId, policyId),
            eq(leaveBalances.leaveYear, year),
            isNull(leaveBalances.archivedAt),
          ),
        )
        .returning({ employeeId: leaveBalances.employeeId, balanceId: leaveBalances.id });
      if (balances.length) {
        await tx.insert(leaveTransactions).values(
          balances.map((balance) => ({
            id: randomUUID(),
            organisationId,
            employeeId: balance.employeeId,
            policyId,
            date: new Date().toISOString().slice(0, 10),
            transactionType: "Manual Adjustment" as const,
            days: String(delta),
            reason: `HR changed the ${year} ${current.name} allowance from ${current.baseEntitlementDays} to ${updates.baseEntitlementDays} days`,
            referenceId: balance.balanceId,
            actorUserId: actor.userId!,
            createdBy: actor.userId!,
            updatedBy: actor.userId!,
          })),
        );
      }
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update-policy",
      module: "leave",
      entityType: "leave-policy",
      entityId: policyId,
      beforeSummary: {
        entitlement: Number(current.baseEntitlementDays),
        enabled: current.isEnabled,
      },
      afterSummary: { entitlement: updates.baseEntitlementDays, enabled: updates.isEnabled },
      reason: `Updated ${current.name} policy`,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function setEmployeeLeaveBalanceInDatabase(
  organisationId: string,
  input: { employeeId: string; policyId: string; newValue: number; reason: string },
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can edit leave balances.");
  if (!actor.userId) throw new Error("A verified user is required.");
  if (!Number.isFinite(input.newValue)) throw new Error("Enter a valid leave balance.");
  if (input.reason.trim().length < 5) throw new Error("Explain why the leave balance is changing.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [policy] = await tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.organisationId, organisationId),
          eq(leavePolicies.id, input.policyId),
          isNull(leavePolicies.archivedAt),
        ),
      )
      .limit(1);
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)))
      .limit(1);
    if (!policy || !employee) throw new Error("The employee or leave policy is unavailable.");
    if (policy.scope === "Per Event" || policy.scope === "Once Per Service") {
      if (input.newValue < 0) throw new Error("An individual leave allowance cannot be negative.");
      await tx.insert(employeeLeaveEntitlementOverrides).values({
        id: randomUUID(),
        organisationId,
        employeeId: input.employeeId,
        policyId: input.policyId,
        days: String(input.newValue),
        reason: input.reason.trim(),
        effectiveFrom: new Date().toISOString().slice(0, 10),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof employeeLeaveEntitlementOverrides.$inferInsert);
    } else {
      const year = new Date().getUTCFullYear();
      const [balance] = await tx
        .select()
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.employeeId, input.employeeId),
            eq(leaveBalances.policyId, input.policyId),
            eq(leaveBalances.leaveYear, year),
          ),
        )
        .for("update")
        .limit(1);
      if (!balance)
        throw new Error("Run the annual entitlement rollover before editing this balance.");
      const delta = input.newValue - Number(balance.balanceDays);
      if (delta === 0) throw new Error("The new balance is the same as the current balance.");
      const minimum = policy.allowNegativeBalance ? -Number(policy.maxNegativeBalance ?? 0) : 0;
      if (input.newValue < minimum)
        throw new Error(`The balance cannot be lower than ${minimum} days.`);
      await tx
        .update(leaveBalances)
        .set({
          balanceDays: String(input.newValue),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${leaveBalances.recordVersion} + 1`,
        })
        .where(eq(leaveBalances.id, balance.id));
      await tx.insert(leaveTransactions).values({
        id: randomUUID(),
        organisationId,
        employeeId: input.employeeId,
        policyId: input.policyId,
        date: new Date().toISOString().slice(0, 10),
        transactionType: "Manual Adjustment",
        days: String(delta),
        reason: input.reason.trim(),
        referenceId: balance.id,
        actorUserId: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof leaveTransactions.$inferInsert);
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "adjust-balance",
      module: "leave",
      entityType: "leave-balance",
      entityId: input.employeeId,
      afterSummary: { policyId: input.policyId, newValue: input.newValue },
      reason: input.reason.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function requestLeaveChangeInDatabase(
  organisationId: string,
  requestId: string,
  action:
    | { kind: "withdraw" }
    | { kind: "cancel"; reason: string }
    | { kind: "amend"; startDate: string; endDate: string; reason: string },
  actor: AuditActorContext,
): Promise<void> {
  if (!actor.userId || !actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ request: leaveRequests, employee: employees })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .where(
        and(
          eq(leaveRequests.organisationId, organisationId),
          eq(leaveRequests.id, requestId),
          isNull(leaveRequests.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!row || row.request.employeeId !== actor.employeeId)
      throw new Error("You can only change your own leave request.");
    let status: (typeof leaveRequests.$inferSelect)["status"];
    let values: Partial<typeof leaveRequests.$inferInsert>;
    if (action.kind === "withdraw") {
      if (!["Pending Line Manager", "Pending HR"].includes(row.request.status))
        throw new Error("Only a pending leave request can be withdrawn.");
      status = "Cancelled";
      values = { status, cancellationReason: "Withdrawn by employee before approval" };
    } else if (action.kind === "cancel") {
      if (row.request.status !== "Approved")
        throw new Error("Only approved future leave can be cancelled.");
      if (row.request.endDate < new Date().toISOString().slice(0, 10))
        throw new Error("Past leave must be corrected by HR.");
      if (action.reason.trim().length < 5)
        throw new Error("Explain why the leave is being cancelled.");
      status = "Cancellation Pending";
      values = { status, cancellationReason: action.reason.trim() };
    } else {
      if (row.request.status !== "Approved")
        throw new Error("Only approved future leave can be changed.");
      if (action.reason.trim().length < 5) throw new Error("Explain why the dates are changing.");
      if (
        action.endDate < action.startDate ||
        action.startDate < new Date().toISOString().slice(0, 10)
      )
        throw new Error("Choose valid future leave dates.");
      const [settings] = await tx
        .select({ workingDays: appSettings.workingDays })
        .from(appSettings)
        .where(eq(appSettings.organisationId, organisationId))
        .limit(1);
      const holidays = await tx
        .select({ date: publicHolidays.holidayDate })
        .from(publicHolidays)
        .where(
          and(
            eq(publicHolidays.organisationId, organisationId),
            eq(publicHolidays.isActive, true),
            or(
              isNull(publicHolidays.locationId),
              eq(publicHolidays.locationId, row.employee.locationId),
            ),
          ),
        );
      const proposedDays = workingDays(
        action.startDate,
        action.endDate,
        new Set(holidays.map((item) => item.date)),
        settings?.workingDays ?? [],
        row.request.isHalfDay,
      );
      if (proposedDays <= 0) throw new Error("The proposed dates contain no working days.");
      const overlap = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.employeeId, actor.employeeId),
            sql`${leaveRequests.id} <> ${requestId}`,
            sql`${leaveRequests.status} NOT IN ('Declined', 'Automatically Refused', 'Cancelled', 'Cancellation Approved')`,
            sql`${leaveRequests.startDate} <= ${action.endDate}`,
            sql`${leaveRequests.endDate} >= ${action.startDate}`,
            isNull(leaveRequests.archivedAt),
          ),
        )
        .limit(1);
      if (overlap.length) throw new Error("The proposed dates overlap another leave request.");
      status = "Amendment Pending Line Manager";
      values = {
        status,
        pendingAmendment: {
          proposedStartDate: action.startDate,
          proposedEndDate: action.endDate,
          proposedWorkingDays: proposedDays,
          reason: action.reason.trim(),
          requestedAt: new Date().toISOString(),
          requestedBy: actor.userId,
          chainApprovals: [
            { role: "Line Manager", status: "Pending" },
            { role: "HR", status: "Pending" },
          ],
        },
      };
    }
    await tx
      .update(leaveRequests)
      .set({
        ...values,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${leaveRequests.recordVersion} + 1`,
      })
      .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.status, row.request.status)));
    const recipientEmployeeId =
      status === "Cancellation Pending" ? row.request.employeeId : row.employee.lineManagerId;
    let recipients: string[] = [];
    if (status === "Cancellation Pending") {
      recipients = (
        await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.status, "Active"),
              inArray(roles.code, ["HR", "Super Admin"]),
            ),
          )
      ).map((item) => item.id);
    } else if (status === "Amendment Pending Line Manager" && recipientEmployeeId) {
      recipients = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.employeeId, recipientEmployeeId),
              eq(users.status, "Active"),
            ),
          )
      ).map((item) => item.id);
    }
    for (const recipientUserId of recipients) {
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId,
          type: "leave_approval",
          title:
            status === "Cancellation Pending"
              ? "Leave cancellation awaiting HR review"
              : "Leave date change awaiting your review",
          message: `A change to leave from ${row.request.startDate} to ${row.request.endDate} needs review.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `leave-change-${requestId}-${status}-${recipientUserId}`,
          link: {
            entityType: "leave-request",
            entityId: requestId,
            path: "/staff/leave-approvals",
          },
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: action.kind,
      module: "leave",
      entityType: "leave-request",
      entityId: requestId,
      beforeSummary: { status: row.request.status },
      afterSummary: { status },
      reason: action.kind === "withdraw" ? "Withdrew leave request" : action.reason.trim(),
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportLeaveRequestsCsvInDatabase(
  organisationId: string,
  filters: { startDate?: string; endDate?: string; status?: string; departmentId?: string },
  actor: AuditActorContext,
): Promise<{ fileName: string; content: string; rowCount: number }> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can export leave records.");
  if (!actor.userId) throw new Error("A verified user is required.");
  const db = getDatabaseClient();
  const conditions = [
    eq(leaveRequests.organisationId, organisationId),
    isNull(leaveRequests.archivedAt),
  ];
  if (filters.startDate) conditions.push(sql`${leaveRequests.endDate} >= ${filters.startDate}`);
  if (filters.endDate) conditions.push(sql`${leaveRequests.startDate} <= ${filters.endDate}`);
  if (filters.status) conditions.push(sql`${leaveRequests.status}::text = ${filters.status}`);
  if (filters.departmentId) conditions.push(eq(employees.departmentId, filters.departmentId));
  const rows = await db
    .select({
      employeeNumber: employees.employeeNumber,
      employeeName: employees.legalName,
      department: departments.name,
      policy: leavePolicies.name,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.workingDaysRequested,
      status: leaveRequests.status,
      reason: leaveRequests.reason,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leavePolicies, eq(leavePolicies.id, leaveRequests.policyId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(...conditions))
    .orderBy(desc(leaveRequests.startDate), asc(employees.employeeNumber));
  const headers = [
    "Employee Number",
    "Employee",
    "Department",
    "Leave Type",
    "Start Date",
    "End Date",
    "Working Days",
    "Status",
    "Reason",
  ];
  const content = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.employeeNumber,
        row.employeeName,
        row.department,
        row.policy,
        row.startDate,
        row.endDate,
        row.days,
        row.status,
        row.reason,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [actor.activeRole],
    action: "export",
    module: "leave",
    entityType: "leave-export",
    entityId: randomUUID(),
    afterSummary: { rowCount: rows.length, filters },
    reason: "Exported leave records",
    riskLevel: "High",
  } as typeof auditEvents.$inferInsert);
  return {
    fileName: `leave-requests-${new Date().toISOString().slice(0, 10)}.csv`,
    content,
    rowCount: rows.length,
  };
}

/** Idempotent annual entitlement/carry-forward materialisation for a payroll year. */
export async function rolloverLeaveBalancesInDatabase(
  organisationId: string,
  leaveYear: number,
  actor: AuditActorContext,
): Promise<number> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can run leave rollover.");
  const db = getDatabaseClient();
  let created = 0;
  await db.transaction(async (tx) => {
    const [settings] = await tx
      .select({ leaveYearStart: appSettings.leaveYearStart })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (!settings) throw new Error("Organisation leave-year settings are unavailable.");
    const rolloverDate = `${leaveYear}-${settings.leaveYearStart}`;
    const policies = await tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.organisationId, organisationId),
          eq(leavePolicies.isEnabled, true),
          eq(leavePolicies.consumesBalance, true),
          eq(leavePolicies.scope, "Annual"),
        ),
      );
    const staff = await tx
      .select({
        id: employees.id,
        gender: employees.gender,
        nationality: employees.nationality,
        startDate: employees.startDate,
      })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          sql`${employees.status} NOT IN ('Inactive', 'Archived')`,
        ),
      );
    for (const employee of staff)
      for (const policy of policies) {
        const eligibility = (policy.eligibility ?? {}) as {
          genderRestriction?: string;
          omaniOnly?: boolean;
          minimumServiceMonths?: number;
        };
        if (eligibility.genderRestriction && employee.gender !== eligibility.genderRestriction)
          continue;
        if (eligibility.omaniOnly && employee.nationality?.trim().toLowerCase() !== "omani")
          continue;
        if (eligibility.minimumServiceMonths !== undefined) {
          const atYearStart = new Date(`${leaveYear}-01-01T00:00:00Z`);
          const months =
            (atYearStart.getUTCFullYear() - Number(employee.startDate.slice(0, 4))) * 12 +
            (atYearStart.getUTCMonth() + 1 - Number(employee.startDate.slice(5, 7)));
          if (months < eligibility.minimumServiceMonths) continue;
        }
        const [existing] = await tx
          .select({ id: leaveBalances.id })
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.employeeId, employee.id),
              eq(leaveBalances.policyId, policy.id),
              eq(leaveBalances.leaveYear, leaveYear),
            ),
          )
          .limit(1);
        if (existing) continue;
        const [prior] = await tx
          .select({ balance: leaveBalances.balanceDays })
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.employeeId, employee.id),
              eq(leaveBalances.policyId, policy.id),
              eq(leaveBalances.leaveYear, leaveYear - 1),
            ),
          )
          .limit(1);
        const carry = Math.max(
          0,
          Math.min(Number(prior?.balance ?? 0), Number(policy.carryForwardLimit)),
        );
        const [override] = await tx
          .select({ days: employeeLeaveEntitlementOverrides.days })
          .from(employeeLeaveEntitlementOverrides)
          .where(
            and(
              eq(employeeLeaveEntitlementOverrides.employeeId, employee.id),
              eq(employeeLeaveEntitlementOverrides.policyId, policy.id),
              sql`${employeeLeaveEntitlementOverrides.effectiveFrom} <= ${rolloverDate}`,
              isNull(employeeLeaveEntitlementOverrides.archivedAt),
            ),
          )
          .orderBy(desc(employeeLeaveEntitlementOverrides.effectiveFrom))
          .limit(1);
        const entitlement = Number(override?.days ?? policy.baseEntitlementDays);
        const total = entitlement + carry;
        if (total <= 0) continue;
        const balanceId = randomUUID();
        await tx.insert(leaveBalances).values({
          id: balanceId,
          organisationId,
          employeeId: employee.id,
          policyId: policy.id,
          leaveYear,
          balanceDays: String(total),
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof leaveBalances.$inferInsert);
        if (entitlement > 0)
          await tx.insert(leaveTransactions).values({
            id: randomUUID(),
            organisationId,
            employeeId: employee.id,
            policyId: policy.id,
            date: rolloverDate,
            transactionType: "Entitlement",
            days: String(entitlement),
            reason: `Annual ${leaveYear} entitlement`,
            referenceId: balanceId,
            actorUserId: actor.userId,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof leaveTransactions.$inferInsert);
        if (carry > 0)
          await tx.insert(leaveTransactions).values({
            id: randomUUID(),
            organisationId,
            employeeId: employee.id,
            policyId: policy.id,
            date: rolloverDate,
            transactionType: "Carry-Forward",
            days: String(carry),
            reason: `Unused balance carried forward from ${leaveYear - 1}`,
            referenceId: balanceId,
            actorUserId: actor.userId,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof leaveTransactions.$inferInsert);
        created += 1;
      }
    if (created)
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole ?? null,
        actorRoles: actor.roles ?? [],
        action: "rollover",
        module: "leave",
        entityType: "leave-balance",
        entityId: organisationId,
        afterSummary: { leaveYear, balancesCreated: created },
        reason: `Initialised leave entitlements for ${leaveYear}`,
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
  });
  return created;
}

/** Durable idempotent rollover entry point for the background worker. */
export async function processScheduledLeaveRollover(now = new Date()): Promise<{
  organisations: number;
  balancesCreated: number;
  requestsMarkedTaken: number;
}> {
  const db = getDatabaseClient();
  const rows = await db
    .select({ organisation: organisations, settings: appSettings })
    .from(organisations)
    .innerJoin(appSettings, eq(appSettings.organisationId, organisations.id))
    .where(eq(organisations.isActive, true));
  let balancesCreated = 0;
  let requestsMarkedTaken = 0;
  for (const row of rows) {
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: row.settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const leaveYear = Number(localDate.slice(0, 4));
    const taken = await db
      .update(leaveRequests)
      .set({
        status: "Taken",
        updatedAt: new Date(),
        updatedBy: row.organisation.createdBy,
        recordVersion: sql`${leaveRequests.recordVersion} + 1`,
      })
      .where(
        and(
          eq(leaveRequests.organisationId, row.organisation.id),
          eq(leaveRequests.status, "Approved"),
          sql`${leaveRequests.endDate} < ${localDate}`,
        ),
      )
      .returning({ id: leaveRequests.id });
    requestsMarkedTaken += taken.length;
    if (taken.length) {
      await db.insert(auditEvents).values({
        organisationId: row.organisation.id,
        actorUserId: row.organisation.createdBy,
        actorDisplayName: "VIA background worker",
        activeRole: "Super Admin",
        actorRoles: ["Super Admin"],
        action: "mark-taken",
        module: "leave",
        entityType: "leave-request",
        entityId: row.organisation.id,
        afterSummary: { requestIds: taken.map((item) => item.id), date: localDate },
        reason: "Updated completed approved leave to taken",
        riskLevel: "Low",
      } as typeof auditEvents.$inferInsert);
    }
    const start = `${leaveYear}-${row.settings.leaveYearStart}`;
    if (localDate < start) continue;
    balancesCreated += await rolloverLeaveBalancesInDatabase(row.organisation.id, leaveYear, {
      userId: row.organisation.createdBy,
      displayName: "VIA background worker",
      roles: ["Super Admin"],
      activeRole: "Super Admin",
    });
  }
  return { organisations: rows.length, balancesCreated, requestsMarkedTaken };
}
