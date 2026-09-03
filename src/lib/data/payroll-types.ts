import type { BaseRecord, RecordId } from "./types";

export type PayrollPeriodStatus =
  | "Draft"
  | "Collecting Inputs"
  | "Exceptions"
  | "Prepared"
  | "Approved"
  | "Locked"
  | "Exported"
  | "Corrected";

export interface PayrollException {
  id: string;
  employeeId: RecordId;
  type:
    | "Missing Timesheet"
    | "Missing Bank Data"
    | "Pending Leave"
    | "Extreme Value"
    | "Duplicate Input"
    | "Unmatched Overtime"
    | "Unmatched Reimbursement"
    | "Attendance Conflict"
    | "Joiner / Leaver"
    | "Pending Travel"
    | "Expired Contract"
    | "Invalid Currency";
  description: string;
  severity: "High" | "Medium" | "Low";
  acknowledged: boolean;
  acknowledgementNotes?: string;
}

export interface PayrollManualAdjustment {
  id: string;
  periodId: RecordId;
  employeeId: RecordId;
  type: "Allowance" | "Deduction" | "Correction";
  amount: number;
  currency: string;
  reason: string;
  evidenceFileId?: string;
  createdAt: string;
  createdBy: string;
}

export interface PayrollInputReport {
  employeeId: RecordId;
  approvedOvertimeHours: number;
  unpaidLeaveDays: number;
  reimbursementsTotal: number;
  /** Reimbursements are converted to VIA's base currency independently of salary currency. */
  reimbursementsCurrency: string;
  manualAdjustmentsTotal: number;
  /** Salary/manual-adjustment currency; never reused to label reimbursements. */
  currency: string;
}

export interface PayrollPeriod extends BaseRecord {
  /** Authoritative PostgreSQL UUID while the compatibility cache remains during cutover. */
  databaseId?: string;
  name: string;
  startDate: string;
  endDate: string;
  cutoffDate: string;
  paymentDate: string;
  status: PayrollPeriodStatus;
  notes?: string;

  exceptions: PayrollException[];
  manualAdjustments: PayrollManualAdjustment[];

  // Stored snapshot of the inputs after preparation
  compiledInputs?: PayrollInputReport[];
}
