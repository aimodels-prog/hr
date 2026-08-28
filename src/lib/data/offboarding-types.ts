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
  // A specific person to assign this task to on every case created from this template, instead
  // of leaving it open to "anyone holding ownerRole". Copied onto the case's OffboardingTask at
  // startCase() time - undefined means "anyone with this responsibility", matching ownerRole alone.
  assignedUserId?: RecordId | undefined;
  offsetDaysFromLastWorkingDate: number; // e.g. -7 for a week before, 0 for last day, 5 for after
  isMandatory: boolean;
  requiresEvidence: boolean;
  instructions?: string | undefined;
  dependsOnTaskIds?: string[] | undefined;
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

// Standard: visible to any HR user or Super Admin, same as today.
// Restricted: the case involves matters (e.g. termination for cause, legal dispute) sensitive
// enough that confidentialNotes should be visible only to a Super Admin, not every HR user.
export type OffboardingConfidentialityLevel = "Standard" | "Restricted";

export interface OffboardingCase extends BaseRecord {
  employeeId: RecordId;
  templateId?: RecordId;

  reasonCategory: OffboardingReasonCategory;
  noticeDate: string;
  lastWorkingDate: string;
  confidentialityLevel: OffboardingConfidentialityLevel;
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
