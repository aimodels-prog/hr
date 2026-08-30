import { SYSTEM_CONTEXT } from "./types.ts";
import { LocalRepository, type NewRecord } from "./repository.ts";
import type {
  PayrollPeriod,
  PayrollPeriodStatus,
  PayrollManualAdjustment,
  PayrollInputReport,
  PayrollException,
} from "./payroll-types.ts";
import type { ActorContext } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";
import { TimesheetService } from "./timesheet-service.ts";
import { OvertimeService } from "./overtime-service.ts";
import { TravelService } from "./travel-service.ts";
import { LeaveService } from "./leave-service.ts";
import { isWithinInterval, parseISO } from "date-fns";
import { getApplicationDataServices } from "./application-data.ts";
import { getRolePermissions, type Permission } from "../auth/permissions.ts";
import { recordAccessDenied } from "./audit-service.ts";

const generateId = () => Math.random().toString(36).substring(2, 9);

function escapeCsvCell(value: string): string {
  const protectedValue = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

// Matches the shape LeaveService.getSickLeavePayBreakdown returns, expected to be persisted on
// LeaveRequest as an optional `sickPayTiers` field at submission time.
interface SickPayTierBreakdown {
  fromDay: number;
  toDay: number;
  payPercentage: number;
  days: number;
}

export class PayrollService {
  private repo: LocalRepository<PayrollPeriod>;
  private empService = new EmployeeService();
  private timesheetService = new TimesheetService();
  private overtimeService = new OvertimeService();
  private travelService = new TravelService();
  private leaveService = new LeaveService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.repo = new LocalRepository<PayrollPeriod>("payrollPeriods", storage, audit, {
      module: "payroll",
      entityType: "payroll-period",
    });
  }

  private requirePermission(
    permission: Permission,
    context: ActorContext,
    action: string,
    entityId: string,
  ): void {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole && getRolePermissions(activeRole).has(permission)) return;
    recordAccessDenied(getApplicationDataServices().audit, {
      module: "payroll",
      entityType: "payroll-period",
      entityId,
      action: `Payroll ${action} denied`,
      context,
    });
    throw new Error(`You are not authorised to ${action}.`);
  }

  private auditView(context: ActorContext, entityId: string, description: string): void {
    if (context.actor.userId === "system") return;
    getApplicationDataServices().audit.record({
      context,
      action: "payroll_viewed",
      module: "payroll",
      entityType: "payroll-period",
      entityId,
      reason: description,
      riskLevel: "High",
    });
  }

  getAllPeriods(context: ActorContext): PayrollPeriod[] {
    this.requirePermission("payroll:view", context, "view payroll periods", "all");
    this.auditView(context, "all", "Viewed the payroll-period register.");
    return this.repo.list();
  }

  getPeriodById(id: string, context: ActorContext): PayrollPeriod | null {
    this.requirePermission("payroll:view", context, "view this payroll period", id);
    const period = this.repo.getById(id);
    if (period) this.auditView(context, id, `Viewed payroll period ${period.name}.`);
    return period;
  }

  createPeriod(
    data: Omit<NewRecord<PayrollPeriod>, "status" | "exceptions" | "manualAdjustments">,
    context: ActorContext,
  ): PayrollPeriod {
    this.requirePermission("payroll:prepare", context, "create payroll periods", "new");
    const dateValues = [data.startDate, data.endDate, data.cutoffDate, data.paymentDate];
    if (dateValues.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      throw new Error("Enter valid start, end, cutoff and payment dates.");
    }
    if (data.startDate > data.endDate)
      throw new Error("Payroll end date cannot precede its start date.");
    if (data.cutoffDate < data.startDate || data.cutoffDate > data.paymentDate) {
      throw new Error(
        "Payroll cutoff must fall on or after the period start and no later than payment.",
      );
    }
    if (!data.name.trim()) throw new Error("Payroll period name is required.");
    return this.repo.create(
      {
        ...data,
        status: "Draft",
        exceptions: [],
        manualAdjustments: [],
      },
      context,
    );
  }

  addManualAdjustment(
    periodId: string,
    adjustment: Omit<PayrollManualAdjustment, "id" | "periodId" | "createdAt" | "createdBy">,
    context: ActorContext,
  ): PayrollPeriod {
    this.requirePermission("payroll:prepare", context, "add payroll adjustments", periodId);
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");
    if (period.status !== "Collecting Inputs" && period.status !== "Exceptions") {
      throw new Error("Cannot add manual adjustments in this state.");
    }

    // The compiled row for this employee is otherwise entirely in their real salary currency, so an
    // adjustment recorded in any other currency would be silently wrong (e.g. a 50 OMR bonus exported
    // as 50 GBP). Reject mismatches here so this can't be bypassed even by a future direct caller.
    const employee = this.empService.getById(adjustment.employeeId, SYSTEM_CONTEXT);
    if (!employee || employee.archivedAt || ["Inactive", "Archived"].includes(employee.status)) {
      throw new Error("Select an active employee for this adjustment.");
    }
    if (!Number.isFinite(adjustment.amount) || adjustment.amount <= 0) {
      throw new Error("Adjustment amount must be greater than zero.");
    }
    if (adjustment.reason.trim().length < 3) {
      throw new Error("A clear reason is required for every payroll adjustment.");
    }
    const expectedCurrency = employee.salary?.currency || "OMR";
    if (adjustment.currency !== expectedCurrency) {
      throw new Error(
        `Adjustment currency (${adjustment.currency}) does not match the employee's salary currency (${expectedCurrency}).`,
      );
    }

    period.manualAdjustments.push({
      ...adjustment,
      id: generateId(),
      periodId,
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
    });

    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  collectInputs(periodId: string, context: ActorContext): PayrollPeriod {
    this.requirePermission("payroll:prepare", context, "collect payroll inputs", periodId);
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");
    if (
      period.status !== "Draft" &&
      period.status !== "Collecting Inputs" &&
      period.status !== "Exceptions"
    ) {
      throw new Error("Cannot collect inputs for this period status.");
    }

    const employees = this.empService.getEmployees(SYSTEM_CONTEXT);
    const interval = { start: parseISO(period.startDate), end: parseISO(period.endDate) };

    const compiledInputs: PayrollInputReport[] = [];
    const exceptions: PayrollException[] = [];
    const includedOvertimeClaimIds: string[] = [];
    const includedTravelRequestIds: string[] = [];
    // Read each organisation-wide source once. Besides avoiding repeated work, this creates one
    // meaningful audited payroll read per source instead of one audit event per employee.
    const payrollOvertime = this.overtimeService.getAllClaims(context);
    const payrollLeave = this.leaveService.getPayrollLeaveRequests(context);
    const payrollTravel = this.travelService.getAllRequests(context);
    const timesheetPeriods = this.timesheetService.getPeriods();

    // Scan all employees
    for (const emp of employees) {
      // Missing Timesheet Check (simplified logic: check if they have a missing/draft timesheet spanning the period)
      // Since timesheets are weekly, we'll just query the timesheet service and see if any periods overlapping this one are missing/late.
      // For demonstration:

      const overtime = payrollOvertime.filter(
        (r) =>
          r.employeeId === emp.id &&
          r.status === "Approved" &&
          r.compensationType === "Payment" &&
          (r.payrollPeriodId === period.id ||
            (!r.payrollPeriodId && parseISO(r.date) <= interval.end)),
      );
      includedOvertimeClaimIds.push(...overtime.map((claim) => claim.id));
      const carriedOverOvertime = overtime.filter((claim) => claim.date < period.startDate);

      const unpaidLeaves = payrollLeave.filter(
        (r) =>
          r.employeeId === emp.id &&
          (r.status === "Approved" || r.status === "Taken") &&
          r.policySnapshot.isPaid === false &&
          isWithinInterval(parseISO(r.startDate), interval),
      );

      // Sick leave (policySnapshot.isPaid === true) is not flat-rate paid: Labour Law Art. 82 tiers the
      // pay percentage down (100% / 75% / 50% / 35%) the longer sick leave runs across the year. A request
      // that has a persisted sickPayTiers breakdown (see LeaveRequest / LeaveService.getSickLeavePayBreakdown)
      // must be reduced proportionally instead of being compiled as if fully paid.
      const sickLeaves = payrollLeave.filter(
        (r) =>
          r.employeeId === emp.id &&
          (r.status === "Approved" || r.status === "Taken") &&
          r.policySnapshot.type === "Sick" &&
          isWithinInterval(parseISO(r.startDate), interval),
      );

      let sickPartialUnpaidDays = 0;
      for (const sick of sickLeaves) {
        const tiers = (sick as unknown as { sickPayTiers?: SickPayTierBreakdown[] }).sickPayTiers;
        if (!tiers || tiers.length === 0) continue; // no persisted tier data yet - fall back to the flat isPaid=true default

        // Any portion of the request not covered by the persisted tier breakdown (stale/partial data) is
        // conservatively left at the flat fully-paid default rather than guessed at.
        const tierUnpaidDays = tiers.reduce(
          (sum, t) => sum + t.days * (1 - t.payPercentage / 100),
          0,
        );
        sickPartialUnpaidDays += tierUnpaidDays;
      }
      sickPartialUnpaidDays = Math.round(sickPartialUnpaidDays * 100) / 100;

      const allClosedTravels = payrollTravel.filter(
        (r) => r.employeeId === emp.id && r.status === "Closed",
      );

      // A closed reimbursement belongs to the first payroll period collected after closure,
      // not necessarily the period containing the trip end date. Legacy records without
      // closedAt use endDate as the safest available eligibility date.
      const travels = allClosedTravels.filter((request) => {
        if (request.payrollPeriodId === period.id) return true;
        if (request.payrollPeriodId) return false;
        const eligibilityDate = (request.closedAt ?? request.endDate).slice(0, 10);
        return eligibilityDate <= period.endDate;
      });
      const verifiedTravels = travels.filter((request) => request.actualTotalOmr !== undefined);
      includedTravelRequestIds.push(...verifiedTravels.map((request) => request.id));
      const carriedOverTravels = verifiedTravels.filter(
        (request) => (request.closedAt ?? request.endDate).slice(0, 10) < period.startDate,
      );

      const adj = period.manualAdjustments.filter((m) => m.employeeId === emp.id);

      const otHours = overtime.reduce((sum, r) => sum + r.hours, 0);
      const leaveDays =
        unpaidLeaves.reduce((sum, r) => sum + r.workingDaysRequested, 0) + sickPartialUnpaidDays;
      // Must use the currency-safe OMR-equivalent total (see TravelService.submitExpenses), not the raw
      // actualTotal, which silently mixes currencies for trips whose expense lines aren't all in OMR.
      // Records closed before actualTotalOmr existed won't have it - those are flagged below rather than
      // silently falling back to the (possibly foreign-currency) actualTotal.
      const travelsMissingOmrTotal = travels.filter(
        (r) => r.actualTotalOmr === undefined && (r.actualTotal || 0) > 0,
      );
      const travelTotal = verifiedTravels.reduce((sum, r) => sum + (r.actualTotalOmr ?? 0), 0);
      const adjTotal = adj.reduce(
        (sum, r) => (r.type === "Deduction" ? sum - r.amount : sum + r.amount),
        0,
      );

      // Exception Detection
      if (otHours > 50) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Extreme Value",
          description: `Extremely high approved overtime hours detected: ${otHours} hours.`,
          severity: "High",
          acknowledged: false,
        });
      }
      if (carriedOverOvertime.length > 0) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Unmatched Overtime",
          description: `${carriedOverOvertime.length} approved overtime claim${carriedOverOvertime.length === 1 ? " was" : "s were"} approved after an earlier payroll period and carried into this period (${carriedOverOvertime.map((claim) => claim.date).join(", ")}).`,
          severity: "Medium",
          acknowledged: false,
        });
      }

      if (!emp.bankDetails?.iban && !emp.bankDetails?.accountNumber) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Missing Bank Data",
          description: "Employee bank details are missing or incomplete.",
          severity: "High",
          acknowledged: false,
        });
      }

      // Missing Timesheet: any timesheet period overlapping this payroll period that isn't
      // Approved/Payroll Locked/Corrected by now means payroll can't rely on it yet.
      const employeeTimesheets = this.timesheetService.getTimesheetsForEmployee(emp.id, context);
      const overlappingUnresolved = employeeTimesheets.filter((ts) => {
        const tsPeriod = timesheetPeriods.find((p) => p.id === ts.periodId);
        if (!tsPeriod) return false;
        const overlaps =
          isWithinInterval(parseISO(tsPeriod.startDate), interval) ||
          isWithinInterval(parseISO(tsPeriod.endDate), interval);
        if (!overlaps) return false;
        return (
          ts.status !== "Approved" && ts.status !== "Payroll Locked" && ts.status !== "Corrected"
        );
      });
      if (overlappingUnresolved.length > 0) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Missing Timesheet",
          description: `${overlappingUnresolved.length} timesheet(s) for this period are not yet approved.`,
          severity: "Medium",
          acknowledged: false,
        });
      }

      if (sickPartialUnpaidDays > 0) {
        const tierDescriptions = sickLeaves
          .map(
            (sick) => (sick as unknown as { sickPayTiers?: SickPayTierBreakdown[] }).sickPayTiers,
          )
          .filter((tiers): tiers is SickPayTierBreakdown[] => !!tiers && tiers.length > 0)
          .flat()
          .map((t) => `days ${t.fromDay}-${t.toDay} @ ${t.payPercentage}%`)
          .join(", ");
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          // Reusing the closest existing leave-related category so this doesn't collide (by
          // type+employeeId) with the unrelated "Extreme Value" overtime exception above.
          type: "Pending Leave",
          description: `Sick leave partial-pay tiering applied (${tierDescriptions}). Compiled unpaid-leave-equivalent increased by ${sickPartialUnpaidDays} day(s) to reflect the blended pay percentage - verify before running payroll.`,
          severity: "Medium",
          acknowledged: false,
        });
      }

      if (travelsMissingOmrTotal.length > 0) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Unmatched Reimbursement",
          description: `${travelsMissingOmrTotal.length} closed travel request(s) (IDs: ${travelsMissingOmrTotal.map((t) => t.id).join(", ")}) were closed before currency-safe OMR conversion existed and have no verified OMR total. They have been excluded from payroll; verify and correct the OMR amount before collecting again.`,
          severity: "High",
          acknowledged: false,
        });
      }

      if (carriedOverTravels.length > 0) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Unmatched Reimbursement",
          description: `${carriedOverTravels.length} reimbursement${carriedOverTravels.length === 1 ? " was" : "s were"} closed after an earlier payroll cycle and automatically carried into this period (${carriedOverTravels.map((request) => request.id).join(", ")}).`,
          severity: "Medium",
          acknowledged: false,
        });
      }

      const currency = emp.salary?.currency || "OMR";

      if (otHours > 0 || leaveDays > 0 || travelTotal > 0 || adjTotal !== 0) {
        compiledInputs.push({
          employeeId: emp.id,
          approvedOvertimeHours: otHours,
          unpaidLeaveDays: leaveDays,
          reimbursementsTotal: travelTotal,
          reimbursementsCurrency: "OMR",
          manualAdjustmentsTotal: adjTotal,
          currency,
        });
      }
    }

    period.compiledInputs = compiledInputs;

    // Merge unacknowledged new exceptions with existing acknowledged ones
    const newExceptions = exceptions.filter(
      (e) => !period.exceptions.some((ex) => ex.employeeId === e.employeeId && ex.type === e.type),
    );
    period.exceptions = [...period.exceptions, ...newExceptions];

    period.status = period.exceptions.some((e) => !e.acknowledged) ? "Exceptions" : "Prepared";
    period.updatedAt = new Date().toISOString();
    // A payroll period and its source-claim assignments are two collections in the browser
    // prototype. Commit them as one recoverable operation so a quota/audit failure cannot leave
    // the period showing hours whose claims still look unprocessed (or the reverse).
    const { storage, audit } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      const updated = this.repo.update(period.id, period, context);
      this.overtimeService.markIncludedInPayroll(includedOvertimeClaimIds, period.id, context);
      this.travelService.markIncludedInPayroll(includedTravelRequestIds, period.id, context);
      return updated;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      try {
        audit.record({
          context,
          action: "payroll_input_collection_rolled_back",
          module: "payroll",
          entityType: "payroll-period",
          entityId: period.id,
          reason: `Payroll input collection was not completed and all local changes were restored: ${error instanceof Error ? error.message : "unknown error"}.`,
          riskLevel: "High",
        });
      } catch {
        // Best effort only: preserve the original collection error for the caller.
      }
      throw error;
    }
  }

  acknowledgeException(
    periodId: string,
    exceptionId: string,
    notes: string,
    context: ActorContext,
  ): PayrollPeriod {
    this.requirePermission("payroll:prepare", context, "resolve payroll exceptions", periodId);
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");

    const ex = period.exceptions.find((e) => e.id === exceptionId);
    if (!ex) throw new Error("Exception not found");
    if (notes.trim().length < 5)
      throw new Error("Explain how this payroll exception was resolved.");

    ex.acknowledged = true;
    ex.acknowledgementNotes = notes;

    // Check if we can move to Prepared
    if (!period.exceptions.some((e) => !e.acknowledged)) {
      period.status = "Prepared";
    }

    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  lockPeriod(periodId: string, context: ActorContext): PayrollPeriod {
    this.requirePermission("payroll:lock", context, "lock payroll periods", periodId);
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");

    if (period.status !== "Prepared" && period.status !== "Approved") {
      throw new Error("Period must be prepared or approved before locking.");
    }

    if (period.exceptions.some((e) => !e.acknowledged)) {
      throw new Error("All exceptions must be acknowledged before locking.");
    }

    period.status = "Locked";
    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  exportCsv(periodId: string, context: ActorContext): string {
    this.requirePermission("payroll:export", context, "export payroll data", periodId);
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");

    if (period.status !== "Locked" && period.status !== "Exported") {
      throw new Error("Period must be locked to export the final CSV.");
    }

    const rows = [
      [
        "Employee ID",
        "Employee Name",
        "Overtime Hours",
        "Unpaid Leave Days",
        "Reimbursements",
        "Reimbursement Currency",
        "Manual Adjustments",
        "Adjustment Currency",
      ],
    ];

    period.compiledInputs?.forEach((input) => {
      const emp = this.empService.getById(input.employeeId, SYSTEM_CONTEXT);
      rows.push([
        input.employeeId,
        emp ? emp.preferredName : "Unknown",
        input.approvedOvertimeHours.toString(),
        input.unpaidLeaveDays.toString(),
        input.reimbursementsTotal.toString(),
        input.reimbursementsCurrency || "OMR",
        input.manualAdjustmentsTotal.toString(),
        input.currency,
      ]);
    });

    period.status = "Exported";
    this.repo.update(period.id, period, context);

    getApplicationDataServices().audit.record({
      context,
      action: "payroll_exported",
      module: "payroll",
      entityType: "payroll-period",
      entityId: period.id,
      reason: `Exported ${period.compiledInputs?.length ?? 0} payroll input row(s) for ${period.name}.`,
      riskLevel: "Critical",
    });

    return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
  }
}
