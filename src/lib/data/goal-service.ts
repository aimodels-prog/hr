import { isValid, parseISO } from "date-fns";

import { getRolePermissions } from "../auth/permissions.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { EmployeeService } from "./employee-service.ts";
import type { PerformanceReview } from "./performance-types.ts";
import { LocalRepository } from "./repository.ts";
import { SYSTEM_CONTEXT, type ActorContext, type BaseRecord, type User } from "./types.ts";

export type GoalStatus =
  | "Draft"
  | "Pending Approval"
  | "Changes Requested"
  | "Active"
  | "Completion Pending"
  | "Completed"
  | "Cancelled";

export interface GoalCheckIn {
  id: string;
  progressPercent: number;
  progressComment: string;
  evidenceFileId?: string;
  createdAt: string;
  createdBy: string;
}

export interface EmployeeGoal extends BaseRecord {
  employeeId: string;
  cycleId: string;
  title: string;
  description: string;
  successMeasure: string;
  targetValue: string;
  startDate: string;
  dueDate: string;
  weight: number;
  progressPercent: number;
  status: GoalStatus;
  managerFeedback?: string;
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  completedAt?: string;
  completedBy?: string;
  checkIns: GoalCheckIn[];
}

export type GoalDraftInput = Pick<
  EmployeeGoal,
  | "employeeId"
  | "cycleId"
  | "title"
  | "description"
  | "successMeasure"
  | "targetValue"
  | "startDate"
  | "dueDate"
  | "weight"
>;

const generateId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

export class GoalService {
  private readonly repo: LocalRepository<EmployeeGoal>;
  private readonly reviewsRepo: LocalRepository<PerformanceReview>;
  private readonly employeeService = new EmployeeService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.repo = new LocalRepository<EmployeeGoal>("employeeGoals", storage, audit, {
      module: "performance",
      entityType: "employee-goal",
    });
    this.reviewsRepo = new LocalRepository<PerformanceReview>(
      "performanceReviews",
      storage,
      audit,
      {
        module: "performance",
        entityType: "performance-review",
      },
    );
  }

  getGoalsForEmployee(employeeId: string, context: ActorContext, cycleId?: string): EmployeeGoal[] {
    this.requireEmployeeRead(employeeId, context, "view these objectives");
    return this.repo
      .list()
      .filter((goal) => goal.employeeId === employeeId && (!cycleId || goal.cycleId === cycleId))
      .map((goal) => this.normalizeGoal(goal));
  }

  getGoalById(goalId: string, context: ActorContext): EmployeeGoal | null {
    const goal = this.repo.getById(goalId);
    if (!goal) return null;
    this.requireEmployeeRead(goal.employeeId, context, "view this objective", goal.id);
    return this.normalizeGoal(goal);
  }

  getGoalsForCycle(cycleId: string, context: ActorContext): EmployeeGoal[] {
    this.requireManageAll(context, "view objectives for this review cycle", cycleId);
    return this.repo
      .list()
      .filter((goal) => goal.cycleId === cycleId)
      .map((goal) => this.normalizeGoal(goal));
  }

  getPendingGoalsForManager(context: ActorContext): EmployeeGoal[] {
    if (context.actor.activeRole !== "Line Manager" || !context.actor.employeeId) {
      this.deny(
        context,
        "view objective approvals",
        "all",
        "Only an assigned supervisor can view their objective approval queue.",
      );
    }
    const reportIds = new Set(
      this.employeeService
        .getEmployees(SYSTEM_CONTEXT)
        .filter((employee) => employee.lineManagerId === context.actor.employeeId)
        .map((employee) => employee.id),
    );
    return this.repo
      .list()
      .filter(
        (goal) =>
          reportIds.has(goal.employeeId) &&
          (goal.status === "Pending Approval" || goal.status === "Completion Pending"),
      )
      .map((goal) => this.normalizeGoal(goal));
  }

  getGoalsForTeam(context: ActorContext): EmployeeGoal[] {
    const role = context.actor.activeRole ?? context.actor.roles[0];
    if (role && getRolePermissions(role).has("performance:manage_all")) {
      return this.repo.list().map((goal) => this.normalizeGoal(goal));
    }
    if (context.actor.activeRole === "Line Manager" && context.actor.employeeId) {
      const reportIds = new Set(
        this.employeeService
          .getEmployees(SYSTEM_CONTEXT)
          .filter((employee) => employee.lineManagerId === context.actor.employeeId)
          .map((employee) => employee.id),
      );
      return this.repo
        .list()
        .filter((goal) => reportIds.has(goal.employeeId))
        .map((goal) => this.normalizeGoal(goal));
    }
    this.deny(
      context,
      "view team objectives",
      "all",
      "Only an assigned supervisor, HR or Super Admin can view team objectives.",
    );
  }

  getPendingGoalsForTeam(context: ActorContext): EmployeeGoal[] {
    return this.getGoalsForTeam(context).filter(
      (goal) => goal.status === "Pending Approval" || goal.status === "Completion Pending",
    );
  }

  async getEvidenceFile(
    goalId: string,
    checkInId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; name: string; mimeType: string }> {
    const goal = this.requireGoal(goalId);
    this.requireEmployeeRead(goal.employeeId, context, "view this objective evidence", goal.id);
    const checkIn = goal.checkIns.find((item) => item.id === checkInId);
    if (!checkIn?.evidenceFileId) throw new Error("No supporting file is attached to this update.");
    const { files, audit } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(checkIn.evidenceFileId),
      files.getBlob(checkIn.evidenceFileId),
    ]);
    if (
      !metadata ||
      !blob ||
      metadata.owner.entityType !== "performance-goal" ||
      metadata.owner.entityId !== goal.id
    ) {
      throw new Error("The supporting file could not be verified for this objective.");
    }
    audit.record({
      context,
      action: "view",
      module: "performance",
      entityType: "objective-evidence",
      entityId: checkIn.id,
      reason: "Viewed objective progress evidence",
      after: { goalId: goal.id, fileName: metadata.name },
    });
    return { blob, name: metadata.name, mimeType: metadata.mimeType };
  }

  createGoal(input: GoalDraftInput, context: ActorContext): EmployeeGoal {
    this.requireSelf(input.employeeId, context, "create objectives");
    this.validateGoal(input);
    const cycle = this.requireOpenCycle(input.cycleId);
    this.validateGoalDates(input, cycle);
    this.requireWeightCapacity(input.employeeId, input.cycleId, input.weight);
    return this.repo.create(
      {
        ...this.cleanInput(input),
        status: "Draft",
        progressPercent: 0,
        checkIns: [],
      },
      context,
    );
  }

  updateGoal(
    goalId: string,
    updates: Partial<Omit<GoalDraftInput, "employeeId" | "cycleId">>,
    context: ActorContext,
  ): EmployeeGoal {
    const goal = this.requireGoal(goalId);
    this.requireSelf(goal.employeeId, context, "edit this objective", goal.id);
    if (goal.status !== "Draft" && goal.status !== "Changes Requested") {
      throw new Error("Only draft objectives or objectives returned for changes can be edited.");
    }
    const proposed = { ...goal, ...updates };
    this.validateGoal(proposed);
    const cycle = this.requireOpenCycle(goal.cycleId);
    this.validateGoalDates(proposed, cycle);
    this.requireWeightCapacity(goal.employeeId, goal.cycleId, proposed.weight, goal.id);
    return this.normalizeGoal(
      this.repo.update(
        goal.id,
        {
          ...this.cleanInput(proposed),
        },
        context,
      ),
    );
  }

  submitCycleGoalsForApproval(
    employeeId: string,
    cycleId: string,
    context: ActorContext,
  ): EmployeeGoal[] {
    this.requireSelf(employeeId, context, "submit objectives");
    this.requireOpenCycle(cycleId);
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (!employee?.lineManagerId) {
      throw new Error(
        "Your supervisor has not been assigned. Ask HR to update your reporting line.",
      );
    }
    const goals = this.repo
      .list()
      .filter(
        (goal) =>
          goal.employeeId === employeeId && goal.cycleId === cycleId && goal.status !== "Cancelled",
      )
      .map((goal) => this.normalizeGoal(goal));
    if (goals.length === 0) throw new Error("Create at least one objective before submitting.");
    const totalWeight = goals.reduce((total, goal) => total + goal.weight, 0);
    if (totalWeight !== 100) {
      throw new Error(`Objective weights must total 100%. They currently total ${totalWeight}%.`);
    }
    if (goals.some((goal) => goal.status === "Pending Approval")) {
      throw new Error("These objectives are already awaiting supervisor approval.");
    }
    const submittable = goals.filter((goal) =>
      ["Draft", "Changes Requested"].includes(goal.status),
    );
    if (submittable.length === 0) throw new Error("There are no draft objectives ready to submit.");
    if (goals.some((goal) => !["Draft", "Changes Requested", "Active"].includes(goal.status))) {
      throw new Error("Resolve outstanding objective updates before submitting this set.");
    }

    const { storage } = getApplicationDataServices();
    const snapshot = storage.createRawSnapshot();
    const submittedAt = new Date().toISOString();
    try {
      const updated = submittable.map((goal) =>
        this.repo.update(
          goal.id,
          {
            status: "Pending Approval",
            submittedAt,
            submittedBy: context.actor.userId,
          },
          context,
        ),
      );
      this.notifyEmployee(
        employee.lineManagerId,
        "Objectives awaiting your review",
        `${employee.preferredName || employee.legalName} submitted ${updated.length} objective${updated.length === 1 ? "" : "s"} for approval.`,
        "/staff/performance/team",
        `performance-goals-manager-${employeeId}-${cycleId}-${submittedAt}`,
        context,
      );
      return updated.map((goal) => this.normalizeGoal(goal));
    } catch (error) {
      storage.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  submitForApproval(goalId: string, context: ActorContext): EmployeeGoal {
    const goal = this.requireGoal(goalId);
    return this.submitCycleGoalsForApproval(goal.employeeId, goal.cycleId, context).find(
      (item) => item.id === goalId,
    )!;
  }

  approveGoal(goalId: string, context: ActorContext): EmployeeGoal {
    const goal = this.requireGoal(goalId);
    this.requireAssignedManager(goal.employeeId, context, "approve this objective", goal.id);
    if (goal.status !== "Pending Approval") {
      throw new Error("Only objectives awaiting approval can be approved.");
    }
    const approved = this.repo.update(
      goal.id,
      {
        status: "Active",
        approvedAt: new Date().toISOString(),
        approvedBy: context.actor.userId,
      },
      context,
    );
    this.openSelfAssessmentWhenReady(goal.employeeId, goal.cycleId, context);
    this.notifyEmployee(
      goal.employeeId,
      "Objective approved",
      `Your objective “${goal.title}” is approved and active.`,
      "/staff/me/performance?tab=objectives",
      `performance-goal-approved-${goal.id}-${approved.recordVersion}`,
      context,
    );
    return this.normalizeGoal(approved);
  }

  returnGoal(goalId: string, feedback: string, context: ActorContext): EmployeeGoal {
    const goal = this.requireGoal(goalId);
    this.requireAssignedManager(goal.employeeId, context, "return this objective", goal.id);
    if (goal.status !== "Pending Approval") {
      throw new Error("Only objectives awaiting approval can be returned.");
    }
    if (feedback.trim().length < 5) {
      throw new Error("Explain what the employee needs to change.");
    }
    const returned = this.repo.update(
      goal.id,
      { status: "Changes Requested", managerFeedback: feedback.trim() },
      context,
    );
    this.notifyEmployee(
      goal.employeeId,
      "Objective changes requested",
      `Your supervisor returned “${goal.title}”: ${feedback.trim()}`,
      "/staff/me/performance?tab=objectives",
      `performance-goal-returned-${goal.id}-${returned.recordVersion}`,
      context,
    );
    return this.normalizeGoal(returned);
  }

  rejectGoal(goalId: string, context: ActorContext, feedback = "Please revise this objective.") {
    return this.returnGoal(goalId, feedback, context);
  }

  async recordProgress(
    goalId: string,
    progressPercent: number,
    progressComment: string,
    evidenceFileId: string | undefined,
    context: ActorContext,
  ): Promise<EmployeeGoal> {
    const goal = this.requireGoal(goalId);
    this.requireSelf(goal.employeeId, context, "update this objective", goal.id);
    if (goal.status !== "Active")
      throw new Error("Only active objectives can receive progress updates.");
    if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) {
      throw new Error("Progress must be a whole number from 0 to 100.");
    }
    if (progressPercent < goal.progressPercent) {
      throw new Error("Progress cannot be lower than the previously recorded percentage.");
    }
    if (progressComment.trim().length < 5) {
      throw new Error("Describe the progress made and any relevant result or blocker.");
    }
    if (evidenceFileId) {
      const metadata = await getApplicationDataServices().files.getMetadata(evidenceFileId);
      if (
        !metadata ||
        metadata.owner.entityType !== "performance-goal" ||
        metadata.owner.entityId !== goal.id
      ) {
        throw new Error("The supporting file could not be verified for this objective.");
      }
    }
    const checkIn: GoalCheckIn = {
      id: generateId(),
      progressPercent,
      progressComment: progressComment.trim(),
      ...(evidenceFileId ? { evidenceFileId } : {}),
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
    };
    const status: GoalStatus = progressPercent === 100 ? "Completion Pending" : "Active";
    const updated = this.repo.update(
      goal.id,
      {
        progressPercent,
        status,
        checkIns: [...goal.checkIns, checkIn],
      },
      context,
    );
    const employee = this.employeeService.getById(goal.employeeId, SYSTEM_CONTEXT);
    if (employee?.lineManagerId) {
      this.notifyEmployee(
        employee.lineManagerId,
        progressPercent === 100
          ? "Objective completion awaiting review"
          : "Objective progress updated",
        `${employee.preferredName || employee.legalName} recorded ${progressPercent}% progress for “${goal.title}”.`,
        "/staff/performance/team",
        `performance-goal-checkin-${checkIn.id}`,
        context,
      );
    }
    return this.normalizeGoal(updated);
  }

  approveCompletion(goalId: string, context: ActorContext): EmployeeGoal {
    const goal = this.requireGoal(goalId);
    this.requireAssignedManager(goal.employeeId, context, "confirm this objective", goal.id);
    if (goal.status !== "Completion Pending" || goal.progressPercent !== 100) {
      throw new Error("Only an objective reported at 100% can be confirmed as completed.");
    }
    const completed = this.repo.update(
      goal.id,
      {
        status: "Completed",
        completedAt: new Date().toISOString(),
        completedBy: context.actor.userId,
      },
      context,
    );
    this.notifyEmployee(
      goal.employeeId,
      "Objective completed",
      `Your supervisor confirmed completion of “${goal.title}”.`,
      "/staff/me/performance?tab=objectives",
      `performance-goal-completed-${goal.id}-${completed.recordVersion}`,
      context,
    );
    return this.normalizeGoal(completed);
  }

  deleteGoal(goalId: string, context: ActorContext): void {
    const goal = this.requireGoal(goalId);
    this.requireSelf(goal.employeeId, context, "remove this objective", goal.id);
    if (goal.status !== "Draft" && goal.status !== "Changes Requested") {
      throw new Error("Only draft objectives or objectives returned for changes can be removed.");
    }
    this.repo.archive(goal.id, context);
  }

  private normalizeGoal(goal: EmployeeGoal): EmployeeGoal {
    return {
      ...goal,
      successMeasure: goal.successMeasure ?? "Success measure not recorded",
      targetValue: goal.targetValue ?? "Target not recorded",
      startDate: goal.startDate ?? goal.createdAt.slice(0, 10),
      dueDate: goal.dueDate ?? goal.createdAt.slice(0, 10),
      progressPercent: goal.progressPercent ?? 0,
      checkIns: goal.checkIns ?? [],
    };
  }

  private cleanInput(input: GoalDraftInput): GoalDraftInput {
    return {
      employeeId: input.employeeId,
      cycleId: input.cycleId,
      title: input.title.trim(),
      description: input.description.trim(),
      successMeasure: input.successMeasure.trim(),
      targetValue: input.targetValue.trim(),
      startDate: input.startDate,
      dueDate: input.dueDate,
      weight: input.weight,
    };
  }

  private validateGoal(input: GoalDraftInput): void {
    if (input.title.trim().length < 3) throw new Error("Enter a clear objective title.");
    if (input.description.trim().length < 10) {
      throw new Error("Describe the work required to achieve this objective.");
    }
    if (input.successMeasure.trim().length < 5) {
      throw new Error("Explain how success will be measured.");
    }
    if (input.targetValue.trim().length < 2)
      throw new Error("Enter the expected target or result.");
    const start = parseISO(input.startDate);
    const due = parseISO(input.dueDate);
    if (!isValid(start) || !isValid(due) || input.dueDate < input.startDate) {
      throw new Error("Enter a valid objective start date and due date.");
    }
    if (!Number.isInteger(input.weight) || input.weight < 1 || input.weight > 100) {
      throw new Error("Objective weight must be a whole percentage from 1 to 100.");
    }
  }

  private requireWeightCapacity(
    employeeId: string,
    cycleId: string,
    proposedWeight: number,
    excludedGoalId?: string,
  ): void {
    const existingWeight = this.repo
      .list()
      .filter(
        (goal) =>
          goal.employeeId === employeeId &&
          goal.cycleId === cycleId &&
          goal.id !== excludedGoalId &&
          goal.status !== "Cancelled",
      )
      .reduce((total, goal) => total + goal.weight, 0);
    if (existingWeight + proposedWeight > 100) {
      throw new Error(
        `Objective weights cannot exceed 100%. ${100 - existingWeight}% remains available.`,
      );
    }
  }

  private requireOpenCycle(cycleId: string): {
    id: string;
    status: string;
    objectiveSettingDeadline?: string;
    selfAssessmentDeadline: string;
  } {
    const cycle = getApplicationDataServices()
      .storage.readCollection<{
        id: string;
        status: string;
        objectiveSettingDeadline?: string;
        selfAssessmentDeadline: string;
      }>("performanceCycles")
      .find((item) => item.id === cycleId);
    if (!cycle || cycle.status !== "Active") {
      throw new Error("Select an active performance cycle for this objective.");
    }
    if (
      cycle.objectiveSettingDeadline &&
      new Date().toISOString().slice(0, 10) > cycle.objectiveSettingDeadline
    ) {
      throw new Error("The objective-setting deadline for this review cycle has passed.");
    }
    return cycle;
  }

  private validateGoalDates(
    goal: Pick<EmployeeGoal, "dueDate">,
    cycle: { selfAssessmentDeadline: string },
  ): void {
    if (goal.dueDate > cycle.selfAssessmentDeadline) {
      throw new Error("The objective due date must be on or before the self-assessment deadline.");
    }
  }

  private openSelfAssessmentWhenReady(
    employeeId: string,
    cycleId: string,
    context: ActorContext,
  ): void {
    const goals = this.repo
      .list()
      .filter(
        (goal) =>
          goal.employeeId === employeeId && goal.cycleId === cycleId && goal.status !== "Cancelled",
      );
    if (
      goals.length === 0 ||
      goals.reduce((sum, goal) => sum + goal.weight, 0) !== 100 ||
      goals.some((goal) => goal.status !== "Active" && goal.status !== "Completed")
    ) {
      return;
    }
    const review = this.reviewsRepo
      .list()
      .find(
        (item) =>
          item.employeeId === employeeId &&
          item.cycleId === cycleId &&
          item.status === "Objectives Pending",
      );
    if (!review) return;
    const updated = this.reviewsRepo.update(
      review.id,
      { status: "Self Assessment Pending" },
      {
        ...context,
        reason: "All weighted objectives were approved by the assigned supervisor",
      },
    );
    this.notifyEmployee(
      employeeId,
      "Self-assessment ready",
      "All objectives are approved. You can now complete your performance self-assessment.",
      `/staff/performance/reviews/${review.id}`,
      `performance-self-ready-${review.id}-${updated.recordVersion}`,
      context,
    );
  }

  private requireGoal(goalId: string): EmployeeGoal {
    const goal = this.repo.getById(goalId);
    if (!goal) throw new Error("Objective not found.");
    return this.normalizeGoal(goal);
  }

  private requireSelf(
    employeeId: string,
    context: ActorContext,
    action: string,
    entityId = employeeId,
  ): void {
    if (
      context.actor.activeRole === "Employee" &&
      context.actor.employeeId &&
      context.actor.employeeId === employeeId
    ) {
      return;
    }
    this.deny(context, action, entityId, "Employees can manage only their own objectives.");
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
    this.deny(context, action, entityId, "Only the employee's assigned supervisor can decide it.");
  }

  private requireEmployeeRead(
    employeeId: string,
    context: ActorContext,
    action: string,
    entityId = employeeId,
  ): void {
    if (context.actor.userId === "system") return;
    if (context.actor.employeeId === employeeId) return;
    const employee = this.employeeService.getById(employeeId, SYSTEM_CONTEXT);
    if (
      context.actor.activeRole === "Line Manager" &&
      context.actor.employeeId &&
      employee?.lineManagerId === context.actor.employeeId
    ) {
      return;
    }
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole && getRolePermissions(activeRole).has("performance:manage_all")) return;
    this.deny(
      context,
      action,
      entityId,
      "This objective is outside your permitted employee scope.",
    );
  }

  private requireManageAll(context: ActorContext, action: string, entityId: string): void {
    if (context.actor.userId === "system") return;
    const activeRole = context.actor.activeRole ?? context.actor.roles[0];
    if (activeRole && getRolePermissions(activeRole).has("performance:manage_all")) return;
    this.deny(context, action, entityId, "Only HR or Super Admin can manage performance cycles.");
  }

  private deny(context: ActorContext, action: string, entityId: string, message: string): never {
    recordAccessDenied(getApplicationDataServices().audit, {
      context,
      action: `Performance ${action} denied`,
      module: "performance",
      entityType: "employee-goal",
      entityId,
    });
    throw new Error(message);
  }

  private notifyEmployee(
    employeeId: string,
    title: string,
    message: string,
    path: string,
    deduplicationKey: string,
    context: ActorContext,
  ): void {
    const { storage, notifications } = getApplicationDataServices();
    const user = storage
      .readCollection<User>("users")
      .find((item) => item.employeeId === employeeId && item.status === "Active");
    if (!user) return;
    notifications.create(
      {
        recipientUserId: user.id,
        type: "Action Required",
        title,
        message,
        priority: "Normal",
        status: "Unread",
        deduplicationKey,
        link: { entityType: "employee-goal", entityId: employeeId, path },
      },
      context,
    );
  }
}
