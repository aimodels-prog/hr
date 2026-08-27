import type {
  BaseRecord,
  Candidate,
  CandidateApplication,
  CandidateScoreRun,
  InterviewSlot,
  RecordId,
  Vacancy,
} from "../data/types.ts";

export const INTEGRATION_CAPABILITIES = [
  "job_description",
  "candidate_scoring",
  "email_delivery",
  "calendar_availability",
  "calendar_event",
  "meeting_link",
  "workspace_identity",
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

export const INTEGRATION_OPERATION_STATUSES = [
  "Not Required",
  "Pending",
  "Simulated",
  "Ready to Sync",
  "Completed",
  "Failed",
] as const;

export type IntegrationOperationStatus = (typeof INTEGRATION_OPERATION_STATUSES)[number];

export interface IntegrationOperation extends BaseRecord {
  operationType: IntegrationCapability;
  relatedEntityType: string;
  relatedEntityId: RecordId;
  providerName: string;
  status: IntegrationOperationStatus;
  requestSummary: Record<string, unknown>;
  responseSummary?: Record<string, unknown> | undefined;
  externalReference?: string | undefined;
  attemptedAt?: string | undefined;
  completedAt?: string | undefined;
  failureReason?: string | undefined;
  retryCount: number;
}

export interface JobFacts {
  title: string;
  department: string;
  location: string;
  employmentType: string;
  education: string;
  minimumExperience: string;
  skills: { required: string[]; preferred: string[] };
  languages: string[];
  mandatoryCriteria: string[];
}

export interface GeneratedJobDescription {
  summary: string;
  responsibilities: string[];
  requirements: string[];
}

export type CandidateScorePayload = Omit<
  CandidateScoreRun,
  "id" | "createdAt" | "updatedAt" | "recordVersion" | "createdBy" | "updatedBy"
>;

export interface EmailDeliveryRequest {
  to: string[];
  subject: string;
  textBody: string;
  htmlBody?: string | undefined;
  replyTo?: string | undefined;
}

export interface EmailDeliveryResult {
  deliveryReference: string;
  acceptedRecipients: string[];
}

export interface CalendarAvailabilityRequest {
  panelUserIds: string[];
  candidateId: string;
  startDate: Date;
  endDate: Date;
  durationMinutes: number;
  timezone: string;
}

export interface CalendarEventRequest {
  title: string;
  attendeeEmails: string[];
  startTime: string;
  endTime: string;
  timezone: string;
  description?: string | undefined;
  location?: string | undefined;
}

export interface CalendarEventResult {
  eventReference: string;
  status: "simulated" | "confirmed";
}

export interface MeetingRequest {
  title: string;
  startTime: string;
  endTime: string;
  attendeeEmails: string[];
}

export interface MeetingResult {
  meetingReference: string;
  joinUrl?: string | undefined;
}

export interface WorkspaceIdentityRequest {
  employeeId: string;
  primaryEmail: string;
  displayName: string;
  organisationalUnit?: string | undefined;
}

export interface WorkspaceIdentityResult {
  identityReference: string;
  primaryEmail: string;
  status: "simulated" | "provisioned";
}

export interface IntegrationProviderMetadata {
  name: string;
  mode: "local" | "external";
  capabilities: readonly IntegrationCapability[];
}

export interface AiProvider {
  readonly metadata: IntegrationProviderMetadata;
  generateJobDescription(facts: JobFacts): Promise<GeneratedJobDescription>;
  scoreCandidate(
    candidate: Candidate,
    vacancy: Vacancy,
    application?: CandidateApplication,
  ): CandidateScorePayload;
}

export interface EmailProvider {
  readonly metadata: IntegrationProviderMetadata;
  send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult>;
}

export interface CalendarProvider {
  readonly metadata: IntegrationProviderMetadata;
  findAvailability(request: CalendarAvailabilityRequest): Promise<InterviewSlot[]>;
  createEvent(request: CalendarEventRequest): Promise<CalendarEventResult>;
  cancelEvent(eventReference: string): Promise<{ cancelled: boolean }>;
}

export interface MeetingProvider {
  readonly metadata: IntegrationProviderMetadata;
  createMeeting(request: MeetingRequest): Promise<MeetingResult>;
  cancelMeeting(meetingReference: string): Promise<{ cancelled: boolean }>;
}

export interface WorkspaceIdentityProvider {
  readonly metadata: IntegrationProviderMetadata;
  provisionIdentity(request: WorkspaceIdentityRequest): Promise<WorkspaceIdentityResult>;
}

export interface IntegrationProviderRegistry {
  ai: AiProvider;
  email: EmailProvider;
  calendar: CalendarProvider;
  meeting: MeetingProvider;
  workspaceIdentity: WorkspaceIdentityProvider;
}
