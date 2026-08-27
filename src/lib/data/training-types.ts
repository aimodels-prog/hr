import type { BaseRecord, RecordId } from "./types";

export interface TrainingRecord extends BaseRecord {
  employeeId: RecordId;
  title: string;
  provider: string;
  completionDate: string;
  expiryDate?: string; // If applicable
  certificateFileId?: string; // Link to uploaded document
  hrVerified: boolean;
}
