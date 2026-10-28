import "@tanstack/react-start/server-only";
import { requireEmployeeSupervisor } from "./supervisor-access.repository.server.ts";

import { randomUUID } from "node:crypto";
import { sickLeaveBackdatePermissions } from "../schema/leave.ts";
import { siteVisitLocalNow } from "../../data/site-visit.ts";
import { leaveNoticeAssessment, validateLeaveNoticeException } from "../../data/leave-notice.ts";
import { organisationLeaveYear } from "./leave-year.repository.server.ts";
import { leaveYearForDate } from "../../data/leave-year.ts";
import { carryExpiryDateForYear, carryPosition } from "../../data/leave-carry.ts";
import { leaveWorkingDates } from "../../data/leave-working-days.ts";
import { allocateSpecialUnpaidDates } from "../../data/special-leave.ts";
import { validateSickPayTiers } from "../../data/sick-leave-payroll.ts";
import { getLeaveEligibility, isOmaniNationality } from "../../data/leave-eligibility.ts";
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
import { departments, positions, publicHolidays } from "../schema/master-data.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { roles, userRoles, users } from "../schema/employee.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function payrollSafeLeaveSnapshot(
  snapshot: LeaveRequest["policySnapshot"],
): LeaveRequest["policySnapshot"] {
  const safe = { ...snapshot };
  delete safe.noticeException;
  if (safe.specialRequest)
    safe.specialRequest = { ...safe.specialRequest, reason: "Special leave approved" };
  return safe;
}

async function annualCarryState(
  tx: Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0],
  organisationId: string,
  employeeId: string,
  policyId: string,
  leaveYear: number,
  settings: {
    leaveYearStart: string;
    annualCarryExpiryDates?: Record<string, string | null>;
    annualCarryExpiryMonthDay?: string | null;
  },
) {
  const yearStart = `${leaveYear}-${settings.leaveYearStart}`;
  const nextStart = `${leaveYear + 1}-${settings.leaveYearStart}`;
  const entries = await tx
    .select({
      transactionType: leaveTransactions.transactionType,
      days: leaveTransactions.days,
      createdAt: leaveTransactions.createdAt,
      referenceId: leaveTransactions.referenceId,
    })
    .from(leaveTransactions)
    .where(
      and(
        eq(leaveTransactions.organisationId, organisationId),
        eq(leaveTransactions.employeeId, employeeId),
        eq(leaveTransactions.policyId, policyId),
        sql`${leaveTransactions.date} >= ${yearStart}`,
        sql`${leaveTransactions.date} < ${nextStart}`,
        isNull(leaveTransactions.archivedAt),
      ),
    );
  const requests = await tx
    .select({ id: leaveRequests.id, startDate: leaveRequests.startDate })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.organisationId, organisationId),
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.policyId, policyId),
        isNull(leaveRequests.archivedAt),
      ),
    );
  const expiryDate = carryExpiryDateForYear(settings, leaveYear);
  return {
    expiryDate,
    ...carryPosition(
      entries,
      new Map(requests.map((request) => [request.id, request.startDate])),
      expiryDate,
    ),
  };
}

async function carryReserveForRequest(
  tx: Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0],
  organisationId: string,
  employeeId: string,
  policyId: string,
  leaveYear: number,
  leaveStartDate: string,
) {
  const [settings] = await tx
    .select({
      timezone: appSettings.timezone,
      leaveYearStart: appSettings.leaveYearStart,
      additionalSettings: appSettings.additionalSettings,
    })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  if (!settings) throw new Error("Organisation leave settings are unavailable.");
  const state = await annualCarryState(tx, organisationId, employeeId, policyId, leaveYear, {
    leaveYearStart: settings.leaveYearStart,
    annualCarryExpiryDates: (settings.additionalSettings["annualCarryExpiryDates"] ?? {}) as Record<
      string,
      string | null
    >,
    annualCarryExpiryMonthDay: (settings.additionalSettings["annualCarryExpiryMonthDay"] ??
      null) as string | null,
  });
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return state.expiryDate && (leaveStartDate > state.expiryDate || today > state.expiryDate)
    ? state.remaining
    : 0;
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
    eligibility: getLeaveEligibility(row),
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
          actor.activeRole === "Line Manager" && actor.employeeId
            ? or(
                inArray(leaveRequests.employeeId, employeeIds),
                sql`${leaveRequests.policySnapshot}->'specialRequest'->>'countryManagerEmployeeId' = ${actor.employeeId}`,
                sql`${leaveRequests.policySnapshot}->'noticeException'->>'countryManagerEmployeeId' = ${actor.employeeId}`,
              )
            : inArray(leaveRequests.employeeId, employeeIds),
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
  const requestNames = new Map(
    (
      await db
        .select({ id: employees.id, name: employees.preferredName })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            inArray(employees.id, [...new Set(requestRows.map((row) => row.employeeId))]),
          ),
        )
    ).map((item) => [item.id, item.name]),
  );
  return {
    policies: policyRows.map(mapPolicy),
    requests: requestRows.map((row) => ({
      ...recordFields(row),
      employeeId: row.employeeId,
      ...(requestNames.get(row.employeeId)
        ? { requesterName: requestNames.get(row.employeeId)! }
        : {}),
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
      policySnapshot: payrollReader
        ? payrollSafeLeaveSnapshot(row.policySnapshot as LeaveRequest["policySnapshot"])
        : (row.policySnapshot as LeaveRequest["policySnapshot"]),
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
      policySnapshot: leaveRequests.policySnapshot,
      status: leaveRequests.status,
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
  const snapshot = row.policySnapshot as LeaveRequest["policySnapshot"];
  const allowed =
    row.employeeId === actor.employeeId ||
    (actor.activeRole === "Line Manager" && row.lineManagerId === actor.employeeId) ||
    (row.status === "Pending HR" &&
      actor.employeeId ===
        (snapshot.specialRequest?.countryManagerEmployeeId ??
          snapshot.noticeException?.countryManagerEmployeeId)) ||
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

export async function grantSickLeaveBackdatePermission(
  organisationId: string,
  input: { employeeId: string; startDate: string; endDate: string; reason: string },
  actor: AuditActorContext,
) {
  const grantedBy = actor.userId;
  if (!grantedBy) throw new Error("Sign in before granting permission.");
  if (!["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR can authorise backdated sick leave.");
  if (actor.employeeId === input.employeeId)
    throw new Error("Another HR colleague must authorise your own backdated sick leave.");
  if (input.reason.trim().length < 5) throw new Error("Record the reason for this permission.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.id, input.employeeId),
          isNull(employees.archivedAt),
        ),
      )
      .limit(1);
    if (!employee || ["Inactive", "Archived"].includes(employee.status))
      throw new Error("Select an active employee in this organisation.");
    const [settings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (!settings) throw new Error("Configure the organisation timezone first.");
    const today = siteVisitLocalNow(settings.timezone).date;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ||
      input.startDate >= today ||
      input.endDate > today ||
      input.endDate < input.startDate ||
      input.startDate < employee.startDate
    )
      throw new Error(
        "Choose past sick-leave dates within the employee's service, ending no later than today.",
      );
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 14 * 86_400_000);
    await tx.insert(sickLeaveBackdatePermissions).values({
      id,
      organisationId,
      ...input,
      reason: input.reason.trim(),
      grantedBy,
      expiresAt,
    });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "authorise-backdated-sick-leave",
      module: "leave",
      entityType: "sick-leave-backdate-permission",
      entityId: id,
      afterSummary: {
        employeeId: input.employeeId,
        startDate: input.startDate,
        endDate: input.endDate,
        expiresAt: expiresAt.toISOString(),
      },
      reason: input.reason.trim(),
      riskLevel: "Medium",
    });
    const recipients = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.employeeId, input.employeeId),
          eq(users.status, "Active"),
        ),
      );
    for (const recipient of recipients)
      await tx.insert(notifications).values({
        organisationId,
        recipientUserId: recipient.id,
        type: "leave_backdate_permission",
        title: "HR has authorised a historical leave submission",
        message: `You may submit sick leave for ${input.startDate} to ${input.endDate} within 14 days. Supporting evidence and normal approvals still apply.`,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `sick-backdate-${id}-${recipient.id}`,
        createdBy: grantedBy,
        updatedBy: grantedBy,
        link: {
          path: "/staff/leave",
          entityType: "sick-leave-backdate-permission",
          entityId: id,
        },
      });
    return { id, expiresAt: expiresAt.toISOString() };
  });
}

export async function createLeaveRequestInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    policyId: string;
    startDate: string;
    endDate: string;
    reason: string;
    noticeExceptionReason?: string;
    specialRequestReason?: string;
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
        preferredName: employees.preferredName,
        legalName: employees.legalName,
        gender: employees.gender,
        nationality: employees.nationality,
        startDate: employees.startDate,
        status: employees.status,
        profileSetupStatus: employees.profileSetupStatus,
        employmentConfirmationStatus: employees.employmentConfirmationStatus,
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
    if (employee.employmentConfirmationStatus !== "Confirmed")
      throw new Error("HR must confirm your employment details before you can request leave.");
    if (input.endDate < input.startDate)
      throw new Error("Leave end date cannot be before the start date.");
    if (
      policy.type !== "Annual" &&
      input.reason.trim().length < 3 &&
      !input.specialRequestReason?.trim()
    )
      throw new Error("Explain the reason for this leave request.");
    if (policy.requiresAttachment && !input.attachmentFileId)
      throw new Error(`Supporting evidence is required for ${policy.name}.`);
    if (policy.requiresHandoverContact && !input.handoverContactId)
      throw new Error(`Select a covering colleague for ${policy.name}.`);
    if (!employee.lineManagerId || employee.lineManagerId === employee.id)
      throw new Error("Ask HR to assign a valid supervisor before requesting leave.");
    await requireEmployeeSupervisor(tx, organisationId, employee.id);
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
      .select({
        workingDays: appSettings.workingDays,
        timezone: appSettings.timezone,
        additionalSettings: appSettings.additionalSettings,
      })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (!settings?.workingDays.length)
      throw new Error("Organisation working days are not configured.");
    let backdatePermission: typeof sickLeaveBackdatePermissions.$inferSelect | undefined;
    if (policy.type === "Sick" && input.startDate < siteVisitLocalNow(settings.timezone).date) {
      [backdatePermission] = await tx
        .select()
        .from(sickLeaveBackdatePermissions)
        .where(
          and(
            eq(sickLeaveBackdatePermissions.organisationId, organisationId),
            eq(sickLeaveBackdatePermissions.employeeId, employee.id),
            eq(sickLeaveBackdatePermissions.startDate, input.startDate),
            eq(sickLeaveBackdatePermissions.endDate, input.endDate),
            isNull(sickLeaveBackdatePermissions.usedByRequestId),
            sql`${sickLeaveBackdatePermissions.expiresAt} > now()`,
          ),
        )
        .orderBy(asc(sickLeaveBackdatePermissions.createdAt))
        .limit(1)
        .for("update");
      if (!backdatePermission)
        throw new Error(
          "Ask HR to authorise backdated sick leave for these exact dates before submitting.",
        );
    }
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
    const workingDates = leaveWorkingDates(
      input.startDate,
      input.endDate,
      new Set(holidays.map((h) => h.date)),
      settings.workingDays,
      input.isHalfDay ?? false,
      settings.additionalSettings["leaveIncludesWeekends"] !== false,
    );
    const days = workingDates.length * (input.isHalfDay ? 0.5 : 1);
    if (days <= 0) throw new Error("The selected dates contain no working days.");
    const eligibility = getLeaveEligibility(policy);
    if (eligibility.genderRestriction && employee.gender !== eligibility.genderRestriction)
      throw new Error(`${policy.name} is not available for this employee.`);
    if (eligibility.omaniOnly && !isOmaniNationality(employee.nationality))
      throw new Error(`${policy.name} is available only to Omani employees.`);
    if (eligibility.minimumServiceMonths !== undefined) {
      const eligibleFrom = new Date(`${employee.startDate}T00:00:00Z`);
      eligibleFrom.setUTCMonth(eligibleFrom.getUTCMonth() + eligibility.minimumServiceMonths);
      const eligibleFromDate = eligibleFrom.toISOString().slice(0, 10);
      if (input.startDate < eligibleFromDate)
        throw new Error(
          `${policy.name} can be taken from ${eligibleFromDate}, after ${eligibility.minimumServiceMonths} completed months of service.`,
        );
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
    const specialRequested = Boolean(input.specialRequestReason?.trim());
    if (policy.consumesBalance && !specialRequested) {
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
        const leaveYear = await organisationLeaveYear(organisationId, input.startDate, tx);
        if (leaveYear !== (await organisationLeaveYear(organisationId, input.endDate, tx)))
          throw new Error("Submit separate leave requests for each entitlement year.");
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
          .select({
            days: leaveRequests.workingDaysRequested,
            snapshot: leaveRequests.policySnapshot,
          })
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.employeeId, input.employeeId),
              eq(leaveRequests.policyId, input.policyId),
              sql`${leaveRequests.status} IN ('Pending Line Manager', 'Pending HR', 'Pending Super Admin', 'Amendment Pending Line Manager', 'Amendment Pending HR')`,
            ),
          );
        const carryReserve =
          policy.type === "Annual"
            ? await carryReserveForRequest(
                tx,
                organisationId,
                input.employeeId,
                input.policyId,
                leaveYear,
                input.startDate,
              )
            : 0;
        const projected =
          Number(balance?.days ?? 0) -
          carryReserve -
          pendingRows.reduce(
            (sum, row) =>
              sum +
              ((row.snapshot as LeaveRequest["policySnapshot"]).specialRequest
                ? 0
                : Number(row.days)),
            0,
          ) -
          days;
        const minimum = policy.allowNegativeBalance ? -Number(policy.maxNegativeBalance ?? 0) : 0;
        if (projected < minimum)
          throw new Error("There is not enough leave balance for this request.");
      }
    }
    const notice = backdatePermission
      ? null
      : leaveNoticeAssessment(
          policy.noticeRules as LeavePolicy["noticeRules"],
          days,
          input.startDate,
          siteVisitLocalNow(settings.timezone).date,
        );
    if (notice && !input.noticeExceptionReason?.trim() && !input.specialRequestReason?.trim())
      throw new Error(
        `This leave normally requires ${notice.requiredDays} days' notice. Choose the special request option and explain why shorter notice is needed.`,
      );
    const countryManagers =
      notice || specialRequested
        ? await tx
            .select({
              employeeId: employees.id,
              userId: users.id,
              workEmail: employees.workEmail,
              portalEmail: users.workspaceEmail,
            })
            .from(employees)
            .innerJoin(positions, eq(positions.id, employees.positionId))
            .innerJoin(
              users,
              and(
                eq(users.employeeId, employees.id),
                eq(users.organisationId, organisationId),
                eq(users.status, "Active"),
                isNull(users.archivedAt),
              ),
            )
            .where(
              and(
                eq(employees.organisationId, organisationId),
                inArray(employees.status, ["Active", "Probation", "Notice"]),
                isNull(employees.archivedAt),
                sql`lower(btrim(${positions.name})) IN ('country manager', 'country manager oman')`,
              ),
            )
        : [];
    const designatedEmail = (
      process.env["VIA_HR_SPECIAL_LEAVE_APPROVER_EMAIL"] || "r.centonze@via-int.com"
    )
      .trim()
      .toLowerCase();
    const matchingCountryManagers = countryManagers.filter(
      (item) =>
        item.workEmail.toLowerCase() === designatedEmail ||
        item.portalEmail.toLowerCase() === designatedEmail,
    );
    if ((notice || specialRequested) && matchingCountryManagers.length !== 1)
      throw new Error(
        "Ask HR to confirm Riccardo's active Country Manager account for special leave approvals.",
      );
    const countryManager = matchingCountryManagers[0];
    if ((notice || specialRequested) && countryManager?.employeeId === employee.id)
      throw new Error("Ask HR to arrange an independent approver for your special leave request.");
    const hrRecipients =
      notice || specialRequested
        ? await tx
            .selectDistinct({ id: users.id })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(
              and(
                eq(users.organisationId, organisationId),
                eq(users.status, "Active"),
                eq(roles.code, "HR"),
                sql`${users.employeeId} <> ${employee.id}`,
              ),
            )
        : [];
    if ((notice || specialRequested) && !hrRecipients.length)
      throw new Error("Ask HR to activate an HR approver before sending a special leave request.");
    const noticeException =
      notice && !specialRequested
        ? {
            ...notice,
            reason: validateLeaveNoticeException(input.noticeExceptionReason),
            countryManagerEmployeeId: countryManager!.employeeId,
          }
        : undefined;
    const specialRequest = specialRequested
      ? {
          reason: validateLeaveNoticeException(input.specialRequestReason),
          countryManagerEmployeeId: countryManager!.employeeId,
        }
      : undefined;
    const status = noticeException ? "Pending HR" : "Pending Line Manager";
    await tx.insert(leaveRequests).values({
      id: requestId,
      organisationId,
      employeeId: input.employeeId,
      policyId: input.policyId,
      startDate: input.startDate,
      endDate: input.endDate,
      isHalfDay: input.isHalfDay ?? false,
      workingDaysRequested: String(days),
      reason: input.reason.trim() || input.specialRequestReason?.trim() || "Annual leave requested",
      handoverContactId: input.handoverContactId,
      attachmentFileId: input.attachmentFileId,
      status,
      chainApprovals: specialRequest
        ? [
            { role: "Line Manager", status: "Pending" },
            { role: "Country Manager", status: "Pending" },
            { role: "HR", status: "Pending" },
          ]
        : noticeException
          ? [
              { role: "Country Manager", status: "Pending" },
              { role: "HR", status: "Pending" },
              { role: "Line Manager", status: "Pending" },
            ]
          : [
              { role: "Line Manager", status: "Pending" },
              { role: "HR", status: "Pending" },
            ],
      policySnapshot: {
        workingDates,
        payTiers: validateSickPayTiers(policy.payTiers),
        ...(noticeException ? { noticeException } : {}),
        ...(specialRequest ? { specialRequest } : {}),
        ...(backdatePermission
          ? {
              backdatePermissionId: backdatePermission.id,
              backdateAuthorisedBy: backdatePermission.grantedBy,
            }
          : {}),
        name: policy.name,
        type: policy.type,
        isPaid: policy.isPaid,
        baseEntitlementDays: Number(policy.baseEntitlementDays),
        accrualMode: policy.accrualMode,
      },
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof leaveRequests.$inferInsert);
    if (backdatePermission)
      await tx
        .update(sickLeaveBackdatePermissions)
        .set({ usedByRequestId: requestId })
        .where(eq(sickLeaveBackdatePermissions.id, backdatePermission.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "submit",
      module: "leave",
      entityType: "leave-request",
      entityId: requestId,
      afterSummary: {
        status,
        days,
        ...(noticeException ? { noticeException } : {}),
        ...(specialRequest ? { specialRequest } : {}),
        ...(backdatePermission ? { backdatePermissionId: backdatePermission.id } : {}),
      },
      reason: specialRequest
        ? "Submitted a special leave request"
        : noticeException
          ? "Submitted a short-notice special leave request"
          : "Submitted a leave request",
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
    if (noticeException) {
      const recipients = new Set([countryManager!.userId, ...hrRecipients.map((item) => item.id)]);
      for (const recipientUserId of recipients) {
        await tx
          .insert(notifications)
          .values({
            organisationId,
            recipientUserId,
            type: "leave_approval",
            title: "Short-notice leave exception awaiting your approval",
            message: `${employee.preferredName || employee.legalName} requested ${days} day(s) of ${policy.name}: ${input.startDate} to ${input.endDate}. Reason: ${noticeException.reason}. Country Manager and HR review before the line manager.`,
            priority: "High",
            status: "Unread",
            deduplicationKey: `leave-special-${requestId}-${recipientUserId}`,
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
      return requestId;
    }
    const recipientEmployeeId = employee.lineManagerId;
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
          type: "leave_approval",
          title: "Leave request awaiting your review",
          message: `A ${days}-day ${policy.name} request is awaiting your supervisor decision.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `leave-submission-${requestId}-${recipient.id}`,
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
    if (status === "Pending Line Manager") {
      const hrRecipients = await tx
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(
          userRoles,
          and(eq(userRoles.userId, users.id), eq(userRoles.organisationId, organisationId)),
        )
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            eq(roles.code, "HR"),
          ),
        );
      for (const hrRecipient of hrRecipients) {
        // An HR user who is also the assigned manager already has the actionable request.
        if (hrRecipient.id === recipient?.id) continue;
        await tx
          .insert(notifications)
          .values({
            organisationId,
            recipientUserId: hrRecipient.id,
            type: "leave_submitted",
            title: "New leave request — awaiting line manager",
            message: `${employee.preferredName || employee.legalName} requested ${days} day(s) of ${policy.name}: ${input.startDate} to ${input.endDate}. Awaiting line manager approval; no HR action is required yet.`,
            priority: "Normal",
            status: "Unread",
            deduplicationKey: `leave-submitted-hr-info-${requestId}-${hrRecipient.id}`,
            link: { entityType: "leave-request", entityId: requestId, path: "/staff/leave-admin" },
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof notifications.$inferInsert)
          .onConflictDoNothing();
      }
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
  specialAllocation?: {
    allocations: Array<{ policyId: string; leaveYear: number; days: number }>;
    remainingPay: "Paid" | "Unpaid";
  },
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
        nationality: employees.nationality,
        gender: employees.gender,
        startDate: employees.startDate,
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
    const snapshot = request.policySnapshot as LeaveRequest["policySnapshot"];
    const noticeException = snapshot.noticeException;
    const specialRequest = snapshot.specialRequest;
    const specialCountryStage =
      request.status === "Pending HR" &&
      Boolean(specialRequest) &&
      (request.chainApprovals as LeaveRequest["chainApprovals"]).some(
        (step) => step.role === "Country Manager" && step.status === "Pending",
      );
    const specialHrStage =
      request.status === "Pending HR" &&
      Boolean(specialRequest) &&
      !specialCountryStage &&
      (request.chainApprovals as LeaveRequest["chainApprovals"]).some(
        (step) => step.role === "HR" && step.status === "Pending",
      );
    const specialStage =
      request.status === "Pending HR" &&
      Boolean(noticeException) &&
      (request.chainApprovals as LeaveRequest["chainApprovals"]).some(
        (step) => step.role === "Country Manager",
      );
    const managerStage =
      request.status === "Pending Line Manager" ||
      request.status === "Amendment Pending Line Manager";
    const hrStage =
      request.status === "Pending HR" || request.status === "Amendment Pending HR" || cancellation;
    // An HR employee may also be the assigned line manager while using the HR view.
    // Identity, not the currently selected UI role, determines this stage.
    const isManager = Boolean(actor.employeeId) && actor.employeeId === employee?.lineManagerId;
    const specialRole = specialStage
      ? actor.employeeId === noticeException?.countryManagerEmployeeId
        ? "Country Manager"
        : role === "HR"
          ? "HR"
          : null
      : null;
    const pendingSpecialStep = specialRole
      ? (request.chainApprovals as LeaveRequest["chainApprovals"]).find(
          (step) => step.role === specialRole && step.status === "Pending",
        )
      : undefined;
    if (
      (specialCountryStage && actor.employeeId !== specialRequest?.countryManagerEmployeeId) ||
      (specialHrStage && role !== "HR") ||
      (Boolean(specialRequest) &&
        request.status === "Pending HR" &&
        !specialCountryStage &&
        !specialHrStage) ||
      (specialStage && !pendingSpecialStep) ||
      (!specialStage && managerStage && !isManager) ||
      (!specialStage &&
        !specialCountryStage &&
        !specialHrStage &&
        hrStage &&
        role !== "HR" &&
        role !== "Super Admin") ||
      (!specialStage && !managerStage && !hrStage)
    )
      throw new Error("You are not the assigned approver for this leave request.");
    if (actor.employeeId === request.employeeId)
      throw new Error("You cannot make a decision on your own leave request.");
    if (
      decision === "approve" &&
      !cancellation &&
      getLeaveEligibility(policy).omaniOnly &&
      !isOmaniNationality(employee.nationality)
    )
      throw new Error(
        `${policy.name} is available only to Omani employees. Ask HR to confirm the employee's nationality.`,
      );
    const pendingAmendment = request.pendingAmendment
      ? structuredClone(request.pendingAmendment as NonNullable<LeaveRequest["pendingAmendment"]>)
      : undefined;
    const sourceApprovals: LeaveRequest["chainApprovals"] = amendment
      ? (pendingAmendment?.chainApprovals ?? [])
      : (request.chainApprovals as LeaveRequest["chainApprovals"]);
    const chainApprovals = [...sourceApprovals];
    const currentStep = chainApprovals.find((step) =>
      specialCountryStage
        ? step.role === "Country Manager" && step.status === "Pending"
        : specialHrStage
          ? step.role === "HR" && step.status === "Pending"
          : specialStage
            ? step.role === specialRole && step.status === "Pending"
            : managerStage
              ? step.role === "Line Manager"
              : step.role === "HR",
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
    } else if (specialCountryStage) {
      nextStatus = "Pending HR";
    } else if (specialStage) {
      nextStatus = chainApprovals.some(
        (step) => step.role !== "Line Manager" && step.status === "Pending",
      )
        ? "Pending HR"
        : "Pending Line Manager";
    } else if (managerStage && (!noticeException || amendment)) {
      nextStatus = amendment ? "Amendment Pending HR" : "Pending HR";
      if (amendment && pendingAmendment) {
        pendingAmendment.chainApprovals = chainApprovals;
        requestUpdateExtras = { pendingAmendment };
      }
    } else {
      nextStatus = cancellation ? "Cancellation Approved" : "Approved";
      if (specialRequest && !cancellation && !amendment) {
        if (!specialHrStage || !specialAllocation)
          throw new Error(
            "HR must choose the balance deductions and pay treatment before final approval.",
          );
        const requestedDays = Number(request.workingDaysRequested);
        const allocations = specialAllocation.allocations;
        if (
          allocations.some(
            (item) =>
              !Number.isInteger(item.leaveYear) ||
              !Number.isFinite(item.days) ||
              item.days <= 0 ||
              (item.days * 2) % 1 !== 0,
          )
        )
          throw new Error("Choose positive balance deductions in half-day increments.");
        const keys = allocations.map((item) => `${item.policyId}:${item.leaveYear}`);
        if (new Set(keys).size !== keys.length)
          throw new Error("Choose each leave balance only once.");
        const allocatedDays = allocations.reduce((sum, item) => sum + item.days, 0);
        if (!Number.isFinite(allocatedDays) || allocatedDays > requestedDays)
          throw new Error("Balance deductions cannot exceed the requested leave days.");
        let unpaidAllocatedDays = 0;
        for (const allocation of allocations) {
          const [sourcePolicy] = await tx
            .select()
            .from(leavePolicies)
            .where(
              and(
                eq(leavePolicies.organisationId, organisationId),
                eq(leavePolicies.id, allocation.policyId),
              ),
            )
            .limit(1);
          if (
            !sourcePolicy ||
            !sourcePolicy.isEnabled ||
            sourcePolicy.archivedAt ||
            !sourcePolicy.consumesBalance ||
            !["Annual", "Ledger"].includes(sourcePolicy.scope)
          )
            throw new Error("Choose an active annual or ledger leave balance for each deduction.");
          if (Array.isArray(sourcePolicy.payTiers) && sourcePolicy.payTiers.length)
            throw new Error(
              "A leave type with tiered pay cannot fund a special request. Choose another balance or mark remaining days paid or unpaid.",
            );
          if (!sourcePolicy.isPaid) unpaidAllocatedDays += allocation.days;
          const sourceEligibility = getLeaveEligibility(sourcePolicy);
          if (sourceEligibility.omaniOnly && !isOmaniNationality(employee.nationality))
            throw new Error(`${sourcePolicy.name} is available only to Omani employees.`);
          if (
            sourceEligibility.genderRestriction &&
            employee.gender !== sourceEligibility.genderRestriction
          )
            throw new Error(`${sourcePolicy.name} is not available for this employee.`);
          if (sourceEligibility.minimumServiceMonths !== undefined) {
            const eligibleFrom = new Date(`${employee.startDate}T00:00:00Z`);
            eligibleFrom.setUTCMonth(
              eligibleFrom.getUTCMonth() + sourceEligibility.minimumServiceMonths,
            );
            if (request.startDate < eligibleFrom.toISOString().slice(0, 10))
              throw new Error(`${sourcePolicy.name} is not yet available for this employee.`);
          }
          const carryReserve =
            sourcePolicy.type === "Annual"
              ? await carryReserveForRequest(
                  tx,
                  organisationId,
                  request.employeeId,
                  allocation.policyId,
                  allocation.leaveYear,
                  request.startDate,
                )
              : 0;
          const updated = await tx
            .update(leaveBalances)
            .set({
              balanceDays: sql`${leaveBalances.balanceDays} - ${allocation.days}`,
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${leaveBalances.recordVersion} + 1`,
            })
            .where(
              and(
                eq(leaveBalances.organisationId, organisationId),
                eq(leaveBalances.employeeId, request.employeeId),
                eq(leaveBalances.policyId, allocation.policyId),
                eq(leaveBalances.leaveYear, allocation.leaveYear),
                isNull(leaveBalances.archivedAt),
                sql`${leaveBalances.balanceDays} - ${allocation.days} - ${carryReserve} >= 0`,
              ),
            )
            .returning({ id: leaveBalances.id });
          if (!updated.length)
            throw new Error(
              `The selected ${sourcePolicy.name} ${allocation.leaveYear} balance is insufficient or expired.`,
            );
          const [yearSettings] = await tx
            .select({ leaveYearStart: appSettings.leaveYearStart })
            .from(appSettings)
            .where(eq(appSettings.organisationId, organisationId))
            .limit(1);
          await tx.insert(leaveTransactions).values({
            id: randomUUID(),
            organisationId,
            employeeId: request.employeeId,
            policyId: allocation.policyId,
            date: `${allocation.leaveYear}-${yearSettings?.leaveYearStart ?? "01-01"}`,
            transactionType: "Approved Leave",
            days: String(-allocation.days),
            reason: `Special leave: ${request.startDate} to ${request.endDate}; HR allocated ${allocation.days} day(s) from ${sourcePolicy.name} ${allocation.leaveYear}`,
            referenceId: request.id,
            actorUserId: actor.userId,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof leaveTransactions.$inferInsert);
        }
        const unpaidByDate = allocateSpecialUnpaidDates(
          snapshot.workingDates ?? [],
          request.isHalfDay,
          requestedDays,
          allocatedDays,
          specialAllocation.remainingPay,
          unpaidAllocatedDays,
        );
        requestUpdateExtras = {
          policySnapshot: {
            ...snapshot,
            specialRequest: {
              ...specialRequest,
              allocations,
              remainingPay: specialAllocation.remainingPay,
              unpaidByDate,
            },
          },
        };
      }
      if (specialRequest && cancellation) {
        const [yearSettings] = await tx
          .select({ leaveYearStart: appSettings.leaveYearStart })
          .from(appSettings)
          .where(eq(appSettings.organisationId, organisationId))
          .limit(1);
        for (const allocation of specialRequest.allocations ?? []) {
          const updated = await tx
            .update(leaveBalances)
            .set({
              balanceDays: sql`${leaveBalances.balanceDays} + ${allocation.days}`,
              updatedAt: new Date(),
              updatedBy: actor.userId,
              recordVersion: sql`${leaveBalances.recordVersion} + 1`,
            })
            .where(
              and(
                eq(leaveBalances.organisationId, organisationId),
                eq(leaveBalances.employeeId, request.employeeId),
                eq(leaveBalances.policyId, allocation.policyId),
                eq(leaveBalances.leaveYear, allocation.leaveYear),
              ),
            )
            .returning({ id: leaveBalances.id });
          if (!updated.length)
            throw new Error(
              "The original leave balance could not be restored. Ask HR to review this cancellation.",
            );
          await tx.insert(leaveTransactions).values({
            id: randomUUID(),
            organisationId,
            employeeId: request.employeeId,
            policyId: allocation.policyId,
            date: `${allocation.leaveYear}-${yearSettings?.leaveYearStart ?? "01-01"}`,
            transactionType: "Cancellation Restoration",
            days: String(allocation.days),
            reason: `Special leave cancellation: ${request.startDate} to ${request.endDate}`,
            referenceId: request.id,
            actorUserId: actor.userId,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof leaveTransactions.$inferInsert);
        }
      }
      if (
        !specialRequest &&
        !cancellation &&
        policy.consumesBalance &&
        ["Annual", "Ledger"].includes(policy.scope)
      ) {
        const entitlementYear = await organisationLeaveYear(organisationId, request.startDate, tx);
        const approvedStart = pendingAmendment?.proposedStartDate ?? request.startDate;
        const approvedEnd = pendingAmendment?.proposedEndDate ?? request.endDate;
        if (
          entitlementYear !== (await organisationLeaveYear(organisationId, approvedStart, tx)) ||
          entitlementYear !== (await organisationLeaveYear(organisationId, approvedEnd, tx))
        )
          throw new Error("Split this request into separate entitlement years before approval.");
      }
      const balanceChange = cancellation
        ? Number(request.workingDaysRequested)
        : amendment && pendingAmendment
          ? Number(request.workingDaysRequested) - pendingAmendment.proposedWorkingDays
          : -Number(request.workingDaysRequested);
      if (
        !specialRequest &&
        policy.consumesBalance &&
        (policy.scope === "Annual" || policy.scope === "Ledger") &&
        balanceChange !== 0
      ) {
        const minimum = policy.allowNegativeBalance ? -Number(policy.maxNegativeBalance ?? 0) : 0;
        const leaveYear = await organisationLeaveYear(organisationId, request.startDate, tx);
        const carryReserve =
          policy.type === "Annual" && balanceChange < 0
            ? await carryReserveForRequest(
                tx,
                organisationId,
                request.employeeId,
                request.policyId,
                leaveYear,
                pendingAmendment?.proposedStartDate ?? request.startDate,
              )
            : 0;
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
              eq(
                leaveBalances.leaveYear,
                await organisationLeaveYear(organisationId, request.startDate, tx),
              ),
              sql`${leaveBalances.balanceDays} + ${balanceChange} - ${carryReserve} >= ${minimum}`,
            ),
          )
          .returning({ id: leaveBalances.id });
        if (!updated.length) throw new Error("There is not enough leave balance available.");
      }
      if (!specialRequest && policy.consumesBalance && balanceChange !== 0) {
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
          policySnapshot: {
            ...(request.policySnapshot as LeaveRequest["policySnapshot"]),
            // An older pending amendment has no snapshot; do not retain the old dates.
            workingDates: pendingAmendment.proposedWorkingDates,
          },
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
    if (specialStage && nextStatus === "Pending HR") {
      recipients = [];
    } else if (specialStage && nextStatus === "Pending Line Manager") {
      recipients = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.employeeId, employee.lineManagerId!),
              eq(users.status, "Active"),
            ),
          )
      ).map((item) => ({ id: item.id, path: "/staff/leave-approvals" }));
    } else if (specialRequest && managerStage && nextStatus === "Pending HR") {
      recipients = (
        await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organisationId, organisationId),
              eq(users.employeeId, specialRequest.countryManagerEmployeeId),
              eq(users.status, "Active"),
            ),
          )
      ).map((item) => ({ id: item.id, path: "/staff/leave-approvals" }));
    } else if (nextStatus === "Pending HR" || nextStatus === "Amendment Pending HR") {
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
              inArray(
                roles.code,
                specialRequest && specialCountryStage ? ["HR"] : ["HR", "Super Admin"],
              ),
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
                  : specialRequest && nextStatus === "Pending HR"
                    ? specialCountryStage
                      ? "Special leave awaiting HR allocation and approval"
                      : "Special leave awaiting Country Manager approval"
                    : specialStage && nextStatus === "Pending Line Manager"
                      ? "Short-notice leave exception awaiting line manager"
                      : noticeException && !amendment
                        ? "Short-notice leave exception awaiting HR confirmation"
                        : "Leave request awaiting HR confirmation",
          message:
            nextStatus === "Approved"
              ? `${employee.preferredName} will be away from ${request.startDate} to ${request.endDate}.`
              : nextStatus === "Cancellation Approved"
                ? `The approved leave from ${request.startDate} to ${request.endDate} has been cancelled.`
                : nextStatus === "Declined"
                  ? reason!.trim()
                  : specialRequest && nextStatus === "Pending HR"
                    ? `${employee.preferredName}'s special leave from ${request.startDate} to ${request.endDate} needs your review. ${specialRequest.reason}`
                    : specialStage && nextStatus === "Pending Line Manager"
                      ? `${employee.preferredName}'s short-notice leave was approved by the Country Manager and HR. The line manager now makes the final decision. Reason: ${noticeException!.reason}.`
                      : `${employee.preferredName}'s leave request has supervisor approval and now needs HR confirmation.${noticeException && !amendment ? ` Short-notice reason: ${noticeException.reason}.` : ""}`,
          priority:
            nextStatus === "Pending HR" ||
            nextStatus === "Amendment Pending HR" ||
            nextStatus === "Pending Line Manager"
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
    if (specialRequest && (nextStatus === "Approved" || nextStatus === "Cancellation Approved")) {
      const financeUsers = await tx
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.status, "Active"),
            eq(roles.code, "Accounts"),
          ),
        );
      for (const financeUser of financeUsers) {
        await tx
          .insert(notifications)
          .values({
            organisationId,
            recipientUserId: financeUser.id,
            type: "leave_approved",
            title:
              nextStatus === "Approved"
                ? "Special leave approved - finance review"
                : "Special leave cancelled - finance review",
            message:
              nextStatus === "Approved"
                ? `${employee.preferredName}'s special leave from ${request.startDate} to ${request.endDate} was approved. Check the HR-approved paid and unpaid days in payroll.`
                : `${employee.preferredName}'s special leave from ${request.startDate} to ${request.endDate} was cancelled. Recheck payroll before processing.`,
            priority: "Normal",
            status: "Unread",
            deduplicationKey: `leave-special-finance-${nextStatus}-${request.id}-${financeUser.id}`,
            link: { entityType: "leave-request", entityId: request.id, path: "/staff/payroll" },
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof notifications.$inferInsert)
          .onConflictDoNothing();
      }
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
      afterSummary: {
        decision,
        status: nextStatus,
        ...(specialRequest && nextStatus === "Approved" && specialAllocation
          ? { specialAllocation }
          : {}),
      },
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
        eligibility: getLeaveEligibility({
          ...current,
          eligibility: updates.eligibility ?? current.eligibility,
        }),
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
      const year = await organisationLeaveYear(organisationId, undefined, tx);
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
  if (actor.employeeId === input.employeeId)
    throw new Error(
      "Another authorised HR or Super Admin must review and adjust your leave balance.",
    );
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
      const year = await organisationLeaveYear(organisationId, undefined, tx);
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
      if ((row.request.policySnapshot as LeaveRequest["policySnapshot"]).specialRequest)
        throw new Error(
          "Cancel this special leave and submit a new request. HR must choose the balance deductions again for changed dates.",
        );
      if (action.reason.trim().length < 5) throw new Error("Explain why the dates are changing.");
      const originalYear = await organisationLeaveYear(organisationId, row.request.startDate, tx);
      if (
        originalYear !== (await organisationLeaveYear(organisationId, action.startDate, tx)) ||
        originalYear !== (await organisationLeaveYear(organisationId, action.endDate, tx))
      )
        throw new Error(
          "Cancel and submit a separate request to move leave to another entitlement year.",
        );
      if (
        action.endDate < action.startDate ||
        action.startDate < new Date().toISOString().slice(0, 10)
      )
        throw new Error("Choose valid future leave dates.");
      const [settings] = await tx
        .select({
          workingDays: appSettings.workingDays,
          additionalSettings: appSettings.additionalSettings,
        })
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
      const proposedWorkingDates = leaveWorkingDates(
        action.startDate,
        action.endDate,
        new Set(holidays.map((item) => item.date)),
        settings?.workingDays ?? [],
        row.request.isHalfDay,
        settings?.additionalSettings["leaveIncludesWeekends"] !== false,
      );
      const proposedDays = proposedWorkingDates.length * (row.request.isHalfDay ? 0.5 : 1);
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
      await requireEmployeeSupervisor(tx, organisationId, row.request.employeeId);
      values = {
        status,
        pendingAmendment: {
          proposedStartDate: action.startDate,
          proposedEndDate: action.endDate,
          proposedWorkingDays: proposedDays,
          proposedWorkingDates,
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
  filters: {
    startDate?: string;
    endDate?: string;
    status?: string;
    departmentId?: string;
    employeeId?: string;
  },
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
  if (filters.employeeId) conditions.push(eq(leaveRequests.employeeId, filters.employeeId));
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
  employeeScopeId?: string,
): Promise<number> {
  const isAdministrator = actor.activeRole === "HR" || actor.activeRole === "Super Admin";
  const isOwnSetup = Boolean(employeeScopeId && actor.employeeId === employeeScopeId);
  if (!isAdministrator && !isOwnSetup)
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
        employmentConfirmationStatus: employees.employmentConfirmationStatus,
      })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          sql`${employees.status} NOT IN ('Inactive', 'Archived')`,
          eq(employees.employmentConfirmationStatus, "Confirmed"),
          ...(employeeScopeId ? [eq(employees.id, employeeScopeId)] : []),
        ),
      );
    for (const employee of staff)
      for (const policy of policies) {
        const eligibility = getLeaveEligibility(policy);
        if (eligibility.genderRestriction && employee.gender !== eligibility.genderRestriction)
          continue;
        if (eligibility.omaniOnly && !isOmaniNationality(employee.nationality)) continue;
        // Waiting periods control when leave can be taken, not whether the employee can see
        // the entitlement that will become available later in the leave year.
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
        let priorYearCarry = 0;
        if (policy.type === "Annual" && prior) {
          const [fullSettings] = await tx
            .select({ additionalSettings: appSettings.additionalSettings })
            .from(appSettings)
            .where(eq(appSettings.organisationId, organisationId))
            .limit(1);
          const carryState = await annualCarryState(
            tx,
            organisationId,
            employee.id,
            policy.id,
            leaveYear - 1,
            {
              leaveYearStart: settings.leaveYearStart,
              annualCarryExpiryDates: (fullSettings?.additionalSettings["annualCarryExpiryDates"] ??
                {}) as Record<string, string | null>,
              annualCarryExpiryMonthDay: (fullSettings?.additionalSettings[
                "annualCarryExpiryMonthDay"
              ] ?? null) as string | null,
            },
          );
          priorYearCarry = carryState.remaining;
        }
        const carry = Math.max(
          0,
          Math.min(Number(prior?.balance ?? 0) - priorYearCarry, Number(policy.carryForwardLimit)),
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
        reason: employeeScopeId
          ? `Prepared leave allowances after employee profile setup for ${leaveYear}`
          : `Initialised leave entitlements for ${leaveYear}`,
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
  });
  return created;
}

/** Reconcile unused carried days against HR's expiry date without erasing history. */
export async function reconcileAnnualCarryExpiryInDatabase(
  organisationId: string,
  actor: AuditActorContext,
  now = new Date(),
): Promise<number> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select({
        leaveYearStart: appSettings.leaveYearStart,
        timezone: appSettings.timezone,
        additionalSettings: appSettings.additionalSettings,
      })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (!settings) throw new Error("Organisation leave settings are unavailable.");
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const leaveYear = leaveYearForDate(localDate, settings.leaveYearStart);
    const carrySettings = {
      leaveYearStart: settings.leaveYearStart,
      annualCarryExpiryDates: (settings.additionalSettings["annualCarryExpiryDates"] ??
        {}) as Record<string, string | null>,
      annualCarryExpiryMonthDay: (settings.additionalSettings["annualCarryExpiryMonthDay"] ??
        null) as string | null,
    };
    const balances = await tx
      .select({
        id: leaveBalances.id,
        employeeId: leaveBalances.employeeId,
        policyId: leaveBalances.policyId,
      })
      .from(leaveBalances)
      .innerJoin(leavePolicies, eq(leavePolicies.id, leaveBalances.policyId))
      .where(
        and(
          eq(leaveBalances.organisationId, organisationId),
          eq(leaveBalances.leaveYear, leaveYear),
          eq(leavePolicies.type, "Annual"),
          isNull(leaveBalances.archivedAt),
        ),
      );
    let changed = 0;
    for (const balance of balances) {
      await tx.execute(sql`SELECT id FROM leave_balances WHERE id=${balance.id} FOR UPDATE`);
      const carry = await annualCarryState(
        tx,
        organisationId,
        balance.employeeId,
        balance.policyId,
        leaveYear,
        carrySettings,
      );
      const delta =
        carry.expiryDate && localDate > carry.expiryDate
          ? -carry.remaining
          : -carry.expiryAdjustment;
      if (Math.abs(delta) < 0.005) continue;
      await tx
        .update(leaveBalances)
        .set({
          balanceDays: sql`${leaveBalances.balanceDays} + ${delta}`,
          updatedAt: now,
          updatedBy: actor.userId,
          recordVersion: sql`${leaveBalances.recordVersion} + 1`,
        })
        .where(eq(leaveBalances.id, balance.id));
      await tx.insert(leaveTransactions).values({
        organisationId,
        employeeId: balance.employeeId,
        policyId: balance.policyId,
        date: localDate,
        transactionType: "Expiry",
        days: String(delta),
        reason:
          delta < 0
            ? `Unused carried annual leave expired after ${carry.expiryDate}`
            : "Carried annual leave restored after expiry date changed",
        referenceId: balance.id,
        actorUserId: actor.userId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof leaveTransactions.$inferInsert);
      changed += 1;
    }
    if (changed)
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        actorRoles: actor.roles ?? [actor.activeRole],
        action: "reconcile-carry-expiry",
        module: "leave",
        entityType: "leave-balance",
        entityId: organisationId,
        afterSummary: { leaveYear, balancesChanged: changed },
        reason: "Reconciled the unused carried annual leave against the saved expiry date",
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
    return changed;
  });
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
    const [workerUser] = await db
      .select({ userId: users.id, employeeId: users.employeeId, role: roles.code })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(users.organisationId, row.organisation.id),
          eq(users.status, "Active"),
          isNull(users.archivedAt),
          inArray(roles.code, ["Super Admin", "HR"]),
        ),
      )
      .orderBy(sql`CASE WHEN ${roles.code} = 'Super Admin' THEN 0 ELSE 1 END`)
      .limit(1);
    if (!workerUser) continue;
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: row.settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const leaveYear = leaveYearForDate(localDate, row.settings.leaveYearStart);
    const taken = await db
      .update(leaveRequests)
      .set({
        status: "Taken",
        updatedAt: new Date(),
        updatedBy: workerUser.userId,
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
        actorUserId: workerUser.userId,
        actorEmployeeId: workerUser.employeeId,
        actorDisplayName: "VIA background worker",
        activeRole: workerUser.role,
        actorRoles: [workerUser.role],
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
    const workerActor = {
      userId: workerUser.userId,
      employeeId: workerUser.employeeId,
      displayName: "VIA background worker",
      roles: [workerUser.role],
      activeRole: workerUser.role,
    };
    balancesCreated += await rolloverLeaveBalancesInDatabase(
      row.organisation.id,
      leaveYear,
      workerActor,
    );
    await reconcileAnnualCarryExpiryInDatabase(row.organisation.id, workerActor, now);
  }
  return { organisations: rows.length, balancesCreated, requestsMarkedTaken };
}
