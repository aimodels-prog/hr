import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { LocalRepository } from "./repository.ts";
import { ScorecardService } from "./scorecard-service.ts";
import {
  type ActorContext,
  type Candidate,
  type CandidateApplication,
  type InterviewDisposition,
  type InterviewDispositionOutcome,
  type InterviewEvent,
  type InterviewSlot,
  type InterviewStatus,
  type ManualInterviewOutcome,
} from "./types.ts";
import {
  getIntegrationProviderRegistry,
  IntegrationOperationService,
  LocalCalendarProvider,
  IntegrationGateway,
  type CalendarProvider,
} from "../integrations/index.ts";

export type SchedulingProvider = CalendarProvider;
export class LocalMockSchedulingProvider extends LocalCalendarProvider {}

// Completed, Cancelled, and No Show are terminal - none of them can be moved to any other
// status through this service, which previously allowed any transition unconditionally.
const INTERVIEW_STATUS_TRANSITIONS: Record<InterviewStatus, InterviewStatus[]> = {
  Proposed: ["Awaiting Candidate", "Scheduled", "Cancelled"],
  "Awaiting Candidate": ["Scheduled", "Cancelled"],
  Scheduled: ["Completed", "Cancelled", "No Show"],
  Completed: [],
  Cancelled: [],
  "No Show": [],
};

export class InterviewService {
  private interviewRepo: LocalRepository<InterviewEvent>;
  private candidateRepo: LocalRepository<Candidate>;
  private applicationRepo: LocalRepository<CandidateApplication>;
  private dispositionRepo: LocalRepository<InterviewDisposition>;
  private provider: CalendarProvider;
  private operations: IntegrationOperationService;
  private gateway: IntegrationGateway;

  constructor(provider?: CalendarProvider, operations?: IntegrationOperationService) {
    const { storage, audit } = getApplicationDataServices();
    this.interviewRepo = new LocalRepository<InterviewEvent>("interview_events", storage, audit, {
      module: "recruitment",
      entityType: "interview",
    });
    this.candidateRepo = new LocalRepository<Candidate>("candidates", storage, audit, {
      module: "candidates",
      entityType: "candidate",
    });
    this.applicationRepo = new LocalRepository<CandidateApplication>(
      "applications",
      storage,
      audit,
      {
        module: "applications",
        entityType: "candidate-application",
      },
    );
    this.dispositionRepo = new LocalRepository<InterviewDisposition>(
      "interview_dispositions",
      storage,
      audit,
      { module: "recruitment", entityType: "interview-disposition" },
    );
    this.provider = provider ?? getIntegrationProviderRegistry().calendar;
    this.operations = operations ?? new IntegrationOperationService();
    this.gateway = new IntegrationGateway();
  }

  private serverActor(context: ActorContext) {
    const user = getApplicationDataServices()
      .storage.readCollection<{ id: string; workspaceEmail?: string }>("users")
      .find((item) => item.id === context.actor.userId);
    return {
      actorId: context.actor.userId,
      ...(context.actor.workspaceEmail || user?.workspaceEmail
        ? { actorEmail: context.actor.workspaceEmail ?? user?.workspaceEmail }
        : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    };
  }

  private databaseVacancyId(id?: string): string | undefined {
    if (!id) return undefined;
    const vacancy = getApplicationDataServices()
      .storage.readCollection<{ id: string; databaseId?: string }>("vacancies")
      .find((item) => item.id === id || item.databaseId === id);
    return vacancy?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
  }

  private databaseUserIds(ids: string[]): string[] {
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      databaseId?: string;
    }>("users");
    return ids.map((id) => {
      const user = users.find((item) => item.id === id || item.databaseId === id);
      const databaseId = user?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
      if (!databaseId) throw new Error("A selected panel member is not connected to PostgreSQL.");
      return databaseId;
    });
  }

  private async refresh(context: ActorContext): Promise<void> {
    const { CandidateService } = await import("./candidate-service.ts");
    await new CandidateService().hydrateCompatibilityCache(context);
  }

  async createInterviewAsync(
    payload: Partial<InterviewEvent>,
    context: ActorContext,
  ): Promise<InterviewEvent> {
    if (!payload.candidateId || !payload.vacancyId || !payload.templateId)
      throw new Error("Vacancy, candidate and scorecard template are required.");
    const vacancyId = this.databaseVacancyId(payload.vacancyId);
    if (!vacancyId) throw new Error("The vacancy is not connected to PostgreSQL.");
    const { createInterviewFn } = await import("../server-functions/interview.server.ts");
    const id = await createInterviewFn({
      data: {
        actor: this.serverActor(context),
        candidateId: payload.candidateId,
        vacancyId,
        templateId: payload.templateId,
        source: "Scheduled Recruitment",
        stageName: payload.stageName ?? "Interview",
        durationMinutes: payload.durationMinutes ?? 30,
        panelUserIds: this.databaseUserIds(payload.panelUserIds ?? []),
        location: payload.location ?? "To be confirmed",
        videoMethod: payload.videoMethod ?? "To be confirmed",
        notes: payload.notes ?? "",
        proposedSlots: payload.proposedSlots ?? [],
      },
    });
    await this.refresh(context);
    return this.getInterviewById(id, context)!;
  }

  async createManualInterviewAsync(
    payload: {
      candidateId: string;
      vacancyId?: string | undefined;
      templateId: string;
      stageName: string;
      occurredAt: string;
      durationMinutes: number;
      timezone: string;
      panelUserIds: string[];
      positionTitle: string;
      projectName?: string | undefined;
      location: string;
      videoMethod: string;
      notes: string;
    },
    context: ActorContext,
  ): Promise<InterviewEvent> {
    const { createInterviewFn } = await import("../server-functions/interview.server.ts");
    const vacancyId = this.databaseVacancyId(payload.vacancyId);
    const id = await createInterviewFn({
      data: {
        actor: this.serverActor(context),
        candidateId: payload.candidateId,
        ...(vacancyId ? { vacancyId } : {}),
        templateId: payload.templateId,
        source: "Manual / Offline",
        stageName: payload.stageName,
        durationMinutes: payload.durationMinutes,
        panelUserIds: this.databaseUserIds(payload.panelUserIds),
        location: payload.location,
        videoMethod: payload.videoMethod,
        notes: payload.notes,
        occurredAt: payload.occurredAt,
        timezone: payload.timezone,
        positionTitle: payload.positionTitle,
        ...(payload.projectName ? { projectName: payload.projectName } : {}),
      },
    });
    await this.refresh(context);
    return this.getInterviewById(id, context)!;
  }

  async updateWorkflowAsync(
    interviewId: string,
    input: {
      action:
        "send-slots" | "candidate-accepted" | "candidate-declined" | "reschedule" | "change-status";
      slot?: InterviewSlot;
      status?: InterviewStatus;
      reason: string;
      waiver?: boolean;
    },
    context: ActorContext,
  ): Promise<InterviewEvent> {
    const interview = this.getInterviewById(interviewId, context);
    if (!interview) throw new Error("Interview not found.");
    const { updateInterviewWorkflowFn } = await import("../server-functions/interview.server.ts");
    await updateInterviewWorkflowFn({
      data: {
        actor: this.serverActor(context),
        interviewId,
        ...input,
        expectedRecordVersion: interview.recordVersion,
      },
    });
    await this.refresh(context);
    return this.getInterviewById(interviewId, context)!;
  }

  async recordDispositionAsync(
    interviewId: string,
    input: {
      outcome: InterviewDispositionOutcome;
      reason: string;
      futureVacancyIds?: string[];
      suggestedRoleTitles?: string[];
    },
    context: ActorContext,
  ): Promise<InterviewDisposition> {
    const { recordInterviewDispositionFn } =
      await import("../server-functions/interview.server.ts");
    const id = await recordInterviewDispositionFn({
      data: {
        actor: this.serverActor(context),
        interviewId,
        outcome: input.outcome,
        reason: input.reason,
        ...(input.futureVacancyIds
          ? {
              futureVacancyIds: input.futureVacancyIds.map((value) =>
                this.databaseVacancyId(value)!,
              ),
            }
          : {}),
        ...(input.suggestedRoleTitles ? { suggestedRoleTitles: input.suggestedRoleTitles } : {}),
      },
    });
    await this.refresh(context);
    return this.dispositionRepo.getById(id)!;
  }

  async recordManualOutcomeAsync(
    id: string,
    outcome: Exclude<ManualInterviewOutcome, "Pending">,
    reason: string,
    context: ActorContext,
  ): Promise<InterviewEvent> {
    const { recordManualInterviewOutcomeFn } =
      await import("../server-functions/interview.server.ts");
    await recordManualInterviewOutcomeFn({
      data: { actor: this.serverActor(context), interviewId: id, outcome, reason },
    });
    await this.refresh(context);
    return this.getInterviewById(id, context)!;
  }

  private canViewInterview(interview: InterviewEvent, context: ActorContext): boolean {
    return (
      context.actor.activeRole === "HR" ||
      context.actor.activeRole === "Super Admin" ||
      interview.panelUserIds.includes(context.actor.userId)
    );
  }

  private denyInterviewView(context: ActorContext, entityId: string): never {
    recordAccessDenied(getApplicationDataServices().audit, {
      module: "recruitment",
      entityType: "interview",
      entityId,
      action: "interview_view_denied",
      context,
    });
    throw new Error("You are not permitted to view this interview record.");
  }

  getInterviewRepository(context: ActorContext) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyInterviewView(context, "repository");
    }
    return this.interviewRepo;
  }

  getInterviews(context: ActorContext): InterviewEvent[] {
    return this.interviewRepo
      .list()
      .filter((interview) => this.canViewInterview(interview, context));
  }

  getInterviewById(interviewId: string, context: ActorContext): InterviewEvent | null {
    const interview = this.interviewRepo.getById(interviewId);
    if (!interview) return null;
    if (!this.canViewInterview(interview, context)) this.denyInterviewView(context, interviewId);
    return interview;
  }

  getInterviewsForCandidate(candidateId: string, context: ActorContext): InterviewEvent[] {
    const matching = this.interviewRepo.list().filter((i) => i.candidateId === candidateId);
    if (
      matching.length > 0 &&
      context.actor.activeRole !== "HR" &&
      context.actor.activeRole !== "Super Admin"
    ) {
      const visible = matching.filter((interview) =>
        interview.panelUserIds.includes(context.actor.userId),
      );
      if (visible.length === 0) this.denyInterviewView(context, candidateId);
      return visible;
    }
    return matching;
  }

  getInterviewsForVacancy(vacancyId: string, context: ActorContext): InterviewEvent[] {
    const matching = this.interviewRepo.list().filter((i) => i.vacancyId === vacancyId);
    if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") {
      return matching;
    }
    return matching.filter((interview) => interview.panelUserIds.includes(context.actor.userId));
  }

  getDispositionsForCandidate(candidateId: string, context: ActorContext): InterviewDisposition[] {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyInterviewView(context, candidateId);
    }
    return this.dispositionRepo
      .list()
      .filter((item) => item.candidateId === candidateId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  getDispositionForInterview(
    interviewId: string,
    context: ActorContext,
  ): InterviewDisposition | undefined {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      this.denyInterviewView(context, interviewId);
    }
    return this.dispositionRepo
      .list()
      .filter((item) => item.interviewId === interviewId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  }

  recordDisposition(
    interviewId: string,
    input: {
      outcome: InterviewDispositionOutcome;
      reason: string;
      futureVacancyIds?: string[];
      suggestedRoleTitles?: string[];
    },
    context: ActorContext,
  ): InterviewDisposition {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: interviewId,
        action: "record_interview_disposition_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can record the final interview recommendation.");
    }
    if (input.reason.trim().length < 5) throw new Error("Record a meaningful interview decision.");
    const interview = this.interviewRepo.getById(interviewId);
    if (!interview) throw new Error("Interview not found.");
    if (interview.status !== "Completed" && interview.status !== "No Show") {
      throw new Error("Complete the interview before recording the panel recommendation.");
    }
    const suggestedRoleTitles = [
      ...new Set((input.suggestedRoleTitles || []).map((item) => item.trim()).filter(Boolean)),
    ];
    const futureVacancyIds = [...new Set(input.futureVacancyIds || [])];
    if (
      input.outcome === "Recommend for Another Role" &&
      suggestedRoleTitles.length === 0 &&
      futureVacancyIds.length === 0
    ) {
      throw new Error("Add the role or vacancy this candidate is recommended for.");
    }
    const candidate = this.candidateRepo.getById(interview.candidateId);
    if (!candidate) throw new Error("Candidate not found.");
    const snapshot = getApplicationDataServices().storage.exportState();
    try {
      const existing = this.getDispositionForInterview(interview.id, context);
      const payload = {
        interviewId: interview.id,
        candidateId: candidate.id,
        vacancyId: interview.vacancyId,
        outcome: input.outcome,
        reason: input.reason.trim(),
        futureVacancyIds,
        suggestedRoleTitles,
        recordedAt: new Date().toISOString(),
        recordedByUserId: context.actor.userId,
      };
      const disposition = existing
        ? this.dispositionRepo.update(existing.id, payload, {
            ...context,
            reason: `Updated interview recommendation: ${input.reason.trim()}`,
          })
        : this.dispositionRepo.create(payload, {
            ...context,
            reason: `Recorded interview recommendation: ${input.reason.trim()}`,
          });

      const stage: Candidate["stage"] =
        input.outcome === "Recommend for Offer"
          ? "Offer"
          : input.outcome === "Proceed to Next Interview"
            ? "Interview"
            : input.outcome === "Do Not Proceed"
              ? "Not Selected"
              : input.outcome === "Candidate Withdrew"
                ? "Withdrawn"
                : "On Hold";
      const talentPools = [...(candidate.talentPools || [])];
      if (
        input.outcome === "Future Consideration" &&
        !talentPools.includes("Future Consideration")
      ) {
        talentPools.push("Future Consideration");
      }
      for (const role of suggestedRoleTitles) {
        const label = `Future role: ${role}`;
        if (!talentPools.includes(label)) talentPools.push(label);
      }
      this.candidateRepo.update(
        candidate.id,
        { stage, talentPools },
        { ...context, reason: input.reason.trim() },
      );
      if (interview.vacancyId) {
        const application = this.applicationRepo
          .list()
          .find(
            (item) => item.candidateId === candidate.id && item.vacancyId === interview.vacancyId,
          );
        if (application) {
          const status: CandidateApplication["status"] =
            input.outcome === "Do Not Proceed"
              ? "Rejected"
              : input.outcome === "Candidate Withdrew"
                ? "Withdrawn"
                : input.outcome === "Proceed to Next Interview" ||
                    input.outcome === "Recommend for Offer"
                  ? "Interviewing"
                  : "On Hold";
          this.applicationRepo.update(
            application.id,
            { status },
            { ...context, reason: input.reason.trim() },
          );
        }
      }
      return disposition;
    } catch (error) {
      getApplicationDataServices().storage.replaceState(snapshot);
      throw error;
    }
  }

  async proposeSlots(
    panelUserIds: string[],
    candidateId: string,
    startDate: Date,
    endDate: Date,
    durationMinutes: number,
    timezone: string,
    context: ActorContext,
  ): Promise<InterviewSlot[]> {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "candidate",
        entityId: candidateId,
        action: "propose_slots_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can propose interview slots.");
    }
    const operation = this.operations.start(
      {
        operationType: "calendar_availability",
        relatedEntityType: "candidate",
        relatedEntityId: candidateId,
        providerName: this.provider.metadata.name,
        requestSummary: {
          panelUserIds,
          candidateId,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          durationMinutes,
          timezone,
        },
      },
      context,
    );
    this.operations.beginAttempt(operation.id, context);
    try {
      const slots = await this.provider.findAvailability({
        panelUserIds,
        candidateId,
        startDate,
        endDate,
        durationMinutes,
        timezone,
      });
      this.operations.complete(operation.id, { slotCount: slots.length }, context, {
        status: this.provider.metadata.mode === "local" ? "Simulated" : "Completed",
      });
      return slots;
    } catch (error) {
      this.operations.fail(operation.id, error, context);
      throw error;
    }
  }

  createInterview(payload: Partial<InterviewEvent>, context: ActorContext): InterviewEvent {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: payload.candidateId ?? "unknown",
        action: "create_interview_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can schedule interviews.");
    }
    if (!payload.vacancyId || !payload.candidateId) {
      throw new Error("Vacancy and candidate are required to create an interview.");
    }
    if (!payload.templateId) {
      throw new Error("A scorecard template is required for every interview stage.");
    }
    if (!payload.panelUserIds?.length) {
      throw new Error("At least one panel member is required.");
    }
    return this.interviewRepo.create(
      {
        vacancyId: payload.vacancyId,
        candidateId: payload.candidateId,
        source: "Scheduled Recruitment",
        ...(payload.templateId ? { templateId: payload.templateId } : {}),
        stageName: payload.stageName ?? "Interview",
        durationMinutes: payload.durationMinutes ?? 30,
        panelUserIds: payload.panelUserIds ?? [],
        location: payload.location ?? "To be confirmed",
        videoMethod: payload.videoMethod ?? "To be confirmed",
        notes: payload.notes ?? "",
        status: "Proposed",
        confirmedSlot: null,
        proposedSlots: payload.proposedSlots ?? [],
        history: [
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Created",
            details: "Interview created and slots proposed.",
          },
        ],
      },
      context,
    );
  }

  createManualInterview(
    payload: {
      candidateId: string;
      vacancyId?: string | undefined;
      templateId: string;
      stageName: string;
      occurredAt: string;
      durationMinutes: number;
      timezone: string;
      panelUserIds: string[];
      positionTitle: string;
      projectName?: string | undefined;
      location: string;
      videoMethod: string;
      notes: string;
    },
    context: ActorContext,
  ): InterviewEvent {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: payload.candidateId,
        action: "create_manual_interview_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can record manual interviews.");
    }
    if (!this.candidateRepo.getById(payload.candidateId)) throw new Error("Candidate not found.");
    if (!payload.positionTitle.trim()) throw new Error("Position discussed is required.");
    if (!payload.stageName.trim()) throw new Error("Interview stage is required.");
    if (!payload.templateId) throw new Error("A scorecard template is required.");
    if (!payload.panelUserIds.length) throw new Error("At least one interviewer is required.");
    if (!payload.occurredAt || Number.isNaN(new Date(payload.occurredAt).getTime())) {
      throw new Error("A valid interview date and time is required.");
    }
    if (new Date(payload.occurredAt).getTime() > Date.now() + 5 * 60_000) {
      throw new Error("A manual interview must already have taken place.");
    }
    if (!Number.isFinite(payload.durationMinutes) || payload.durationMinutes < 1) {
      throw new Error("Interview duration must be greater than zero.");
    }

    const start = new Date(payload.occurredAt);
    const end = new Date(start.getTime() + payload.durationMinutes * 60_000);
    return this.interviewRepo.create(
      {
        ...(payload.vacancyId ? { vacancyId: payload.vacancyId } : {}),
        candidateId: payload.candidateId,
        templateId: payload.templateId,
        source: "Manual / Offline",
        positionTitle: payload.positionTitle.trim(),
        ...(payload.projectName?.trim() ? { projectName: payload.projectName.trim() } : {}),
        occurredAt: start.toISOString(),
        manualOutcome: "Pending",
        stageName: payload.stageName.trim(),
        durationMinutes: payload.durationMinutes,
        panelUserIds: payload.panelUserIds,
        location: payload.location.trim() || "Not recorded",
        videoMethod: payload.videoMethod.trim() || "In person",
        notes: payload.notes.trim(),
        status: "Completed",
        confirmedSlot: {
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          timezone: payload.timezone,
        },
        proposedSlots: [],
        history: [
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Manual interview recorded",
            details: `Recorded an interview that occurred on ${start.toISOString()} outside the scheduling workflow.`,
          },
        ],
      },
      { ...context, reason: context.reason || "Recorded completed manual interview" },
    );
  }

  recordManualOutcome(
    id: string,
    outcome: Exclude<ManualInterviewOutcome, "Pending">,
    reason: string,
    context: ActorContext,
  ): InterviewEvent {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: id,
        action: "record_manual_outcome_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can record interview outcomes.");
    }
    const interview = this.interviewRepo.getById(id);
    if (!interview) throw new Error("Interview not found.");
    if (interview.source !== "Manual / Offline") {
      throw new Error("This outcome action is only for manual interviews.");
    }
    if (reason.trim().length < 5) throw new Error("Enter a meaningful decision reason.");
    if (outcome === "Selected") {
      const metrics = new ScorecardService().calculateInterviewMetrics(id, interview.panelUserIds);
      if (!metrics.isComplete) {
        throw new Error("All assigned scorecards must be submitted before selection.");
      }
    }

    const updated = this.interviewRepo.update(
      id,
      {
        manualOutcome: outcome,
        manualDecisionReason: reason.trim(),
        history: [
          ...interview.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: `Manual outcome: ${outcome}`,
            details: reason.trim(),
          },
        ],
      },
      { ...context, reason: reason.trim() },
    );

    const stage =
      outcome === "Selected"
        ? "Offer"
        : outcome === "Hold"
          ? "On Hold"
          : outcome === "Reject"
            ? "Not Selected"
            : "Interview";
    this.candidateRepo.update(
      interview.candidateId,
      { stage },
      { ...context, reason: reason.trim() },
    );
    return updated;
  }

  // Two interviews sharing a panel member with overlapping confirmed times is a real scheduling
  // failure, not just a UI inconvenience - the panel member cannot physically attend both. This
  // is checked against every other Scheduled interview at confirm/reschedule time rather than
  // left for someone to notice on their calendar afterward.
  private assertNoPanelConflict(interview: InterviewEvent, slot: InterviewSlot): void {
    const newStart = new Date(slot.startTime).getTime();
    const newEnd = new Date(slot.endTime).getTime();
    const others = this.interviewRepo
      .list()
      .filter(
        (other) => other.id !== interview.id && other.status === "Scheduled" && other.confirmedSlot,
      );
    for (const other of others) {
      const overlappingPanelist = interview.panelUserIds.find((userId) =>
        other.panelUserIds.includes(userId),
      );
      if (!overlappingPanelist) continue;
      const otherStart = new Date(other.confirmedSlot!.startTime).getTime();
      const otherEnd = new Date(other.confirmedSlot!.endTime).getTime();
      const overlaps = newStart < otherEnd && otherStart < newEnd;
      if (overlaps) {
        throw new Error(
          `This time conflicts with panel member availability - they are already booked on another interview (${other.stageName}) from ${new Date(otherStart).toLocaleString()} to ${new Date(otherEnd).toLocaleString()}.`,
        );
      }
    }
  }

  // Marks proposed slots as sent out for the candidate to respond to - a distinct state from
  // "Proposed" (slots exist but haven't been shared yet) so the interview list can show HR what
  // it's actually waiting on.
  sendSlotsToCandidate(id: string, context: ActorContext): InterviewEvent {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: id,
        action: "send_slots_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can send proposed slots to a candidate.");
    }
    const interview = this.interviewRepo.getById(id);
    if (!interview) throw new Error("Interview not found");
    if (interview.status !== "Proposed") {
      throw new Error("Only an interview still in Proposed status can be sent to the candidate.");
    }
    if (!interview.proposedSlots.length) {
      throw new Error("There are no proposed slots to send.");
    }
    return this.interviewRepo.update(
      id,
      {
        status: "Awaiting Candidate",
        candidateResponseStatus: "Pending",
        history: [
          ...interview.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Slots sent to candidate",
            details: `${interview.proposedSlots.length} proposed time(s) sent for the candidate's response.`,
          },
        ],
      },
      context,
    );
  }

  // Records what the candidate actually said, rather than the interview silently sitting in
  // Awaiting Candidate forever. Acceptance confirms the chosen slot (going through the same
  // panel-conflict check as any other confirmation); decline reopens it for a fresh set of
  // proposed slots instead of leaving a dead half-scheduled record.
  async recordCandidateResponse(
    id: string,
    response: "Accepted" | "Declined",
    context: ActorContext,
    chosenSlot?: InterviewSlot,
    note?: string,
  ): Promise<InterviewEvent> {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: id,
        action: "record_candidate_response_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can record a candidate's response.");
    }
    const interview = this.interviewRepo.getById(id);
    if (!interview) throw new Error("Interview not found");
    if (interview.status !== "Awaiting Candidate") {
      throw new Error("This interview is not currently awaiting a candidate response.");
    }

    if (response === "Accepted") {
      if (!chosenSlot) throw new Error("The slot the candidate accepted is required.");
      return this.confirmInterview(id, chosenSlot, {
        ...context,
        reason: context.reason || "Candidate accepted a proposed slot",
      });
    }

    return this.interviewRepo.update(
      id,
      {
        status: "Proposed",
        candidateResponseStatus: "Declined",
        history: [
          ...interview.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Candidate declined proposed slots",
            details: note?.trim() || "None of the proposed times worked for the candidate.",
          },
        ],
      },
      { ...context, reason: context.reason || "Candidate declined proposed slots" },
    );
  }

  async confirmInterview(
    id: string,
    slot: InterviewSlot,
    context: ActorContext,
  ): Promise<InterviewEvent> {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: id,
        action: "confirm_interview_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can confirm interviews.");
    }
    const interview = this.interviewRepo.getById(id);
    if (!interview) throw new Error("Interview not found");
    if (!interview.vacancyId) {
      throw new Error("Manual interviews are already completed and cannot be scheduled.");
    }
    if (
      interview.status === "Completed" ||
      interview.status === "Cancelled" ||
      interview.status === "No Show"
    ) {
      throw new Error(
        `This interview is already ${interview.status} and cannot be confirmed or reconfirmed.`,
      );
    }

    this.assertNoPanelConflict(interview, slot);

    const { storage } = getApplicationDataServices();
    const candidate = storage
      .readCollection<{ id: string; firstName: string; lastName: string; email: string }>(
        "candidates",
      )
      .find((item) => item.id === interview.candidateId);
    const vacancy = storage
      .readCollection<{ id: string; title: string }>("vacancies")
      .find((item) => item.id === interview.vacancyId);
    const users = storage.readCollection<{ id: string; workspaceEmail: string }>("users");
    if (!candidate || !vacancy) throw new Error("Candidate or vacancy no longer exists.");
    const attendeeEmails = [
      candidate.email,
      ...interview.panelUserIds
        .map((userId) => users.find((user) => user.id === userId)?.workspaceEmail)
        .filter((email): email is string => Boolean(email)),
    ];
    const title = `${interview.stageName}: ${candidate.firstName} ${candidate.lastName} — ${vacancy.title}`;
    const relatedRecord = { entityType: "interview", entityId: interview.id };
    const meeting = await this.gateway.createMeeting(
      { title, startTime: slot.startTime, endTime: slot.endTime, attendeeEmails },
      relatedRecord,
      context,
    );
    const calendar = await this.gateway.createCalendarEvent(
      {
        title,
        attendeeEmails,
        startTime: slot.startTime,
        endTime: slot.endTime,
        timezone: slot.timezone,
        location: interview.location,
        description: [interview.notes, meeting.joinUrl ? `Meeting: ${meeting.joinUrl}` : ""]
          .filter(Boolean)
          .join("\n\n"),
      },
      relatedRecord,
      context,
    );
    const deliveries = await Promise.all(
      attendeeEmails.map((email) =>
        this.gateway.sendEmail(
          {
            to: [email],
            subject: `Interview scheduled: ${vacancy.title}`,
            textBody: `${title}\n${new Date(slot.startTime).toLocaleString()} (${slot.timezone})${meeting.joinUrl ? `\n${meeting.joinUrl}` : ""}`,
          },
          relatedRecord,
          context,
        ),
      ),
    );

    return this.interviewRepo.update(
      id,
      {
        status: "Scheduled",
        confirmedSlot: slot,
        calendarEventReference: calendar.eventReference,
        meetingReference: meeting.meetingReference,
        meetingJoinUrl: meeting.joinUrl,
        invitationDeliveryReferences: deliveries.map((delivery) => delivery.deliveryReference),
        history: [
          ...interview.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Confirmed",
            details: `Interview scheduled for ${new Date(slot.startTime).toLocaleString()} (${slot.timezone})`,
          },
        ],
      },
      context,
    );
  }

  async rescheduleInterview(
    id: string,
    newSlot: InterviewSlot,
    context: ActorContext,
  ): Promise<InterviewEvent> {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: id,
        action: "reschedule_interview_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can reschedule interviews.");
    }
    const interview = this.interviewRepo.getById(id);
    if (!interview) throw new Error("Interview not found");

    const oldTime = interview.confirmedSlot
      ? new Date(interview.confirmedSlot.startTime).toLocaleString()
      : "Unknown";

    const relatedRecord = { entityType: "interview", entityId: interview.id };
    if (interview.calendarEventReference) {
      await this.gateway.cancelCalendarEvent(
        interview.calendarEventReference,
        relatedRecord,
        context,
      );
    }
    if (interview.meetingReference) {
      await this.gateway.cancelMeeting(interview.meetingReference, relatedRecord, context);
    }

    await this.confirmInterview(id, newSlot, {
      ...context,
      reason: context.reason || "Interview rescheduled and local invitations regenerated",
    });
    const confirmed = this.interviewRepo.getById(id)!;
    return this.interviewRepo.update(
      id,
      {
        status: "Scheduled",
        confirmedSlot: newSlot,
        history: [
          ...confirmed.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Rescheduled",
            details: `Moved from ${oldTime} to ${new Date(newSlot.startTime).toLocaleString()} (${newSlot.timezone})`,
          },
        ],
      },
      context,
    );
  }

  changeStatus(
    id: string,
    status: InterviewStatus,
    reason: string,
    context: ActorContext,
    waiver?: boolean,
  ): InterviewEvent {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "interview",
        entityId: id,
        action: "interview_status_change_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can change interview status.");
    }
    if (!reason || reason.trim().length === 0) {
      throw new Error("A reason is required to change interview status.");
    }
    const interview = this.interviewRepo.getById(id);
    if (!interview) throw new Error("Interview not found");

    if (!INTERVIEW_STATUS_TRANSITIONS[interview.status].includes(status)) {
      throw new Error(`Interview cannot move from ${interview.status} to ${status}.`);
    }

    if (status === "Completed" && !waiver) {
      const scorecardService = new ScorecardService();
      const metrics = scorecardService.calculateInterviewMetrics(id, interview.panelUserIds);
      if (!metrics.isComplete) {
        throw new Error(
          "Cannot mark interview as completed because not all panel members have submitted their scorecards. A waiver is required.",
        );
      }
    }
    if (waiver && reason.trim().length < 10) {
      throw new Error(
        "A waiver requires a real recorded explanation (at least 10 characters), not a placeholder reason.",
      );
    }

    return this.interviewRepo.update(
      id,
      {
        status,
        history: [
          ...interview.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: `Status Changed to ${status}`,
            details: reason,
          },
        ],
      },
      context,
    );
  }
}
