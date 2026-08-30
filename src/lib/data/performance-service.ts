import { isValid, parseISO } from "date-fns";

import { getRolePermissions } from "../auth/permissions.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { GoalService, type EmployeeGoal } from "./goal-service.ts";
import type {
  PerformanceReview,
  ReviewCycle,
  ReviewItemInstance,
  ReviewSectionInstance,
  ReviewSectionTemplate,
  ReviewTemplate,
} from "./performance-types.ts";
import { LocalRepository, type NewRecord } from "./repository.ts";
import { SYSTEM_CONTEXT, type ActorContext, type User } from "./types.ts";

const generateId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

type AssessmentKind = "self" | "manager" | "both";

export class PerformanceService {
  private readonly templatesRepo: LocalRepository<ReviewTemplate>;
  private readonly cyclesRepo: LocalRepository<ReviewCycle>;
  private readonly reviewsRepo: LocalRepository<PerformanceReview>;
  private readonly employeeService = new EmployeeService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.templatesRepo = new LocalRepository<ReviewTemplate>(
      "performanceTemplates",
      storage,
      audit,
      { module: "performance", entityType: "performance-template" },
    );
    this.cyclesRepo = new LocalRepository<ReviewCycle>("performanceCycles", storage, audit, {
      module: "performance",
      entityType: "performance-cycle",
    });
    this.reviewsRepo = new LocalRepository<PerformanceReview>(
      "performanceReviews",
      storage,
      audit,
      { module: "performance", entityType: "performance-review" },
    );
    this.seedDefaultTemplate();
  }

  getTemplates(context: ActorContext): ReviewTemplate[] {
    this.requireManageAll(context, "view performance templates", "all");
    return this.templatesRepo.list().map((template) => this.normalizeTemplate(template));
  }

  getTemplateById(id: string, context: ActorContext): ReviewTemplate | null {
    const template = this.templatesRepo.getById(id);
    if (!template) return null;
    if (!this.canViewAnyPerformance(context)) {
      this.deny(context, "view a performance template", "performance-template", id);
    }
    return this.normalizeTemplate(template);
  }

  saveTemplate(
    input: ReviewTemplate | NewRecord<ReviewTemplate>,
    context: ActorContext,
  ): ReviewTemplate {
    this.requireManageAll(context, "save performance templates", input.id ?? "new");
    this.validateTemplate(input);
    const cleaned = {
      name: input.name.trim(),
      description: input.description.trim(),
      isActive: input.isActive,
      maxRating: input.maxRating,
      employeeCanSeeManagerRatings: input.employeeCanSeeManagerRatings,
      sections: input.sections.map((section) => ({
        ...section,
        title: section.title.trim(),
        items: section.items.map((item) => {
          const { evidencePrompt: _evidencePrompt, ...baseItem } = item;
          return {
            ...baseItem,
            title: item.title.trim(),
            description: item.description.trim(),
            ...(item.evidencePrompt?.trim() ? { evidencePrompt: item.evidencePrompt.trim() } : {}),
          };
        }),
      })),
    };
    const existing = input.id ? this.templatesRepo.getById(input.id) : null;
    return existing
      ? this.templatesRepo.update(existing.id, cleaned, context)
      : this.templatesRepo.create({ ...cleaned, id: input.id || generateId() } as never, context);
  }

  deleteTemplate(id: string, context: ActorContext): void {
    this.requireManageAll(context, "archive performance templates", id);
    const template = this.templatesRepo.getById(id);
    if (!template) throw new Error("Performance template not found.");
    if (this.cyclesRepo.list().some((cycle) => cycle.templateId === id)) {
      throw new Error("This template is used by a review cycle and must remain in history.");
    }
    if (
      template.isActive &&
      this.templatesRepo.list().filter((item) => item.isActive).length <= 1
    ) {
      throw new Error("At least one active performance template must remain available.");
    }
    this.templatesRepo.archive(id, context);
  }

  getCycles(context: ActorContext): ReviewCycle[] {
    this.requireManageAll(context, "view all performance cycles", "all");
    return this.cyclesRepo.list();
  }

  getCyclesForEmployee(employeeId: string, context: ActorContext): ReviewCycle[] {
    this.requireEmployeeRead(employeeId, context, "view performance cycles", employeeId);
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (!employee) return [];
    return this.cyclesRepo.list().filter((cycle) => this.employeeMatchesCycle(employee, cycle));
  }

  getCycleById(id: string, context: ActorContext): ReviewCycle | null {
    const cycle = this.cyclesRepo.getById(id);
    if (!cycle) return null;
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole && getRolePermissions(activeRole).has("performance:manage_all")) return cycle;
    if (context.actor.employeeId) {
      const employee = this.employeeService.getById(context.actor.employeeId, SYSTEM_CONTEXT);
      if (employee && this.employeeMatchesCycle(employee, cycle)) return cycle;
      if (
        context.actor.activeRole === "Line Manager" &&
        this.reviewsRepo.list().some((review) => {
          if (review.cycleId !== cycle.id) return false;
          const reviewedEmployee = this.employeeService.getById(review.employeeId, SYSTEM_CONTEXT);
          return reviewedEmployee?.lineManagerId === context.actor.employeeId;
        })
      )
        return cycle;
    }
    this.deny(context, "view this performance cycle", "performance-cycle", id);
  }

  createCycle(input: NewRecord<ReviewCycle>, context: ActorContext): ReviewCycle {
    this.requireManageAll(context, "create performance cycles", input.id ?? "new");
    this.validateCycle(input);
    if (
      this.cyclesRepo
        .list()
        .some((cycle) => cycle.name.toLowerCase() === input.name.trim().toLowerCase())
    ) {
      throw new Error("A performance cycle with this name already exists.");
    }
    if (input.status === "Active") this.validateCyclePopulation(input);
    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      const saved = this.cyclesRepo.create(
        {
          ...input,
          name: input.name.trim(),
          departments: [...new Set(input.departments)],
          employmentTypes: [...new Set(input.employmentTypes)],
        },
        context,
      );
      if (saved.status === "Active") this.launchCycle(saved.id, context);
      return saved;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  updateDraftCycle(
    id: string,
    input: Omit<NewRecord<ReviewCycle>, "id" | "status">,
    context: ActorContext,
  ): ReviewCycle {
    this.requireManageAll(context, "edit this performance cycle", id);
    const cycle = this.cyclesRepo.getById(id);
    if (!cycle) throw new Error("Performance cycle not found.");
    if (cycle.status !== "Draft") throw new Error("Only a draft cycle can be edited.");
    const proposed: NewRecord<ReviewCycle> = { ...cycle, ...input, id, status: "Draft" };
    this.validateCycle(proposed);
    if (
      this.cyclesRepo
        .list()
        .some(
          (item) =>
            item.id !== id && item.name.toLowerCase() === proposed.name.trim().toLowerCase(),
        )
    ) {
      throw new Error("A performance cycle with this name already exists.");
    }
    return this.cyclesRepo.update(
      id,
      {
        ...input,
        name: input.name.trim(),
        departments: [...new Set(input.departments)],
        employmentTypes: [...new Set(input.employmentTypes)],
      },
      context,
    );
  }

  updateCycleStatus(
    id: string,
    status: "Draft" | "Active" | "Completed",
    context: ActorContext,
  ): ReviewCycle {
    this.requireManageAll(context, "change performance cycle status", id);
    const cycle = this.cyclesRepo.getById(id);
    if (!cycle) throw new Error("Performance cycle not found.");
    if (cycle.status === "Completed") throw new Error("A completed cycle cannot be reopened.");
    if (status === "Active" && cycle.status === "Draft") {
      this.validateCyclePopulation(cycle);
      const { storage } = getApplicationDataServices();
      const snapshot = storage.createRawSnapshot();
      try {
        const updated = this.cyclesRepo.update(id, { status }, context);
        this.launchCycle(id, context);
        return updated;
      } catch (error) {
        storage.restoreRawSnapshot(snapshot);
        throw error;
      }
    }
    if (status === "Completed") {
      const unfinished = this.reviewsRepo
        .list()
        .filter(
          (review) => review.cycleId === id && !["Locked", "Corrected"].includes(review.status),
        );
      if (unfinished.length > 0) {
        throw new Error(
          `${unfinished.length} review${unfinished.length === 1 ? " is" : "s are"} not locked yet.`,
        );
      }
    }
    return this.cyclesRepo.update(id, { status }, context);
  }

  getReviews(context: ActorContext): PerformanceReview[] {
    this.requireManageAll(context, "view all performance reviews", "all");
    return this.reviewsRepo
      .list()
      .filter((review) => review.status !== "Corrected")
      .map((review) => this.resolveReviewGoals(review));
  }

  getReviewById(id: string, context: ActorContext): PerformanceReview | null {
    const review = this.reviewsRepo.getById(id);
    if (!review) return null;
    this.requireReviewRead(review, context);
    return this.resolveReviewGoals(review);
  }

  getReviewsForCycle(cycleId: string, context: ActorContext): PerformanceReview[] {
    this.requireManageAll(context, "view reviews for this cycle", cycleId);
    return this.reviewsRepo
      .list()
      .filter((review) => review.cycleId === cycleId && review.status !== "Corrected")
      .map((review) => this.resolveReviewGoals(review));
  }

  getReviewsForEmployee(employeeId: string, context: ActorContext): PerformanceReview[] {
    this.requireEmployeeRead(employeeId, context, "view these performance reviews", employeeId);
    return this.reviewsRepo
      .list()
      .filter((review) => review.employeeId === employeeId && review.status !== "Corrected")
      .map((review) => this.resolveReviewGoals(review));
  }

  getReviewsForManager(context: ActorContext): PerformanceReview[] {
    if (context.actor.activeRole !== "Line Manager" || !context.actor.employeeId) {
      this.deny(context, "view team performance reviews", "performance-review", "all");
    }
    const reportIds = new Set(
      this.employeeService
        .getEmployees(SYSTEM_CONTEXT)
        .filter((employee) => employee.lineManagerId === context.actor.employeeId)
        .map((employee) => employee.id),
    );
    return this.reviewsRepo
      .list()
      .filter((review) => reportIds.has(review.employeeId) && review.status !== "Corrected")
      .map((review) => this.resolveReviewGoals(review));
  }

  getReviewsForTeam(context: ActorContext): PerformanceReview[] {
    const role = context.actor.activeRole ?? context.actor.roles[0];
    if (role && getRolePermissions(role).has("performance:manage_all")) {
      return this.reviewsRepo
        .list()
        .filter((review) => review.status !== "Corrected")
        .map((review) => this.resolveReviewGoals(review));
    }
    return this.getReviewsForManager(context);
  }

  getCyclesForTeam(context: ActorContext): ReviewCycle[] {
    const reviewCycleIds = new Set(this.getReviewsForTeam(context).map((review) => review.cycleId));
    return this.cyclesRepo.list().filter((cycle) => reviewCycleIds.has(cycle.id));
  }

  submitSelfAssessment(
    reviewId: string,
    updatedSections: ReviewSectionInstance[],
    context: ActorContext,
  ): PerformanceReview {
    const review = this.requireReview(reviewId);
    if (context.actor.activeRole !== "Employee" || context.actor.employeeId !== review.employeeId) {
      this.deny(context, "submit this self-assessment", "performance-review", review.id);
    }
    if (review.status !== "Self Assessment Pending") {
      throw new Error("This review is not awaiting a self-assessment.");
    }
    const template = this.requireTemplate(review.templateId);
    const resolved = this.resolveReviewGoals(review);
    resolved.sections = this.mergeAssessment(
      resolved.sections,
      updatedSections,
      "self",
      template.maxRating,
    );
    this.calculateScores(resolved);
    resolved.status = "Manager Review Pending";
    const updated = this.reviewsRepo.update(review.id, resolved, context);
    const employee = this.employeeService.getById(review.employeeId, SYSTEM_CONTEXT);
    if (employee?.lineManagerId) {
      this.notifyEmployee(
        employee.lineManagerId,
        "Self-assessment awaiting your review",
        `${employee.preferredName || employee.legalName} submitted their performance self-assessment.`,
        `/staff/performance/reviews/${review.id}`,
        `performance-manager-review-${review.id}-${updated.recordVersion}`,
        context,
      );
    }
    return updated;
  }

  submitManagerReview(
    reviewId: string,
    updatedSections: ReviewSectionInstance[],
    summaryComment: string,
    developmentPlan: string,
    context: ActorContext,
  ): PerformanceReview {
    const review = this.requireReview(reviewId);
    this.requireAssignedManager(
      review.employeeId,
      context,
      "submit this manager review",
      review.id,
    );
    if (review.status !== "Manager Review Pending") {
      throw new Error("This review is not awaiting the supervisor's assessment.");
    }
    if (summaryComment.trim().length < 10) throw new Error("Enter a meaningful manager summary.");
    if (developmentPlan.trim().length < 10) {
      throw new Error("Record the employee's agreed development plan for the next period.");
    }
    const template = this.requireTemplate(review.templateId);
    review.sections = this.mergeAssessment(
      review.sections,
      updatedSections,
      "manager",
      template.maxRating,
    );
    review.managerSummaryComment = summaryComment.trim();
    review.developmentPlan = developmentPlan.trim();
    this.calculateScores(review);
    const cycle = this.cyclesRepo.getById(review.cycleId);
    review.status = cycle?.requiresModeration ? "Moderation Pending" : "Discussion Pending";
    const updated = this.reviewsRepo.update(review.id, review, context);
    this.notifyNextReviewStage(updated, context);
    return updated;
  }

  approveModeration(
    reviewId: string,
    moderationComment: string,
    context: ActorContext,
  ): PerformanceReview {
    this.requireManageAll(context, "moderate performance reviews", reviewId);
    const review = this.requireReview(reviewId);
    if (review.status !== "Moderation Pending")
      throw new Error("This review is not awaiting moderation.");
    if (moderationComment.trim().length < 5) throw new Error("Record the moderation outcome.");
    review.status = "Discussion Pending";
    review.moderatedAt = new Date().toISOString();
    review.moderatedBy = context.actor.userId;
    review.moderationComment = moderationComment.trim();
    const updated = this.reviewsRepo.update(review.id, review, context);
    this.notifyNextReviewStage(updated, context);
    return updated;
  }

  recordDiscussion(
    reviewId: string,
    heldAt: string,
    notes: string,
    context: ActorContext,
  ): PerformanceReview {
    const review = this.requireReview(reviewId);
    this.requireAssignedManager(
      review.employeeId,
      context,
      "record this review discussion",
      review.id,
    );
    if (review.status !== "Discussion Pending") {
      throw new Error("This review is not ready for the review discussion.");
    }
    const discussionDate = parseISO(heldAt);
    if (!isValid(discussionDate) || discussionDate > new Date()) {
      throw new Error("Enter a valid discussion date that is not in the future.");
    }
    if (notes.trim().length < 10)
      throw new Error("Record the key points agreed in the discussion.");
    review.discussionHeldAt = discussionDate.toISOString();
    review.discussionRecordedAt = new Date().toISOString();
    review.discussionRecordedBy = context.actor.userId;
    review.discussionNotes = notes.trim();
    review.status = "Acknowledgement Pending";
    const updated = this.reviewsRepo.update(review.id, review, context);
    this.notifyEmployee(
      review.employeeId,
      "Performance review ready for acknowledgement",
      "Your supervisor recorded the review discussion. Please acknowledge receipt and say whether you agree.",
      `/staff/performance/reviews/${review.id}`,
      `performance-acknowledgement-${review.id}-${updated.recordVersion}`,
      context,
    );
    return updated;
  }

  acknowledgeReview(
    reviewId: string,
    agreesWithReview: boolean,
    comment: string | undefined,
    context: ActorContext,
  ): PerformanceReview {
    const review = this.requireReview(reviewId);
    if (context.actor.activeRole !== "Employee" || context.actor.employeeId !== review.employeeId) {
      this.deny(context, "acknowledge this review", "performance-review", review.id);
    }
    if (review.status !== "Acknowledgement Pending") {
      throw new Error("This review is not ready for acknowledgement.");
    }
    if (!agreesWithReview && (comment?.trim().length ?? 0) < 5) {
      throw new Error("Explain your concern when acknowledging that you do not agree.");
    }
    review.employeeAcknowledgedAt = new Date().toISOString();
    review.employeeAgreesWithReview = agreesWithReview;
    if (comment?.trim()) review.employeeAcknowledgementComment = comment.trim();
    review.status = "Acknowledged";
    const updated = this.reviewsRepo.update(review.id, review, context);
    this.notifyHr(
      "Performance review ready to lock",
      `The review for ${this.employeeName(review.employeeId)} has been acknowledged.`,
      `/staff/performance/reviews/${review.id}`,
      `performance-lock-${review.id}-${updated.recordVersion}`,
      context,
    );
    return updated;
  }

  lockReview(reviewId: string, context: ActorContext): PerformanceReview {
    this.requireManageAll(context, "lock performance reviews", reviewId);
    const review = this.requireReview(reviewId);
    if (review.status !== "Acknowledged") {
      throw new Error("Only an acknowledged review can be locked.");
    }
    review.status = "Locked";
    review.lockedAt = new Date().toISOString();
    review.lockedBy = context.actor.userId;
    const updated = this.reviewsRepo.update(review.id, review, context);
    this.notifyEmployee(
      review.employeeId,
      "Performance review completed",
      "Your acknowledged performance review has been finalised and locked.",
      `/staff/performance/reviews/${review.id}`,
      `performance-locked-${review.id}-${updated.recordVersion}`,
      context,
    );
    return updated;
  }

  correctReview(
    reviewId: string,
    correctedSections: ReviewSectionInstance[],
    newSummaryComment: string,
    newDevelopmentPlan: string,
    reason: string,
    context: ActorContext,
  ): PerformanceReview {
    this.requireManageAll(context, "correct locked performance reviews", reviewId);
    const original = this.requireReview(reviewId);
    if (original.status !== "Locked") throw new Error("Only a locked review can be corrected.");
    if (reason.trim().length < 10) throw new Error("Enter a detailed reason for the correction.");
    const template = this.requireTemplate(original.templateId);
    const correctionSections = this.mergeAssessment(
      original.sections,
      correctedSections,
      "both",
      template.maxRating,
    );
    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    try {
      const correction = this.reviewsRepo.create(
        {
          ...original,
          id: generateId(),
          sections: correctionSections,
          managerSummaryComment: newSummaryComment.trim(),
          developmentPlan: newDevelopmentPlan.trim(),
          status: "Locked",
          correctedReason: reason.trim(),
          originalReviewId: original.id,
          lockedAt: new Date().toISOString(),
          lockedBy: context.actor.userId,
        } as never,
        context,
      );
      this.calculateScores(correction);
      const saved = this.reviewsRepo.update(correction.id, correction, context);
      this.reviewsRepo.update(original.id, { status: "Corrected" }, context);
      return saved;
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  private launchCycle(cycleId: string, context: ActorContext): void {
    const cycle = this.cyclesRepo.getById(cycleId);
    if (!cycle) throw new Error("Performance cycle not found.");
    const template = this.requireTemplate(cycle.templateId);
    const existingEmployeeIds = new Set(
      this.reviewsRepo
        .list()
        .filter((review) => review.cycleId === cycleId)
        .map((review) => review.employeeId),
    );
    const employees = this.employeeService
      .getEmployees(SYSTEM_CONTEXT)
      .filter(
        (employee) =>
          !["Inactive", "Archived"].includes(employee.status) &&
          this.employeeMatchesCycle(employee, cycle) &&
          !existingEmployeeIds.has(employee.id),
      );
    for (const employee of employees) {
      const activeGoals = new GoalService()
        .getGoalsForEmployee(employee.id, SYSTEM_CONTEXT, cycle.id)
        .filter((goal) => goal.status === "Active" || goal.status === "Completed");
      const review = this.reviewsRepo.create(
        {
          employeeId: employee.id,
          cycleId: cycle.id,
          templateId: template.id,
          status: cycle.objectiveSettingDeadline ? "Objectives Pending" : "Self Assessment Pending",
          sections: template.sections.map((section) =>
            this.buildSectionInstance(section, activeGoals),
          ),
        },
        context,
      );
      this.notifyEmployee(
        employee.id,
        cycle.objectiveSettingDeadline ? "Objectives ready to set" : "Performance review opened",
        cycle.objectiveSettingDeadline
          ? `${cycle.name} is open. Submit your weighted objectives by ${cycle.objectiveSettingDeadline}.`
          : `${cycle.name} is ready for your self-assessment by ${cycle.selfAssessmentDeadline}.`,
        cycle.objectiveSettingDeadline
          ? "/staff/me/performance"
          : `/staff/performance/reviews/${review.id}`,
        `performance-cycle-employee-${cycle.id}-${employee.id}`,
        context,
      );
    }
  }

  private resolveReviewGoals(review: PerformanceReview): PerformanceReview {
    if (!["Objectives Pending", "Self Assessment Pending"].includes(review.status)) return review;
    const template = this.templatesRepo.getById(review.templateId);
    if (!template) return review;
    const activeGoals = new GoalService()
      .getGoalsForEmployee(review.employeeId, SYSTEM_CONTEXT, review.cycleId)
      .filter((goal) => goal.status === "Active" || goal.status === "Completed");
    return {
      ...review,
      sections: review.sections.map((section) => {
        if (!this.isGoalsSection(section.title)) return section;
        const source = template.sections.find(
          (candidate) => candidate.id === section.templateSectionId,
        );
        return source ? this.buildSectionInstance(source, activeGoals) : section;
      }),
    };
  }

  private buildSectionInstance(
    section: ReviewSectionTemplate,
    activeGoals: EmployeeGoal[],
  ): ReviewSectionInstance {
    const items: ReviewItemInstance[] =
      this.isGoalsSection(section.title) && activeGoals.length > 0
        ? activeGoals.map((goal) => ({
            templateItemId: `goal-${goal.id}`,
            title: goal.title,
            description: `${goal.description} Target: ${goal.targetValue}. Measure: ${goal.successMeasure}.`,
            evidencePrompt: "Summarise the result and supporting evidence.",
            weight: goal.weight,
          }))
        : section.items.map((item) => ({ ...item, templateItemId: item.id }));
    return {
      templateSectionId: section.id,
      title: section.title,
      weight: section.weight,
      items,
    };
  }

  private mergeAssessment(
    originalSections: ReviewSectionInstance[],
    submittedSections: ReviewSectionInstance[],
    kind: AssessmentKind,
    maxRating: number,
  ): ReviewSectionInstance[] {
    if (submittedSections.length !== originalSections.length) {
      throw new Error("The review structure changed. Refresh the page and try again.");
    }
    return originalSections.map((section) => {
      const submittedSection = submittedSections.find(
        (candidate) => candidate.templateSectionId === section.templateSectionId,
      );
      if (!submittedSection || submittedSection.items.length !== section.items.length) {
        throw new Error("The review structure changed. Refresh the page and try again.");
      }
      return {
        ...section,
        items: section.items.map((item) => {
          const submitted = submittedSection.items.find(
            (candidate) => candidate.templateItemId === item.templateItemId,
          );
          if (!submitted) throw new Error("A required review item is missing.");
          const next = { ...item };
          if (kind === "self" || kind === "both") {
            this.validateRating(submitted.selfRating, maxRating, "self-rating", item.title);
            if ((submitted.selfComment?.trim().length ?? 0) < 3) {
              throw new Error(`Add a self-assessment comment for “${item.title}”.`);
            }
            next.selfRating = submitted.selfRating!;
            next.selfComment = submitted.selfComment!.trim();
          }
          if (kind === "manager" || kind === "both") {
            this.validateRating(submitted.managerRating, maxRating, "manager rating", item.title);
            if ((submitted.managerComment?.trim().length ?? 0) < 3) {
              throw new Error(`Add a supervisor comment for “${item.title}”.`);
            }
            next.managerRating = submitted.managerRating!;
            next.managerComment = submitted.managerComment!.trim();
          }
          return next;
        }),
      };
    });
  }

  private calculateScores(review: PerformanceReview): void {
    let selfTotal = 0;
    let managerTotal = 0;
    for (const section of review.sections) {
      const selfScore = this.calculateSectionScore(section, "selfRating");
      const managerScore = this.calculateSectionScore(section, "managerRating");
      if (selfScore === undefined) delete section.selfSectionScore;
      else section.selfSectionScore = selfScore;
      if (managerScore === undefined) delete section.managerSectionScore;
      else section.managerSectionScore = managerScore;
      if (section.selfSectionScore !== undefined) {
        selfTotal += section.selfSectionScore * (section.weight / 100);
      }
      if (section.managerSectionScore !== undefined) {
        managerTotal += section.managerSectionScore * (section.weight / 100);
      }
    }
    review.overallSelfScore = Number(selfTotal.toFixed(2));
    review.overallManagerScore = Number(managerTotal.toFixed(2));
  }

  private calculateSectionScore(
    section: ReviewSectionInstance,
    field: "selfRating" | "managerRating",
  ): number | undefined {
    if (section.items.some((item) => item[field] === undefined)) return undefined;
    return Number(
      section.items
        .reduce((total, item) => total + item[field]! * (item.weight / 100), 0)
        .toFixed(2),
    );
  }

  private validateTemplate(
    template: Pick<ReviewTemplate, "name" | "description" | "maxRating" | "sections">,
  ): void {
    if (template.name.trim().length < 3) throw new Error("Enter a template name.");
    if (template.description.trim().length < 5)
      throw new Error("Describe when this template is used.");
    if (
      !Number.isInteger(template.maxRating) ||
      template.maxRating < 3 ||
      template.maxRating > 10
    ) {
      throw new Error("The rating scale must be a whole number from 3 to 10.");
    }
    if (template.sections.length === 0) throw new Error("Add at least one review section.");
    if (
      Math.abs(template.sections.reduce((sum, section) => sum + section.weight, 0) - 100) > 0.01
    ) {
      throw new Error("Review section weights must total 100%.");
    }
    for (const section of template.sections) {
      if (section.title.trim().length < 2 || section.items.length === 0) {
        throw new Error("Every review section needs a title and at least one item.");
      }
      if (Math.abs(section.items.reduce((sum, item) => sum + item.weight, 0) - 100) > 0.01) {
        throw new Error(`Items in “${section.title}” must total 100%.`);
      }
      for (const item of section.items) {
        if (item.title.trim().length < 2 || item.description.trim().length < 3) {
          throw new Error("Every review item needs a title and description.");
        }
      }
    }
  }

  private validateCycle(cycle: NewRecord<ReviewCycle>): void {
    if (cycle.name.trim().length < 3) throw new Error("Enter a performance cycle name.");
    const template = this.templatesRepo.getById(cycle.templateId);
    if (!template || !template.isActive) throw new Error("Select an active performance template.");
    const dates = [
      cycle.objectiveSettingDeadline,
      cycle.selfAssessmentDeadline,
      cycle.managerReviewDeadline,
      cycle.discussionDeadline,
    ].filter((value): value is string => Boolean(value));
    if (dates.some((date) => !isValid(parseISO(date))))
      throw new Error("Enter valid cycle deadlines.");
    if (
      cycle.objectiveSettingDeadline &&
      cycle.objectiveSettingDeadline > cycle.selfAssessmentDeadline
    ) {
      throw new Error("Objective setting must close before self-assessments are due.");
    }
    if (
      cycle.selfAssessmentDeadline > cycle.managerReviewDeadline ||
      cycle.managerReviewDeadline > cycle.discussionDeadline
    ) {
      throw new Error("Cycle deadlines must follow objective, self, manager and discussion order.");
    }
  }

  private employeeMatchesCycle(
    employee: { department: string; employmentType: string },
    cycle: Pick<ReviewCycle, "departments" | "employmentTypes">,
  ): boolean {
    return (
      (cycle.departments.length === 0 || cycle.departments.includes(employee.department)) &&
      (cycle.employmentTypes.length === 0 ||
        cycle.employmentTypes.includes(employee.employmentType))
    );
  }

  private validateCyclePopulation(
    cycle: Pick<ReviewCycle, "departments" | "employmentTypes">,
  ): void {
    const eligible = this.employeeService
      .getEmployees(SYSTEM_CONTEXT)
      .filter(
        (employee) =>
          !["Inactive", "Archived"].includes(employee.status) &&
          this.employeeMatchesCycle(employee, cycle),
      );
    if (eligible.length === 0)
      throw new Error("This performance cycle does not include any active employees.");
    const withoutSupervisor = eligible.filter(
      (employee) => !employee.lineManagerId || employee.lineManagerId === employee.id,
    );
    if (withoutSupervisor.length > 0) {
      const names = withoutSupervisor
        .slice(0, 3)
        .map((employee) => employee.preferredName || employee.legalName)
        .join(", ");
      throw new Error(
        `${names}${withoutSupervisor.length > 3 ? ` and ${withoutSupervisor.length - 3} more` : ""} must have a supervisor before this cycle can be launched.`,
      );
    }
  }

  private normalizeTemplate(template: ReviewTemplate): ReviewTemplate {
    return {
      ...template,
      employeeCanSeeManagerRatings: template.employeeCanSeeManagerRatings ?? true,
    };
  }

  private requireReview(reviewId: string): PerformanceReview {
    const review = this.reviewsRepo.getById(reviewId);
    if (!review) throw new Error("Performance review not found.");
    return review;
  }

  private requireTemplate(templateId: string): ReviewTemplate {
    const template = this.templatesRepo.getById(templateId);
    if (!template) throw new Error("Performance template not found.");
    return this.normalizeTemplate(template);
  }

  private requireReviewRead(review: PerformanceReview, context: ActorContext): void {
    this.requireEmployeeRead(review.employeeId, context, "view this performance review", review.id);
  }

  private requireEmployeeRead(
    employeeId: string,
    context: ActorContext,
    action: string,
    entityId: string,
  ): void {
    if (context.actor.userId === "system" || context.actor.employeeId === employeeId) return;
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (
      context.actor.activeRole === "Line Manager" &&
      context.actor.employeeId &&
      employee?.lineManagerId === context.actor.employeeId
    ) {
      return;
    }
    const role = context.actor.activeRole ?? context.actor.roles[0];
    if (role && getRolePermissions(role).has("performance:manage_all")) return;
    this.deny(context, action, "performance-review", entityId);
  }

  private requireAssignedManager(
    employeeId: string,
    context: ActorContext,
    action: string,
    entityId: string,
  ): void {
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (
      context.actor.activeRole === "Line Manager" &&
      context.actor.employeeId &&
      employee?.lineManagerId === context.actor.employeeId &&
      context.actor.employeeId !== employeeId
    ) {
      return;
    }
    this.deny(context, action, "performance-review", entityId);
  }

  private requireManageAll(context: ActorContext, action: string, entityId: string): void {
    const role = context.actor.activeRole ?? context.actor.roles[0];
    if (context.actor.userId === "system") return;
    if (role && getRolePermissions(role).has("performance:manage_all")) return;
    this.deny(context, action, "performance", entityId);
  }

  private canViewAnyPerformance(context: ActorContext): boolean {
    if (context.actor.userId === "system") return true;
    const role = context.actor.activeRole ?? context.actor.roles[0];
    return Boolean(role && getRolePermissions(role).has("performance:view_self"));
  }

  private deny(context: ActorContext, action: string, entityType: string, entityId: string): never {
    recordAccessDenied(getApplicationDataServices().audit, {
      context,
      action: `Performance ${action} denied`,
      module: "performance",
      entityType,
      entityId,
    });
    throw new Error(`You are not authorised to ${action}.`);
  }

  private validateRating(
    value: number | undefined,
    maximum: number,
    label: string,
    itemTitle: string,
  ): void {
    if (!Number.isInteger(value) || value! < 1 || value! > maximum) {
      throw new Error(`Enter a ${label} from 1 to ${maximum} for “${itemTitle}”.`);
    }
  }

  private isGoalsSection(title: string): boolean {
    return title.toLowerCase().includes("goal") || title.toLowerCase().includes("objective");
  }

  private employeeName(employeeId: string): string {
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    return employee?.preferredName || employee?.legalName || "the employee";
  }

  private notifyNextReviewStage(review: PerformanceReview, context: ActorContext): void {
    if (review.status === "Moderation Pending") {
      this.notifyHr(
        "Performance review awaiting moderation",
        `${this.employeeName(review.employeeId)}'s review is ready for moderation.`,
        `/staff/performance/reviews/${review.id}`,
        `performance-moderation-${review.id}-${review.recordVersion}`,
        context,
      );
      return;
    }
    const employee = this.employeeService.getById(review.employeeId, SYSTEM_CONTEXT);
    if (employee?.lineManagerId) {
      this.notifyEmployee(
        employee.lineManagerId,
        "Performance discussion ready",
        `${this.employeeName(review.employeeId)}'s manager assessment is ready for the review discussion.`,
        `/staff/performance/reviews/${review.id}`,
        `performance-discussion-${review.id}-${review.recordVersion}`,
        context,
      );
    }
  }

  private notifyHr(
    title: string,
    message: string,
    path: string,
    key: string,
    context: ActorContext,
  ): void {
    const { storage } = getApplicationDataServices();
    for (const user of storage.readCollection<User>("users")) {
      if (
        user.status !== "Active" ||
        !user.roles.some((role) => role === "HR" || role === "Super Admin")
      )
        continue;
      this.notifyUser(user.id, title, message, path, `${key}-${user.id}`, context);
    }
  }

  private notifyEmployee(
    employeeId: string,
    title: string,
    message: string,
    path: string,
    key: string,
    context: ActorContext,
  ): void {
    const user = getApplicationDataServices()
      .storage.readCollection<User>("users")
      .find((item) => item.employeeId === employeeId && item.status === "Active");
    if (user) this.notifyUser(user.id, title, message, path, key, context);
  }

  private notifyUser(
    userId: string,
    title: string,
    message: string,
    path: string,
    key: string,
    context: ActorContext,
  ): void {
    getApplicationDataServices().notifications.create(
      {
        recipientUserId: userId,
        type: "Action Required",
        title,
        message,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: key,
        link: { entityType: "performance-review", entityId: key, path },
      },
      context,
    );
  }

  private seedDefaultTemplate(): void {
    if (this.templatesRepo.list().length > 0) return;
    this.templatesRepo.create(
      {
        id: "tmpl-annual",
        name: "Annual Performance Review",
        description: "VIA's standard review of approved objectives and core behaviours.",
        isActive: true,
        maxRating: 5,
        employeeCanSeeManagerRatings: true,
        sections: [
          {
            id: "sec-goals",
            title: "Goals & Objectives",
            weight: 60,
            items: [
              {
                id: "item-goals",
                title: "Objective achievement",
                description: "Review progress against the approved objectives for this cycle.",
                evidencePrompt: "Describe the measurable result and supporting evidence.",
                weight: 100,
              },
            ],
          },
          {
            id: "sec-behaviours",
            title: "VIA Behaviours",
            weight: 40,
            items: [
              {
                id: "item-collaboration",
                title: "Collaboration",
                description: "Works constructively across teams and shares responsibility.",
                weight: 50,
              },
              {
                id: "item-delivery",
                title: "Reliable delivery",
                description: "Delivers agreed work safely, accurately and on time.",
                weight: 50,
              },
            ],
          },
        ],
      } as never,
      SYSTEM_CONTEXT,
    );
  }
}
