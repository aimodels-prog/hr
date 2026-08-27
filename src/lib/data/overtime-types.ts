import type { BaseRecord, RecordId } from "./types";

export type OvertimeClaimStatus = "Draft" | "Pending Manager" | "Pending HR" | "Approved" | "Rejected" | "Corrected";

// Whether the employee wants this overtime paid, or converted to a Compensation Leave
// (Off-in-Lieu) day credited once the claim is fully approved.
export type OvertimeCompensationType = "Payment" | "TOIL";

export interface OvertimeClaim extends BaseRecord {
  employeeId: RecordId;
  date: string; // YYYY-MM-DD
  hours: number;
  projectId?: string;
  reason: string;
  evidenceFileId?: string;
  compensationType: OvertimeCompensationType;
  /** Set once TOIL compensation has actually been credited to the employee's leave balance, so approving twice (or re-processing) can never double-credit. */
  toilCreditedAt?: string;

  crossCheckWarnings: string[];

  status: OvertimeClaimStatus;
  managerNotes?: string;
  hrNotes?: string;

  // Auditing for corrections
  originalClaimId?: string;
}
