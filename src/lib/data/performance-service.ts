import { SYSTEM_CONTEXT } from "./types.ts";
import { LocalRepository } from "./repository";
import type { ActorContext } from "./types";
import { EmployeeService } from "./employee-service";

const generateId = () => Math.random().toString(36).substring(2, 9);
import type {
  ReviewTemplate,
  ReviewCycle,
  PerformanceReview,
  ReviewSectionInstance,
  ReviewItemInstance,
  ReviewSectionTemplate,
} from "./performance-types";
import { GoalService, type EmployeeGoal } from "./goal-service";
import { getApplicationDataServices } from "./application-data";

export class PerformanceService {
  private templatesRepo: LocalRepository<ReviewTemplate>;
  private cyclesRepo: LocalRepository<ReviewCycle>;
  private reviewsRepo: LocalRepository<PerformanceReview>;
  private empService = new EmployeeService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.templatesRepo = new LocalRepository<ReviewTemplate>(
      "performanceTemplates",
      storage,
      audit,
      { module: "hr", entityType: "performance-template" },
    );
    this.cyclesRepo = new LocalRepository<ReviewCycle>("performanceCycles", storage, audit, {
      module: "hr",
      entityType: "performance-cycle",
    });
    this.reviewsRepo = new LocalRepository<PerformanceReview>(
      "performanceReviews",
      storage,
      audit,
      { module: "hr", entityType: "performance-review" },
    );
    this.seedDefaultTemplate();
  }

  private seedDefaultTemplate() {
    if (this.templatesRepo.list().length === 0) {
      this.templatesRepo.create(
        {
          id: "tmpl-annual",
          name: "Annual Performance Review",
          description: "Standard annual review encompassing goals and core competencies.",
          isActive: true,
          maxRating: 5,
          sections: [
            {
              id: "sec-goals",
              title: "Goals & Objectives",
              weight: 50,
              items: [
                {
                  id: "item-g1",
                  title: "Goal Achievement",
                  description: "Rate the achievement of primary goals set for the year.",
                  evidencePrompt: "List key accomplishments",
                  weight: 100,
                },
              ],
            },
            {
              id: "sec-comp",
              title: "Core Competencies",
              weight: 50,
              items: [
                {
                  id: "item-c1",
                  title: "Communication",
                  description: "Communicates clearly and effectively.",
                  weight: 50,
                },
                {
                  id: "item-c2",
                  title: "Teamwork",
                  description: "Collaborates well with others.",
                  weight: 50,
                },
              ],
            },
          ],
        },
        { actor: { userId: "system", displayName: "System", roles: ["Super Admin"] } },
      );
    }
  }

  getTemplates() {
    return this.templatesRepo.list();
  }

  getTemplateById(id: string) {
    return this.templatesRepo.getById(id);
  }

  saveTemplate(template: ReviewTemplate, context: ActorContext) {
    if (this.templatesRepo.getById(template.id)) {
      return this.templatesRepo.update(template.id, template, context);
    }
    return this.templatesRepo.create(template, context);
  }

  deleteTemplate(id: string, context: ActorContext) {
    return this.templatesRepo.archive(id, context);
  }

  getCycles() {
    return this.cyclesRepo.list();
  }

  getCycleById(id: string) {
    return this.cyclesRepo.getById(id);
  }

  createCycle(cycle: ReviewCycle, context: ActorContext) {
    const savedCycle = this.cyclesRepo.create(cycle, context);

    if (savedCycle.status === "Active") {
      this.launchCycle(savedCycle.id, context);
    }

    return savedCycle;
  }

  updateCycleStatus(id: string, status: "Draft" | "Active" | "Completed", context: ActorContext) {
    const cycle = this.cyclesRepo.getById(id);
    if (!cycle) throw new Error("Cycle not found");

    if (cycle.status === "Draft" && status === "Active") {
      cycle.status = status;
      this.cyclesRepo.update(id, cycle, context);
      this.launchCycle(id, context);
      return;
    }

    cycle.status = status;
    this.cyclesRepo.update(id, cycle, context);
  }

  private launchCycle(cycleId: string, context: ActorContext) {
    const cycle = this.cyclesRepo.getById(cycleId);
    if (!cycle) return;

    const template = this.templatesRepo.getById(cycle.templateId);
    if (!template) throw new Error("Template not found");

    const allEmployees = this.empService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list()
      .filter((e) => e.status !== "Archived");

    const targetEmployees = allEmployees.filter((e) => {
      const matchDept = cycle.departments.length === 0 || cycle.departments.includes(e.department);
      const matchType =
        cycle.employmentTypes.length === 0 || cycle.employmentTypes.includes(e.employmentType);
      return matchDept && matchType;
    });

    for (const emp of targetEmployees) {
      const goalService = new GoalService();
      const activeGoals = goalService
        .getGoalsForEmployee(emp.id, cycle.id)
        .filter((g) => g.status === "Active");

      const sections: ReviewSectionInstance[] = template.sections.map((ts) =>
        this.buildSectionInstance(ts, activeGoals),
      );

      const review: PerformanceReview = {
        id: generateId(),
        employeeId: emp.id,
        cycleId: cycle.id,
        templateId: template.id,
        status: "Self Assessment Pending",
        sections,
        createdAt: new Date().toISOString(),
        createdBy: context.actor.userId,
        updatedAt: new Date().toISOString(),
        updatedBy: context.actor.userId,
        recordVersion: 1,
      };

      this.reviewsRepo.create(review, context);
    }
  }

  private isGoalsSection(title: string) {
    return title.toLowerCase().includes("goal");
  }

  private buildSectionInstance(
    ts: ReviewSectionTemplate,
    activeGoals: EmployeeGoal[],
  ): ReviewSectionInstance {
    // If this is the "Goals" section, we dynamically inject the employee's approved goals
    if (this.isGoalsSection(ts.title)) {
      const goalItems: ReviewItemInstance[] = activeGoals.map((g) => ({
        templateItemId: `goal-${g.id}`, // pseudo id
        title: g.title,
        description: g.description,
        evidencePrompt: "Provide evidence of achievement for this specific goal.",
        weight: g.weight,
      }));

      return {
        templateSectionId: ts.id,
        title: ts.title,
        weight: ts.weight,
        items:
          goalItems.length > 0
            ? goalItems
            : ts.items.map((ti) => ({
                templateItemId: ti.id,
                title: ti.title,
                description: ti.description,
                ...(ti.evidencePrompt !== undefined ? { evidencePrompt: ti.evidencePrompt } : {}),
                weight: ti.weight,
              })),
      };
    }

    return {
      templateSectionId: ts.id,
      title: ts.title,
      weight: ts.weight,
      items: ts.items.map((ti) => ({
        templateItemId: ti.id,
        title: ti.title,
        description: ti.description,
        ...(ti.evidencePrompt !== undefined ? { evidencePrompt: ti.evidencePrompt } : {}),
        weight: ti.weight,
      })),
    };
  }

  /**
   * Re-pulls the employee's currently Active (approved) goals for the review's cycle and
   * refreshes the review's Goals & Objectives section with them.
   *
   * This runs at review-*open* time (every time a review is fetched) rather than only once
   * at cycle-launch time. Bulk generation in launchCycle() takes a snapshot of goals at the
   * moment the cycle is created/activated - but goals are frequently approved *after* that
   * moment and before the employee actually submits their self-assessment. Without a fresh
   * re-fetch here, those late-approved goals (and, in the edge case where a cycle is created
   * directly as Active, ALL goals - since none could possibly reference the brand-new cycle id
   * at creation time) would be permanently missed and the section would silently fall back to
   * generic template items.
   *
   * Only reviews still in "Self Assessment Pending" are refreshed: once the employee has
   * submitted their self-assessment (or later stages), the section reflects what was actually
   * rated/discussed and must stay stable, so it is left untouched. The refresh only affects the
   * data returned to callers - it is not persisted back to the repository, so it never bumps
   * recordVersion or updatedAt on a mere read.
   */
  private resolveReviewGoals(review: PerformanceReview): PerformanceReview {
    if (review.status !== "Self Assessment Pending") {
      return review;
    }

    const template = this.templatesRepo.getById(review.templateId);
    if (!template) {
      return review;
    }

    const hasGoalsSection = review.sections.some((s) => this.isGoalsSection(s.title));
    if (!hasGoalsSection) {
      return review;
    }

    const goalService = new GoalService();
    const activeGoals = goalService
      .getGoalsForEmployee(review.employeeId, review.cycleId)
      .filter((g) => g.status === "Active");

    const refreshedSections = review.sections.map((section) => {
      if (!this.isGoalsSection(section.title)) {
        return section;
      }
      const ts = template.sections.find((s) => s.id === section.templateSectionId);
      if (!ts) {
        return section;
      }
      return this.buildSectionInstance(ts, activeGoals);
    });

    return { ...review, sections: refreshedSections };
  }

  getReviews() {
    return this.reviewsRepo.list();
  }

  getReviewById(id: string) {
    const review = this.reviewsRepo.getById(id);
    if (!review) return review;
    return this.resolveReviewGoals(review);
  }

  getReviewsForCycle(cycleId: string) {
    return this.reviewsRepo
      .list()
      .filter((r) => r.cycleId === cycleId && r.status !== "Corrected")
      .map((r) => this.resolveReviewGoals(r));
  }

  getReviewsForEmployee(employeeId: string) {
    return this.reviewsRepo
      .list()
      .filter((r) => r.employeeId === employeeId && r.status !== "Corrected")
      .map((r) => this.resolveReviewGoals(r));
  }

  getReviewsForManager(managerId: string) {
    const directReports = this.empService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list()
      .filter((e) => e.lineManagerId === managerId)
      .map((e) => e.id);
    return this.reviewsRepo
      .list()
      .filter((r) => directReports.includes(r.employeeId) && r.status !== "Corrected")
      .map((r) => this.resolveReviewGoals(r));
  }

  private calculateScores(review: PerformanceReview) {
    let totalSelfWeight = 0;
    let totalManagerWeight = 0;
    let overallSelfScore = 0;
    let overallManagerScore = 0;

    for (const section of review.sections) {
      let secSelfScore = 0;
      let secManagerScore = 0;
      let secSelfItemWeight = 0;
      let secManagerItemWeight = 0;

      for (const item of section.items) {
        if (item.selfRating !== undefined) {
          secSelfScore += item.selfRating * (item.weight / 100);
          secSelfItemWeight += item.weight;
        }
        if (item.managerRating !== undefined) {
          secManagerScore += item.managerRating * (item.weight / 100);
          secManagerItemWeight += item.weight;
        }
      }

      // If section is fully or partially rated, normalize the score to the items rated so far
      if (secSelfItemWeight > 0) {
        section.selfSectionScore = secSelfScore / (secSelfItemWeight / 100);
      } else {
        delete section.selfSectionScore;
      }
      if (secManagerItemWeight > 0) {
        section.managerSectionScore = secManagerScore / (secManagerItemWeight / 100);
      } else {
        delete section.managerSectionScore;
      }

      if (section.selfSectionScore !== undefined) {
        overallSelfScore += section.selfSectionScore * (section.weight / 100);
        totalSelfWeight += section.weight;
      }
      if (section.managerSectionScore !== undefined) {
        overallManagerScore += section.managerSectionScore * (section.weight / 100);
        totalManagerWeight += section.weight;
      }
    }

    if (totalSelfWeight > 0) {
      review.overallSelfScore = overallSelfScore / (totalSelfWeight / 100);
    } else {
      delete review.overallSelfScore;
    }
    if (totalManagerWeight > 0) {
      review.overallManagerScore = overallManagerScore / (totalManagerWeight / 100);
    } else {
      delete review.overallManagerScore;
    }
  }

  submitSelfAssessment(
    reviewId: string,
    updatedSections: ReviewSectionInstance[],
    context: ActorContext,
  ) {
    const review = this.reviewsRepo.getById(reviewId);
    if (!review) throw new Error("Review not found");
    if (review.status !== "Self Assessment Pending")
      throw new Error("Not in self-assessment phase");

    review.sections = updatedSections;
    this.calculateScores(review);
    review.status = "Manager Review Pending";

    return this.reviewsRepo.update(reviewId, review, context);
  }

  submitManagerReview(
    reviewId: string,
    updatedSections: ReviewSectionInstance[],
    summaryComment: string,
    context: ActorContext,
  ) {
    const review = this.reviewsRepo.getById(reviewId);
    if (!review) throw new Error("Review not found");
    if (review.status !== "Manager Review Pending") throw new Error("Not in manager review phase");

    review.sections = updatedSections;
    review.managerSummaryComment = summaryComment;
    this.calculateScores(review);

    const cycle = this.cyclesRepo.getById(review.cycleId);
    if (cycle && cycle.requiresModeration) {
      review.status = "Moderation Pending";
    } else {
      review.status = "Discussion Pending";
    }

    return this.reviewsRepo.update(reviewId, review, context);
  }

  approveModeration(reviewId: string, context: ActorContext) {
    const review = this.reviewsRepo.getById(reviewId);
    if (!review) throw new Error("Review not found");
    if (review.status !== "Moderation Pending") throw new Error("Not pending moderation");

    review.status = "Discussion Pending";
    return this.reviewsRepo.update(reviewId, review, context);
  }

  acknowledgeReview(reviewId: string, comment: string | undefined, context: ActorContext) {
    const review = this.reviewsRepo.getById(reviewId);
    if (!review) throw new Error("Review not found");
    if (review.status !== "Discussion Pending") throw new Error("Not ready for acknowledgement");

    review.employeeAcknowledgedAt = new Date().toISOString();
    if (comment !== undefined) {
      review.employeeAcknowledgementComment = comment;
    }
    review.status = "Acknowledged";

    return this.reviewsRepo.update(reviewId, review, context);
  }

  lockReview(reviewId: string, context: ActorContext) {
    const review = this.reviewsRepo.getById(reviewId);
    if (!review) throw new Error("Review not found");

    review.status = "Locked";
    return this.reviewsRepo.update(reviewId, review, context);
  }

  correctReview(
    reviewId: string,
    correctedSections: ReviewSectionInstance[],
    newSummaryComment: string,
    reason: string,
    context: ActorContext,
  ) {
    const original = this.reviewsRepo.getById(reviewId);
    if (!original) throw new Error("Review not found");
    if (original.status !== "Locked") throw new Error("Can only correct locked reviews");

    // Clone to new instance
    const correction: PerformanceReview = {
      ...original,
      id: generateId(),
      sections: correctedSections,
      managerSummaryComment: newSummaryComment,
      status: "Locked",
      correctedReason: reason,
      originalReviewId: original.id,
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: context.actor.userId,
      recordVersion: 1,
    };

    this.calculateScores(correction);
    const savedCorrection = this.reviewsRepo.create(correction, context);

    // Archive original
    original.status = "Corrected";
    this.reviewsRepo.update(original.id, original, context);

    return savedCorrection;
  }
}
