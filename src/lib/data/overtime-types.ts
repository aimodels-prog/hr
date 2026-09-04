import type { BaseRecord, RecordId } from "./types";

export type OvertimeClaimStatus =
  | "Pending Pre-authorisation"
  | "Pre-authorised"
  | "Pending Manager"
  | "Pending HR"
  | "Approved"
  | "Rejected"
  | "Corrected";

// Whether the employee wants this overtime paid, or converted to a Compensation Leave
// (Off-in-Lieu) day credited once the claim is fully approved.
export type OvertimeCompensationType = "Payment" | "TOIL";

export type PayrollOvertimeLedgerState =
  | "Ready for Payroll"
  | "Included in Payroll"
  | "Time Off Credited"
  | "Time Off Pending"
  | "Review Needed";

export type PayrollOvertimeLedgerView = "all" | "ready" | "included" | "time-off" | "exceptions";

export interface PayrollOvertimeLedgerFilters {
  search?: string;
  view?: PayrollOvertimeLedgerView;
  dateFrom?: string;
  dateTo?: string;
  payrollPeriodId?: string;
}

export interface PayrollOvertimeLedgerRow {
  claimId: RecordId;
  employeeId: RecordId;
  employeeName: string;
  employeeNumber: string;
  date: string;
  hours: number;
  compensationType: OvertimeCompensationType;
  projectName: string;
  costCentreName: string;
  activityName: string;
  locationName: string;
  reason: string;
  requestKind?: "Planned" | "Emergency Retrospective";
  emergencyReason?: string;
  authorisedHours?: number;
  preAuthorisedAt?: string;
  preAuthorisedBy?: string;
  actualConfirmedAt?: string;
  hasEvidence: boolean;
  crossCheckWarnings: string[];
  managerNotes?: string;
  hrNotes?: string;
  approvedAt: string;
  approvedBy?: string;
  payrollPeriodId?: string;
  payrollPeriodName?: string;
  payrollPeriodStatus?: string;
  state: PayrollOvertimeLedgerState;
}

export interface OvertimeClaim extends BaseRecord {
  databaseId?: string;
  employeeId: RecordId;
  date: string; // YYYY-MM-DD
  hours: number;
  projectId?: string;
  costCentreId: string;
  activityCodeId: string;
  locationCodeId: string;
  reason: string;
  requestKind?: "Planned" | "Emergency Retrospective";
  emergencyReason?: string;
  authorisedHours?: number;
  preAuthorisedAt?: string;
  preAuthorisedBy?: string;
  actualConfirmedAt?: string;
  evidenceFileId?: string;
  compensationType: OvertimeCompensationType;
  /** Set once TOIL compensation has actually been credited to the employee's leave balance, so approving twice (or re-processing) can never double-credit. */
  toilCreditedAt?: string;
  toilReversedAt?: string;
  payrollPeriodId?: string;

  crossCheckWarnings: string[];

  status: OvertimeClaimStatus;
  managerNotes?: string;
  hrNotes?: string;
  approvedAt?: string;
  approvedBy?: string;

  // Auditing for corrections
  originalClaimId?: string;
}
