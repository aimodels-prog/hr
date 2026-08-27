import type { BaseRecord, RecordId, Role } from "./types.ts";

export type OffboardingReasonCategory =
  "Resignation" | "Termination" | "Contract End" | "Retirement" | "Transfer" | "Other";

export type OffboardingTaskGroup =
  | "Manager Handover"
  | "Project Reassignment"
  | "IT & Assets"
  | "Access & Security"
  | "Visa & Work Permit Cancellation"
  | "Leave & Attendance Reconciliation"
  | "Expenses & Advances"
  | "Final Payroll Input"
  | "Exit Interview"
  | "Service Documents";

export interface OffboardingTemplateTask {
  id: string; // unique within template
  title: string;
  group: OffboardingTaskGroup;
  ownerRole: Role;
  offsetDaysFromLastWorkingDate: number; // e.g. -7 for a week before, 0 for last day, 5 for after
  isMandatory: boolean;
  requiresEvidence: boolean;
  instructions?: string;
  dependsOnTaskIds?: string[];
}

export interface OffboardingTemplate extends BaseRecord {
  name: string;
  description: string;
  isActive: boolean;

  // Triggers (empty means applies to all)
  departments: string[];
  employmentTypes: string[];

  tasks: OffboardingTemplateTask[];
}

export type OffboardingTaskStatus = "Pending" | "Blocked" | "Completed" | "Waived";

export interface OffboardingTask {
  id: string;
  templateTaskId?: string;
  title: string;
  group: OffboardingTaskGroup;
  ownerRole: Role;
  assignedUserId?: RecordId;

  dueDate: string; // ISO date computed from last working date
  isMandatory: boolean;
  requiresEvidence: boolean;
  instructions?: string;
  dependsOnTaskIds: string[];

  status: OffboardingTaskStatus;
  completedAt?: string;
  completedBy?: RecordId;
  evidenceFileId?: RecordId;
  waiverReason?: string;
}

export type OffboardingCaseStatus = "In Progress" | "Pending Clearance" | "Completed" | "Cancelled";

export interface OffboardingCase extends BaseRecord {
  employeeId: RecordId;
  templateId?: RecordId;

  reasonCategory: OffboardingReasonCategory;
  noticeDate: string;
  lastWorkingDate: string;
  confidentialNotes?: string;
  rehireEligible: boolean;

  status: OffboardingCaseStatus;
  tasks: OffboardingTask[];
  progressPercentage: number;

  // Dual clearance required before final closure
  financialClearanceAt?: string;
  financialClearanceBy?: RecordId;
  legalClearanceAt?: string;
  legalClearanceBy?: RecordId;

  finalizedAt?: string;
  finalizedBy?: RecordId;

  assignedHRId?: RecordId;
}
