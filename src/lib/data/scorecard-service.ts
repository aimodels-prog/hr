import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { LocalRepository } from "./repository.ts";
import type {
  BaseRecord,
  ActorContext,
  InterviewScorecard,
  InterviewTemplate,
  CriterionScore,
  ScorecardCriterion,
  ScorecardRecommendation,
} from "./types.ts";

// The in-memory service remains available to isolated unit tests. Browser production flows do
// not seed these records: PostgreSQL is authoritative and HR creates its templates in Settings.
const LOCAL_TEST_DEFAULT_TEMPLATES: Omit<InterviewTemplate, keyof BaseRecord>[] = [
  {
    name: "HR Screening",
    blindScoring: false,
    criteria: [
      {
        id: "hr-communication",
        name: "Communication Skills",
        description: "Clarity of expression and active listening",
        requiresEvidence: false,
        weight: 35,
      },
      {
        id: "hr-values",
        name: "Values Alignment",
        description: "Alignment with VIA's working standards",
        requiresEvidence: true,
        weight: 35,
        minimumScore: 3,
        isCritical: true,
      },
      {
        id: "hr-motivation",
        name: "Motivation",
        description: "Interest in the role and VIA",
        requiresEvidence: false,
        weight: 30,
      },
    ],
    aiDecisionWeight: 40,
    interviewDecisionWeight: 60,
  },
  {
    name: "Technical Interview",
    blindScoring: true,
    criteria: [
      {
        id: "technical-knowledge",
        name: "Technical Knowledge",
        description: "Depth of expertise required by the role",
        requiresEvidence: true,
        weight: 40,
        minimumScore: 3,
        isCritical: true,
      },
      {
        id: "problem-solving",
        name: "Problem Solving",
        description: "Ability to break down and solve complex issues",
        requiresEvidence: true,
        weight: 35,
        minimumScore: 3,
        isCritical: true,
      },
      {
        id: "quality",
        name: "Quality of Work",
        description: "Structure, accuracy and maintainability",
        requiresEvidence: true,
        weight: 25,
      },
    ],
    aiDecisionWeight: 40,
    interviewDecisionWeight: 60,
  },
];

export class ScorecardService {
  private scorecardRepo: LocalRepository<InterviewScorecard>;
  private templateRepo: LocalRepository<InterviewTemplate>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.scorecardRepo = new LocalRepository<InterviewScorecard>(
      "interview_scorecards",
      storage,
      audit,
      { module: "recruitment", entityType: "scorecard" },
    );
    this.templateRepo = new LocalRepository<InterviewTemplate>(
      "interview_templates",
      storage,
      audit,
      { module: "recruitment", entityType: "template" },
    );
    if (typeof window === "undefined" && this.templateRepo.list().length === 0) {
      for (const template of LOCAL_TEST_DEFAULT_TEMPLATES) {
        this.templateRepo.create(template, {
          actor: { userId: "SYSTEM", displayName: "System", roles: ["Super Admin"] },
        });
      }
    }
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

  private async refresh(context: ActorContext): Promise<void> {
    const { CandidateService } = await import("./candidate-service.ts");
    await new CandidateService().hydrateCompatibilityCache(context);
  }

  async saveTemplateAsync(
    payload: Omit<InterviewTemplate, keyof import("./types").BaseRecord>,
    context: ActorContext,
    existing?: InterviewTemplate,
  ): Promise<InterviewTemplate> {
    const { saveInterviewTemplateFn } = await import("../server-functions/interview.server.ts");
    const vacancyId = this.databaseVacancyId(payload.vacancyId);
    const id = await saveInterviewTemplateFn({
      data: {
        actor: this.serverActor(context),
        ...(existing ? { id: existing.id, expectedRecordVersion: existing.recordVersion } : {}),
        name: payload.name,
        criteria: payload.criteria,
        blindScoring: payload.blindScoring,
        ...(vacancyId ? { vacancyId } : {}),
        ...(payload.stageName ? { stageName: payload.stageName } : {}),
        aiDecisionWeight: payload.aiDecisionWeight,
        interviewDecisionWeight: payload.interviewDecisionWeight,
      },
    });
    await this.refresh(context);
    return this.getTemplateById(id)!;
  }

  async deleteTemplateAsync(id: string, context: ActorContext): Promise<void> {
    const { archiveInterviewTemplateFn } = await import("../server-functions/interview.server.ts");
    await archiveInterviewTemplateFn({
      data: {
        actor: this.serverActor(context),
        templateId: id,
        reason: context.reason || "Archived interview template",
      },
    });
    await this.refresh(context);
  }

  async saveScorecardAsync(
    scorecardId: string,
    scores: CriterionScore[],
    overallRecommendation: ScorecardRecommendation | null,
    submit: boolean,
    context: ActorContext,
  ): Promise<InterviewScorecard> {
    const scorecard = this.scorecardRepo.getById(scorecardId);
    if (!scorecard) throw new Error("Scorecard not found.");
    const { saveInterviewScorecardFn } = await import("../server-functions/interview.server.ts");
    const id = await saveInterviewScorecardFn({
      data: {
        actor: this.serverActor(context),
        interviewId: scorecard.interviewId,
        scores,
        recommendation: overallRecommendation,
        submit,
        ...(scorecard.createdBy !== "SYSTEM"
          ? { expectedRecordVersion: scorecard.recordVersion }
          : {}),
      },
    });
    await this.refresh(context);
    return this.scorecardRepo.getById(id)!;
  }

  async reopenScorecardAsync(
    scorecardId: string,
    reason: string,
    context: ActorContext,
  ): Promise<InterviewScorecard> {
    const { reopenInterviewScorecardFn } = await import("../server-functions/interview.server.ts");
    await reopenInterviewScorecardFn({
      data: { actor: this.serverActor(context), scorecardId, reason },
    });
    await this.refresh(context);
    return this.scorecardRepo.getById(scorecardId)!;
  }

  getTemplates() {
    return this.templateRepo.list().map((template) => ({
      ...template,
      aiDecisionWeight: template.aiDecisionWeight ?? 40,
      interviewDecisionWeight: template.interviewDecisionWeight ?? 60,
      criteria: template.criteria.map((criterion) => ({
        ...criterion,
        weight: criterion.weight ?? 100 / template.criteria.length,
      })),
    }));
  }

  getApplicableTemplates(vacancyId: string, stageName?: string) {
    return this.getTemplates()
      .filter(
        (template) =>
          (!template.vacancyId || template.vacancyId === vacancyId) &&
          (!template.stageName || !stageName || template.stageName === stageName),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.vacancyId)) - Number(Boolean(a.vacancyId)) ||
          Number(Boolean(b.stageName)) - Number(Boolean(a.stageName)),
      );
  }

  getTemplateById(id: string) {
    return this.getTemplates().find((template) => template.id === id) ?? null;
  }

  createTemplate(
    payload: Omit<InterviewTemplate, keyof import("./types").BaseRecord>,
    context: ActorContext,
  ): InterviewTemplate {
    this.requireHr(context);
    if (!payload.name.trim()) throw new Error("Template name is required.");
    if (payload.criteria.length === 0) throw new Error("A template needs at least one criterion.");
    this.validateTemplate(payload);
    return this.templateRepo.create(payload, context);
  }

  updateTemplate(
    id: string,
    payload: Omit<InterviewTemplate, keyof import("./types").BaseRecord>,
    context: ActorContext,
  ): InterviewTemplate {
    this.requireHr(context);
    if (!payload.name.trim()) throw new Error("Template name is required.");
    if (payload.criteria.length === 0) throw new Error("A template needs at least one criterion.");
    this.validateTemplate(payload);
    return this.templateRepo.update(id, payload, context);
  }

  private validateTemplate(
    payload: Pick<InterviewTemplate, "criteria" | "aiDecisionWeight" | "interviewDecisionWeight">,
  ) {
    const totalCriterionWeight = payload.criteria.reduce(
      (sum, criterion) => sum + criterion.weight,
      0,
    );
    if (Math.abs(totalCriterionWeight - 100) > 0.01) {
      throw new Error("Interview criterion weights must total 100%.");
    }
    if (payload.aiDecisionWeight + payload.interviewDecisionWeight !== 100) {
      throw new Error("AI and interview decision weights must total 100%.");
    }
    for (const criterion of payload.criteria) {
      if (criterion.weight <= 0) throw new Error("Every criterion must have a positive weight.");
      if (criterion.minimumScore && (criterion.minimumScore < 1 || criterion.minimumScore > 5)) {
        throw new Error("Minimum criterion scores must be between 1 and 5.");
      }
    }
  }

  deleteTemplate(id: string, context: ActorContext): void {
    this.requireHr(context);
    // Read the raw collection instead of instantiating InterviewService, which itself imports
    // this service - going the other way here would create a circular dependency.
    const { storage } = getApplicationDataServices();
    const inUse = storage
      .readCollection<{ templateId?: string }>("interview_events")
      .some((i) => i.templateId === id);
    if (inUse) {
      throw new Error(
        "This template is used by at least one scheduled or past interview and cannot be deleted. Existing scorecards would lose their criteria.",
      );
    }
    this.templateRepo.archive(id, context);
  }

  getScorecardsForInterview(interviewId: string) {
    return this.scorecardRepo.list().filter((s) => s.interviewId === interviewId);
  }

  // actorUserId comes from the caller's own authenticated context, never a raw parameter the
  // caller can substitute another user's ID into - otherwise blind-scoring visibility could be
  // bypassed simply by claiming to be whichever panel member has already submitted.
  getVisibleScorecards(interviewId: string, context: ActorContext, isBlindScoring: boolean) {
    const actorUserId = context.actor.userId;
    const all = this.getScorecardsForInterview(interviewId);

    const myScorecard = all.find((s) => s.panelUserId === actorUserId);
    const iHaveSubmitted = myScorecard?.status === "Submitted";

    return all.map((scorecard) => {
      // If it's mine, I can see it.
      if (scorecard.panelUserId === actorUserId) return scorecard;

      // If it's someone else's:
      // If blind scoring is ON, I can only see it if they submitted AND I have submitted.
      if (isBlindScoring) {
        if (scorecard.status === "Submitted" && iHaveSubmitted) {
          return scorecard;
        } else {
          // Hide scores and recommendation
          return {
            ...scorecard,
            scores: [],
            overallRecommendation: null,
            // we keep status so we know if they completed it
          };
        }
      } else {
        // Not blind scoring, I can see it if they submitted it.
        // Actually, if it's draft, maybe I shouldn't see their live typing.
        if (scorecard.status === "Submitted") return scorecard;
        return {
          ...scorecard,
          scores: [],
          overallRecommendation: null,
        };
      }
    });
  }

  getOrCreateScorecard(interviewId: string, panelUserId: string, context: ActorContext) {
    const isSelf = context.actor.userId === panelUserId;
    const isHr = context.actor.activeRole === "HR" || context.actor.activeRole === "Super Admin";
    if (!isSelf && !isHr) {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "scorecard",
        entityId: interviewId,
        action: "scorecard_create_denied",
        context,
      });
      throw new Error("You can only create your own assigned scorecard.");
    }
    const interview = getApplicationDataServices()
      .storage.readCollection<{ id: string; panelUserIds: string[] }>("interview_events")
      .find((item) => item.id === interviewId);
    if (!interview) throw new Error("Interview not found.");
    if (!interview.panelUserIds.includes(panelUserId)) {
      throw new Error("This user is not an assigned panel member for this interview.");
    }

    const existing = this.getScorecardsForInterview(interviewId).find(
      (s) => s.panelUserId === panelUserId,
    );
    if (existing) return existing;

    return this.scorecardRepo.create(
      {
        interviewId,
        panelUserId,
        status: "Draft",
        scores: [],
        overallRecommendation: null,
        submittedAt: null,
        revisionHistory: [],
      },
      context,
    );
  }

  saveDraft(
    scorecardId: string,
    scores: CriterionScore[],
    overallRecommendation: ScorecardRecommendation | null,
    context: ActorContext,
  ) {
    const scorecard = this.scorecardRepo.getById(scorecardId);
    if (!scorecard) throw new Error("Scorecard not found");
    if (scorecard.status === "Submitted") throw new Error("Cannot edit a submitted scorecard");
    if (scorecard.panelUserId !== context.actor.userId)
      throw new Error("You can only edit your own assigned scorecard.");
    this.validateScores(scorecard.interviewId, scores, false);

    return this.scorecardRepo.update(
      scorecardId,
      {
        scores,
        overallRecommendation,
      },
      context,
    );
  }

  submitScorecard(
    scorecardId: string,
    scores: CriterionScore[],
    overallRecommendation: ScorecardRecommendation,
    context: ActorContext,
  ) {
    const scorecard = this.scorecardRepo.getById(scorecardId);
    if (!scorecard) throw new Error("Scorecard not found");
    if (scorecard.status === "Submitted") throw new Error("Already submitted");
    if (scorecard.panelUserId !== context.actor.userId)
      throw new Error("You can only submit your own assigned scorecard.");
    this.validateScores(scorecard.interviewId, scores, true);

    return this.scorecardRepo.update(
      scorecardId,
      {
        status: "Submitted",
        scores,
        overallRecommendation,
        submittedAt: new Date().toISOString(),
      },
      context,
    );
  }

  reopenScorecard(scorecardId: string, reason: string, context: ActorContext) {
    this.requireHr(context);
    if (!reason.trim()) throw new Error("A correction reason is required.");
    const scorecard = this.scorecardRepo.getById(scorecardId);
    if (!scorecard) throw new Error("Scorecard not found");
    if (scorecard.status === "Draft") throw new Error("Scorecard is already in draft state");

    const revision = {
      date: new Date().toISOString(),
      actor: context.actor.displayName || context.actor.userId,
      reason,
      previousStatus: scorecard.status,
      previousScores: scorecard.scores,
      previousRecommendation: scorecard.overallRecommendation,
    };

    return this.scorecardRepo.update(
      scorecardId,
      {
        status: "Draft",
        submittedAt: null,
        revisionHistory: [...(scorecard.revisionHistory || []), revision],
      },
      context,
    );
  }

  calculateInterviewMetrics(interviewId: string, panelUserIds: string[]) {
    const scorecards = this.getScorecardsForInterview(interviewId);

    let totalScore = 0;
    let scoreCount = 0;
    let criticalFailure = false;
    const recommendations = new Set<string>();

    let completedCount = 0;

    for (const pid of panelUserIds) {
      const sc = scorecards.find((s) => s.panelUserId === pid);
      if (sc && sc.status === "Submitted") {
        completedCount++;
        if (sc.overallRecommendation) recommendations.add(sc.overallRecommendation);

        const interview = getApplicationDataServices()
          .storage.readCollection<{ id: string; templateId?: string }>("interview_events")
          .find((item) => item.id === interviewId);
        const template = interview?.templateId ? this.getTemplateById(interview.templateId) : null;
        for (const s of sc.scores) {
          const criterion = template?.criteria.find((item) => item.id === s.criterionId);
          const weight =
            criterion?.weight ?? (template?.criteria.length ? 100 / template.criteria.length : 1);
          totalScore += s.score * weight;
          scoreCount += weight;
          if (criterion?.isCritical && criterion.minimumScore && s.score < criterion.minimumScore) {
            criticalFailure = true;
          }
        }
      }
    }

    const averageScore = scoreCount > 0 ? totalScore / scoreCount : 0;
    const isComplete = completedCount === panelUserIds.length && panelUserIds.length > 0;

    // Disagreement if both Strong Yes/Yes AND No/Unsure exist
    const hasPositive = recommendations.has("Strong Yes") || recommendations.has("Yes");
    const hasNegative = recommendations.has("No") || recommendations.has("Unsure");
    const hasDisagreement = hasPositive && hasNegative;

    return {
      completedCount,
      totalExpected: panelUserIds.length,
      isComplete,
      averageScore,
      hasDisagreement,
      criticalFailure,
    };
  }

  private requireHr(context: ActorContext) {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "scorecard-template",
        entityId: "unspecified",
        action: "scorecard_management_denied",
        context,
      });
      throw new Error("Only HR or Super Admin can manage scorecard templates and corrections.");
    }
  }

  private validateScores(interviewId: string, scores: CriterionScore[], requireComplete: boolean) {
    const interview = getApplicationDataServices()
      .storage.readCollection<{ id: string; templateId?: string }>("interview_events")
      .find((item) => item.id === interviewId);
    const template = interview?.templateId ? this.getTemplateById(interview.templateId) : null;
    if (!template) throw new Error("The interview scorecard template could not be found.");

    const knownCriterionIds = new Set(template.criteria.map((c) => c.id));
    const seenCriterionIds = new Set<string>();
    for (const score of scores) {
      if (!knownCriterionIds.has(score.criterionId)) {
        throw new Error(`"${score.criterionId}" is not a criterion on this scorecard's template.`);
      }
      if (seenCriterionIds.has(score.criterionId)) {
        throw new Error(`Duplicate score submitted for criterion "${score.criterionId}".`);
      }
      seenCriterionIds.add(score.criterionId);
    }

    const byCriterion = new Map(scores.map((score) => [score.criterionId, score]));
    for (const criterion of template.criteria) {
      const score = byCriterion.get(criterion.id);
      if (requireComplete && !score) throw new Error(`A score is required for ${criterion.name}.`);
      if (!score) continue;
      if (!Number.isInteger(score.score) || score.score < 1 || score.score > 5) {
        throw new Error(`The score for ${criterion.name} must be between 1 and 5.`);
      }
      if (criterion.requiresEvidence && !score.evidence.trim()) {
        throw new Error(`Written evidence is required for ${criterion.name}.`);
      }
    }
  }
}
