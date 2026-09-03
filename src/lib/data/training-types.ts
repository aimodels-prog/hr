import type { BaseRecord, RecordId } from "./types";

export type TrainingDeliveryType = "Classroom" | "Virtual" | "Blended" | "Self-paced";
export type TrainingRequestStatus =
  "Pending Supervisor" | "Pending HR" | "Approved" | "Rejected" | "Withdrawn";
export type TrainingEnrollmentStatus =
  "Assigned" | "Scheduled" | "Attended" | "Completed" | "No Show" | "Cancelled";

export interface TrainingCourse extends BaseRecord {
  databaseId?: string;
  code: string;
  title: string;
  description: string;
  provider: string;
  category: string;
  deliveryType: TrainingDeliveryType;
  durationHours: number;
  cost: number;
  currency: string;
  validityMonths?: number;
  renewalIntervalMonths?: number;
  requiredRoles: string[];
  requiredLocations: string[];
  requiredProjects: string[];
  isMandatory: boolean;
  isActive: boolean;
}

export interface TrainingRequest extends BaseRecord {
  databaseId?: string;
  employeeId: RecordId;
  courseId: RecordId;
  origin: "Employee Request" | "Supervisor Assignment" | "HR Assignment";
  reason: string;
  status: TrainingRequestStatus;
  supervisorDecisionAt?: string;
  supervisorDecisionBy?: RecordId;
  supervisorComment?: string;
  hrDecisionAt?: string;
  hrDecisionBy?: RecordId;
  hrComment?: string;
  rejectionReason?: string;
}

export interface TrainingSession extends BaseRecord {
  databaseId?: string;
  courseId: RecordId;
  title: string;
  startAt: string;
  endAt: string;
  location: string;
  facilitator: string;
  capacity: number;
  status: "Scheduled" | "Completed" | "Cancelled";
}

export interface TrainingEnrollment extends BaseRecord {
  databaseId?: string;
  employeeId: RecordId;
  courseId: RecordId;
  requestId?: RecordId;
  sessionId?: RecordId | undefined;
  status: TrainingEnrollmentStatus;
  assignedBy: RecordId;
  assignedAt: string;
  attendanceRecordedAt?: string;
  attendanceRecordedBy?: RecordId;
  completionDate?: string;
  result?: string;
  actualCost?: number;
  trainingRecordId?: RecordId;
  cancellationReason?: string;
}

export interface TrainingRecord extends BaseRecord {
  databaseId?: string;
  employeeId: RecordId;
  courseId?: RecordId;
  enrollmentId?: RecordId;
  title: string;
  provider: string;
  completionDate: string;
  expiryDate?: string; // If applicable
  certificateFileId?: string; // Link to uploaded document
  hrVerified: boolean;
  verifiedAt?: string | undefined;
  verifiedBy?: RecordId | undefined;
  verificationComment?: string | undefined;
  rejectedAt?: string | undefined;
  rejectedBy?: RecordId | undefined;
  rejectionReason?: string | undefined;
}
