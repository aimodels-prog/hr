import { LocalRepository, type NewRecord } from "./repository";
import type { PayrollPeriod, PayrollPeriodStatus, PayrollManualAdjustment, PayrollInputReport, PayrollException } from "./payroll-types";
import type { ActorContext } from "./types";
import { EmployeeService } from "./employee-service";
import { TimesheetService } from "./timesheet-service";
import { OvertimeService } from "./overtime-service";
import { TravelService } from "./travel-service";
import { LeaveService } from "./leave-service";
import { isWithinInterval, parseISO } from "date-fns";
import { getApplicationDataServices } from "./application-data";

const generateId = () => Math.random().toString(36).substring(2, 9);

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
    this.repo = new LocalRepository<PayrollPeriod>("payrollPeriods", storage, audit, { module: "payroll", entityType: "payroll-period" });
  }

  getAllPeriods(): PayrollPeriod[] {
    return this.repo.list();
  }

  getPeriodById(id: string): PayrollPeriod | null {
    return this.repo.getById(id);
  }

  createPeriod(data: Omit<NewRecord<PayrollPeriod>, "status" | "exceptions" | "manualAdjustments">, context: ActorContext): PayrollPeriod {
    return this.repo.create({
      ...data,
      status: "Draft",
      exceptions: [],
      manualAdjustments: [],
    }, context);
  }

  addManualAdjustment(periodId: string, adjustment: Omit<PayrollManualAdjustment, "id" | "createdAt" | "createdBy">, context: ActorContext): PayrollPeriod {
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");
    if (period.status !== "Collecting Inputs" && period.status !== "Exceptions") {
      throw new Error("Cannot add manual adjustments in this state.");
    }

    // The compiled row for this employee is otherwise entirely in their real salary currency, so an
    // adjustment recorded in any other currency would be silently wrong (e.g. a 50 OMR bonus exported
    // as 50 GBP). Reject mismatches here so this can't be bypassed even by a future direct caller.
    const employee = this.empService.getById(adjustment.employeeId);
    if (!employee) throw new Error("Employee not found.");
    const expectedCurrency = employee.salary?.currency || "OMR";
    if (adjustment.currency !== expectedCurrency) {
      throw new Error(
        `Adjustment currency (${adjustment.currency}) does not match the employee's salary currency (${expectedCurrency}).`
      );
    }

    period.manualAdjustments.push({
      ...adjustment,
      id: generateId(),
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
    });

    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  collectInputs(periodId: string, context: ActorContext): PayrollPeriod {
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");
    if (period.status !== "Draft" && period.status !== "Collecting Inputs" && period.status !== "Exceptions") {
      throw new Error("Cannot collect inputs for this period status.");
    }

    const employees = this.empService.getEmployees();
    const interval = { start: parseISO(period.startDate), end: parseISO(period.endDate) };

    const compiledInputs: PayrollInputReport[] = [];
    const exceptions: PayrollException[] = [];

    // Scan all employees
    for (const emp of employees) {
      // Missing Timesheet Check (simplified logic: check if they have a missing/draft timesheet spanning the period)
      // Since timesheets are weekly, we'll just query the timesheet service and see if any periods overlapping this one are missing/late.
      // For demonstration:
      
      const overtime = this.overtimeService.getAllClaims(context).filter(
        r => r.employeeId === emp.id && r.status === "Approved" && isWithinInterval(parseISO(r.date), interval)
      );

      const unpaidLeaves = this.leaveService.getAllRequests().filter(
         r => r.employeeId === emp.id && (r.status === "Approved" || r.status === "Taken") && r.policySnapshot.isPaid === false && isWithinInterval(parseISO(r.startDate), interval)
      );

      // Sick leave (policySnapshot.isPaid === true) is not flat-rate paid: Labour Law Art. 82 tiers the
      // pay percentage down (100% / 75% / 50% / 35%) the longer sick leave runs across the year. A request
      // that has a persisted sickPayTiers breakdown (see LeaveRequest / LeaveService.getSickLeavePayBreakdown)
      // must be reduced proportionally instead of being compiled as if fully paid.
      const sickLeaves = this.leaveService.getAllRequests().filter(
         r => r.employeeId === emp.id && (r.status === "Approved" || r.status === "Taken") && r.policySnapshot.type === "Sick" && isWithinInterval(parseISO(r.startDate), interval)
      );

      let sickPartialUnpaidDays = 0;
      for (const sick of sickLeaves) {
        const tiers = (sick as unknown as { sickPayTiers?: SickPayTierBreakdown[] }).sickPayTiers;
        if (!tiers || tiers.length === 0) continue; // no persisted tier data yet - fall back to the flat isPaid=true default

        // Any portion of the request not covered by the persisted tier breakdown (stale/partial data) is
        // conservatively left at the flat fully-paid default rather than guessed at.
        const tierUnpaidDays = tiers.reduce((sum, t) => sum + t.days * (1 - t.payPercentage / 100), 0);
        sickPartialUnpaidDays += tierUnpaidDays;
      }
      sickPartialUnpaidDays = Math.round(sickPartialUnpaidDays * 100) / 100;

      const allClosedTravels = this.travelService.getAllRequests(context).filter(
         r => r.employeeId === emp.id && r.status === "Closed"
      );

      const travels = allClosedTravels.filter(r => isWithinInterval(parseISO(r.endDate), interval));

      // Travel closure (expense submission -> review -> Super Admin closure) necessarily happens after the
      // trip's endDate, sometimes after the payroll period covering that endDate has already locked. Since
      // TravelRequest has no closedAt-style timestamp to re-key the match on, detect requests whose endDate
      // is in the past relative to this period and that were never captured by any period whose date window
      // did cover that endDate, and raise a visible exception instead of letting the reimbursement vanish.
      const otherPeriods = this.repo.list().filter(p => p.id !== period.id);
      const unmatchedTravels = allClosedTravels.filter(t => {
        const tripEnd = parseISO(t.endDate);
        if (isWithinInterval(tripEnd, interval)) return false; // captured by the normal match above
        const coveringPeriod = otherPeriods.find(p => {
          try {
            return isWithinInterval(tripEnd, { start: parseISO(p.startDate), end: parseISO(p.endDate) });
          } catch {
            return false;
          }
        });
        const alreadyCaptured = !!coveringPeriod?.compiledInputs?.some(
          ci => ci.employeeId === emp.id && ci.reimbursementsTotal > 0
        );
        return !alreadyCaptured;
      });

      const adj = period.manualAdjustments.filter(m => m.employeeId === emp.id);

      const otHours = overtime.reduce((sum, r) => sum + r.hours, 0);
      const leaveDays = unpaidLeaves.reduce((sum, r) => sum + r.workingDaysRequested, 0) + sickPartialUnpaidDays;
      // Must use the currency-safe OMR-equivalent total (see TravelService.submitExpenses), not the raw
      // actualTotal, which silently mixes currencies for trips whose expense lines aren't all in OMR.
      // Records closed before actualTotalOmr existed won't have it - those are flagged below rather than
      // silently falling back to the (possibly foreign-currency) actualTotal.
      const travelsMissingOmrTotal = travels.filter(r => r.actualTotalOmr === undefined && (r.actualTotal || 0) > 0);
      const travelTotal = travels.reduce((sum, r) => sum + (r.actualTotalOmr ?? r.actualTotal ?? 0), 0);
      const adjTotal = adj.reduce((sum, r) => r.type === "Deduction" ? sum - r.amount : sum + r.amount, 0);

      // Exception Detection
      if (otHours > 50) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Extreme Value",
          description: `Extremely high approved overtime hours detected: ${otHours} hours.`,
          severity: "High",
          acknowledged: false
        });
      }

      if (!emp.bankDetails?.iban && !emp.bankDetails?.accountNumber) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Missing Bank Data",
          description: "Employee bank details are missing or incomplete.",
          severity: "High",
          acknowledged: false
        });
      }

      // Missing Timesheet: any timesheet period overlapping this payroll period that isn't
      // Approved/Payroll Locked/Corrected by now means payroll can't rely on it yet.
      const employeeTimesheets = this.timesheetService.getTimesheetsForEmployee(emp.id);
      const allPeriods = this.timesheetService.getPeriods();
      const overlappingUnresolved = employeeTimesheets.filter(ts => {
        const tsPeriod = allPeriods.find(p => p.id === ts.periodId);
        if (!tsPeriod) return false;
        const overlaps = isWithinInterval(parseISO(tsPeriod.startDate), interval) || isWithinInterval(parseISO(tsPeriod.endDate), interval);
        if (!overlaps) return false;
        return ts.status !== "Approved" && ts.status !== "Payroll Locked" && ts.status !== "Corrected";
      });
      if (overlappingUnresolved.length > 0) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Missing Timesheet",
          description: `${overlappingUnresolved.length} timesheet(s) for this period are not yet approved.`,
          severity: "Medium",
          acknowledged: false
        });
      }

      if (sickPartialUnpaidDays > 0) {
        const tierDescriptions = sickLeaves
          .map(sick => (sick as unknown as { sickPayTiers?: SickPayTierBreakdown[] }).sickPayTiers)
          .filter((tiers): tiers is SickPayTierBreakdown[] => !!tiers && tiers.length > 0)
          .flat()
          .map(t => `days ${t.fromDay}-${t.toDay} @ ${t.payPercentage}%`)
          .join(", ");
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          // Reusing the closest existing leave-related category so this doesn't collide (by
          // type+employeeId) with the unrelated "Extreme Value" overtime exception above.
          type: "Pending Leave",
          description: `Sick leave partial-pay tiering applied (${tierDescriptions}). Compiled unpaid-leave-equivalent increased by ${sickPartialUnpaidDays} day(s) to reflect the blended pay percentage - verify before running payroll.`,
          severity: "Medium",
          acknowledged: false
        });
      }

      if (travelsMissingOmrTotal.length > 0) {
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          type: "Unmatched Reimbursement" as PayrollException["type"],
          description: `${travelsMissingOmrTotal.length} closed travel request(s) (IDs: ${travelsMissingOmrTotal.map(t => t.id).join(", ")}) were closed before currency-safe OMR conversion existed and have no actualTotalOmr recorded. Their raw actualTotal (which may be in a foreign currency) was used as a fallback - verify the OMR amount manually before running payroll.`,
          severity: "High",
          acknowledged: false
        });
      }

      if (unmatchedTravels.length > 0) {
        const totalAmount = unmatchedTravels.reduce((sum, t) => sum + (t.actualTotalOmr ?? t.actualTotal ?? 0), 0);
        exceptions.push({
          id: generateId(),
          employeeId: emp.id,
          // No dedicated exception category exists yet for "closed travel request never captured by any
          // payroll period" (payroll-types.ts is out of scope for this fix) - reusing the closest existing
          // category here; the description carries the actionable detail.
          type: "Unmatched Reimbursement" as PayrollException["type"],
          description: `${unmatchedTravels.length} closed travel request(s) (trip end date(s): ${unmatchedTravels.map(t => t.endDate).join(", ")}; IDs: ${unmatchedTravels.map(t => t.id).join(", ")}) totalling ${totalAmount} were closed too late to fall inside any payroll period's date window and were never compiled into a period. Accounts must apply this reimbursement manually.`,
          severity: "Medium",
          acknowledged: false
        });
      }

      const currency = emp.salary?.currency || "OMR";

      if (otHours > 0 || leaveDays > 0 || travelTotal > 0 || adjTotal !== 0) {
         compiledInputs.push({
           employeeId: emp.id,
           approvedOvertimeHours: otHours,
           unpaidLeaveDays: leaveDays,
           reimbursementsTotal: travelTotal,
           manualAdjustmentsTotal: adjTotal,
           currency
         });
      }
    }

    period.compiledInputs = compiledInputs;
    
    // Merge unacknowledged new exceptions with existing acknowledged ones
    const newExceptions = exceptions.filter(e => !period.exceptions.some(ex => ex.employeeId === e.employeeId && ex.type === e.type));
    period.exceptions = [...period.exceptions, ...newExceptions];

    period.status = period.exceptions.some(e => !e.acknowledged) ? "Exceptions" : "Prepared";
    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  acknowledgeException(periodId: string, exceptionId: string, notes: string, context: ActorContext): PayrollPeriod {
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");
    
    const ex = period.exceptions.find(e => e.id === exceptionId);
    if (!ex) throw new Error("Exception not found");

    ex.acknowledged = true;
    ex.acknowledgementNotes = notes;

    // Check if we can move to Prepared
    if (!period.exceptions.some(e => !e.acknowledged)) {
      period.status = "Prepared";
    }

    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  lockPeriod(periodId: string, context: ActorContext): PayrollPeriod {
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");
    
    if (period.status !== "Prepared" && period.status !== "Approved") {
      throw new Error("Period must be prepared or approved before locking.");
    }

    if (period.exceptions.some(e => !e.acknowledged)) {
       throw new Error("All exceptions must be acknowledged before locking.");
    }

    period.status = "Locked";
    period.updatedAt = new Date().toISOString();
    return this.repo.update(period.id, period, context);
  }

  exportCsv(periodId: string, context: ActorContext): string {
    const period = this.repo.getById(periodId);
    if (!period) throw new Error("Not found");

    if (period.status !== "Locked" && period.status !== "Exported") {
      throw new Error("Period must be locked to export the final CSV.");
    }

    const rows = [
      ["Employee ID", "Employee Name", "Overtime Hours", "Unpaid Leave Days", "Reimbursements", "Manual Adjustments", "Currency"]
    ];

    period.compiledInputs?.forEach(input => {
      const emp = this.empService.getById(input.employeeId);
      rows.push([
        input.employeeId,
        emp ? emp.preferredName : "Unknown",
        input.approvedOvertimeHours.toString(),
        input.unpaidLeaveDays.toString(),
        input.reimbursementsTotal.toString(),
        input.manualAdjustmentsTotal.toString(),
        input.currency
      ]);
    });

    period.status = "Exported";
    this.repo.update(period.id, period, context);

    return rows.map(r => r.join(",")).join("\n");
  }
}
