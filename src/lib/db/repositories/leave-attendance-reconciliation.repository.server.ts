import "@tanstack/react-start/server-only";

import { and, eq, isNull, lte, gte, sql, inArray } from "drizzle-orm";

import { getDatabaseClient, type ViaHrDatabase } from "../client.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import {
  leaveAttendanceOverlapReviews,
  leaveBalances,
  leavePolicies,
  leaveRequests,
  leaveTransactions,
} from "../schema/leave.ts";
import { appSettings } from "../schema/organisation.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { payrollPeriods } from "../schema/travel-payroll.ts";
import {
  attendanceDevicePunches,
  attendanceRecords,
  siteVisitRequests,
  timesheetPeriods,
  timesheets,
} from "../schema/time.ts";
import { organisationLeaveYear } from "./leave-year.repository.server.ts";

type Transaction = Parameters<Parameters<ViaHrDatabase["transaction"]>[0]>[0];
type LeaveRow = typeof leaveRequests.$inferSelect;
type LeaveSnapshot = Record<string, unknown> & {
  workingDates?: string[];
  name?: string;
  specialRequest?: {
    allocations?: Array<{ policyId: string; leaveYear: number; days: number }>;
    unpaidByDate?: Array<{ date: string; days: number }>;
    [key: string]: unknown;
  };
  officeWorkCorrections?: Array<{
    date: string;
    attendanceRecordId: string;
    correctedAt: string;
    restoredDays: number;
    decisionSource: "Biometric" | "HR";
    reason?: string;
  }>;
};

/** This UUID is metadata for a scheduled system operation, never a pretend human approver. */
const SYSTEM_METADATA_ID = "00000000-0000-0000-0000-000000000000";
const DIRECTLY_CORRECTABLE_STATUSES = ["Approved", "Taken"] as const;
const EFFECTIVE_STATUSES = [
  ...DIRECTLY_CORRECTABLE_STATUSES,
  "Cancellation Pending",
  "Amendment Pending Line Manager",
  "Amendment Pending HR",
] as const;

export interface OfficeWorkLeaveInput {
  organisationId: string;
  employeeId: string;
  date: string;
  attendanceRecordId: string;
  observedWorkHours: number;
  expectedWorkHours?: number;
  explicitOut: boolean;
  hrApprovedCorrection?: boolean;
}

export type OfficeWorkLeaveResult = {
  kind: "changed" | "no-overlap" | "needs-review" | "already-reconciled";
  leaveRequestIds?: string[];
  reason?: string;
};

function snapshotOf(request: LeaveRow): LeaveSnapshot {
  return request.policySnapshot && typeof request.policySnapshot === "object"
    ? (request.policySnapshot as LeaveSnapshot)
    : {};
}

function validDates(
  snapshot: LeaveSnapshot,
): snapshot is LeaveSnapshot & { workingDates: string[] } {
  return (
    Array.isArray(snapshot.workingDates) &&
    snapshot.workingDates.every(
      (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
    )
  );
}

async function notify(
  tx: Transaction,
  organisationId: string,
  recipientUserId: string,
  title: string,
  message: string,
  deduplicationKey: string,
  path: string,
  entityId: string,
) {
  await tx
    .insert(notifications)
    .values({
      organisationId,
      recipientUserId,
      type: "Leave attendance review",
      title,
      message,
      priority: "Normal",
      deduplicationKey,
      link: { entityType: "leaveRequest", entityId, path },
      createdBy: SYSTEM_METADATA_ID,
      updatedBy: SYSTEM_METADATA_ID,
    })
    .onConflictDoNothing();
}

async function notifyHrReview(tx: Transaction, request: LeaveRow, date: string, reason: string) {
  const reviewers = await tx
    .select({ userId: users.id })
    .from(users)
    .innerJoin(
      userRoles,
      and(eq(userRoles.userId, users.id), eq(userRoles.organisationId, request.organisationId)),
    )
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.code, "HR")))
    .where(
      and(
        eq(users.organisationId, request.organisationId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
      ),
    );
  for (const reviewer of reviewers) {
    await notify(
      tx,
      request.organisationId,
      reviewer.userId,
      "Leave and office attendance need review",
      `Office attendance on ${date} overlaps approved leave. ${reason}`,
      `leave-office-review:${request.id}:${date}`,
      "/staff/leave-admin#section=office-work",
      request.id,
    );
  }
}

async function createReview(
  tx: Transaction,
  request: LeaveRow,
  attendanceRecordId: string,
  date: string,
  observedWorkHours: number,
  reason: string,
): Promise<OfficeWorkLeaveResult> {
  const [existing] = await tx
    .select()
    .from(leaveAttendanceOverlapReviews)
    .where(
      and(
        eq(leaveAttendanceOverlapReviews.requestId, request.id),
        eq(leaveAttendanceOverlapReviews.date, date),
      ),
    )
    .limit(1);
  if (existing && existing.status !== "Pending")
    return { kind: "already-reconciled", leaveRequestIds: [request.id] };
  if (!existing) {
    await tx
      .insert(leaveAttendanceOverlapReviews)
      .values({
        organisationId: request.organisationId,
        employeeId: request.employeeId,
        requestId: request.id,
        attendanceRecordId,
        date,
        observedWorkHours: String(Math.max(0, observedWorkHours)),
        reason,
        createdBy: SYSTEM_METADATA_ID,
        updatedBy: SYSTEM_METADATA_ID,
      })
      .onConflictDoNothing();
  } else {
    await tx
      .update(leaveAttendanceOverlapReviews)
      .set({
        attendanceRecordId,
        observedWorkHours: String(Math.max(0, observedWorkHours)),
        reason,
        updatedAt: new Date(),
        updatedBy: SYSTEM_METADATA_ID,
        recordVersion: sql`${leaveAttendanceOverlapReviews.recordVersion} + 1`,
      })
      .where(eq(leaveAttendanceOverlapReviews.id, existing.id));
  }
  await notifyHrReview(tx, request, date, reason);
  return { kind: "needs-review", leaveRequestIds: [request.id], reason };
}

async function assertOfficeEvidence(tx: Transaction, input: OfficeWorkLeaveInput) {
  const [record] = await tx
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.id, input.attendanceRecordId),
        eq(attendanceRecords.organisationId, input.organisationId),
        eq(attendanceRecords.employeeId, input.employeeId),
        eq(attendanceRecords.date, input.date),
        isNull(attendanceRecords.archivedAt),
      ),
    )
    .limit(1);
  if (
    !record ||
    !record.clockInAt ||
    !record.clockOutAt ||
    !["Hardware Terminal", "Multiple Sources"].includes(record.source) ||
    !["Present", "Late", "Corrected"].includes(record.status)
  )
    return {
      record,
      hardValid: false,
      valid: false,
      reason: "A complete office biometric attendance record is required.",
    };
  const terminalPunches = await tx
    .select({
      id: attendanceDevicePunches.id,
      occurredAt: attendanceDevicePunches.occurredAt,
      deviceStatus: attendanceDevicePunches.deviceStatus,
    })
    .from(attendanceDevicePunches)
    .where(
      and(
        eq(attendanceDevicePunches.organisationId, input.organisationId),
        eq(attendanceDevicePunches.employeeId, input.employeeId),
        eq(attendanceDevicePunches.attendanceRecordId, record.id),
        eq(attendanceDevicePunches.status, "Applied"),
      ),
    )
    .orderBy(attendanceDevicePunches.occurredAt);
  if (!terminalPunches.length || record.siteVisitId || record.workMode === "Remote")
    return {
      record,
      hardValid: false,
      valid: false,
      reason: "Office biometric evidence is mixed with another work mode or visit.",
    };
  const activeVisits = await tx
    .select({ id: siteVisitRequests.id })
    .from(siteVisitRequests)
    .where(
      and(
        eq(siteVisitRequests.organisationId, input.organisationId),
        eq(siteVisitRequests.employeeId, input.employeeId),
        eq(siteVisitRequests.date, input.date),
        inArray(siteVisitRequests.status, ["Pending HR", "Approved", "Completed"]),
        isNull(siteVisitRequests.archivedAt),
      ),
    )
    .limit(1);
  if (activeVisits.length)
    return {
      record,
      hardValid: false,
      valid: false,
      reason: "A site visit also exists on this day; HR must verify what happened.",
    };
  if (!input.explicitOut && !input.hrApprovedCorrection)
    return {
      record,
      hardValid: true,
      valid: false,
      reason: "The apparent sign-out was inferred; HR must review the machine punches.",
    };
  if (
    !input.hrApprovedCorrection &&
    (terminalPunches[0]?.deviceStatus !== 0 || terminalPunches.at(-1)?.deviceStatus !== 1)
  )
    return {
      record,
      hardValid: true,
      valid: false,
      reason: "The machine does not show an explicit IN followed by an explicit OUT.",
    };
  const hours = Number(record.calculatedHours);
  if (!Number.isFinite(hours) || hours < 1 || input.observedWorkHours < 1)
    return {
      record,
      hardValid: true,
      valid: false,
      reason: "Less than one hour of office work was recorded; HR must review.",
    };
  return { record, hardValid: true, valid: true, reason: "" };
}

async function blockedByTimesheet(tx: Transaction, input: OfficeWorkLeaveInput) {
  // Share-lock both relevant rows so a concurrent submit/close cannot race this correction.
  await tx.execute(sql`select id from timesheet_periods where organisation_id=${input.organisationId}
    and start_date <= ${input.date} and end_date >= ${input.date} and archived_at is null for share`);
  await tx.execute(sql`select t.id from timesheets t join timesheet_periods p on p.id=t.period_id
    where p.organisation_id=${input.organisationId} and t.employee_id=${input.employeeId}
      and p.start_date <= ${input.date} and p.end_date >= ${input.date}
      and t.archived_at is null for share`);
  const periods = await tx
    .select({
      periodStatus: timesheetPeriods.status,
      timesheetStatus: timesheets.status,
    })
    .from(timesheetPeriods)
    .leftJoin(
      timesheets,
      and(
        eq(timesheets.periodId, timesheetPeriods.id),
        eq(timesheets.employeeId, input.employeeId),
        isNull(timesheets.archivedAt),
      ),
    )
    .where(
      and(
        eq(timesheetPeriods.organisationId, input.organisationId),
        lte(timesheetPeriods.startDate, input.date),
        gte(timesheetPeriods.endDate, input.date),
        isNull(timesheetPeriods.archivedAt),
      ),
    );
  return periods.some(
    (row) =>
      row.periodStatus !== "Open" ||
      (row.timesheetStatus !== null && !["Draft", "Returned"].includes(row.timesheetStatus)),
  );
}

async function blockedByPayroll(tx: Transaction, input: OfficeWorkLeaveInput) {
  await tx.execute(sql`select id from payroll_periods where organisation_id=${input.organisationId}
    and start_date <= ${input.date} and end_date >= ${input.date} and archived_at is null for share`);
  const periods = await tx
    .select({ status: payrollPeriods.status })
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.organisationId, input.organisationId),
        lte(payrollPeriods.startDate, input.date),
        gte(payrollPeriods.endDate, input.date),
        isNull(payrollPeriods.archivedAt),
      ),
    );
  return periods.some((period) =>
    ["Prepared", "Approved", "Locked", "Exported", "Corrected"].includes(period.status),
  );
}

type CorrectionActor = { userId: string; employeeId?: string; displayName?: string };

async function correctOneDay(
  tx: Transaction,
  request: LeaveRow,
  input: OfficeWorkLeaveInput,
  actor?: CorrectionActor,
  selectedAllocation?: { policyId: string; leaveYear: number },
  decisionReason?: string,
): Promise<OfficeWorkLeaveResult> {
  const snapshot = snapshotOf(request);
  if (!actor) {
    const [priorDecision] = await tx
      .select({ status: leaveAttendanceOverlapReviews.status })
      .from(leaveAttendanceOverlapReviews)
      .where(
        and(
          eq(leaveAttendanceOverlapReviews.requestId, request.id),
          eq(leaveAttendanceOverlapReviews.date, input.date),
          inArray(leaveAttendanceOverlapReviews.status, ["Kept", "Resolved"]),
          isNull(leaveAttendanceOverlapReviews.archivedAt),
        ),
      )
      .limit(1);
    if (priorDecision) return { kind: "already-reconciled", leaveRequestIds: [request.id] };
  }
  if (!validDates(snapshot)) {
    if (actor)
      throw new Error(
        "This older leave record has no approved day list. HR must amend the original leave dates before removing this day.",
      );
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "The approved day-by-day leave dates are missing; HR must verify the original record.",
    );
  }
  if (!snapshot.workingDates.includes(input.date))
    return { kind: "already-reconciled", leaveRequestIds: [request.id] };
  if (snapshot.officeWorkCorrections?.some((entry) => entry.date === input.date))
    return { kind: "already-reconciled", leaveRequestIds: [request.id] };
  if (
    request.pendingAmendment ||
    !DIRECTLY_CORRECTABLE_STATUSES.includes(
      request.status as (typeof DIRECTLY_CORRECTABLE_STATUSES)[number],
    )
  ) {
    if (actor)
      throw new Error(
        "Finish the pending leave amendment or cancellation before removing this day.",
      );
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "The leave approval is being amended or cancelled; HR must resolve this overlap.",
    );
  }
  if (await blockedByTimesheet(tx, input)) {
    if (actor)
      throw new Error(
        "The timesheet period is submitted or closed. Return or reopen it before removing this leave day.",
      );
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "The timesheet period has already been submitted or closed; HR must review before changing leave.",
    );
  }
  if (await blockedByPayroll(tx, input)) {
    if (actor)
      throw new Error(
        "Payroll has been prepared or locked for this date. Reopen or correct payroll before removing this leave day.",
      );
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "Payroll has been prepared or locked; HR must review the pay effect before changing leave.",
    );
  }

  const [policy] = await tx
    .select()
    .from(leavePolicies)
    .where(
      and(
        eq(leavePolicies.id, request.policyId),
        eq(leavePolicies.organisationId, input.organisationId),
      ),
    )
    .limit(1);
  if (!policy) {
    if (actor)
      throw new Error(
        "The original leave policy is missing. Restore or identify it before changing this request.",
      );
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "The leave policy is missing; HR must review the balance.",
    );
  }
  if (
    !actor &&
    ((Array.isArray(snapshot["payTiers"]) && snapshot["payTiers"].length) ||
      (Array.isArray(request.sickPayTiers) && request.sickPayTiers.length))
  )
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "Tiered leave pay may change; HR must review the payroll effect.",
    );

  const restoredDays = request.isHalfDay ? 0.5 : 1;
  const currentDays = Number(request.workingDaysRequested);
  if (
    !Number.isFinite(currentDays) ||
    currentDays < restoredDays ||
    Math.abs(snapshot.workingDates.length * restoredDays - currentDays) > 0.01
  ) {
    if (actor)
      throw new Error(
        "Approved leave dates and day count disagree. Correct the underlying leave record before removing this day.",
      );
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "The leave day count does not match its approved dates.",
    );
  }
  const special = snapshot.specialRequest;
  if (special && !actor)
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      "A special leave balance and pay allocation needs an HR decision.",
    );
  let balancePolicyId: string | null = null;
  let balanceYear: number | null = null;
  let creditBalanceRow = false;
  let transactionDate = request.startDate;
  let nextSpecial = special;
  if (special) {
    const allocations = special.allocations ?? [];
    if (allocations.length && !selectedAllocation) {
      if (actor)
        throw new Error("Choose which approved special-leave balance allocation to restore.");
      return createReview(
        tx,
        request,
        input.attendanceRecordId,
        input.date,
        input.observedWorkHours,
        "Choose which approved special-leave allocation to restore.",
      );
    }
    if (selectedAllocation) {
      const chosen = allocations.find(
        (entry) =>
          entry.policyId === selectedAllocation.policyId &&
          entry.leaveYear === selectedAllocation.leaveYear &&
          entry.days >= restoredDays,
      );
      if (!chosen) {
        if (actor)
          throw new Error(
            "The chosen special-leave allocation has insufficient days. Choose another source or reconcile the leave record.",
          );
        return createReview(
          tx,
          request,
          input.attendanceRecordId,
          input.date,
          input.observedWorkHours,
          "The chosen special-leave allocation cannot cover this day.",
        );
      }
      balancePolicyId = chosen.policyId;
      balanceYear = chosen.leaveYear;
      creditBalanceRow = true;
      const [settings] = await tx
        .select({ leaveYearStart: appSettings.leaveYearStart })
        .from(appSettings)
        .where(eq(appSettings.organisationId, input.organisationId))
        .limit(1);
      transactionDate = `${balanceYear}-${settings?.leaveYearStart ?? "01-01"}`;
      nextSpecial = {
        ...special,
        allocations: allocations
          .map((entry) =>
            entry === chosen
              ? { ...entry, days: Number((entry.days - restoredDays).toFixed(2)) }
              : entry,
          )
          .filter((entry) => entry.days > 0),
        ...(special.unpaidByDate
          ? { unpaidByDate: special.unpaidByDate.filter((entry) => entry.date !== input.date) }
          : {}),
      };
    } else {
      nextSpecial = {
        ...special,
        ...(special.unpaidByDate
          ? { unpaidByDate: special.unpaidByDate.filter((entry) => entry.date !== input.date) }
          : {}),
      };
    }
  } else if (policy.consumesBalance) {
    balancePolicyId = policy.id;
    balanceYear = await organisationLeaveYear(input.organisationId, request.startDate, tx);
    // Per Event, Once Per Service and Not Tracked approvals write a usage ledger
    // debit but do not have a materialized balance row to update.
    creditBalanceRow = ["Annual", "Ledger"].includes(policy.scope);
  }

  if (balancePolicyId && balanceYear !== null) {
    // Check the original ledger before crediting the balance; imported or previously corrected
    // requests can have different funding and must never receive an invented refund.
    const ledger = await tx
      .select({
        policyId: leaveTransactions.policyId,
        date: leaveTransactions.date,
        days: leaveTransactions.days,
      })
      .from(leaveTransactions)
      .where(
        and(
          eq(leaveTransactions.organisationId, input.organisationId),
          eq(leaveTransactions.employeeId, input.employeeId),
          eq(leaveTransactions.referenceId, request.id),
          isNull(leaveTransactions.archivedAt),
        ),
      );
    const netForSource = ledger
      .filter(
        (entry) =>
          entry.policyId === balancePolicyId && (!special || entry.date === transactionDate),
      )
      .reduce((total, entry) => total + Number(entry.days), 0);
    const expectedDebit = special
      ? -(special.allocations ?? [])
          .filter((entry) => entry.policyId === balancePolicyId && entry.leaveYear === balanceYear)
          .reduce((total, entry) => total + entry.days, 0)
      : -currentDays;
    if (Math.abs(netForSource - expectedDebit) > 0.01) {
      if (actor)
        throw new Error(
          "The original leave ledger does not match the approved request. Reconcile the ledger before restoring days.",
        );
      return createReview(
        tx,
        request,
        input.attendanceRecordId,
        input.date,
        input.observedWorkHours,
        "The original leave balance ledger does not match the approved request; HR must reconcile it.",
      );
    }
    if (creditBalanceRow) {
      const updatedBalance = await tx
        .update(leaveBalances)
        .set({
          balanceDays: sql`${leaveBalances.balanceDays} + ${restoredDays}`,
          updatedAt: new Date(),
          updatedBy: actor?.userId ?? SYSTEM_METADATA_ID,
          recordVersion: sql`${leaveBalances.recordVersion} + 1`,
        })
        .where(
          and(
            eq(leaveBalances.organisationId, input.organisationId),
            eq(leaveBalances.employeeId, input.employeeId),
            eq(leaveBalances.policyId, balancePolicyId),
            eq(leaveBalances.leaveYear, balanceYear),
            isNull(leaveBalances.archivedAt),
          ),
        )
        .returning({ id: leaveBalances.id });
      if (!updatedBalance.length) {
        if (actor)
          throw new Error(
            "The original leave balance row is missing. Restore or reconcile it before refunding this day.",
          );
        return createReview(
          tx,
          request,
          input.attendanceRecordId,
          input.date,
          input.observedWorkHours,
          "The original leave balance is unavailable; HR must review the refund.",
        );
      }
    }
    await tx.insert(leaveTransactions).values({
      organisationId: input.organisationId,
      employeeId: input.employeeId,
      policyId: balancePolicyId,
      date: transactionDate,
      transactionType: "Cancellation Restoration",
      days: String(restoredDays),
      reason: `Office work on ${input.date} replaced an approved leave day`,
      referenceId: request.id,
      actorUserId: actor?.userId ?? null,
      createdBy: actor?.userId ?? SYSTEM_METADATA_ID,
      updatedBy: actor?.userId ?? SYSTEM_METADATA_ID,
    });
  }

  const correctedAt = new Date().toISOString();
  const nextSnapshot: LeaveSnapshot = {
    ...snapshot,
    workingDates: snapshot.workingDates.filter((day) => day !== input.date),
    officeWorkCorrections: [
      ...(snapshot.officeWorkCorrections ?? []),
      {
        date: input.date,
        attendanceRecordId: input.attendanceRecordId,
        correctedAt,
        restoredDays: balancePolicyId ? restoredDays : 0,
        decisionSource: actor ? "HR" : "Biometric",
        ...(decisionReason ? { reason: decisionReason } : {}),
      },
    ],
    ...(special ? { specialRequest: nextSpecial } : {}),
  };
  await tx
    .update(leaveRequests)
    .set({
      policySnapshot: nextSnapshot,
      workingDaysRequested: String(Math.max(0, currentDays - restoredDays)),
      ...(currentDays - restoredDays > 0
        ? {}
        : {
            status: "Cancellation Approved" as const,
            cancellationReason: `Office attendance verified on ${input.date}`,
          }),
      updatedAt: new Date(),
      updatedBy: actor?.userId ?? SYSTEM_METADATA_ID,
      recordVersion: sql`${leaveRequests.recordVersion} + 1`,
    })
    .where(eq(leaveRequests.id, request.id));
  await tx.insert(auditEvents).values({
    organisationId: input.organisationId,
    actorUserId: actor?.userId ?? null,
    actorEmployeeId: actor?.employeeId ?? null,
    actorDisplayName: actor?.displayName ?? "VIA attendance reconciliation",
    activeRole: actor ? "HR" : null,
    actorRoles: actor ? ["HR"] : [],
    action: "approved_leave_day_replaced_by_office_work",
    module: "Leave",
    entityType: "leaveRequest",
    entityId: request.id,
    beforeSummary: { date: input.date, days: currentDays, status: request.status },
    afterSummary: {
      date: input.date,
      days: Math.max(0, currentDays - restoredDays),
      restoredDays: balancePolicyId ? restoredDays : 0,
      attendanceRecordId: input.attendanceRecordId,
    },
    reason: actor
      ? (decisionReason ?? "HR confirmed office work replaces approved leave")
      : "Verified office biometric sign-in and sign-out",
    riskLevel: "Medium",
  });
  const [employeeUser] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organisationId, input.organisationId),
        eq(users.employeeId, input.employeeId),
        eq(users.status, "Active"),
        isNull(users.archivedAt),
      ),
    )
    .limit(1);
  if (employeeUser)
    await notify(
      tx,
      input.organisationId,
      employeeUser.id,
      "Leave updated after office attendance",
      `Your approved leave on ${input.date} was removed because office work was confirmed.${creditBalanceRow ? ` ${restoredDays} day${restoredDays === 1 ? "" : "s"} returned to your leave balance.` : balancePolicyId ? " Your recorded leave usage was adjusted." : ""}`,
      `leave-office-corrected:${request.id}:${input.date}`,
      "/staff/me/leave-balances",
      request.id,
    );
  await tx
    .update(leaveAttendanceOverlapReviews)
    .set({
      status: "Resolved",
      decisionReason: actor
        ? (decisionReason ?? "HR confirmed office attendance")
        : "Verified biometric attendance",
      decidedBy: actor?.userId ?? null,
      decidedAt: new Date().toISOString(),
      updatedBy: actor?.userId ?? SYSTEM_METADATA_ID,
      updatedAt: new Date(),
      recordVersion: sql`${leaveAttendanceOverlapReviews.recordVersion} + 1`,
    })
    .where(
      and(
        eq(leaveAttendanceOverlapReviews.requestId, request.id),
        eq(leaveAttendanceOverlapReviews.date, input.date),
      ),
    );
  return { kind: "changed", leaveRequestIds: [request.id] };
}

/** Called inside the same transaction that persists the biometric daily projection. */
export async function reconcileApprovedLeaveForOfficeWorkDayInDatabase(
  tx: Transaction,
  input: OfficeWorkLeaveInput,
): Promise<OfficeWorkLeaveResult> {
  const requests = await tx
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.organisationId, input.organisationId),
        eq(leaveRequests.employeeId, input.employeeId),
        lte(leaveRequests.startDate, input.date),
        gte(leaveRequests.endDate, input.date),
        inArray(leaveRequests.status, [...EFFECTIVE_STATUSES]),
        isNull(leaveRequests.archivedAt),
      ),
    );
  const overlaps = requests.filter((request) => {
    const snapshot = snapshotOf(request);
    return !validDates(snapshot) || snapshot.workingDates.includes(input.date);
  });
  if (!overlaps.length) return { kind: "no-overlap" };
  await tx.execute(
    sql`select id from leave_requests where id in (${sql.join(
      overlaps.map((request) => sql`${request.id}`),
      sql`, `,
    )}) order by id for update`,
  );
  // A concurrent projection may have corrected this day while this transaction waited.
  const current = await tx
    .select()
    .from(leaveRequests)
    .where(
      inArray(
        leaveRequests.id,
        overlaps.map((request) => request.id),
      ),
    );
  const currentOverlaps = current.filter((request) => {
    const snapshot = snapshotOf(request);
    return (
      EFFECTIVE_STATUSES.includes(request.status as (typeof EFFECTIVE_STATUSES)[number]) &&
      (!validDates(snapshot) || snapshot.workingDates.includes(input.date))
    );
  });
  if (!currentOverlaps.length)
    return { kind: "already-reconciled", leaveRequestIds: overlaps.map((request) => request.id) };
  const evidence = await assertOfficeEvidence(tx, input);
  if (currentOverlaps.length > 1) {
    for (const request of currentOverlaps)
      await createReview(
        tx,
        request,
        input.attendanceRecordId,
        input.date,
        input.observedWorkHours,
        "Multiple approved leave requests cover this day; HR must resolve the overlap.",
      );
    return {
      kind: "needs-review",
      leaveRequestIds: currentOverlaps.map((request) => request.id),
      reason: "Multiple approved leave requests cover this day.",
    };
  }
  const request = currentOverlaps[0]!;
  if (!evidence.valid)
    return createReview(
      tx,
      request,
      input.attendanceRecordId,
      input.date,
      input.observedWorkHours,
      evidence.reason,
    );
  return correctOneDay(tx, request, input);
}

export interface LeaveAttendanceOverlapReviewRow {
  reviewId: string;
  requestId: string;
  date: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  attendanceRecordId: string;
  observedWorkHours: number;
  reason: string;
  status: "Pending" | "Resolved" | "Kept";
  allocationOptions?: Array<{
    policyId: string;
    leaveYear: number;
    policyName: string;
    days: number;
  }>;
}

/** Read-only queue preview for historical overlaps; it never changes past leave or payroll. */
export async function previewExistingApprovedLeaveOfficeOverlapsInDatabase(
  organisationId: string,
  limit = 200,
): Promise<
  Array<{
    requestId: string;
    employeeId: string;
    employeeName: string;
    date: string;
    leaveType: string;
    attendanceRecordId: string;
    observedWorkHours: number;
    hasReview: boolean;
  }>
> {
  const db = getDatabaseClient();
  const rows = await db
    .select({
      request: leaveRequests,
      attendance: attendanceRecords,
      employeeName: employees.preferredName,
      legalName: employees.legalName,
      reviewId: leaveAttendanceOverlapReviews.id,
    })
    .from(attendanceRecords)
    .innerJoin(
      leaveRequests,
      and(
        eq(leaveRequests.organisationId, attendanceRecords.organisationId),
        eq(leaveRequests.employeeId, attendanceRecords.employeeId),
        lte(leaveRequests.startDate, attendanceRecords.date),
        gte(leaveRequests.endDate, attendanceRecords.date),
        inArray(leaveRequests.status, [...EFFECTIVE_STATUSES]),
        isNull(leaveRequests.archivedAt),
      ),
    )
    .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
    .leftJoin(
      leaveAttendanceOverlapReviews,
      and(
        eq(leaveAttendanceOverlapReviews.requestId, leaveRequests.id),
        eq(leaveAttendanceOverlapReviews.date, attendanceRecords.date),
        isNull(leaveAttendanceOverlapReviews.archivedAt),
      ),
    )
    .where(
      and(
        eq(attendanceRecords.organisationId, organisationId),
        inArray(attendanceRecords.source, ["Hardware Terminal", "Multiple Sources"]),
        eq(attendanceRecords.workMode, "Office"),
        inArray(attendanceRecords.status, ["Present", "Late", "Corrected"]),
        isNull(attendanceRecords.siteVisitId),
        isNull(attendanceRecords.archivedAt),
        sql`${attendanceRecords.clockInAt} is not null`,
        sql`${attendanceRecords.clockOutAt} is not null`,
        sql`exists (select 1 from attendance_device_punches p
          where p.attendance_record_id=${attendanceRecords.id} and p.status='Applied')`,
        sql`not exists (select 1 from site_visit_requests v
          where v.organisation_id=${organisationId} and v.employee_id=${attendanceRecords.employeeId}
            and v.date=${attendanceRecords.date} and v.status in ('Pending HR','Approved','Completed')
            and v.archived_at is null)`,
      ),
    )
    .orderBy(sql`${attendanceRecords.date} desc`)
    .limit(Math.max(1, Math.min(limit, 500)));
  return rows
    .filter(({ request, attendance }) => {
      const snapshot = snapshotOf(request);
      return !validDates(snapshot) || snapshot.workingDates.includes(attendance.date);
    })
    .map(({ request, attendance, employeeName, legalName, reviewId }) => ({
      requestId: request.id,
      employeeId: request.employeeId,
      employeeName: employeeName || legalName,
      date: attendance.date,
      leaveType: snapshotOf(request).name ?? "Leave",
      attendanceRecordId: attendance.id,
      observedWorkHours: Number(attendance.calculatedHours),
      hasReview: Boolean(reviewId),
    }));
}

export async function listLeaveAttendanceOverlapReviewsInDatabase(
  organisationId: string,
  options: { includeResolved?: boolean } = {},
): Promise<LeaveAttendanceOverlapReviewRow[]> {
  const db = getDatabaseClient();
  const rows = await db
    .select({
      review: leaveAttendanceOverlapReviews,
      request: leaveRequests,
      employeeName: employees.preferredName,
      legalName: employees.legalName,
    })
    .from(leaveAttendanceOverlapReviews)
    .innerJoin(leaveRequests, eq(leaveRequests.id, leaveAttendanceOverlapReviews.requestId))
    .innerJoin(employees, eq(employees.id, leaveAttendanceOverlapReviews.employeeId))
    .where(
      and(
        eq(leaveAttendanceOverlapReviews.organisationId, organisationId),
        ...(options.includeResolved ? [] : [eq(leaveAttendanceOverlapReviews.status, "Pending")]),
        isNull(leaveAttendanceOverlapReviews.archivedAt),
      ),
    );
  const policyIds = [
    ...new Set(
      rows.flatMap(
        (row) =>
          snapshotOf(row.request).specialRequest?.allocations?.map((entry) => entry.policyId) ?? [],
      ),
    ),
  ];
  const policies = policyIds.length
    ? await db
        .select({ id: leavePolicies.id, name: leavePolicies.name })
        .from(leavePolicies)
        .where(
          and(
            eq(leavePolicies.organisationId, organisationId),
            inArray(leavePolicies.id, policyIds),
          ),
        )
    : [];
  const names = new Map(policies.map((policy) => [policy.id, policy.name]));
  return rows.map(({ review, request, employeeName, legalName }) => {
    const snapshot = snapshotOf(request);
    const allocations = snapshot.specialRequest?.allocations ?? [];
    return {
      reviewId: review.id,
      requestId: request.id,
      date: review.date,
      employeeId: review.employeeId,
      employeeName: employeeName || legalName,
      leaveType: snapshot.name ?? "Leave",
      attendanceRecordId: review.attendanceRecordId,
      observedWorkHours: Number(review.observedWorkHours),
      reason: review.reason,
      status: review.status,
      ...(snapshot.specialRequest
        ? {
            allocationOptions: allocations.map((entry) => ({
              ...entry,
              policyName: names.get(entry.policyId) ?? "Leave balance",
            })),
          }
        : {}),
    };
  });
}

async function requireActiveHr(tx: Transaction, organisationId: string, userId: string) {
  const [hr] = await tx
    .select({ id: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.code, "HR")))
    .innerJoin(
      users,
      and(eq(users.id, userRoles.userId), eq(users.status, "Active"), isNull(users.archivedAt)),
    )
    .where(and(eq(userRoles.organisationId, organisationId), eq(userRoles.userId, userId)))
    .limit(1);
  if (!hr) throw new Error("Only an active HR account can review a leave and attendance overlap.");
}

/** Makes an existing historical overlap visible to HR without changing leave or payroll. */
export async function stageExistingApprovedLeaveOfficeOverlapInDatabase(
  organisationId: string,
  input: { requestId: string; date: string; attendanceRecordId: string },
  actor: CorrectionActor,
): Promise<OfficeWorkLeaveResult> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await requireActiveHr(tx, organisationId, actor.userId);
    await tx.execute(
      sql`select id from leave_requests where id=${input.requestId} and organisation_id=${organisationId} for update`,
    );
    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.id, input.requestId),
          eq(leaveRequests.organisationId, organisationId),
          lte(leaveRequests.startDate, input.date),
          gte(leaveRequests.endDate, input.date),
          inArray(leaveRequests.status, [...EFFECTIVE_STATUSES]),
          isNull(leaveRequests.archivedAt),
        ),
      )
      .limit(1);
    if (!request) throw new Error("Approved leave no longer covers that date.");
    const snapshot = snapshotOf(request);
    if (validDates(snapshot) && !snapshot.workingDates.includes(input.date))
      return { kind: "already-reconciled", leaveRequestIds: [request.id] };
    const [attendance] = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.id, input.attendanceRecordId),
          eq(attendanceRecords.organisationId, organisationId),
          eq(attendanceRecords.employeeId, request.employeeId),
          eq(attendanceRecords.date, input.date),
          isNull(attendanceRecords.archivedAt),
        ),
      )
      .limit(1);
    if (!attendance) throw new Error("Office attendance no longer matches this employee and day.");
    const evidence = await assertOfficeEvidence(tx, {
      organisationId,
      employeeId: request.employeeId,
      date: input.date,
      attendanceRecordId: attendance.id,
      observedWorkHours: Number(attendance.calculatedHours),
      explicitOut: false,
    });
    if (!evidence.hardValid) throw new Error(evidence.reason);
    return createReview(
      tx,
      request,
      attendance.id,
      input.date,
      Number(attendance.calculatedHours),
      "Historical approved leave overlaps a complete office biometric attendance record; HR must verify it.",
    );
  });
}

/** Final HR approval can happen after the employee has already worked at the office. */
export async function stageOfficeWorkOverlapsAfterLeaveApprovalInDatabase(
  tx: Transaction,
  input: { organisationId: string; requestId: string },
): Promise<number> {
  const [request] = await tx
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.id, input.requestId),
        eq(leaveRequests.organisationId, input.organisationId),
        eq(leaveRequests.status, "Approved"),
        isNull(leaveRequests.archivedAt),
      ),
    )
    .limit(1);
  if (!request) return 0;
  const snapshot = snapshotOf(request);
  const rows = await tx
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.organisationId, input.organisationId),
        eq(attendanceRecords.employeeId, request.employeeId),
        lte(attendanceRecords.date, request.endDate),
        gte(attendanceRecords.date, request.startDate),
        inArray(attendanceRecords.source, ["Hardware Terminal", "Multiple Sources"]),
        isNull(attendanceRecords.archivedAt),
        sql`${attendanceRecords.clockInAt} is not null`,
        sql`${attendanceRecords.clockOutAt} is not null`,
      ),
    );
  let staged = 0;
  for (const attendance of rows) {
    if (validDates(snapshot) && !snapshot.workingDates.includes(attendance.date)) continue;
    const evidence = await assertOfficeEvidence(tx, {
      organisationId: input.organisationId,
      employeeId: request.employeeId,
      date: attendance.date,
      attendanceRecordId: attendance.id,
      observedWorkHours: Number(attendance.calculatedHours),
      explicitOut: false,
    });
    if (!evidence.hardValid) continue;
    const result = await createReview(
      tx,
      request,
      attendance.id,
      attendance.date,
      Number(attendance.calculatedHours),
      "Leave was approved after the employee had already recorded an office workday; HR must verify the overlap.",
    );
    if (result.kind === "needs-review") staged++;
  }
  return staged;
}

export async function resolveLeaveAttendanceOverlapReviewInDatabase(
  organisationId: string,
  input: {
    reviewId: string;
    decision: "remove-leave" | "keep-leave";
    reason: string;
    allocationPolicyId?: string;
    allocationLeaveYear?: number;
  },
  actor: CorrectionActor,
): Promise<{ kind: "changed" | "kept" | "needs-review" | "already-reconciled"; reason?: string }> {
  if (!input.reason.trim()) throw new Error("Explain the HR decision.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await requireActiveHr(tx, organisationId, actor.userId);
    const [candidate] = await tx
      .select({ requestId: leaveAttendanceOverlapReviews.requestId })
      .from(leaveAttendanceOverlapReviews)
      .where(
        and(
          eq(leaveAttendanceOverlapReviews.id, input.reviewId),
          eq(leaveAttendanceOverlapReviews.organisationId, organisationId),
          isNull(leaveAttendanceOverlapReviews.archivedAt),
        ),
      )
      .limit(1);
    if (!candidate) throw new Error("Leave review not found.");
    // All correction paths take the leave lock before the review lock.
    await tx.execute(sql`select id from leave_requests where id=${candidate.requestId} for update`);
    await tx.execute(
      sql`select id from leave_attendance_overlap_reviews where id=${input.reviewId} and organisation_id=${organisationId} for update`,
    );
    const [review] = await tx
      .select()
      .from(leaveAttendanceOverlapReviews)
      .where(
        and(
          eq(leaveAttendanceOverlapReviews.id, input.reviewId),
          eq(leaveAttendanceOverlapReviews.organisationId, organisationId),
          isNull(leaveAttendanceOverlapReviews.archivedAt),
        ),
      )
      .limit(1);
    if (!review) throw new Error("Leave review not found.");
    if (review.status !== "Pending") return { kind: "already-reconciled" };
    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.id, review.requestId))
      .limit(1);
    if (!request) throw new Error("Approved leave request not found.");
    if (input.decision === "keep-leave") {
      await tx
        .update(leaveAttendanceOverlapReviews)
        .set({
          status: "Kept",
          decisionReason: input.reason.trim(),
          decidedBy: actor.userId,
          decidedAt: new Date().toISOString(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${leaveAttendanceOverlapReviews.recordVersion} + 1`,
        })
        .where(eq(leaveAttendanceOverlapReviews.id, review.id));
      await tx.insert(auditEvents).values({
        organisationId,
        actorUserId: actor.userId,
        actorEmployeeId: actor.employeeId ?? null,
        actorDisplayName: actor.displayName ?? "HR",
        activeRole: "HR",
        actorRoles: ["HR"],
        action: "leave_attendance_overlap_kept",
        module: "Leave",
        entityType: "leaveRequest",
        entityId: request.id,
        afterSummary: { date: review.date, attendanceRecordId: review.attendanceRecordId },
        reason: input.reason.trim(),
        riskLevel: "Medium",
      });
      const [employeeUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organisationId, organisationId),
            eq(users.employeeId, review.employeeId),
            eq(users.status, "Active"),
            isNull(users.archivedAt),
          ),
        )
        .limit(1);
      if (employeeUser)
        await notify(
          tx,
          organisationId,
          employeeUser.id,
          "Leave and attendance reviewed",
          `HR reviewed the office attendance on ${review.date} and kept the approved leave. ${input.reason.trim()}`,
          `leave-office-kept:${request.id}:${review.date}`,
          "/staff/me/leave-balances",
          request.id,
        );
      return { kind: "kept" };
    }
    const evidence = await assertOfficeEvidence(tx, {
      organisationId,
      employeeId: review.employeeId,
      date: review.date,
      attendanceRecordId: review.attendanceRecordId,
      observedWorkHours: Number(review.observedWorkHours),
      explicitOut: true,
      hrApprovedCorrection: true,
    });
    if (!evidence.record || !evidence.record.clockInAt || !evidence.record.clockOutAt)
      throw new Error(
        "The complete attendance record is no longer available. Review it again before removing leave.",
      );
    if (!evidence.hardValid) throw new Error(evidence.reason);
    const result = await correctOneDay(
      tx,
      request,
      {
        organisationId,
        employeeId: review.employeeId,
        date: review.date,
        attendanceRecordId: review.attendanceRecordId,
        observedWorkHours: Number(review.observedWorkHours),
        explicitOut: true,
        hrApprovedCorrection: true,
      },
      actor,
      input.allocationPolicyId && input.allocationLeaveYear
        ? { policyId: input.allocationPolicyId, leaveYear: input.allocationLeaveYear }
        : undefined,
      input.reason.trim(),
    );
    return {
      kind: result.kind === "no-overlap" ? "already-reconciled" : result.kind,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  });
}
