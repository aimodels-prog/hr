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
    | "Unmatched Reimbursement";
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
  evidenceUrl?: string;
  createdAt: string;
  createdBy: string;
}

export interface PayrollInputReport {
  employeeId: RecordId;
  approvedOvertimeHours: number;
  unpaidLeaveDays: number;
  reimbursementsTotal: number;
  manualAdjustmentsTotal: number;
  currency: string;
}

export interface PayrollPeriod extends BaseRecord {
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
