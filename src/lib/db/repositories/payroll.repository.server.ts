import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";

import type { PayrollPeriod } from "../../data/payroll-types.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import { getDatabaseClient } from "../client.ts";
import { readObjectFile } from "../object-storage.server.ts";
import { employeeDocuments, fileMetadata } from "../schema/documents.ts";
import { employeeBankDetails, employeeCompensation, employees } from "../schema/employee.ts";
import { leavePolicies, leaveRequests } from "../schema/leave.ts";
import { offboardingCases } from "../schema/onboarding-offboarding.ts";
import { auditEvents } from "../schema/system.ts";
import {
  attendanceExceptionCases,
  overtimeClaims,
  timesheetPeriods,
  timesheets,
} from "../schema/time.ts";
import {
  payrollExceptions,
  payrollInputs,
  payrollManualAdjustments,
  payrollPeriods,
  reimbursements,
  travelRequests,
} from "../schema/travel-payroll.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function role(actor: AuditActorContext) {
  return actor.activeRole ?? actor.roles?.[0] ?? "Employee";
}
function requirePayroll(actor: AuditActorContext) {
  if (!["Accounts", "Super Admin"].includes(role(actor)))
    throw new Error("Only Accounts or Super Admin can access payroll.");
}
function auditActor(actor: AuditActorContext) {
  return {
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: role(actor),
    actorRoles: actor.roles ?? [],
  };
}

async function periodSnapshot(org: string, periodId?: string): Promise<PayrollPeriod[]> {
  const db = getDatabaseClient();
  const periods = await db
    .select()
    .from(payrollPeriods)
    .where(
      and(
        eq(payrollPeriods.organisationId, org),
        isNull(payrollPeriods.archivedAt),
        ...(periodId ? [eq(payrollPeriods.id, periodId)] : []),
      ),
    )
    .orderBy(desc(payrollPeriods.startDate));
  if (!periods.length) return [];
  const ids = periods.map((item) => item.id);
  const [inputs, exceptions, adjustments] = await Promise.all([
    db
      .select()
      .from(payrollInputs)
      .where(
        and(
          eq(payrollInputs.organisationId, org),
          inArray(payrollInputs.periodId, ids),
          isNull(payrollInputs.archivedAt),
        ),
      ),
    db
      .select()
      .from(payrollExceptions)
      .where(
        and(
          eq(payrollExceptions.organisationId, org),
          inArray(payrollExceptions.periodId, ids),
          isNull(payrollExceptions.archivedAt),
        ),
      ),
    db
      .select()
      .from(payrollManualAdjustments)
      .where(
        and(
          eq(payrollManualAdjustments.organisationId, org),
          inArray(payrollManualAdjustments.periodId, ids),
          isNull(payrollManualAdjustments.archivedAt),
        ),
      ),
  ]);
  return periods.map((period) => ({
    id: period.id,
    databaseId: period.id,
    name: period.name,
    startDate: period.startDate,
    endDate: period.endDate,
    cutoffDate: period.cutoffDate,
    paymentDate: period.paymentDate,
    status: period.status,
    ...(period.notes ? { notes: period.notes } : {}),
    compiledInputs: inputs
      .filter((item) => item.periodId === period.id)
      .map((item) => ({
        employeeId: item.employeeId,
        approvedOvertimeHours: Number(item.approvedOvertimeHours),
        unpaidLeaveDays: Number(item.unpaidLeaveDays),
        reimbursementsTotal: Number(item.reimbursementsTotal),
        reimbursementsCurrency: item.reimbursementsCurrency,
        manualAdjustmentsTotal: Number(item.manualAdjustmentsTotal),
        currency: item.currency,
      })),
    exceptions: exceptions
      .filter((item) => item.periodId === period.id)
      .map((item) => ({
        id: item.id,
        employeeId: item.employeeId,
        type: item.type as PayrollPeriod["exceptions"][number]["type"],
        description: item.description,
        severity: item.severity as "High" | "Medium" | "Low",
        acknowledged: item.acknowledged,
        ...(item.acknowledgementNotes ? { acknowledgementNotes: item.acknowledgementNotes } : {}),
      })),
    manualAdjustments: adjustments
      .filter((item) => item.periodId === period.id)
      .map((item) => ({
        id: item.id,
        periodId: item.periodId,
        employeeId: item.employeeId,
        type: item.type as "Allowance" | "Deduction" | "Correction",
        amount: Number(item.amount),
        currency: item.currency,
        reason: item.reason,
        ...(item.evidenceFileId ? { evidenceFileId: item.evidenceFileId } : {}),
        createdAt: item.createdAt.toISOString(),
        createdBy: item.createdBy,
      })),
    createdAt: period.createdAt.toISOString(),
    createdBy: period.createdBy,
    updatedAt: period.updatedAt.toISOString(),
    updatedBy: period.updatedBy,
    ...(period.archivedAt ? { archivedAt: period.archivedAt.toISOString() } : {}),
    recordVersion: period.recordVersion,
  }));
}

export async function listPayrollPeriodsInDatabase(org: string, actor: AuditActorContext) {
  requirePayroll(actor);
  const rows = await periodSnapshot(org);
  if (actor.userId)
    await getDatabaseClient()
      .insert(auditEvents)
      .values({
        organisationId: org,
        ...auditActor(actor),
        action: "view",
        module: "payroll",
        entityType: "payroll-period-register",
        entityId: org,
        afterSummary: { periodCount: rows.length },
        reason: "Viewed payroll periods",
        riskLevel: "High",
      } as typeof auditEvents.$inferInsert);
  return rows;
}

export async function createPayrollPeriodInDatabase(
  org: string,
  input: {
    name: string;
    startDate: string;
    endDate: string;
    cutoffDate: string;
    paymentDate: string;
    notes?: string;
  },
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  if (!input.name.trim()) throw new Error("Payroll period name is required.");
  if (
    input.startDate > input.endDate ||
    input.cutoffDate < input.startDate ||
    input.cutoffDate > input.paymentDate
  )
    throw new Error("Check the payroll start, end, cutoff and payment dates.");
  const id = randomUUID();
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [overlap] = await tx
      .select({ id: payrollPeriods.id })
      .from(payrollPeriods)
      .where(
        and(
          eq(payrollPeriods.organisationId, org),
          isNull(payrollPeriods.archivedAt),
          sql`${payrollPeriods.startDate} <= ${input.endDate}`,
          sql`${payrollPeriods.endDate} >= ${input.startDate}`,
        ),
      )
      .limit(1);
    if (overlap) throw new Error("This payroll period overlaps an existing period.");
    await tx.insert(payrollPeriods).values({
      id,
      organisationId: org,
      name: input.name.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      cutoffDate: input.cutoffDate,
      paymentDate: input.paymentDate,
      notes: input.notes?.trim(),
      status: "Draft",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof payrollPeriods.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "create",
      module: "payroll",
      entityType: "payroll-period",
      entityId: id,
      afterSummary: {
        name: input.name.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
      },
      reason: "Created a payroll period",
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function addPayrollAdjustmentInDatabase(
  org: string,
  periodId: string,
  input: {
    employeeId: string;
    type: "Allowance" | "Deduction" | "Correction";
    amount: number;
    currency: string;
    reason: string;
    evidenceFileId: string;
  },
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new Error("Adjustment amount must be greater than zero.");
  if (input.reason.trim().length < 3) throw new Error("A clear adjustment reason is required.");
  const db = getDatabaseClient();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (
      !period ||
      !["Draft", "Collecting Inputs", "Exceptions", "Corrected"].includes(period.status)
    )
      throw new Error("This payroll period no longer accepts adjustments.");
    const [employee] = await tx
      .select({ status: employees.status, payload: employeeCompensation.encryptedPayload })
      .from(employees)
      .leftJoin(employeeCompensation, eq(employeeCompensation.employeeId, employees.id))
      .where(and(eq(employees.organisationId, org), eq(employees.id, input.employeeId)))
      .limit(1);
    if (!employee || !["Active", "Probation", "Notice"].includes(employee.status))
      throw new Error("Select an active employee.");
    const salary = employee.payload
      ? decryptSensitiveJson<{ currency?: string }>(employee.payload)
      : undefined;
    const expectedCurrency = salary?.currency ?? "OMR";
    if (input.currency !== expectedCurrency)
      throw new Error(
        `Adjustment currency must match the employee salary currency (${expectedCurrency}).`,
      );
    const [evidence] = await tx
      .select({
        id: fileMetadata.id,
        ownerEntityType: fileMetadata.ownerEntityType,
        ownerEntityId: fileMetadata.ownerEntityId,
      })
      .from(fileMetadata)
      .where(
        and(
          eq(fileMetadata.organisationId, org),
          eq(fileMetadata.id, input.evidenceFileId),
          eq(fileMetadata.storageStatus, "Available"),
        ),
      )
      .limit(1);
    if (
      !evidence ||
      evidence.ownerEntityType !== "payroll-adjustment-evidence" ||
      evidence.ownerEntityId !== input.employeeId
    )
      throw new Error("Upload valid supporting evidence for this employee's adjustment.");
    await tx.insert(payrollManualAdjustments).values({
      id,
      organisationId: org,
      periodId,
      employeeId: input.employeeId,
      type: input.type,
      amount: String(input.amount),
      currency: input.currency,
      reason: input.reason.trim(),
      evidenceFileId: input.evidenceFileId,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof payrollManualAdjustments.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "adjust",
      module: "payroll",
      entityType: "payroll-adjustment",
      entityId: id,
      afterSummary: {
        periodId,
        employeeId: input.employeeId,
        type: input.type,
        amount: input.amount,
        currency: input.currency,
      },
      reason: input.reason.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function readPayrollAdjustmentEvidenceInDatabase(
  org: string,
  adjustmentId: string,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  const [adjustment] = await getDatabaseClient()
    .select({ evidenceFileId: payrollManualAdjustments.evidenceFileId })
    .from(payrollManualAdjustments)
    .where(
      and(
        eq(payrollManualAdjustments.organisationId, org),
        eq(payrollManualAdjustments.id, adjustmentId),
        isNull(payrollManualAdjustments.archivedAt),
      ),
    )
    .limit(1);
  if (!adjustment?.evidenceFileId)
    throw new Error("Supporting evidence is not available for this adjustment.");
  return readObjectFile(
    org,
    adjustment.evidenceFileId,
    {
      ...(actor.userId ? { userId: actor.userId } : {}),
      ...(actor.employeeId ? { employeeId: actor.employeeId } : {}),
      displayName: actor.displayName,
      activeRole: role(actor),
      ...(actor.roles ? { roles: actor.roles } : {}),
    },
    `Viewed supporting evidence for payroll adjustment ${adjustmentId}`,
  );
}

export async function collectPayrollInputsInDatabase(
  org: string,
  periodId: string,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (
      !period ||
      !["Draft", "Collecting Inputs", "Exceptions", "Corrected"].includes(period.status)
    )
      throw new Error("This payroll period cannot collect inputs.");
    const staff = await tx
      .select({
        id: employees.id,
        name: employees.preferredName,
        status: employees.status,
        startDate: employees.startDate,
        compensation: employeeCompensation.encryptedPayload,
        bank: employeeBankDetails.encryptedPayload,
      })
      .from(employees)
      .leftJoin(employeeCompensation, eq(employeeCompensation.employeeId, employees.id))
      .leftJoin(employeeBankDetails, eq(employeeBankDetails.employeeId, employees.id))
      .where(
        and(
          eq(employees.organisationId, org),
          inArray(employees.status, ["Active", "Probation", "Notice"]),
        ),
      );
    const adjustments = await tx
      .select()
      .from(payrollManualAdjustments)
      .where(
        and(
          eq(payrollManualAdjustments.organisationId, org),
          eq(payrollManualAdjustments.periodId, periodId),
          isNull(payrollManualAdjustments.archivedAt),
        ),
      );
    const overtime = await tx
      .select()
      .from(overtimeClaims)
      .where(
        and(
          eq(overtimeClaims.organisationId, org),
          eq(overtimeClaims.status, "Approved"),
          eq(overtimeClaims.compensationType, "Payment"),
          lte(overtimeClaims.date, period.endDate),
          or(isNull(overtimeClaims.payrollPeriodId), eq(overtimeClaims.payrollPeriodId, periodId)),
        ),
      );
    const travel = await tx
      .select({ request: travelRequests, reimbursement: reimbursements })
      .from(travelRequests)
      .innerJoin(reimbursements, eq(reimbursements.travelRequestId, travelRequests.id))
      .where(
        and(
          eq(travelRequests.organisationId, org),
          eq(travelRequests.status, "Closed"),
          lte(travelRequests.closedAt, `${period.endDate}T23:59:59.999Z`),
          or(isNull(travelRequests.payrollPeriodId), eq(travelRequests.payrollPeriodId, periodId)),
        ),
      );
    const unpaid = await tx
      .select({ employeeId: leaveRequests.employeeId, days: leaveRequests.workingDaysRequested })
      .from(leaveRequests)
      .innerJoin(leavePolicies, eq(leavePolicies.id, leaveRequests.policyId))
      .where(
        and(
          eq(leaveRequests.organisationId, org),
          inArray(leaveRequests.status, ["Approved", "Taken"]),
          eq(leavePolicies.isPaid, false),
          sql`${leaveRequests.startDate} <= ${period.endDate}`,
          sql`${leaveRequests.endDate} >= ${period.startDate}`,
        ),
      );
    const unresolvedTimesheets = await tx
      .select({ employeeId: timesheets.employeeId })
      .from(timesheets)
      .innerJoin(timesheetPeriods, eq(timesheetPeriods.id, timesheets.periodId))
      .where(
        and(
          eq(timesheets.organisationId, org),
          sql`${timesheetPeriods.startDate} <= ${period.endDate}`,
          sql`${timesheetPeriods.endDate} >= ${period.startDate}`,
          notInArray(timesheets.status, ["Approved", "Payroll Locked", "Corrected"]),
        ),
      );
    const pendingLeave = await tx
      .select({ employeeId: leaveRequests.employeeId })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.organisationId, org),
          inArray(leaveRequests.status, [
            "Pending Line Manager",
            "Pending HR",
            "Pending Super Admin",
            "Cancellation Pending",
            "Amendment Pending Line Manager",
            "Amendment Pending HR",
          ]),
          sql`${leaveRequests.startDate} <= ${period.endDate}`,
          sql`${leaveRequests.endDate} >= ${period.startDate}`,
        ),
      );
    const attendanceConflicts = await tx
      .select({ employeeId: attendanceExceptionCases.employeeId })
      .from(attendanceExceptionCases)
      .where(
        and(
          eq(attendanceExceptionCases.organisationId, org),
          inArray(attendanceExceptionCases.status, ["Open", "Investigating"]),
          sql`${attendanceExceptionCases.date} BETWEEN ${period.startDate} AND ${period.endDate}`,
        ),
      );
    const pendingTravel = await tx
      .select({ employeeId: travelRequests.employeeId })
      .from(travelRequests)
      .where(
        and(
          eq(travelRequests.organisationId, org),
          inArray(travelRequests.status, ["Pre-authorised", "Pending Super Admin Closure"]),
          lte(travelRequests.endDate, period.endDate),
        ),
      );
    const leavers = await tx
      .select({
        employeeId: offboardingCases.employeeId,
        lastWorkingDate: offboardingCases.lastWorkingDate,
      })
      .from(offboardingCases)
      .where(
        and(
          eq(offboardingCases.organisationId, org),
          notInArray(offboardingCases.status, ["Cancelled"]),
          sql`${offboardingCases.lastWorkingDate} BETWEEN ${period.startDate} AND ${period.endDate}`,
        ),
      );
    const expiredContracts = await tx
      .select({ employeeId: employeeDocuments.employeeId })
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.organisationId, org),
          eq(employeeDocuments.type, "contract"),
          isNull(employeeDocuments.replacedById),
          isNull(employeeDocuments.archivedAt),
          sql`${employeeDocuments.expiryDate} < ${period.endDate}`,
          notInArray(employeeDocuments.status, ["Rejected", "Replaced"]),
        ),
      );
    const acknowledged = await tx
      .select()
      .from(payrollExceptions)
      .where(
        and(
          eq(payrollExceptions.organisationId, org),
          eq(payrollExceptions.periodId, periodId),
          eq(payrollExceptions.acknowledged, true),
        ),
      );
    await tx
      .delete(payrollInputs)
      .where(and(eq(payrollInputs.organisationId, org), eq(payrollInputs.periodId, periodId)));
    await tx
      .delete(payrollExceptions)
      .where(
        and(
          eq(payrollExceptions.organisationId, org),
          eq(payrollExceptions.periodId, periodId),
          eq(payrollExceptions.acknowledged, false),
        ),
      );
    const inputs: (typeof payrollInputs.$inferInsert)[] = [];
    const exceptions: (typeof payrollExceptions.$inferInsert)[] = [];
    for (const employee of staff) {
      const employeeOvertime = overtime.filter((item) => item.employeeId === employee.id);
      const employeeTravel = travel.filter((item) => item.request.employeeId === employee.id);
      const employeeLeave = unpaid.filter((item) => item.employeeId === employee.id);
      const employeeAdjustments = adjustments.filter((item) => item.employeeId === employee.id);
      const salary = employee.compensation
        ? decryptSensitiveJson<{ currency?: string }>(employee.compensation)
        : undefined;
      const currency = salary?.currency ?? "OMR";
      const approvedOvertimeHours = employeeOvertime.reduce(
        (sum, item) => sum + Number(item.hours),
        0,
      );
      const unpaidLeaveDays = employeeLeave.reduce((sum, item) => sum + Number(item.days), 0);
      const reimbursementsTotal = employeeTravel.reduce(
        (sum, item) => sum + Number(item.reimbursement.amount),
        0,
      );
      const manualAdjustmentsTotal = employeeAdjustments.reduce(
        (sum, item) =>
          sum + (item.type === "Deduction" ? -Number(item.amount) : Number(item.amount)),
        0,
      );
      if (approvedOvertimeHours || unpaidLeaveDays || reimbursementsTotal || manualAdjustmentsTotal)
        inputs.push({
          organisationId: org,
          periodId,
          employeeId: employee.id,
          approvedOvertimeHours: String(approvedOvertimeHours),
          unpaidLeaveDays: String(unpaidLeaveDays),
          reimbursementsTotal: String(reimbursementsTotal),
          reimbursementsCurrency: "OMR",
          manualAdjustmentsTotal: String(manualAdjustmentsTotal),
          currency,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof payrollInputs.$inferInsert);
      const addException = (type: string, description: string, severity: "High" | "Medium") => {
        if (!acknowledged.some((item) => item.employeeId === employee.id && item.type === type))
          exceptions.push({
            organisationId: org,
            periodId,
            employeeId: employee.id,
            type,
            description,
            severity,
            acknowledged: false,
            createdBy: actor.userId,
            updatedBy: actor.userId,
          } as typeof payrollExceptions.$inferInsert);
      };
      if (!employee.bank)
        addException(
          "Missing Bank Data",
          "Employee bank details are missing or incomplete.",
          "High",
        );
      if (!salary?.currency || !/^[A-Z]{3}$/.test(salary.currency))
        addException(
          "Invalid Currency",
          "Employee salary currency is missing or invalid; payroll used the organisation fallback only for review.",
          "High",
        );
      if (expiredContracts.some((item) => item.employeeId === employee.id))
        addException(
          "Expired Contract",
          "The latest employee contract expires before this payroll period ends.",
          "High",
        );
      if (unresolvedTimesheets.some((item) => item.employeeId === employee.id))
        addException(
          "Missing Timesheet",
          "One or more timesheets overlapping this payroll period are not approved.",
          "Medium",
        );
      if (pendingLeave.some((item) => item.employeeId === employee.id))
        addException(
          "Pending Leave",
          "A leave request overlapping this payroll period is still awaiting a decision or amendment.",
          "Medium",
        );
      if (attendanceConflicts.some((item) => item.employeeId === employee.id))
        addException(
          "Attendance Conflict",
          "An unresolved attendance exception overlaps this payroll period.",
          "High",
        );
      if (pendingTravel.some((item) => item.employeeId === employee.id))
        addException(
          "Pending Travel",
          "A completed trip still requires expense submission or reimbursement closure.",
          "Medium",
        );
      const leaver = leavers.find((item) => item.employeeId === employee.id);
      if (employee.startDate >= period.startDate && employee.startDate <= period.endDate)
        addException(
          "Joiner / Leaver",
          `Employee joined on ${employee.startDate}; verify prorating before approval.`,
          "High",
        );
      if (leaver)
        addException(
          "Joiner / Leaver",
          `Employee's last working day is ${leaver.lastWorkingDate}; verify final-pay prorating and clearance.`,
          "High",
        );
      if (approvedOvertimeHours > 50)
        addException(
          "Extreme Value",
          `Approved overtime is unusually high at ${approvedOvertimeHours} hours; verify before approval.`,
          "High",
        );
      if (Math.abs(manualAdjustmentsTotal) > 10000)
        addException(
          "Extreme Value",
          `Manual adjustments total ${manualAdjustmentsTotal.toLocaleString()} ${currency}; verify the supporting evidence and approval.`,
          "High",
        );
      if (employeeOvertime.some((item) => item.date < period.startDate))
        addException(
          "Unmatched Overtime",
          "Approved overtime from an earlier payroll cycle was automatically carried into this period.",
          "Medium",
        );
      if (employeeTravel.some((item) => item.request.endDate < period.startDate))
        addException(
          "Unmatched Reimbursement",
          "A reimbursement for earlier travel was automatically carried into this period.",
          "Medium",
        );
    }
    if (inputs.length) await tx.insert(payrollInputs).values(inputs);
    if (exceptions.length) await tx.insert(payrollExceptions).values(exceptions);
    const overtimeIds = overtime.map((item) => item.id);
    if (overtimeIds.length)
      await tx
        .update(overtimeClaims)
        .set({
          payrollPeriodId: periodId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${overtimeClaims.recordVersion} + 1`,
        })
        .where(
          and(
            eq(overtimeClaims.organisationId, org),
            inArray(overtimeClaims.id, overtimeIds),
            isNull(overtimeClaims.payrollPeriodId),
          ),
        );
    const travelIds = travel.map((item) => item.request.id);
    if (travelIds.length) {
      await tx
        .update(travelRequests)
        .set({
          payrollPeriodId: periodId,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${travelRequests.recordVersion} + 1`,
        })
        .where(
          and(
            eq(travelRequests.organisationId, org),
            inArray(travelRequests.id, travelIds),
            isNull(travelRequests.payrollPeriodId),
          ),
        );
      await tx
        .update(reimbursements)
        .set({
          status: "Included in Payroll",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${reimbursements.recordVersion} + 1`,
        })
        .where(
          and(
            eq(reimbursements.organisationId, org),
            inArray(reimbursements.travelRequestId, travelIds),
          ),
        );
    }
    const status = exceptions.length ? "Exceptions" : "Prepared";
    await tx
      .update(payrollPeriods)
      .set({
        status,
        compiledInputs: [],
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${payrollPeriods.recordVersion} + 1`,
      })
      .where(eq(payrollPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "collect-inputs",
      module: "payroll",
      entityType: "payroll-period",
      entityId: periodId,
      afterSummary: {
        status,
        inputCount: inputs.length,
        exceptionCount: exceptions.length,
        overtimeClaims: overtimeIds.length,
        reimbursements: travelIds.length,
      },
      reason: "Collected and reconciled payroll inputs",
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function acknowledgePayrollExceptionInDatabase(
  org: string,
  periodId: string,
  exceptionId: string,
  notes: string,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  if (notes.trim().length < 5) throw new Error("Explain how the exception was resolved.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (!period || !["Exceptions", "Collecting Inputs"].includes(period.status))
      throw new Error("This payroll period is not resolving exceptions.");
    const [exception] = await tx
      .select()
      .from(payrollExceptions)
      .where(
        and(
          eq(payrollExceptions.organisationId, org),
          eq(payrollExceptions.periodId, periodId),
          eq(payrollExceptions.id, exceptionId),
        ),
      )
      .limit(1);
    if (!exception) throw new Error("Payroll exception not found.");
    if (exception.acknowledged) throw new Error("This exception has already been acknowledged.");
    const now = new Date().toISOString();
    await tx
      .update(payrollExceptions)
      .set({
        acknowledged: true,
        acknowledgementNotes: notes.trim(),
        acknowledgedBy: actor.userId,
        acknowledgedAt: now,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${payrollExceptions.recordVersion} + 1`,
      })
      .where(eq(payrollExceptions.id, exceptionId));
    const [remaining] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(payrollExceptions)
      .where(
        and(
          eq(payrollExceptions.organisationId, org),
          eq(payrollExceptions.periodId, periodId),
          eq(payrollExceptions.acknowledged, false),
          sql`${payrollExceptions.id} <> ${exceptionId}`,
        ),
      );
    if (Number(remaining?.count ?? 0) === 0)
      await tx
        .update(payrollPeriods)
        .set({
          status: "Prepared",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${payrollPeriods.recordVersion} + 1`,
        })
        .where(eq(payrollPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "acknowledge-exception",
      module: "payroll",
      entityType: "payroll-exception",
      entityId: exceptionId,
      afterSummary: { periodId, acknowledged: true },
      reason: notes.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function lockPayrollPeriodInDatabase(
  org: string,
  periodId: string,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (!period || period.status !== "Approved")
      throw new Error("Super Admin must approve the prepared period before it can be locked.");
    const [remaining] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(payrollExceptions)
      .where(
        and(
          eq(payrollExceptions.organisationId, org),
          eq(payrollExceptions.periodId, periodId),
          eq(payrollExceptions.acknowledged, false),
        ),
      );
    if (Number(remaining?.count ?? 0) > 0)
      throw new Error("Resolve every payroll exception before locking.");
    await tx
      .update(payrollPeriods)
      .set({
        status: "Locked",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${payrollPeriods.recordVersion} + 1`,
      })
      .where(eq(payrollPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "lock",
      module: "payroll",
      entityType: "payroll-period",
      entityId: periodId,
      beforeSummary: { status: period.status },
      afterSummary: { status: "Locked" },
      reason: "Locked payroll after reconciliation",
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function approvePayrollPeriodInDatabase(
  org: string,
  periodId: string,
  reason: string | undefined,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  if (role(actor) !== "Super Admin")
    throw new Error("Only Super Admin can approve a prepared payroll period.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (!period || period.status !== "Prepared")
      throw new Error("Only a prepared payroll period can be approved.");
    await tx
      .update(payrollPeriods)
      .set({
        status: "Approved",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${payrollPeriods.recordVersion} + 1`,
      })
      .where(eq(payrollPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "approve",
      module: "payroll",
      entityType: "payroll-period",
      entityId: periodId,
      beforeSummary: { status: "Prepared" },
      afterSummary: { status: "Approved" },
      reason: reason?.trim() || "Approved the prepared payroll input",
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function reopenPayrollPeriodInDatabase(
  org: string,
  periodId: string,
  reason: string,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  if (role(actor) !== "Super Admin") throw new Error("Only Super Admin can reopen payroll.");
  if (reason.trim().length < 5) throw new Error("Explain why payroll must be reopened.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (!period || !["Locked", "Exported"].includes(period.status))
      throw new Error("Only locked or exported payroll can be reopened.");
    await tx
      .update(payrollPeriods)
      .set({
        status: "Corrected",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${payrollPeriods.recordVersion} + 1`,
      })
      .where(eq(payrollPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "reopen",
      module: "payroll",
      entityType: "payroll-period",
      entityId: periodId,
      beforeSummary: { status: period.status },
      afterSummary: { status: "Corrected" },
      reason: reason.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function exportPayrollPeriodInDatabase(
  org: string,
  periodId: string,
  actor: AuditActorContext,
) {
  requirePayroll(actor);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from payroll_periods where organisation_id=${org} and id=${periodId} for update`,
    );
    const [period] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.organisationId, org), eq(payrollPeriods.id, periodId)))
      .limit(1);
    if (!period || !["Locked", "Exported"].includes(period.status))
      throw new Error("Lock the payroll period before export.");
    const rows = await tx
      .select({
        employeeId: payrollInputs.employeeId,
        employeeNumber: employees.employeeNumber,
        employeeName: employees.preferredName,
        overtime: payrollInputs.approvedOvertimeHours,
        leave: payrollInputs.unpaidLeaveDays,
        reimbursements: payrollInputs.reimbursementsTotal,
        reimbursementCurrency: payrollInputs.reimbursementsCurrency,
        adjustments: payrollInputs.manualAdjustmentsTotal,
        currency: payrollInputs.currency,
      })
      .from(payrollInputs)
      .innerJoin(employees, eq(employees.id, payrollInputs.employeeId))
      .where(
        and(
          eq(payrollInputs.organisationId, org),
          eq(payrollInputs.periodId, periodId),
          isNull(payrollInputs.archivedAt),
        ),
      )
      .orderBy(employees.employeeNumber);
    const csv = [
      [
        "Employee Number",
        "Employee",
        "Overtime Hours",
        "Unpaid Leave Days",
        "Reimbursements",
        "Reimbursement Currency",
        "Manual Adjustments",
        "Adjustment Currency",
      ],
      ...rows.map((item) => [
        item.employeeNumber,
        item.employeeName,
        item.overtime,
        item.leave,
        item.reimbursements,
        item.reimbursementCurrency,
        item.adjustments,
        item.currency,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    if (period.status !== "Exported")
      await tx
        .update(payrollPeriods)
        .set({
          status: "Exported",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${payrollPeriods.recordVersion} + 1`,
        })
        .where(eq(payrollPeriods.id, periodId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      ...auditActor(actor),
      action: "export",
      module: "payroll",
      entityType: "payroll-period",
      entityId: periodId,
      afterSummary: { rowCount: rows.length, status: "Exported" },
      reason: `Exported payroll ${period.name}`,
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
    return csv;
  });
}
