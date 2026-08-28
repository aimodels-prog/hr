import { SYSTEM_CONTEXT } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { LocalRepository } from "./repository.ts";
import type {
  ActorContext,
  HiringDecisionSnapshot,
  InterviewEvent,
  JobOffer,
  JobOfferStatus,
  Vacancy,
} from "./types.ts";
import { InterviewService } from "./interview-service.ts";
import { ScorecardService } from "./scorecard-service.ts";
import { CandidateService } from "./candidate-service.ts";
import { ShortlistService } from "./shortlist-service.ts";
import { ConversionService } from "./conversion-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { IntegrationGateway } from "../integrations/index.ts";
import { VacancyService } from "./vacancy-service.ts";

// salary, allowances, and benefits are compensation data - restricted to HR, Accounts, and Super
// Admin at the data layer itself, not only hidden by whichever screen happens to render it. A
// caller with no context at all gets the redacted view by default (fail safe), not the raw one.
function redactOffer(offer: JobOffer, context: ActorContext): JobOffer {
  const role = context.actor.activeRole;
  const canSeeCompensation = role === "HR" || role === "Accounts" || role === "Super Admin";
  if (canSeeCompensation) return offer;
  return {
    ...offer,
    salary: 0,
    allowances: "Restricted",
    benefits: "Restricted",
  };
}

const OFFER_TRANSITIONS: Record<JobOfferStatus, JobOfferStatus[]> = {
  Draft: ["Pending Approval", "Withdrawn"],
  "Pending Approval": ["Approved", "Draft", "Withdrawn"],
  Approved: ["Ready to Send", "Withdrawn"],
  "Ready to Send": ["Sent", "Withdrawn"],
  Sent: ["Accepted", "Declined", "Expired", "Withdrawn"],
  Accepted: [],
  Declined: [],
  Expired: [],
  Withdrawn: [],
};

/**
 * Best-effort timestamp for when an interview actually took place, used to determine which of a
 * candidate's completed interviews is the most recent one. Manual/offline interviews record the
 * real occurrence time in `occurredAt`; scheduled interviews carry it in `confirmedSlot`. If
 * neither is present, fall back to the record's last-updated time.
 */
function getInterviewRecencyTimestamp(interview: InterviewEvent): number {
  const raw = interview.occurredAt ?? interview.confirmedSlot?.startTime ?? interview.updatedAt;
  const parsed = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface DecisionRecommendationResult {
  recommendedCandidateId: string | null;
  candidatesData: Array<{
    candidateId: string;
    overallScore: number;
    interviewScore: number;
    aiScore: number;
    missingInterviews: boolean;
    risks: string[];
    recommendations: string[];
    criticalFailure: boolean;
  }>;
  hasMissingInterviews: boolean;
}

export class OfferService {
  private decisionRepo: LocalRepository<HiringDecisionSnapshot>;
  private offerRepo: LocalRepository<JobOffer>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.decisionRepo = new LocalRepository<HiringDecisionSnapshot>(
      "hiring_decisions",
      storage,
      audit,
      { module: "recruitment", entityType: "decision" },
    );
    this.offerRepo = new LocalRepository<JobOffer>("job_offers", storage, audit, {
      module: "recruitment",
      entityType: "offer",
    });
  }

  private requireOfferView(context: ActorContext, entityId: string): void {
    if (context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin") return;
    recordAccessDenied(getApplicationDataServices().audit, {
      module: "recruitment",
      entityType: "offer",
      entityId,
      action: "offer_view_denied",
      context,
    });
    throw new Error("Only HR or Super Admin can view hiring decisions and offers.");
  }

  getDecisionsForVacancy(vacancyId: string, context: ActorContext): HiringDecisionSnapshot[] {
    this.requireOfferView(context, vacancyId);
    return this.decisionRepo.list().filter((d) => d.vacancyId === vacancyId);
  }

  getDecisionForInterview(
    interviewId: string,
    context: ActorContext,
  ): HiringDecisionSnapshot | null {
    this.requireOfferView(context, interviewId);
    return (
      this.decisionRepo
        .list()
        .find(
          (decision) => decision.interviewId === interviewId && decision.status === "Finalized",
        ) ?? null
    );
  }

  getAllOffers(context: ActorContext): JobOffer[] {
    this.requireOfferView(context, "all");
    return this.offerRepo.list().map((o) => redactOffer(o, context));
  }

  getOfferById(id: string, context: ActorContext): JobOffer | null {
    this.requireOfferView(context, id);
    const offer = this.offerRepo.getById(id);
    return offer ? redactOffer(offer, context) : null;
  }

  getOffersForVacancy(vacancyId: string, context: ActorContext): JobOffer[] {
    this.requireOfferView(context, vacancyId);
    return this.offerRepo
      .list()
      .filter((o) => o.vacancyId === vacancyId)
      .map((o) => redactOffer(o, context));
  }

  getOffersForCandidate(candidateId: string, context: ActorContext): JobOffer[] {
    this.requireOfferView(context, candidateId);
    return this.offerRepo
      .list()
      .filter((o) => o.candidateId === candidateId)
      .map((o) => redactOffer(o, context));
  }

  calculateDecisionRecommendation(
    vacancyId: string,
    context: ActorContext,
  ): DecisionRecommendationResult {
    this.requireOfferView(context, vacancyId);
    const candidateService = new CandidateService();
    const shortlistService = new ShortlistService();
    const interviewService = new InterviewService();
    const scorecardService = new ScorecardService();

    // Find finalists (candidates in the finalized shortlist)
    const latestShortlist = shortlistService.getFinalizedForVacancy(vacancyId);

    if (!latestShortlist) {
      return { recommendedCandidateId: null, candidatesData: [], hasMissingInterviews: false };
    }

    const candidateIds = latestShortlist.selectedCandidateIds;
    const allInterviews = interviewService.getInterviewsForVacancy(vacancyId, context);
    const latestScores = candidateService.getLatestScoresForVacancy(vacancyId, context);

    const candidatesData = candidateIds
      .map((candidateId: string) => {
        const candidate = candidateService
          .getDetailedCandidates(context)
          .find((c) => c.id === candidateId);
        if (!candidate) return null;

        // 1. Get AI Score
        const aiScoreRun = latestScores.find((s) => s.candidateId === candidateId);
        const aiScore = aiScoreRun ? aiScoreRun.overallScore : 0;
        const risks = aiScoreRun ? [...aiScoreRun.risks] : [];

        // 2. Get Interview Scores
        const candidateInterviews = allInterviews.filter((i) => i.candidateId === candidateId);
        let missingInterviews = candidateInterviews.length === 0;
        let totalInterviewScore = 0;
        let validInterviewCount = 0;
        let criticalFailure = false;
        const recommendations: string[] = [];

        candidateInterviews.forEach((interview) => {
          if (interview.status !== "Completed") {
            missingInterviews = true;
          }

          if (interview.templateId) {
            const metrics = scorecardService.calculateInterviewMetrics(
              interview.id,
              interview.panelUserIds,
            );
            if (!metrics.isComplete) {
              missingInterviews = true;
            }
            if (metrics.criticalFailure) criticalFailure = true;
            if (metrics.averageScore > 0) {
              totalInterviewScore += metrics.averageScore;
              validInterviewCount++;
            }
            const scorecards = scorecardService.getScorecardsForInterview(interview.id);
            scorecards.forEach((sc) => {
              if (sc.overallRecommendation) recommendations.push(sc.overallRecommendation);
            });
          } else {
            missingInterviews = true;
          }
        });

        if (criticalFailure) risks.push("Failed at least one critical interview criterion.");

        const avgInterviewScore =
          validInterviewCount > 0 ? totalInterviewScore / validInterviewCount : 0;
        // Normalize Interview Score (out of 5) to out of 100
        const normalizedInterviewScore = avgInterviewScore * 20;

        // Determine the decision-weight template from the candidate's own completed interview(s)
        // for this vacancy, not a generic "applicable templates" lookup — a customized template
        // (e.g. Technical Interview) must actually drive the blend for the candidate it was used
        // to score. If multiple completed interviews used different templates, the most recent
        // one wins; averaging across multiple stage templates is a reasonable follow-up
        // enhancement but is out of scope for this fix.
        const mostRecentTemplatedInterview = candidateInterviews
          .filter((interview) => interview.status === "Completed" && interview.templateId)
          .sort((a, b) => getInterviewRecencyTimestamp(b) - getInterviewRecencyTimestamp(a))[0];
        let decisionTemplate = mostRecentTemplatedInterview
          ? scorecardService.getTemplateById(mostRecentTemplatedInterview.templateId!)
          : null;
        if (!decisionTemplate) {
          // Fallback only: no completed interview with a template exists yet for this candidate
          // on this vacancy (e.g. still pending, or recorded without a template at all). This
          // picks a generically-applicable template rather than the one actually used to score
          // the candidate, and is a last resort — not the primary path.
          decisionTemplate = scorecardService.getApplicableTemplates(vacancyId)[0] ?? null;
        }
        const aiWeight = (decisionTemplate?.aiDecisionWeight ?? 40) / 100;
        const interviewWeight = (decisionTemplate?.interviewDecisionWeight ?? 60) / 100;
        const overallScore = aiScore * aiWeight + normalizedInterviewScore * interviewWeight;

        return {
          candidateId,
          overallScore,
          interviewScore: avgInterviewScore,
          aiScore,
          missingInterviews,
          risks,
          recommendations,
          criticalFailure,
        };
      })
      .filter(Boolean) as DecisionRecommendationResult["candidatesData"];

    // Find if any candidate has missing interviews
    const hasMissingInterviews = candidatesData.some((c) => c.missingInterviews);

    // Sort by overall score
    candidatesData.sort(
      (a, b) =>
        Number(a.criticalFailure) - Number(b.criticalFailure) || b.overallScore - a.overallScore,
    );
    const recommendedCandidateId = candidatesData[0]?.candidateId ?? null;

    return {
      recommendedCandidateId,
      candidatesData,
      hasMissingInterviews,
    };
  }

  finalizeDecision(
    vacancyId: string,
    selectedCandidateId: string,
    overrideReason: string | undefined,
    waiverReason: string | undefined,
    context: ActorContext,
  ): HiringDecisionSnapshot {
    this.requireHr(context);

    const existingFinalized = this.decisionRepo
      .list()
      .find((d) => d.vacancyId === vacancyId && d.status === "Finalized");
    if (existingFinalized) {
      throw new Error(
        `A hiring decision has already been finalised for this vacancy (candidate ${existingFinalized.finalSelectedCandidateId}). It must be reversed before a new decision can be made.`,
      );
    }

    const recommendation = this.calculateDecisionRecommendation(vacancyId, context);

    if (!recommendation.candidatesData.some((c) => c.candidateId === selectedCandidateId)) {
      throw new Error(
        "The selected candidate is not part of the finalized shortlist for this vacancy.",
      );
    }

    if (recommendation.hasMissingInterviews && !waiverReason) {
      throw new Error(
        "Decision is blocked because required interview data is missing. An authorised waiver reason must be provided.",
      );
    }

    if (recommendation.recommendedCandidateId !== selectedCandidateId && !overrideReason) {
      throw new Error(
        "You must provide an override reason when selecting a candidate other than the system recommendation.",
      );
    }

    // Update candidate stage to "Offer" (or keep as Interview until offer is sent, but usually 'Offer' means Offer phase)
    const candidateService = new CandidateService();
    candidateService.updateCandidateStage(selectedCandidateId, "Offer", context);
    candidateService.updateApplicationStatus(selectedCandidateId, vacancyId, "Offered", context);
    for (const finalist of recommendation.candidatesData) {
      if (finalist.candidateId === selectedCandidateId) continue;
      candidateService.updateCandidateStage(finalist.candidateId, "On Hold", {
        ...context,
        reason: context.reason || "Placed on hold after another finalist was selected",
      });
    }

    return this.decisionRepo.create(
      {
        vacancyId,
        systemRecommendedCandidateId: recommendation.recommendedCandidateId,
        finalSelectedCandidateId: selectedCandidateId,
        ...(overrideReason ? { overrideReason } : {}),
        ...(waiverReason ? { waiverReason } : {}),
        status: "Finalized",
      },
      context,
    );
  }

  prepareManualInterviewHire(
    interviewId: string,
    details: {
      position: string;
      department: string;
      location: string;
      employmentType: string;
      grade: string;
    },
    reason: string,
    context: ActorContext,
  ): { vacancy: Vacancy; decision: HiringDecisionSnapshot } {
    this.requireHr(context);
    if (reason.trim().length < 5) throw new Error("A direct-hire reason is required.");
    if (
      !details.position.trim() ||
      !details.department.trim() ||
      !details.location.trim() ||
      !details.employmentType.trim() ||
      !details.grade.trim()
    ) {
      throw new Error("Position, department, location, employment type, and grade are required.");
    }

    const interviewService = new InterviewService();
    const interview = interviewService.getInterviewRepository(context).getById(interviewId);
    if (!interview) throw new Error("Interview not found.");
    if (interview.source !== "Manual / Offline" || interview.manualOutcome !== "Selected") {
      throw new Error("The manual interview must have a Selected outcome before proceeding.");
    }
    const metrics = new ScorecardService().calculateInterviewMetrics(
      interview.id,
      interview.panelUserIds,
    );
    if (!metrics.isComplete) throw new Error("All assigned scorecards must be submitted first.");

    const existingDecision = this.decisionRepo
      .list()
      .find((item) => item.interviewId === interviewId && item.status === "Finalized");
    if (existingDecision) {
      const existingVacancy = new VacancyService()
        .getVacancyRepository()
        .getById(existingDecision.vacancyId);
      if (!existingVacancy) throw new Error("The direct-hire vacancy record is missing.");
      return { vacancy: existingVacancy, decision: existingDecision };
    }

    const vacancyService = new VacancyService();
    let vacancy = interview.vacancyId
      ? vacancyService.getVacancyRepository().getById(interview.vacancyId)
      : null;
    if (!vacancy) {
      vacancy = vacancyService.saveDraft(
        {
          title: `${details.position.trim()} — Direct Hire`,
          position: details.position.trim(),
          department: details.department.trim(),
          location: details.location.trim(),
          grade: details.grade.trim(),
          employmentType: details.employmentType.trim(),
          headcount: 1,
          hiringReason: "Selected through a recorded manual interview",
          summary: `Administrative hiring record created from manual interview ${interview.id}.`,
          responsibilities: [],
          requirements: [],
          education: "",
          minimumExperience: "",
          skills: { required: [], preferred: [] },
          certifications: [],
          languages: [],
          notes: reason.trim(),
          screeningQuestions: [],
        },
        { ...context, reason: "Created administrative direct-hire vacancy" },
      );
      vacancyService.closeVacancy(
        vacancy.id,
        "Administrative record only — no public recruitment process",
        context,
      );
      vacancy = vacancyService.getVacancyRepository().getById(vacancy.id)!;
    }

    interviewService.getInterviewRepository(context).update(
      interview.id,
      {
        vacancyId: vacancy.id,
        positionTitle: details.position.trim(),
        history: [
          ...interview.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Proceed to hire",
            details: reason.trim(),
          },
        ],
      },
      { ...context, reason: reason.trim() },
    );

    const decision = this.decisionRepo.create(
      {
        vacancyId: vacancy.id,
        systemRecommendedCandidateId: interview.candidateId,
        finalSelectedCandidateId: interview.candidateId,
        overrideReason: reason.trim(),
        decisionSource: "Manual Interview",
        interviewId: interview.id,
        status: "Finalized",
      },
      { ...context, reason: reason.trim() },
    );
    new CandidateService().updateCandidateStage(interview.candidateId, "Offer", {
      ...context,
      reason: reason.trim(),
    });
    return { vacancy, decision };
  }

  createOffer(
    payload: Omit<
      JobOffer,
      | keyof import("./types").BaseRecord
      | "status"
      | "history"
      | "convertedToEmployeeId"
      | "sentDate"
      | "deliveryReference"
      | "declineReason"
    >,
    context: ActorContext,
  ): JobOffer {
    this.requireHr(context);
    this.validateOffer(payload);
    const decision = this.getDecisionsForVacancy(payload.vacancyId, context).find(
      (item) =>
        item.status === "Finalized" && item.finalSelectedCandidateId === payload.candidateId,
    );
    if (!decision)
      throw new Error(
        "A finalized hiring decision for this candidate is required before creating an offer.",
      );
    const duplicate = this.getOffersForCandidate(payload.candidateId, context).find(
      (offer) =>
        offer.vacancyId === payload.vacancyId &&
        !["Declined", "Expired", "Withdrawn"].includes(offer.status),
    );
    if (duplicate)
      throw new Error("An active offer already exists for this candidate and vacancy.");
    return this.offerRepo.create(
      {
        ...payload,
        status: "Draft",
        history: [
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Created",
            details: "Draft offer created.",
          },
        ],
      },
      context,
    );
  }

  updateOffer(
    id: string,
    payload: Partial<
      Pick<
        JobOffer,
        | "template"
        | "position"
        | "grade"
        | "salary"
        | "allowances"
        | "benefits"
        | "startDate"
        | "probation"
        | "location"
        | "conditions"
        | "responseDeadline"
      >
    >,
    context: ActorContext,
  ): JobOffer {
    this.requireHr(context);
    const offer = this.offerRepo.getById(id);
    if (!offer) throw new Error("Offer not found");
    if (offer.status !== "Draft") throw new Error("Only draft offers can be edited.");
    const next = { ...offer, ...payload };
    this.validateOffer(next);
    return this.offerRepo.update(
      id,
      {
        ...payload,
        history: [
          ...offer.history,
          {
            date: new Date().toISOString(),
            actor: context.actor.displayName || context.actor.userId,
            action: "Draft updated",
            details: context.reason || "Offer details updated.",
          },
        ],
      },
      context,
    );
  }

  private validateOffer(
    offer: Pick<
      JobOffer,
      | "candidateId"
      | "vacancyId"
      | "template"
      | "position"
      | "grade"
      | "salary"
      | "currency"
      | "startDate"
      | "location"
      | "responseDeadline"
    >,
  ) {
    if (!offer.candidateId || !offer.vacancyId)
      throw new Error("Candidate and vacancy are required.");
    if (
      !offer.template.trim() ||
      !offer.position.trim() ||
      !offer.grade.trim() ||
      !offer.location.trim()
    ) {
      throw new Error("Template, position, grade, and location are required.");
    }
    if (!Number.isFinite(offer.salary) || offer.salary <= 0)
      throw new Error("Salary must be greater than zero.");
    if (!offer.currency?.trim()) throw new Error("A salary currency is required.");
    if (!offer.startDate) throw new Error("Start date is required.");
    if (offer.responseDeadline && offer.responseDeadline < new Date().toISOString().slice(0, 10)) {
      throw new Error("Response deadline cannot be in the past.");
    }
  }

  updateOfferStatus(
    id: string,
    status: JobOfferStatus,
    reason: string | undefined,
    context: ActorContext,
  ): JobOffer {
    this.requireHr(context);
    const offer = this.offerRepo.getById(id);
    if (!offer) throw new Error("Offer not found");
    if (!OFFER_TRANSITIONS[offer.status].includes(status)) {
      throw new Error(`Offer cannot move from ${offer.status} to ${status}.`);
    }
    if (["Declined", "Withdrawn"].includes(status) && !reason?.trim()) {
      throw new Error(`A reason is required when an offer is ${status.toLowerCase()}.`);
    }

    const updates: Partial<JobOffer> = {
      status,
      history: [
        ...offer.history,
        {
          date: new Date().toISOString(),
          actor: context.actor.displayName || context.actor.userId,
          action: `Status changed to ${status}`,
          details: reason || "No details provided",
        },
      ],
    };

    if (status === "Sent") {
      updates.sentDate = new Date().toISOString();
    } else if (status === "Declined" && reason !== undefined) {
      updates.declineReason = reason;
    }

    const updated = this.offerRepo.update(id, updates, context);

    return updated;
  }

  async transitionOffer(
    id: string,
    status: JobOfferStatus,
    reason: string | undefined,
    context: ActorContext,
  ): Promise<JobOffer> {
    this.requireHr(context);
    const current = this.getOfferById(id, context);
    if (!current) throw new Error("Offer not found");
    if (!OFFER_TRANSITIONS[current.status].includes(status)) {
      throw new Error(`Offer cannot move from ${current.status} to ${status}.`);
    }
    let deliveryReference: string | undefined;
    if (status === "Sent") {
      const candidate = new CandidateService().getCandidate(current.candidateId, context);
      if (!candidate) throw new Error("Candidate not found");
      const delivery = await new IntegrationGateway().sendEmail(
        {
          to: [candidate.email],
          subject: `Employment offer — ${current.position}`,
          textBody: `Dear ${candidate.firstName}, your VIA employment offer for ${current.position} is ready. Please respond by ${current.responseDeadline || "the stated deadline"}.`,
        },
        { entityType: "offer", entityId: current.id },
        context,
      );
      deliveryReference = delivery.deliveryReference;
    }

    // Browser storage has no database transactions, so take a namespace snapshot before the
    // connected acceptance/conversion/onboarding work. If any required local step fails, restore
    // every affected collection together; reverting only the offer would leave a hired candidate,
    // employee, user or onboarding case behind.
    if (status === "Accepted") {
      const { storage, audit } = getApplicationDataServices();
      const transactionSnapshot = storage.createRawSnapshot();
      let updated = this.updateOfferStatus(id, status, reason, context);
      if (deliveryReference) {
        updated = this.offerRepo.update(id, { deliveryReference }, context);
      }

      try {
        const employeeId = await new ConversionService().convertCandidateToEmployee(
          current.candidateId,
          current.id,
          {},
          { ...context, reason: reason || "Offer accepted; automatic onboarding initiated" },
        );
        const employeeService = new EmployeeService();
        const employee = employeeService.getById(employeeId, SYSTEM_CONTEXT);
        const user = employeeService
          .getUserRepository(SYSTEM_CONTEXT)
          .list()
          .find((item) => item.employeeId === employeeId);
        if (!employee || !user) throw new Error("Employee access mapping was not created.");
        await new IntegrationGateway().provisionWorkspaceIdentity(
          {
            employeeId,
            primaryEmail: user.workspaceEmail,
            displayName: employee.legalName,
            organisationalUnit: employee.department,
          },
          { entityType: "employee", entityId: employeeId },
          context,
        );

        const candidate = new CandidateService().getCandidate(current.candidateId, context);
        if (candidate) {
          // Best-effort welcome email - the employee already fully exists at this point, so a
          // failure here should not undo the acceptance or roll anything back.
          try {
            await new IntegrationGateway().sendEmail(
              {
                to: [candidate.email],
                subject: "Welcome to VIA — complete your onboarding",
                textBody: `Welcome ${candidate.firstName}. Your VIA work email is ${user.workspaceEmail}. Use the VIA portal to complete your employee profile, bank information, passport, visa, and identity-document uploads.`,
              },
              { entityType: "employee", entityId: employeeId },
              context,
            );
          } catch {
            // Non-critical - the employee and offer state are already correct.
          }
        }
      } catch (conversionError) {
        storage.restoreRawSnapshot(transactionSnapshot);
        audit.record({
          context,
          action: "offer_acceptance_rolled_back",
          module: "recruitment",
          entityType: "offer",
          entityId: id,
          reason: `Acceptance was not completed and all local changes were restored: ${conversionError instanceof Error ? conversionError.message : "unknown error"}.`,
          riskLevel: "High",
        });
        throw conversionError;
      }

      return this.getOfferById(id, context)!;
    }

    let updated = this.updateOfferStatus(id, status, reason, context);
    if (deliveryReference) {
      updated = this.offerRepo.update(id, { deliveryReference }, context);
    }
    return updated;
  }

  private requireHr(context: ActorContext) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "offer",
        entityId: "unspecified",
        action: "offer_management_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can manage hiring decisions and offers.");
    }
  }
}
