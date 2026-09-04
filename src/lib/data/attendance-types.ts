import type { BaseRecord, MasterRecord, RecordId } from "./types.ts";

export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "On Leave"
  | "Holiday"
  | "Rest Day"
  | "Late"
  | "Missing Punch"
  | "Correction Pending"
  | "Corrected";

export type AttendanceSource =
  "Hardware Terminal" | "Manual Entry" | "Web" | "Import" | "Site Visit Auto" | "Multiple Sources";

export type AttendanceWorkMode = "Office" | "Approved Site Visit";

export interface GeoReading {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt?: string | undefined;
}

export interface AttendanceLocation extends MasterRecord {
  latitude?: number | undefined;
  longitude?: number | undefined;
  radiusMeters?: number | undefined;
  isClockInSite?: boolean | undefined;
}

export interface PublicHoliday extends MasterRecord {
  date: string;
}

export interface AttendancePolicy extends BaseRecord {
  databaseId?: string | undefined;
  standardDailyHours: number;
  expectedClockIn: string;
  expectedClockOut: string;
  defaultBreakMinutes: number;
  lateGraceMinutes: number;
  maximumLocationAccuracyMeters: number;
  signOutReminderOffsetsMinutes: [number, number, number];
  punchDeduplicationMinutes: number;
  approvedNetworkCidrs?: string[] | undefined;
}

export interface AttendanceDevice {
  id: string;
  recordVersion: number;
  code: string;
  name: string;
  locationId: string;
  locationName: string;
  serialNumber?: string | undefined;
  model?: string | undefined;
  isActive: boolean;
  lastSeenAt?: string | undefined;
  lastSuccessfulSyncAt?: string | undefined;
  lastError?: string | undefined;
}

export interface AttendanceDeviceMapping {
  id: string;
  deviceId: string;
  deviceUserId: string;
  employeeId: string;
  employeeName: string;
}

export interface UnmatchedAttendancePunch {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceUserId: string;
  deviceUserName?: string | undefined;
  occurredAt: string;
  status?: number | undefined;
  punchMethod?: number | undefined;
  failureReason?: string | undefined;
}

export interface AttendanceRecord extends BaseRecord {
  databaseId?: string | undefined;
  employeeId: RecordId;
  date: string;
  shiftId?: string | undefined;
  expectedClockIn?: string | undefined;
  expectedClockOut?: string | undefined;
  clockIn?: string | undefined;
  clockOut?: string | undefined;
  clockInAt?: string | undefined;
  clockOutAt?: string | undefined;
  breakMinutes: number;
  location?: string | undefined;
  locationId?: RecordId | undefined;
  capturedLatitude?: number | undefined;
  capturedLongitude?: number | undefined;
  capturedAccuracyMeters?: number | undefined;
  clockOutLocationId?: RecordId | undefined;
  clockOutCapturedLatitude?: number | undefined;
  clockOutCapturedLongitude?: number | undefined;
  clockOutCapturedAccuracyMeters?: number | undefined;
  source: AttendanceSource;
  workMode?: AttendanceWorkMode | undefined;
  siteVisitId?: RecordId | undefined;
  status: AttendanceStatus;
  calculatedHours: number;
  isLate: boolean;
  isEarlyDeparture: boolean;
}

export type CorrectionStatus = "Pending Manager" | "Pending HR" | "Approved" | "Rejected";
export type AttendanceCorrectionType = "Punch Correction" | "Missed Sign-out";

export interface AttendanceCorrection extends BaseRecord {
  databaseId?: string | undefined;
  attendanceRecordId: RecordId;
  employeeId: RecordId;
  correctionType: AttendanceCorrectionType;
  originalClockIn?: string | undefined;
  originalClockOut?: string | undefined;
  originalStatus: AttendanceStatus;
  proposedClockIn?: string | undefined;
  proposedClockOut?: string | undefined;
  explanation: string;
  evidenceFileId?: RecordId | undefined;
  status: CorrectionStatus;
  managerNotes?: string | undefined;
  managerReviewedBy?: RecordId | undefined;
  managerReviewedAt?: string | undefined;
  hrNotes?: string | undefined;
  hrReviewedBy?: RecordId | undefined;
  hrReviewedAt?: string | undefined;
}

export type SiteVisitOrigin = "Office" | "Home";
export type SiteVisitStatus = "Pending HR" | "Approved" | "Rejected" | "Cancelled" | "Completed";

export interface SiteVisitRequest extends BaseRecord {
  databaseId?: string | undefined;
  employeeId: RecordId;
  date: string;
  startTime: string;
  endTime: string;
  origin: SiteVisitOrigin;
  destination: string;
  purpose: string;
  projectId?: RecordId | undefined;
  status: SiteVisitStatus;
  requestedAt: string;
  hrReviewedBy?: RecordId | undefined;
  hrReviewedAt?: string | undefined;
  hrNotes?: string | undefined;
  attendanceRecordId?: RecordId | undefined;
}

export type AttendanceExceptionType = "Site Visit No Clock-In";
export type AttendanceExceptionStatus = "Open" | "Investigating" | "Resolved";

// A persistent, ownable case for an attendance anomaly that a plain notification isn't enough to
// track to closure - currently raised for an office-origin site visit that ended without an office
// clock-in. Distinct from AttendanceCorrection: a correction is the EMPLOYEE proposing a fix to
// their own punch; an exception case is HR investigating an anomaly nobody has explained yet.
export interface AttendanceExceptionCase extends BaseRecord {
  databaseId?: string | undefined;
  employeeId: RecordId;
  type: AttendanceExceptionType;
  siteVisitId: RecordId;
  date: string;
  destination: string;
  status: AttendanceExceptionStatus;
  ownerId?: RecordId | undefined;
  investigationNotes?: string | undefined;
  resolutionNotes?: string | undefined;
  resolvedBy?: RecordId | undefined;
  resolvedAt?: string | undefined;
}

export interface AttendanceImportRow {
  employeeId: RecordId;
  date: string;
  clockIn?: string | undefined;
  clockOut?: string | undefined;
  breakMinutes: number;
  expectedClockIn?: string | undefined;
  expectedClockOut?: string | undefined;
  location?: string | undefined;
  source: Extract<AttendanceSource, "Hardware Terminal" | "Manual Entry" | "Import">;
}

export interface AttendanceImportPreview {
  validRows: AttendanceImportRow[];
  errors: Array<{ row: number; message: string }>;
}

export interface GeofenceResult {
  allowed: boolean;
  nearestLocation?: AttendanceLocation | undefined;
  distanceMeters?: number | undefined;
  shortfallMeters?: number | undefined;
  message: string;
}
