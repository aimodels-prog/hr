import type { BaseRecord, RecordId } from "./types.ts";

// "Pre-authorised" (not "Approved") is the deliberate label once both HR and Accounts have
// signed off before the trip - it authorises spend up to the estimate, it does not mean the
// trip's expenses are final; that only happens at Closed once actuals are reviewed.
export type TravelRequestStatus =
  | "Draft"
  | "Pending HR and Accounts"
  | "Pre-authorised"
  | "Pending Super Admin Closure"
  | "Closed"
  | "Rejected"
  | "Withdrawn";
export type TravelApprovalState = "Pending" | "Approved" | "Rejected";

export interface TravelBudgetSnapshot {
  estTransport: number;
  estAccommodation: number;
  estPerDiem: number;
  estOther: number;
  totalEstimate: number;
  currency: string;
  capturedAt: string;
}

export interface ExpenseLine {
  id: string;
  category: "Transport" | "Accommodation" | "Per Diem" | "Other";
  amount: number;
  currency: string;
  exchangeRate?: number;
  /** Bill/invoice/receipt reference number - mandatory, since an unreferenced expense line can't be reconciled against the physical receipt. */
  reference: string;
  date: string;
  notes?: string;
  receiptFileId?: string;
}

export interface TravelRequest extends BaseRecord {
  /** Authoritative PostgreSQL UUID while the legacy browser cache remains during cutover. */
  databaseId?: string;
  employeeId: RecordId;
  purpose: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD

  projectId?: RecordId;
  costCentreId?: RecordId;

  // Estimates
  estTransport: number;
  estAccommodation: number;
  estPerDiem: number;
  estOther: number;
  totalEstimate: number;
  currency: string;

  notes?: string;
  evidenceFileId?: string; // Supporting docs, stored via the secure file repository

  // Dual-track approvals
  hrApprovalStatus: TravelApprovalState;
  accountsApprovalStatus: TravelApprovalState;
  hrNotes?: string;
  accountsNotes?: string;
  hrApprovedAt?: string;
  hrApprovedBy?: RecordId;
  accountsApprovedAt?: string;
  accountsApprovedBy?: RecordId;
  preAuthorisedAt?: string;
  authorisedBudget?: TravelBudgetSnapshot;

  // Post-trip actuals
  expenses?: ExpenseLine[];
  actualTotal?: number;
  // OMR-equivalent of actualTotal, computed from each expense line's amount x exchangeRate
  // (rate defaults to 1 only when the line's own currency is already OMR). This is the
  // figure payroll and finance reporting must consume instead of the raw actualTotal, which
  // may mix currencies with no conversion applied.
  actualTotalOmr?: number;
  varianceExplanation?: string;
  closureNotes?: string;
  closedAt?: string;
  closedBy?: RecordId;
  payrollPeriodId?: RecordId;

  status: TravelRequestStatus;
}
