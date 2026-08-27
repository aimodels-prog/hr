import type { ActorContext } from "../data/types.ts";
import { IntegrationOperationService } from "./operation-service.ts";
import { getIntegrationProviderRegistry } from "./provider-registry.ts";
import type {
  CalendarEventRequest,
  CalendarEventResult,
  EmailDeliveryRequest,
  EmailDeliveryResult,
  IntegrationCapability,
  IntegrationProviderRegistry,
  MeetingRequest,
  MeetingResult,
  WorkspaceIdentityRequest,
  WorkspaceIdentityResult,
} from "./types.ts";

export interface IntegrationRecordLink {
  entityType: string;
  entityId: string;
}

export class IntegrationGateway {
  constructor(
    private readonly providers: IntegrationProviderRegistry = getIntegrationProviderRegistry(),
    private readonly operations: IntegrationOperationService = new IntegrationOperationService(),
  ) {}

  sendEmail(
    request: EmailDeliveryRequest,
    relatedRecord: IntegrationRecordLink,
    context: ActorContext,
  ): Promise<EmailDeliveryResult> {
    return this.execute(
      "email_delivery",
      this.providers.email.metadata.name,
      this.providers.email.metadata.mode,
      relatedRecord,
      {
        recipients: request.to,
        subject: request.subject,
        hasHtmlBody: Boolean(request.htmlBody),
      },
      () => this.providers.email.send(request),
      (result) => ({ acceptedRecipients: result.acceptedRecipients }),
      (result) => result.deliveryReference,
      context,
    );
  }

  createCalendarEvent(
    request: CalendarEventRequest,
    relatedRecord: IntegrationRecordLink,
    context: ActorContext,
  ): Promise<CalendarEventResult> {
    return this.execute(
      "calendar_event",
      this.providers.calendar.metadata.name,
      this.providers.calendar.metadata.mode,
      relatedRecord,
      {
        title: request.title,
        attendeeCount: request.attendeeEmails.length,
        startTime: request.startTime,
        endTime: request.endTime,
        timezone: request.timezone,
      },
      () => this.providers.calendar.createEvent(request),
      (result) => ({ status: result.status }),
      (result) => result.eventReference,
      context,
    );
  }

  createMeeting(
    request: MeetingRequest,
    relatedRecord: IntegrationRecordLink,
    context: ActorContext,
  ): Promise<MeetingResult> {
    return this.execute(
      "meeting_link",
      this.providers.meeting.metadata.name,
      this.providers.meeting.metadata.mode,
      relatedRecord,
      {
        title: request.title,
        attendeeCount: request.attendeeEmails.length,
        startTime: request.startTime,
        endTime: request.endTime,
      },
      () => this.providers.meeting.createMeeting(request),
      (result) => ({ joinUrlCreated: Boolean(result.joinUrl) }),
      (result) => result.meetingReference,
      context,
    );
  }

  async cancelCalendarEvent(
    eventReference: string,
    relatedRecord: IntegrationRecordLink,
    context: ActorContext,
  ): Promise<{ cancelled: boolean }> {
    return this.execute(
      "calendar_event",
      this.providers.calendar.metadata.name,
      this.providers.calendar.metadata.mode,
      relatedRecord,
      { action: "cancel", eventReference },
      () => this.providers.calendar.cancelEvent(eventReference),
      (result) => ({ cancelled: result.cancelled }),
      () => eventReference,
      context,
    );
  }

  async cancelMeeting(
    meetingReference: string,
    relatedRecord: IntegrationRecordLink,
    context: ActorContext,
  ): Promise<{ cancelled: boolean }> {
    return this.execute(
      "meeting_link",
      this.providers.meeting.metadata.name,
      this.providers.meeting.metadata.mode,
      relatedRecord,
      { action: "cancel", meetingReference },
      () => this.providers.meeting.cancelMeeting(meetingReference),
      (result) => ({ cancelled: result.cancelled }),
      () => meetingReference,
      context,
    );
  }

  provisionWorkspaceIdentity(
    request: WorkspaceIdentityRequest,
    relatedRecord: IntegrationRecordLink,
    context: ActorContext,
  ): Promise<WorkspaceIdentityResult> {
    return this.execute(
      "workspace_identity",
      this.providers.workspaceIdentity.metadata.name,
      this.providers.workspaceIdentity.metadata.mode,
      relatedRecord,
      {
        employeeId: request.employeeId,
        primaryEmail: request.primaryEmail,
        displayName: request.displayName,
        organisationalUnit: request.organisationalUnit ?? null,
      },
      () => this.providers.workspaceIdentity.provisionIdentity(request),
      (result) => ({ primaryEmail: result.primaryEmail, status: result.status }),
      (result) => result.identityReference,
      context,
    );
  }

  private async execute<TResult>(
    operationType: IntegrationCapability,
    providerName: string,
    providerMode: "local" | "external",
    relatedRecord: IntegrationRecordLink,
    requestSummary: Record<string, unknown>,
    invoke: () => Promise<TResult>,
    responseSummary: (result: TResult) => Record<string, unknown>,
    externalReference: (result: TResult) => string | undefined,
    context: ActorContext,
  ): Promise<TResult> {
    const operation = this.operations.start(
      {
        operationType,
        relatedEntityType: relatedRecord.entityType,
        relatedEntityId: relatedRecord.entityId,
        providerName,
        requestSummary,
      },
      context,
    );
    this.operations.beginAttempt(operation.id, context);
    try {
      const result = await invoke();
      this.operations.complete(operation.id, responseSummary(result), context, {
        status: providerMode === "local" ? "Simulated" : "Completed",
        externalReference: externalReference(result),
      });
      return result;
    } catch (error) {
      this.operations.fail(operation.id, error, context);
      throw error;
    }
  }
}
