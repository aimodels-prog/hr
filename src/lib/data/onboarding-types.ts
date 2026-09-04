import type { BaseRecord, DocumentType, RecordId, Role } from "./types.ts";

// Ties an Employee-owned onboarding task to the actual self-service data-entry surface
// that must be completed for it - a task can't be marked done by clicking a button alone,
// it requires the underlying record (personal details, bank details, or a document) to exist.
export type SelfServiceFormKey =
  "employment_details" | "personal_details" | "bank_details" | "document_upload";

export type TaskGroup =
  | "Employment Setup"
  | "Personal & Legal Documents"
  | "Contract & Payroll"
  | "Visa, Work Permit & ID"
  | "IT & Equipment"
  | "Access & Security"
  | "HSE & Induction"
  | "Department Introduction"
  | "Manager Plan"
  | "Probation Goals";

export type TaskCheckpoint = "Pre-Arrival" | "Day 1" | "Week 1" | "Day 30" | "Day 60" | "Day 90";

export interface OnboardingTemplateTask {
  id: string; // unique within template
  title: string;
  group: TaskGroup;
  checkpoint: TaskCheckpoint;
  ownerRole: Role;
  assignedUserId?: RecordId | undefined;
  offsetDaysFromStart: number; // e.g., 0 for start date, -7 for 7 days before, 30 for 30 days after
  isMandatory: boolean;
  requiresEvidence: boolean;
  instructions?: string;
  dependsOnTaskIds?: string[] | undefined;
  selfServiceFormKey?: SelfServiceFormKey;
  documentType?: DocumentType; // only meaningful when selfServiceFormKey is "document_upload"
  verificationDocumentType?: DocumentType;
  requiresBankDetails?: boolean;
}

export interface OnboardingTemplate extends BaseRecord {
  name: string;
  description: string;
  isActive: boolean;

  // Triggers (Empty means applies to all)
  countries: string[];
  legalEntities: string[];
  departments: string[];
  roles: string[];
  employmentTypes: string[];

  tasks: OnboardingTemplateTask[];
}

export type OnboardingTaskStatus = "Pending" | "Blocked" | "Completed" | "Waived";

export interface OnboardingTask {
  id: string;
  templateTaskId?: string;
  title: string;
  group: TaskGroup;
  checkpoint: TaskCheckpoint;
  ownerRole: Role;
  assignedUserId?: RecordId | undefined; // Can be assigned directly to a user
  offsetDaysFromStart?: number;

  dueDate: string; // ISO date computed from start date
  isMandatory: boolean;
  requiresEvidence: boolean;
  instructions?: string;
  dependsOnTaskIds: string[]; // List of task IDs (instance IDs) this depends on
  selfServiceFormKey?: SelfServiceFormKey;
  documentType?: DocumentType;
  verificationDocumentType?: DocumentType;
  requiresBankDetails?: boolean;

  status: OnboardingTaskStatus;
  completedAt?: string;
  completedBy?: RecordId;
  evidenceFileId?: RecordId;
  waiverReason?: string;
}

export type OnboardingCaseStatus = "In Progress" | "Completed" | "Cancelled";

export interface OnboardingCase extends BaseRecord {
  employeeId: RecordId;
  templateId?: RecordId;
  status: OnboardingCaseStatus;

  tasks: OnboardingTask[];

  progressPercentage: number;
  isReadyForStartDate: boolean; // Computed: True if all Pre-Arrival mandatory tasks are done

  assignedHRId?: RecordId;
}
