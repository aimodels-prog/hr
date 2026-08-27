import type { BaseRecord, RecordId } from "./types";

export interface TimesheetSettings {
  weeklyPeriodStartDay: number; // 0 = Sunday, 1 = Monday, etc.
  standardDailyHours: number;
  submissionDeadlineDays: number; // e.g. 2 days after period end
  overtimeThresholdWeekly: number; // e.g. 40
  allowCopyPreviousWeek: boolean;
  payrollLockBehaviour: "Manual by HR" | "Automatic on Approval";
  requireHrOvertimeVerification: boolean;
  attendanceVarianceToleranceHours: number;
}

export type AttendanceReconciliationStatus =
  | "Matched"
  | "Variance"
  | "Missing Attendance"
  | "Missing Timesheet"
  | "Incomplete Attendance"
  | "Leave"
  | "Holiday"
  | "Rest Day";

export interface DailyAttendanceReconciliation {
  date: string;
  attendanceHours: number;
  timesheetWorkHours: number;
  leaveHours: number;
  holidayHours: number;
  varianceHours: number;
  attendanceStatus: string;
  status: AttendanceReconciliationStatus;
  requiresExplanation: boolean;
  explanation?: string | undefined;
  resolved: boolean;
}

export interface TimesheetAttendanceReconciliation {
  generatedAt: string;
  toleranceHours: number;
  attendanceHours: number;
  timesheetWorkHours: number;
  varianceHours: number;
  unresolvedCount: number;
  days: DailyAttendanceReconciliation[];
}

export interface TimesheetPeriod extends BaseRecord {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: "Open" | "Closed";
}

export type TimesheetStatus =
  | "Draft"
  | "Pending Manager"
  | "Pending HR"
  | "Returned"
  | "Approved"
  | "Payroll Locked"
  | "Corrected";

export interface Timesheet extends BaseRecord {
  employeeId: RecordId;
  periodId: RecordId;
  status: TimesheetStatus;
  expectedHours: number; // computed based on workweek & holidays
  totalHours: number;
  submittedAt?: string;
  approvedAt?: string;
  approvedBy?: RecordId;
  supervisorReviewedAt?: string;
  supervisorReviewedBy?: RecordId;
  managerNotes?: string;
  attendanceDiscrepancyExplanations?: Record<string, string> | undefined;
  attendanceReconciliationSnapshot?: TimesheetAttendanceReconciliation | undefined;
}

export interface TimesheetEntry {
  id: string; // UUID just for entry uniqueness inside the timesheet
  projectId: RecordId;
  costCentreId: RecordId;
  activityCodeId: RecordId;
  locationCodeId: RecordId;
  hours: Record<string, number>; // key: YYYY-MM-DD date string, value: hours worked
  total: number;
  notes?: string;
  isLeave?: boolean;
  isHoliday?: boolean;
}

// We will embed entries directly into the Timesheet record for simplicity in this prototype,
// rather than separate relational tables.
export interface TimesheetWithEntries extends Timesheet {
  entries: TimesheetEntry[];
}
