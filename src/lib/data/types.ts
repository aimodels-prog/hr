export const ROLE_VALUES = [
  "Employee",
  "Line Manager",
  "HR",
  "Accounts",
  "Super Admin",
  "IT",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

export type RecordId = string;

export interface BaseRecord {
  id: RecordId;
  createdAt: string;
  createdBy: RecordId;
  updatedAt: string;
  updatedBy: RecordId;
  archivedAt?: string | undefined;
  recordVersion: number;
}

export interface MasterRecord extends BaseRecord {
  /** PostgreSQL UUID used while unmigrated browser records still reference their legacy IDs. */
  databaseId?: string;
  name: string;
  code?: string | undefined;
  description?: string | undefined;
  isActive: boolean;
  orderIndex: number;
  date?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  radiusMeters?: number | undefined;
  isClockInSite?: boolean | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  breakMinutes?: number | undefined;
  workingDays?: number[] | undefined;
  symbol?: string | undefined;
  decimalPlaces?: number | undefined;
}

export interface Project extends MasterRecord {
  client?: string | undefined;
  type?: string | undefined;
  location?: string | undefined;
  locationId?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  costCentreId?: string | undefined;
  managerId?: string | undefined;
  status?: "Draft" | "Active" | "On Hold" | "Completed" | "Archived" | undefined;
}

export type EmployeeStatus =
  "Onboarding" | "Active" | "Probation" | "Notice" | "Inactive" | "Archived";

export type StaffEntryType = "New Employee" | "Existing Employee";
export type ProfileSetupStatus = "Not Started" | "In Progress" | "Completed";

export interface User extends BaseRecord {
  /** PostgreSQL UUID used while dependent modules still hold legacy browser IDs. */
  databaseId?: string;
  employeeId?: RecordId | undefined;
  displayName: string;
  workspaceEmail: string;
  workspaceSubject?: string | undefined;
  roles: Role[];
  status: "Active" | "Suspended" | "Archived";
}

export interface BankDetails {
  bankName: string;
  accountNumber: string;
  iban: string;
  swiftCode?: string | undefined;
  branch?: string | undefined;
}

export type PaymentMethod = "Bank Transfer" | "Cheque" | "Cash";
export type PayFrequency = "Monthly" | "Biweekly" | "Weekly";

export interface EmployeeSalary {
  baseMonthly: number;
  currency: string;
  housingAllowance?: number | undefined;
  transportAllowance?: number | undefined;
  otherAllowances?: { label: string; amount: number }[] | undefined;
  payFrequency?: PayFrequency | undefined;
  paymentMethod?: PaymentMethod | undefined;
}

export type Gender = "Male" | "Female";
export type EmployeeMaritalStatus = "Single" | "Married" | "Divorced" | "Widowed";

export interface Employee extends BaseRecord {
  /** PostgreSQL UUID used while dependent modules still hold legacy browser IDs. */
  databaseId?: string;
  employeeNumber: string;
  legalName: string;
  preferredName: string;
  workEmail: string;
  personalEmail?: string | undefined;
  phone?: string | undefined;
  department: string;
  position: string;
  grade?: string | undefined;
  location: string;
  country?: string | undefined;
  legalEntity?: string | undefined;
  employmentType: string;
  startDate: string;
  probationEndDate?: string | undefined;
  staffEntryType?: StaffEntryType | undefined;
  profileSetupStatus?: ProfileSetupStatus | undefined;
  profileSetupCompletedAt?: string | undefined;
  proposedLineManagerEmail?: string | undefined;
  lineManagerId?: RecordId | undefined;

  // Future Integrations
  workspaceEmail?: string;

  // Recruitment Links
  candidateId?: string;
  offerId?: string;
  recommendationIds?: RecordId[] | undefined;
  status: EmployeeStatus;
  salary?: EmployeeSalary | undefined;
  bankDetails?: BankDetails | undefined;
  passportNumber?: string | undefined;
  nationalId?: string | undefined;
  performanceRating?: number | undefined;
  performanceNotes?: string | undefined;
  projectId?: RecordId | undefined;
  costCentreId?: RecordId | undefined;
  address?: string | undefined;
  emergencyContacts?:
    { name: string; relationship: string; phone: string; email?: string }[] | undefined;
  dependants?: { name: string; relationship: string; dateOfBirth: string }[] | undefined;

  // Personal details - standard across every HRIS, used for benefits eligibility,
  // statutory/diversity reporting, and (nationality) work-permit/quota compliance.
  dateOfBirth?: string | undefined;
  gender?: Gender | undefined;
  nationality?: string | undefined;
  maritalStatus?: EmployeeMaritalStatus | undefined;

  // Leaver record - without this "who left, when, and why" cannot be reported at all.
  terminationDate?: string | undefined;
  terminationReason?: string | undefined;

  // Payroll/statutory registration
  weeklyHours?: number | undefined; // for part-time proration of pay and leave accrual
  socialInsuranceNumber?: string | undefined; // GOSI/PASI or local equivalent statutory registration number
}

export interface ProfileChangeRequest extends BaseRecord {
  employeeId: RecordId;
  changes: Partial<Employee>;
  status: "Pending" | "Approved" | "Rejected";
  requestedBy: string;
  reviewerId?: string | undefined;
  reviewedAt?: string | undefined;
  reviewNotes?: string | undefined;
}

export type DocumentType =
  | "contract"
  | "passport"
  | "visa"
  | "national_id"
  | "work_permit"
  | "driving_licence"
  | "medical"
  | "education_certificate"
  | "professional_certificate"
  | "bank_evidence"
  | "other";
export type DocumentVisibility = "Public" | "Restricted";
export type DocumentStatus = "Pending Verification" | "Valid" | "Rejected" | "Replaced"; // Missing and Expiring/Expired will be computed dynamically

export interface EmployeeDocument extends BaseRecord {
  employeeId: RecordId;
  type: DocumentType;
  fileId: string; // Required for all actual documents (missing ones are computed)
  documentNumber?: string | undefined;
  issueDate?: string | undefined;
  expiryDate?: string | undefined;
  issuingAuthority?: string | undefined;
  issuingCountry?: string | undefined;
  notes?: string | undefined;
  visibility: DocumentVisibility;
  status: DocumentStatus;
  rejectionReason?: string | undefined;
  replacedById?: RecordId | undefined; // ID of the newer version
  assignedOwnerId?: RecordId | undefined; // HR personnel assigned to follow up
  snoozedUntil?: string | undefined; // ISO Date string to pause reminders
  snoozeReason?: string | undefined;
  waiverReason?: string | undefined; // For resolving documents without replacement
}

export interface EmploymentHistory extends BaseRecord {
  employeeId: RecordId;
  effectiveDate: string;
  field: string;
  oldValue?: string | undefined;
  newValue?: string | undefined;
  reason: string;
}

export type NotificationPriority = "Low" | "Normal" | "High" | "Critical";
export type NotificationStatus = "Unread" | "Read" | "Dismissed";

export interface RecordLink {
  entityType: string;
  entityId: RecordId;
  path?: string | undefined;
}

export type VacancyStatus =
  "Draft" | "Pending Approval" | "Open" | "Paused" | "Closed" | "Archived";

export interface Vacancy extends BaseRecord {
  /** PostgreSQL UUID used while recruitment records still retain legacy browser IDs. */
  databaseId?: string;
  title: string;
  department: string;
  location: string;
  position: string;
  grade: string;
  employmentType: string;
  hiringManagerId?: RecordId | undefined;
  projectId?: RecordId | undefined;
  targetStartDate?: string | undefined;
  assignedOwnerId?: RecordId | undefined;
  status: VacancyStatus;
  summary: string;
  responsibilities: string[];
  requirements: string[];
  applicantCount: number;
  headcount: number;
  salaryRange?:
    { min: number; max: number; currency: string; visibleToPublic: boolean } | undefined;
  hiringReason: string;
  education: string;
  minimumExperience: string;
  skills: { required: string[]; preferred: string[] };
  certifications: string[];
  languages: string[];
  /** HR-approved statements that must remain in the published requirements. */
  mandatoryCriteria?: string[] | undefined;
  notes: string;
  screeningQuestions: string[];
}

export type CandidateStage =
  | "Sourced"
  | "Applied"
  | "Screened"
  | "Shortlisted"
  | "Interview"
  | "Offer"
  | "Hired"
  | "On Hold"
  | "Not Selected"
  | "Withdrawn"
  | "Archived";

// Canonical visa-status vocabulary, normalized from real recruitment-tracker usage
// (source data had "Own"/"own"/"Own visa"/"own visa" etc. as free text for the same meaning).
export const VISA_STATUS_OPTIONS = [
  "Own Visa",
  "Company Visa",
  "Freelance Visa",
  "Visit Visa",
  "Requires Sponsorship",
  "Omani (No Visa Required)",
  "Not Applicable",
  "Other",
] as const;
export type VisaStatus = (typeof VISA_STATUS_OPTIONS)[number];

// Canonical marital/family-status vocabulary, normalized from real recruitment-tracker usage
// (source data mixed marital status with residency/family-in-country status).
export const MARITAL_STATUS_OPTIONS = [
  "Single",
  "Married",
  "Married (With Family)",
  "Not Specified",
] as const;
export type MaritalStatus = (typeof MARITAL_STATUS_OPTIONS)[number];

export interface Candidate extends BaseRecord {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality?: string | undefined;
  location: string;
  currentCompany?: string | undefined;
  currentTitle?: string | undefined;
  linkedInUrl?: string | undefined;
  /** General resume on file, independent of any specific vacancy application (sourced/imported candidates have this without ever applying). */
  cvFileId?: RecordId | undefined;
  yearsOfExperience: number;
  stage: CandidateStage;
  doNotContact: boolean;
  hrOwnerId?: RecordId | undefined;
  recommender?: string | undefined;
  visaStatus?: VisaStatus | undefined;
  maritalStatus?: MaritalStatus | undefined;
  lastContactAt?: string | undefined;
  followUpStatus?: string | undefined;
  source?: string | undefined;
  aiScoreRange?: string | undefined;
  /** The client project this candidate is currently being sourced/tracked for. */
  projectId?: RecordId | undefined;
  /** Project name retained from HR trackers when it is not yet linked to master data. */
  projectName?: string | undefined;
  /** HR's project/category classification (for example Design or Supervision). */
  projectType?: string | undefined;
  /** Original shortlist marker supplied by HR, kept separately from workflow stage. */
  shortlistStatus?: string | undefined;
  /** Operational status supplied by HR, kept separately from workflow stage. */
  trackerStatus?: string | undefined;
  /** Free text - notice period phrasing varies too much in practice to fully structure (e.g. "10 days", "1 Month Notice Period"). */
  noticePeriod?: string | undefined;
  currentSalary?: string | undefined;
  expectedSalary?: string | undefined;
  /** The salary actually agreed/accepted, distinct from what was initially expected. */
  acceptedSalary?: string | undefined;
  /** Interview date recorded in the source tracker, before a formal interview record exists. */
  interviewDate?: string | undefined;
  remarks?: string | undefined;
  importProvenance?: string | undefined;
  /** Lossless source values retained for import traceability. */
  originalImportValues?: Record<string, string> | undefined;
  convertedToEmployeeId?: string | undefined;
  /** Set when this candidate record was merged into another (the survivor's ID) - kept around
   * for history rather than deleted, so old links/audit entries still resolve. */
  mergedIntoId?: string | undefined;
  /** Searchable, HR-confirmed profile information. CV extraction may propose values, but it must
   * never silently replace confirmed candidate information. */
  skills?: string[] | undefined;
  education?: string[] | undefined;
  certifications?: string[] | undefined;
  languages?: string[] | undefined;
  availability?: string | undefined;
  workEligibility?: string | undefined;
  talentPools?: string[] | undefined;
  consentStatus?: CandidateConsentStatus | undefined;
  consentUpdatedAt?: string | undefined;
  latestCvRecordId?: RecordId | undefined;
}

export type CandidateConsentStatus =
  "Confirmed" | "Privacy Notice Sent" | "Awaiting Confirmation" | "Refused" | "Expired";

export type CandidateCvSource =
  | "Careers Portal"
  | "Direct Email"
  | "WhatsApp"
  | "Employee Referral"
  | "Agency"
  | "Walk-in"
  | "HR Upload"
  | "Other";

export type CandidateCvProcessingStatus =
  "Uploaded" | "Extracting" | "Awaiting HR Review" | "Ready" | "Processing Failed";

export interface CandidateCvExtractedFields {
  firstName?: string | undefined;
  lastName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  location?: string | undefined;
  currentCompany?: string | undefined;
  currentTitle?: string | undefined;
  yearsOfExperience?: number | undefined;
  skills?: string[] | undefined;
  education?: string[] | undefined;
  certifications?: string[] | undefined;
  languages?: string[] | undefined;
}

export interface CandidateCvRecord extends BaseRecord {
  candidateId?: RecordId | undefined;
  applicationId?: RecordId | undefined;
  vacancyId?: RecordId | undefined;
  fileId: RecordId;
  originalFileName: string;
  source: CandidateCvSource;
  receivedAt: string;
  processingStatus: CandidateCvProcessingStatus;
  extractionMethod: "Candidate Provided" | "Local Preview" | "Python Service";
  extractedFields: CandidateCvExtractedFields;
  fieldConfidence: Partial<Record<keyof CandidateCvExtractedFields, number>>;
  extractionWarnings: string[];
  consentStatus: CandidateConsentStatus;
  notes?: string | undefined;
  reviewedAt?: string | undefined;
  reviewedByUserId?: RecordId | undefined;
  recommendationPending?: boolean | undefined;
  recommendationId?: RecordId | undefined;
}

export type CandidatePreparationStatus =
  "Queued" | "Processing" | "Ready" | "Needs Review" | "Processing Failed";

export type CandidatePreparationBand =
  | "Strong Match"
  | "Potential Match"
  | "Needs HR Review"
  | "Compulsory Criterion Not Confirmed"
  | "Processing Problem";

export interface CandidateCriterionCheck {
  criterion: string;
  status: "Confirmed" | "Needs Review";
  evidence?: string | undefined;
}

/** Reusable, inexpensive CV preparation. This is deliberately separate from detailed AI scoring. */
export interface CandidatePreparationRun extends BaseRecord {
  vacancyId: RecordId;
  vacancyRecordVersion: number;
  candidateId: RecordId;
  applicationId: RecordId;
  cvRecordId: RecordId;
  cvFileId: RecordId;
  cvChecksum?: string | undefined;
  status: CandidatePreparationStatus;
  documentRoute:
    | "Direct Text"
    | "Searchable PDF"
    | "Word Document"
    | "OCR Required"
    | "Reuse Prepared CV"
    | "Unknown";
  preparationMethod: "Local Preparation" | "Python Service";
  extractedProfile: CandidateCvExtractedFields;
  fieldConfidence: Partial<Record<keyof CandidateCvExtractedFields, number>>;
  preliminaryScore?: number | undefined;
  band?: CandidatePreparationBand | undefined;
  compulsoryChecks: CandidateCriterionCheck[];
  matchedSkills: string[];
  missingRequiredSkills: string[];
  evidence: string[];
  warnings: string[];
  reusedFromPreparationRunId?: RecordId | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  failureReason?: string | undefined;
}

export interface CandidateAssessmentInclusion extends BaseRecord {
  vacancyId: RecordId;
  candidateId: RecordId;
  cvRecordId: RecordId;
  source: "Recommended" | "HR Added";
  reason: string;
  active: boolean;
}

export interface CandidateAssessmentBatch extends BaseRecord {
  vacancyId: RecordId;
  vacancyRecordVersion: number;
  targetSize: number;
  rankedCandidateIds: RecordId[];
  selectedCandidateIds: RecordId[];
  recommendedCandidateIds: RecordId[];
  hrAddedCandidateIds: RecordId[];
  preparationRunIds: RecordId[];
  detailedScoreIds: RecordId[];
  status: "Draft" | "Assessment Completed" | "Cancelled";
}

export interface CandidateInterviewRecommendation extends BaseRecord {
  candidateId: RecordId;
  vacancyId: RecordId;
  applicationId: RecordId;
  cvRecordId?: RecordId | undefined;
  recommendedByUserId: RecordId;
  reason: string;
  assessmentScoreId?: RecordId | undefined;
  assessmentSource?: "Automatic Assessment" | "Existing Assessment" | undefined;
  /** Retained only so older browser records remain readable after migration. */
  screeningDecision?:
    "Run Assessment" | "Use Existing Assessment" | "Proceed Without Assessment" | undefined;
  status: "Ready for Assessment" | "Ready to Schedule" | "Interview Scheduled" | "Withdrawn";
}

export type ApplicationStatus =
  | "New"
  | "Shortlisted"
  | "On Hold"
  | "Interviewing"
  | "Offered"
  | "Hired"
  | "Rejected"
  | "Withdrawn";

export type ContactChannel = "Email" | "Phone" | "LinkedIn" | "In-Person" | "Other";
export type ContactOutcome =
  | "No Answer"
  | "Interested"
  | "Not Interested"
  | "Follow-up Required"
  | "Interview Arranged"
  | "Unavailable"
  | "Invalid Contact"
  | "Do Not Contact";

export interface CandidateContact extends BaseRecord {
  candidateId: RecordId;
  channel: ContactChannel;
  date: string;
  contactedByUserId: RecordId;
  vacancyId?: RecordId | undefined;
  outcome: ContactOutcome;
  notes: string;
  nextFollowUpDate?: string | undefined;
}

export type RecommenderType =
  "Agency" | "Employee Referral" | "External Person" | "Client" | "Supplier" | "Company";

export interface CandidateRecommendation extends BaseRecord {
  candidateId: RecordId;
  vacancyId?: RecordId | undefined;
  recommenderType: RecommenderType;
  recommenderName: string;
  recommenderCompany?: string | undefined;
  recommenderPosition?: string | undefined;
  recommenderEmail: string;
  recommenderPhone?: string | undefined;
  relationship?: string | undefined;
  date: string;
  notes: string;
  hrOwnerId: RecordId;
  commercialTerms?: string | undefined;
  sourceOutcome: string; // e.g. "Hired", "Rejected", "In Progress"
  employeeId?: RecordId | undefined;
}

export interface CandidateApplication extends BaseRecord {
  referenceId: string;
  candidateId: RecordId;
  vacancyId: RecordId;
  status: ApplicationStatus;
  cvFileId: RecordId;
  coverNote?: string | undefined;
  noticePeriod: string;
  salaryExpectation?: string | undefined;
  screeningAnswers: { question: string; answer: string }[];
  source: string;
  // Recorded per application, not on the candidate record, since consent is given for a specific
  // submission of data at a specific time - it is not a standing property of the person.
  consentGiven: boolean;
  consentedAt: string;
  hrInterviewRecommendationId?: RecordId | undefined;
  assessmentScoreId?: RecordId | undefined;
  preparationRunId?: RecordId | undefined;
  preparationStatus?: CandidatePreparationStatus | undefined;
  /** Retained only so older browser records remain readable after migration. */
  screeningDecision?: CandidateInterviewRecommendation["screeningDecision"] | undefined;
}

export interface Notification extends BaseRecord {
  recipientUserId: RecordId;
  type: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  status: NotificationStatus;
  dueAt?: string | undefined;
  readAt?: string | undefined;
  dismissedAt?: string | undefined;
  deduplicationKey?: string | undefined;
  link?: RecordLink | undefined;
}

export type ScoreCategory = "Experience" | "Location" | "Profile";

export interface CandidateScoreRun extends BaseRecord {
  vacancyId: RecordId;
  candidateId: RecordId;
  applicationId?: RecordId | undefined;
  cvRecordId?: RecordId | undefined;
  cvFileId?: RecordId | undefined;
  vacancyRecordVersion?: number | undefined;
  assessmentBatchId?: RecordId | undefined;
  timestamp: string;
  modelRulesVersion: string;
  vacancyVersion: string;
  overallScore: number;
  categoryScores: Record<ScoreCategory, number>;
  strengths: string[];
  risks: string[];
  missingData: string[];
  evidence: string;
}

export type AuditRiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface ShortlistOverride {
  candidateId: RecordId;
  type: "excluded_top" | "included_low" | "included_unscored";
  reason: string;
}

export interface ShortlistSnapshot extends BaseRecord {
  vacancyId: RecordId;
  targetSize: number;
  rankedCandidateIds: RecordId[]; // Top N candidates proposed by the system based on score
  selectedCandidateIds: RecordId[]; // The candidates HR manually chose
  pinnedCandidateIds?: RecordId[] | undefined;
  unselectedAction: "On Hold" | "Not Selected" | null;
  overrides: ShortlistOverride[];
  status: "Draft" | "Finalized";
}

export type InterviewStatus =
  "Proposed" | "Awaiting Candidate" | "Scheduled" | "Completed" | "Cancelled" | "No Show";

export type InterviewSource = "Scheduled Recruitment" | "Manual / Offline";
export type ManualInterviewOutcome = "Pending" | "Proceed" | "Hold" | "Reject" | "Selected";

export type InterviewDispositionOutcome =
  | "Proceed to Next Interview"
  | "Recommend for Offer"
  | "Future Consideration"
  | "Recommend for Another Role"
  | "Place on Hold"
  | "Do Not Proceed"
  | "Candidate Withdrew"
  | "No Show";

export interface InterviewDisposition extends BaseRecord {
  interviewId: RecordId;
  candidateId: RecordId;
  vacancyId?: RecordId | undefined;
  outcome: InterviewDispositionOutcome;
  reason: string;
  futureVacancyIds: RecordId[];
  suggestedRoleTitles: string[];
  recordedAt: string;
  recordedByUserId: RecordId;
}

export interface InterviewSlot {
  startTime: string; // ISO DateTime
  endTime: string;
  timezone: string;
}

export interface InterviewEvent extends BaseRecord {
  vacancyId?: RecordId | undefined;
  candidateId: RecordId;
  templateId?: string;
  source?: InterviewSource | undefined;
  /** The role discussed when no vacancy existed at the time of interview. */
  positionTitle?: string | undefined;
  projectName?: string | undefined;
  /** Actual date/time of an interview that happened outside the scheduling workflow. */
  occurredAt?: string | undefined;
  manualOutcome?: ManualInterviewOutcome | undefined;
  manualDecisionReason?: string | undefined;
  stageName: string;
  durationMinutes: number;
  panelUserIds: RecordId[];
  location: string;
  videoMethod: string;
  notes: string;
  status: InterviewStatus;
  confirmedSlot: InterviewSlot | null;
  proposedSlots: InterviewSlot[];
  calendarEventReference?: string | undefined;
  meetingReference?: string | undefined;
  meetingJoinUrl?: string | undefined;
  invitationDeliveryReferences?: string[] | undefined;
  /** Set once proposed slots are sent to the candidate for a response; cleared again once they
   * accept a slot (the interview moves to Scheduled) or decline (it moves back to Proposed). */
  candidateResponseStatus?: "Pending" | "Declined" | undefined;
  history: Array<{
    date: string;
    actor: string;
    action: string;
    details: string;
  }>;
}

export interface ScorecardCriterion {
  id: string;
  name: string;
  description: string;
  requiresEvidence: boolean;
  weight: number;
  minimumScore?: number | undefined;
  isCritical?: boolean | undefined;
}

export interface InterviewTemplate extends BaseRecord {
  name: string;
  criteria: ScorecardCriterion[];
  blindScoring: boolean;
  vacancyId?: RecordId | undefined;
  stageName?: string | undefined;
  aiDecisionWeight: number;
  interviewDecisionWeight: number;
}

export interface CriterionScore {
  criterionId: string;
  score: number; // 1 to 5
  evidence: string;
}

export type ScorecardRecommendation = "Strong Yes" | "Yes" | "Unsure" | "No";

export interface ScorecardRevision {
  date: string;
  actor: string;
  reason: string;
  previousStatus: "Draft" | "Submitted";
  previousScores: CriterionScore[];
  previousRecommendation: ScorecardRecommendation | null;
}

export interface InterviewScorecard extends BaseRecord {
  interviewId: RecordId;
  panelUserId: RecordId;
  status: "Draft" | "Submitted";
  scores: CriterionScore[];
  overallRecommendation: ScorecardRecommendation | null;
  submittedAt: string | null;
  revisionHistory: ScorecardRevision[];
}

export interface HiringDecisionSnapshot extends BaseRecord {
  vacancyId: RecordId;
  systemRecommendedCandidateId: RecordId | null;
  finalSelectedCandidateId: RecordId;
  overrideReason?: string;
  waiverReason?: string;
  decisionSource?: "Standard Recruitment" | "Manual Interview" | undefined;
  interviewId?: RecordId | undefined;
  status: "Draft" | "Finalized";
}

export type JobOfferStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Ready to Send"
  | "Sent"
  | "Accepted"
  | "Declined"
  | "Expired"
  | "Withdrawn";

export interface JobOffer extends BaseRecord {
  candidateId: RecordId;
  vacancyId: RecordId;
  status: JobOfferStatus;
  template: string;
  position: string;
  grade: string;
  salary: number; // sensitive
  currency: string; // sensitive
  allowances: string; // sensitive
  benefits: string; // sensitive
  startDate: string;
  probation: string;
  location: string;
  conditions: string;
  sentDate?: string;
  deliveryReference?: string | undefined;
  responseDeadline?: string;
  declineReason?: string;
  history: Array<{
    date: string;
    actor: string;
    action: string;
    details: string;
  }>;
  convertedToEmployeeId?: string | undefined;
}

export interface AuditActor {
  userId: RecordId;
  employeeId?: RecordId | undefined;
  displayName: string;
  workspaceEmail?: string | undefined;
  activeRole?: Role | undefined;
  roles: Role[];
  sessionId?: string | undefined;
}

export interface AuditEvent {
  id: RecordId;
  occurredAt: string;
  actor: AuditActor;
  action: string;
  module: string;
  entityType: string;
  entityId: RecordId;
  before?: unknown;
  after?: unknown;
  reason?: string | undefined;
  riskLevel: AuditRiskLevel;
}

export interface AppSettings extends BaseRecord {
  organisationName: string;
  timezone: string;
  baseCurrency: string;
  workingDays: number[];
  standardDailyHours: number;
  standardWeeklyHours: number;
  leaveYearStart: string;
  leaveYearEnd: string;
  documentReminderDays: number[];
  employeeNumberFormat: string;
  candidateReferenceFormat: string;
  schemaVersion: number;
  // New-hire self-service gate: when true, an employee with an in-progress onboarding
  // case and incomplete mandatory self-service tasks (personal details, bank details,
  // required documents) is routed to the onboarding form instead of the normal dashboard.
  requireOnboardingCompletionBeforeDashboard: boolean;
}

export interface FileOwner {
  entityType: string;
  entityId: RecordId;
}

export interface FileMetadata extends BaseRecord {
  name: string;
  mimeType: string;
  size: number;
  checksum?: string | undefined;
  owner: FileOwner;
}

export interface ActorContext {
  actor: AuditActor;
  reason?: string | undefined;
}

export const SYSTEM_ACTOR: AuditActor = {
  userId: "system",
  displayName: "VIA HR System",
  roles: ["Super Admin"],
  activeRole: "Super Admin",
};

/**
 * Reserved capability context for trusted workflow services and scheduled operations.
 * User-facing components must always pass the signed-in user's ActorContext instead.
 */
export const SYSTEM_CONTEXT: ActorContext = { actor: SYSTEM_ACTOR };
