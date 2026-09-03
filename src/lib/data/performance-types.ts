import type { BaseRecord, RecordId } from "./types";

export type ReviewStatus =
  | "Draft"
  | "Objectives Pending"
  | "Self Assessment Pending"
  | "Manager Review Pending"
  | "Moderation Pending"
  | "Discussion Pending"
  | "Acknowledgement Pending"
  | "Acknowledged"
  | "Locked"
  | "Corrected";

export interface ReviewItemTemplate {
  id: string; // unique within template
  title: string;
  description: string;
  evidencePrompt?: string;
  weight: number; // Percentage weight for this item within the section
}

export interface ReviewSectionTemplate {
  id: string; // unique within template
  title: string; // e.g., "Competencies", "Goals"
  weight: number; // Percentage weight of this section in the overall review (all sections should sum to 100)
  items: ReviewItemTemplate[];
}

export interface ReviewTemplate extends BaseRecord {
  databaseId?: string;
  name: string;
  description: string;
  isActive: boolean;
  maxRating: number; // e.g., 5 for a 1-5 scale
  sections: ReviewSectionTemplate[];
  employeeCanSeeManagerRatings: boolean;
}

export interface ReviewCycle extends BaseRecord {
  databaseId?: string;
  name: string;
  templateId: RecordId;
  status: "Draft" | "Active" | "Completed";

  // Population criteria (empty means all)
  departments: string[];
  employmentTypes: string[];

  // Timeline
  selfAssessmentDeadline: string;
  managerReviewDeadline: string;
  discussionDeadline: string;
  objectiveSettingDeadline?: string;

  // Settings
  requiresModeration: boolean; // if true, review stops at Moderation Pending for HR
  employeeCanSeeManagerRatings?: boolean;
}

export interface ReviewItemInstance {
  templateItemId: string;
  title: string;
  description: string;
  evidencePrompt?: string;
  weight: number;

  // Self Assessment
  selfRating?: number;
  selfComment?: string;

  // Manager Review
  managerRating?: number;
  managerComment?: string;
}

export interface ReviewSectionInstance {
  templateSectionId: string;
  title: string;
  weight: number;
  items: ReviewItemInstance[];

  // Computed scores
  selfSectionScore?: number;
  managerSectionScore?: number;
}

export interface PerformanceReview extends BaseRecord {
  databaseId?: string;
  employeeId: RecordId;
  cycleId: RecordId;
  templateId: RecordId;

  status: ReviewStatus;

  sections: ReviewSectionInstance[];

  // Computed overall scores
  overallSelfScore?: number;
  overallManagerScore?: number;

  // Final comments
  managerSummaryComment?: string;
  developmentPlan?: string;

  // Review discussion
  discussionHeldAt?: string;
  discussionRecordedAt?: string;
  discussionRecordedBy?: string;
  discussionNotes?: string;

  // Acknowledgement
  employeeAcknowledgedAt?: string;
  employeeAcknowledgementComment?: string;
  employeeAgreesWithReview?: boolean;

  // Moderation and locking
  moderatedAt?: string;
  moderatedBy?: string;
  moderationComment?: string;
  lockedAt?: string;
  lockedBy?: string;

  // Correction
  correctedReason?: string;
  originalReviewId?: RecordId;
}
