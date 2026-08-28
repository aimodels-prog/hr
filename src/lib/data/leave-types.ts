import type { BaseRecord, Gender, RecordId } from "./types";

export type LeaveAccrualMode = "Upfront" | "Monthly" | "Per Pay Period" | "Not Applicable";
export type LeaveTransactionType =
  | "Entitlement"
  | "Carry-Forward"
  | "Accrual"
  | "Approved Leave"
  | "Cancellation Restoration"
  | "Expiry"
  | "Manual Adjustment";

// How a policy's entitlement is scoped, per Labour Law Royal Decree 53/2023:
// - Annual: a fixed number of days auto-granted every year (Annual Leave, Sick Leave, Accompany-Patient, Exam Leave)
// - Once Per Service: a fixed number of days usable exactly once during the whole employment (Hajj, Art. 84.6) -
//   validated by a lifetime-use check, not the balance ledger
// - Per Event: a fixed statutory cap per occurrence, not auto-granted or annually reset - validated by a simple
//   per-request day-cap check (Maternity, Paternity, Marriage, Compassionate, Iddah)
// - Ledger: balance-tracked like Annual, but never auto-granted - only grows when HR credits it via a Manual
//   Adjustment or Accrual transaction (e.g. crediting overtime-earned time off, or approving an unpaid-leave case),
//   then drawn down through the normal balance ledger (Compensation Off, Unpaid Leave)
// - Not Tracked: no entitlement or balance at all - a record-keeping marker (Remote, Resignation)
export type LeaveScope = "Annual" | "Once Per Service" | "Per Event" | "Ledger" | "Not Tracked";

export type LeaveCategory = "Statutory" | "Company Policy" | "Attendance Marker";

export const LEAVE_TYPE_VALUES = [
  "Annual",
  "Sick",
  "Maternity",
  "Paternity",
  "Marriage",
  "Compassionate",
  "Hajj",
  "Exam",
  "Iddah",
  "AccompanyPatient",
  "CompensationOff",
  "Unpaid",
  "Emergency",
  "Remote",
  "Resignation",
  "Other",
] as const;
export type LeaveType = (typeof LEAVE_TYPE_VALUES)[number];

// Sick leave (Art. 82) pays a declining percentage of wage the longer it runs across the leave year.
export interface SickPayTier {
  fromDay: number; // 1-indexed, inclusive
  toDay: number; // inclusive
  payPercentage: number; // 0-100
}

// A single tier slice of a specific sick leave request, as computed by
// LeaveService.getSickLeavePayBreakdown - how many of the requested days fall into each
// declining pay-percentage tier, given what the employee has already taken this year.
export interface SickPayTierBreakdown {
  fromDay: number;
  toDay: number;
  payPercentage: number;
  days: number; // days of THIS request that fall within this tier
}

export interface LeaveEligibility {
  genderRestriction?: Gender | undefined; // e.g. Maternity = Female only, Paternity = Male only
  omaniOnly?: boolean | undefined; // Hajj, Exam, and Accompany-Patient leave are Omani-national entitlements
  minimumServiceMonths?: number | undefined; // e.g. Hajj requires 1 continuous year of service first
}

export interface LeavePolicy extends BaseRecord {
  code: string; // short operational code shown on rosters/timesheets, e.g. "A/L", "Sick", "MAT"
  name: string;
  type: LeaveType;
  category: LeaveCategory;
  legalBasis?: string | undefined; // e.g. "Labour Law Art. 78" - undefined for non-statutory company policy
  description: string; // self-explanatory note shown to HR and employees wherever this policy appears
  isPaid: boolean;
  payTiers?: SickPayTier[] | undefined; // only Sick Leave uses this; overrides isPaid's flat 100%/0%
  baseEntitlementDays: number; // HR-editable - the single number that drives every balance calculation
  scope: LeaveScope;
  accrualMode: LeaveAccrualMode;
  carryForwardLimit: number;
  allowNegativeBalance: boolean;
  maxNegativeBalance?: number | undefined;
  requiresAttachment: boolean;
  // false for leave types that are inherently sudden (medical emergencies, bereavement) or that
  // are not a real absence at all (Remote, Resignation) - an employee must never be blocked from
  // submitting an urgent request just because they cannot immediately name a covering colleague.
  requiresHandoverContact: boolean;
  countsTowardGratuity: boolean; // false for unpaid leave per Art. 80/83 - excluded from end-of-service gratuity service period
  eligibility?: LeaveEligibility | undefined;
  approvalChain: string[]; // e.g. ["Line Manager", "HR"]
  noticeRules?: {
    enabled: boolean;
    shortLeaveMaxDays: number;
    shortLeaveNoticeDays: number;
    longLeaveNoticeDays: number;
  };
  isEnabled: boolean; // HR toggle in Settings - disabled policies are hidden from every leave request flow
  isStatutory: boolean; // legally mandated by the Labour Law - HR cannot disable these
  consumesBalance: boolean; // false for Attendance Marker types (Remote, Resignation) - no entitlement, always allowed
}

export interface LeaveTransaction extends BaseRecord {
  employeeId: RecordId;
  policyId: RecordId;
  date: string; // ISO date
  transactionType: LeaveTransactionType;
  days: number; // positive for adding balance, negative for taking leave
  reason: string;
  referenceId?: string; // ID of the leave request if applicable
  actorUserId: RecordId;
}

/** An employee-specific statutory/event allowance approved by HR. */
export interface EmployeeLeaveEntitlementOverride extends BaseRecord {
  employeeId: RecordId;
  policyId: RecordId;
  days: number;
  reason: string;
  effectiveFrom: string;
}

export interface LeaveBalanceReport {
  employeeId: string;
  policyId: string;
  entitlement: number;
  carriedForward: number;
  accrued: number;
  adjustments: number;
  taken: number;
  approvedFuture: number;
  pending: number;
  available: number; // The official balance
  projectedAvailable: number; // Available - pending
}

export type LeaveRequestStatus =
  | "Pending Line Manager"
  | "Pending HR"
  /** Retained so existing browser records can be upgraded safely. */
  | "Pending Super Admin"
  | "Approved"
  | "Taken"
  | "Declined"
  | "Automatically Refused"
  | "Cancelled"
  | "Cancellation Pending"
  | "Cancellation Approved";

export interface LeaveRequest extends BaseRecord {
  employeeId: RecordId;
  policyId: RecordId;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  workingDaysRequested: number;
  reason: string;
  handoverContactId?: RecordId;
  attachmentFileId?: RecordId;
  /** Kept for older imported records; new requests store evidence in IndexedDB by file ID. */
  attachmentUrl?: string;
  status: LeaveRequestStatus;
  refusalReason?: string; // used if Automatically Refused
  cancellationReason?: string;
  // Sick-leave pay-percentage tier breakdown at the time this request was submitted, from
  // LeaveService.getSickLeavePayBreakdown. Only populated for requests against a policy that
  // defines payTiers (i.e. Sick Leave). Consumed by payroll to apply the correct declining
  // pay percentage per day rather than recomputing it (which would drift once later requests
  // shift how many sick days had "already been taken" at submission time).
  sickPayTiers?: SickPayTierBreakdown[];
  chainApprovals: Array<{
    role: string;
    approvedBy?: RecordId;
    date?: string;
    status: "Pending" | "Approved" | "Declined";
  }>;
  policySnapshot: {
    name: string;
    type: string;
    isPaid: boolean;
    baseEntitlementDays: number;
    accrualMode: string;
  };
}
