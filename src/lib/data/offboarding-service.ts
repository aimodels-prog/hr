import { LocalRepository } from "./repository.ts";
import type {
  OffboardingCase,
  OffboardingTemplate,
  OffboardingTask,
  OffboardingTaskStatus,
  OffboardingReasonCategory,
} from "./offboarding-types.ts";
import type { ActorContext, Employee, Role } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";

import { getApplicationDataServices } from "./application-data.ts";

const generateId = () => Math.random().toString(36).substring(2, 9);

export class OffboardingService {
  private casesRepo: LocalRepository<OffboardingCase>;
  private templatesRepo: LocalRepository<OffboardingTemplate>;
  private empService = new EmployeeService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.casesRepo = new LocalRepository<OffboardingCase>("offboardingCases", storage, audit, {
      module: "hr",
      entityType: "offboarding-case",
    });
    this.templatesRepo = new LocalRepository<OffboardingTemplate>(
      "offboardingTemplates",
      storage,
      audit,
      { module: "hr", entityType: "offboarding-template" },
    );
    this.seedDefaultTemplate();
  }

  private activeRole(context: ActorContext): Role | undefined {
    return (
      context.actor.activeRole ??
      (context.actor.roles.length === 1 ? context.actor.roles[0] : undefined)
    );
  }

  private deny(action: string, entityId: string, reason: string, context: ActorContext): never {
    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "offboarding",
      entityType: "offboarding-task",
      entityId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
    throw new Error(reason);
  }

  private requireRole(
    context: ActorContext,
    roles: Role[],
    action: string,
    entityId: string,
  ): void {
    if (!roles.includes(this.activeRole(context) as Role)) {
      this.deny(action, entityId, `Only ${roles.join(" or ")} can ${action}.`, context);
    }
  }

  private requireTaskAction(
    c: OffboardingCase,
    task: OffboardingTask,
    status: OffboardingTaskStatus,
    context: ActorContext,
  ): void {
    const role = this.activeRole(context);
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId, {
      includeArchived: true,
    });
    const explicitlyAssigned =
      task.assignedUserId === context.actor.userId ||
      task.assignedUserId === context.actor.employeeId;
    const isOwner =
      explicitlyAssigned ||
      (task.ownerRole === "Employee" && context.actor.employeeId === c.employeeId) ||
      (task.ownerRole === "Line Manager" &&
        role === "Line Manager" &&
        employee?.lineManagerId === context.actor.employeeId) ||
      task.ownerRole === role;

    if (status === "Waived") {
      if (role !== "HR" && role !== "Super Admin") {
        this.deny(
          "waive offboarding task",
          task.id,
          "Only HR or a Super Admin can waive an offboarding task.",
          context,
        );
      }
      return;
    }
    if (!isOwner && role !== "Super Admin") {
      this.deny(
        "complete offboarding task",
        task.id,
        "This task is assigned to another person or role.",
        context,
      );
    }
  }

  private seedDefaultTemplate() {
    if (this.templatesRepo.list().length === 0) {
      this.templatesRepo.create(
        {
          id: "tmpl-offboarding-default",
          name: "Standard Global Offboarding",
          description: "Default clearance process for a departing employee",
          isActive: true,
          departments: [],
          employmentTypes: [],
          tasks: [
            {
              id: "o1",
              title: "Handover notes to line manager",
              group: "Manager Handover",
              ownerRole: "Employee",
              offsetDaysFromLastWorkingDate: -5,
              isMandatory: true,
              requiresEvidence: true,
            },
            {
              id: "o2",
              title: "Reassign active projects",
              group: "Project Reassignment",
              ownerRole: "Line Manager",
              offsetDaysFromLastWorkingDate: -3,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "o3",
              title: "Return laptop and equipment",
              group: "IT & Assets",
              ownerRole: "IT",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "o4",
              title: "Revoke system and building access",
              group: "Access & Security",
              ownerRole: "IT",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["o3"],
            },
            {
              id: "o5",
              title: "Cancel visa / work permit",
              group: "Visa & Work Permit Cancellation",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 2,
              isMandatory: false,
              requiresEvidence: false,
            },
            {
              id: "o6",
              title: "Reconcile leave and attendance balances",
              group: "Leave & Attendance Reconciliation",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "o7",
              title: "Settle outstanding expenses and advances",
              group: "Expenses & Advances",
              ownerRole: "Accounts",
              offsetDaysFromLastWorkingDate: 3,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "o8",
              title: "Submit final payroll input",
              group: "Final Payroll Input",
              ownerRole: "Accounts",
              offsetDaysFromLastWorkingDate: 5,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["o6", "o7"],
            },
            {
              id: "o9",
              title: "Conduct exit interview",
              group: "Exit Interview",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 0,
              isMandatory: false,
              requiresEvidence: false,
            },
            {
              id: "o10",
              title: "Issue service/experience letter",
              group: "Service Documents",
              ownerRole: "HR",
              offsetDaysFromLastWorkingDate: 5,
              isMandatory: true,
              requiresEvidence: false,
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

  saveTemplate(template: OffboardingTemplate, context: ActorContext) {
    this.requireRole(context, ["HR", "Super Admin"], "save an offboarding template", template.id);
    if (this.templatesRepo.getById(template.id)) {
      return this.templatesRepo.update(template.id, template, context);
    }
    return this.templatesRepo.create(template, context);
  }

  deleteTemplate(id: string, context: ActorContext) {
    this.requireRole(context, ["HR", "Super Admin"], "archive an offboarding template", id);
    return this.templatesRepo.archive(id, context);
  }

  getCases() {
    return this.casesRepo.list();
  }

  getCaseById(id: string) {
    return this.casesRepo.getById(id);
  }

  getCaseByEmployeeId(employeeId: string) {
    return this.casesRepo
      .list()
      .find((c) => c.employeeId === employeeId && c.status !== "Cancelled");
  }

  canAccessCase(c: OffboardingCase, context: ActorContext): boolean {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return true;
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId, {
      includeArchived: true,
    });
    return c.tasks.some(
      (task) =>
        task.assignedUserId === context.actor.userId ||
        task.assignedUserId === context.actor.employeeId ||
        (task.ownerRole === "Employee" && c.employeeId === context.actor.employeeId) ||
        (task.ownerRole === "Line Manager" &&
          role === "Line Manager" &&
          employee?.lineManagerId === context.actor.employeeId) ||
        task.ownerRole === role,
    );
  }

  requireCaseAccess(c: OffboardingCase, context: ActorContext): void {
    if (!this.canAccessCase(c, context)) {
      this.deny(
        "view offboarding case",
        c.id,
        "This offboarding case is not assigned to you or your active role.",
        context,
      );
    }
  }

  getTasksForContext(c: OffboardingCase, context: ActorContext): OffboardingTask[] {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return c.tasks;
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId, {
      includeArchived: true,
    });
    return c.tasks.filter(
      (task) =>
        task.assignedUserId === context.actor.userId ||
        task.assignedUserId === context.actor.employeeId ||
        (task.ownerRole === "Employee" && c.employeeId === context.actor.employeeId) ||
        (task.ownerRole === "Line Manager" &&
          role === "Line Manager" &&
          employee?.lineManagerId === context.actor.employeeId) ||
        task.ownerRole === role,
    );
  }

  /**
   * A non-Omani nationality means the employee is in the country on a sponsored
   * visa/work permit, which must be formally cancelled with the authorities before
   * offboarding can close - so the "Cancel visa / work permit" task cannot be optional
   * for them, even though the seeded template defaults it to non-mandatory for the
   * general (often Omani, no-visa-required) case.
   */
  private employeeRequiresVisaCancellation(employee: Employee): boolean {
    const nationality = (employee.nationality ?? "").trim().toLowerCase();
    return nationality !== "" && nationality !== "omani";
  }

  private findMatchingTemplate(employee: Employee): OffboardingTemplate | undefined {
    const templates = this.templatesRepo.list().filter((t) => t.isActive);
    templates.sort(
      (a, b) =>
        b.departments.length +
        b.employmentTypes.length -
        (a.departments.length + a.employmentTypes.length),
    );

    for (const t of templates) {
      const matchesDept = t.departments.length === 0 || t.departments.includes(employee.department);
      const matchesEmpType =
        t.employmentTypes.length === 0 || t.employmentTypes.includes(employee.employmentType);
      if (matchesDept && matchesEmpType) return t;
    }
    return undefined;
  }

  startCase(
    employeeId: string,
    reasonCategory: OffboardingReasonCategory,
    noticeDate: string,
    lastWorkingDate: string,
    rehireEligible: boolean,
    confidentialNotes: string | undefined,
    context: ActorContext,
  ): OffboardingCase {
    this.requireRole(context, ["HR", "Super Admin"], "start an offboarding case", employeeId);
    const employee = this.empService.getEmployeeRepository().getById(employeeId);
    if (!employee) throw new Error("Employee not found");

    if (this.getCaseByEmployeeId(employeeId)) {
      throw new Error("An active offboarding case already exists for this employee.");
    }

    const template = this.findMatchingTemplate(employee);
    const lastDay = new Date(lastWorkingDate);
    const tasks: OffboardingTask[] = [];

    if (template) {
      const idMap = new Map<string, string>();
      for (const tt of template.tasks) idMap.set(tt.id, generateId());

      const requiresVisaCancellation = this.employeeRequiresVisaCancellation(employee);

      for (const tt of template.tasks) {
        const dueDate = new Date(lastDay);
        dueDate.setDate(dueDate.getDate() + tt.offsetDaysFromLastWorkingDate);

        // The visa-cancellation task's mandatory flag depends on this specific employee
        // (whether they actually hold a sponsored visa/work permit), not just the template
        // default, so it is computed per-case rather than copied verbatim from the template.
        const isMandatory =
          tt.group === "Visa & Work Permit Cancellation"
            ? tt.isMandatory || requiresVisaCancellation
            : tt.isMandatory;

        tasks.push({
          id: idMap.get(tt.id)!,
          templateTaskId: tt.id,
          title: tt.title,
          group: tt.group,
          ownerRole: tt.ownerRole,
          dueDate: dueDate.toISOString().split("T")[0]!,
          isMandatory,
          requiresEvidence: tt.requiresEvidence,
          ...(tt.instructions !== undefined ? { instructions: tt.instructions } : {}),
          dependsOnTaskIds: (tt.dependsOnTaskIds || [])
            .map((dtid) => idMap.get(dtid)!)
            .filter(Boolean),
          status: "Pending",
        });
      }
    }

    const obCase: OffboardingCase = {
      id: generateId(),
      employeeId,
      ...(template?.id !== undefined ? { templateId: template.id } : {}),
      reasonCategory,
      noticeDate,
      lastWorkingDate,
      ...(confidentialNotes !== undefined ? { confidentialNotes } : {}),
      rehireEligible,
      status: "In Progress",
      tasks,
      progressPercentage: 0,
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: context.actor.userId,
      recordVersion: 1,
    };

    const saved = this.casesRepo.create(obCase, context);

    // Employee moves to Notice status immediately so the whole org can see they're leaving.
    this.empService.changeEmployeeStatus(
      employeeId,
      "Notice",
      `Offboarding started: ${reasonCategory}`,
      context,
    );

    return this.recalculateCaseProgress(saved.id, context);
  }

  updateTaskStatus(
    caseId: string,
    taskId: string,
    status: OffboardingTaskStatus,
    context: ActorContext,
    evidenceFileId?: string,
    waiverReason?: string,
  ) {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    if (c.status === "Completed" || c.status === "Cancelled") {
      throw new Error(`This offboarding case is already ${c.status} and can no longer be updated.`);
    }

    const task = c.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");

    if (status !== "Completed" && status !== "Waived") {
      throw new Error("Tasks can be completed or waived only from this workflow.");
    }
    this.requireTaskAction(c, task, status, context);

    if (status === "Completed" && task.requiresEvidence && !evidenceFileId) {
      throw new Error("This task requires evidence to be completed.");
    }
    if (status === "Waived" && (!waiverReason || waiverReason.trim().length < 5)) {
      throw new Error("A reason must be provided to waive a task.");
    }

    if (status === "Completed" || status === "Waived") {
      for (const depId of task.dependsOnTaskIds) {
        const depTask = c.tasks.find((t) => t.id === depId);
        if (depTask && depTask.status !== "Completed" && depTask.status !== "Waived") {
          throw new Error(`Cannot complete task. Dependency '${depTask.title}' is not complete.`);
        }
      }
    }

    task.status = status;
    task.completedAt = new Date().toISOString();
    task.completedBy = context.actor.userId;
    if (evidenceFileId !== undefined) task.evidenceFileId = evidenceFileId;
    if (waiverReason !== undefined) task.waiverReason = waiverReason;

    this.casesRepo.update(c.id, c, context);
    return this.recalculateCaseProgress(c.id, context);
  }

  recalculateCaseProgress(caseId: string, context: ActorContext) {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");

    for (const task of c.tasks) {
      const hasUnmetDependencies = task.dependsOnTaskIds.some((depId) => {
        const dt = c.tasks.find((t) => t.id === depId);
        return dt && dt.status !== "Completed" && dt.status !== "Waived";
      });
      if (task.status === "Pending" && hasUnmetDependencies) task.status = "Blocked";
      else if (task.status === "Blocked" && !hasUnmetDependencies) task.status = "Pending";
    }

    const mandatoryTasks = c.tasks.filter((t) => t.isMandatory);
    const completedMandatory = mandatoryTasks.filter(
      (t) => t.status === "Completed" || t.status === "Waived",
    ).length;
    c.progressPercentage =
      mandatoryTasks.length > 0
        ? Math.round((completedMandatory / mandatoryTasks.length) * 100)
        : 100;

    if (c.progressPercentage === 100 && c.status === "In Progress") {
      c.status = "Pending Clearance";
    }

    return this.casesRepo.update(c.id, c, context);
  }

  grantFinancialClearance(caseId: string, context: ActorContext): OffboardingCase {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    this.requireRole(context, ["Accounts", "Super Admin"], "confirm financial clearance", caseId);
    if (c.progressPercentage < 100)
      throw new Error("All mandatory tasks must be complete before financial clearance.");

    c.financialClearanceAt = new Date().toISOString();
    c.financialClearanceBy = context.actor.userId;
    return this.casesRepo.update(c.id, c, context);
  }

  grantLegalClearance(caseId: string, context: ActorContext): OffboardingCase {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    this.requireRole(context, ["HR", "Super Admin"], "confirm HR and document clearance", caseId);
    if (c.progressPercentage < 100)
      throw new Error("All mandatory tasks must be complete before legal/document clearance.");

    c.legalClearanceAt = new Date().toISOString();
    c.legalClearanceBy = context.actor.userId;
    return this.casesRepo.update(c.id, c, context);
  }

  // Mirrors OnboardingService.cancelCase - lets HR abort an offboarding that was started in
  // error, or reverse course when the employee decides to stay, instead of leaving the case (and
  // the employee's Notice status) stuck open forever with no way out.
  cancelCase(caseId: string, reason: string, context: ActorContext): OffboardingCase {
    this.requireRole(context, ["HR", "Super Admin"], "cancel an offboarding case", caseId);
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) throw new Error("A cancellation reason is required.");

    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    if (c.status === "Completed" || c.status === "Cancelled") {
      throw new Error(`This offboarding case is already ${c.status} and cannot be cancelled.`);
    }

    const actionContext = { ...context, reason: trimmedReason };
    const saved = this.casesRepo.update(caseId, { status: "Cancelled" }, actionContext);

    const employee = this.empService
      .getEmployeeRepository()
      .getById(c.employeeId, { includeArchived: true });
    if (employee?.status === "Notice") {
      this.empService.changeEmployeeStatus(employee.id, "Active", trimmedReason, actionContext);
    }

    return saved;
  }

  finalizeCase(caseId: string, context: ActorContext): OffboardingCase {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    this.requireRole(context, ["Super Admin"], "complete offboarding", caseId);

    // Hard gate on visa/work-permit cancellation, independent of the general mandatory-task
    // progress percentage: this must block finalization whenever the task exists, is mandatory
    // for this employee (i.e. isMandatory was set - see employeeRequiresVisaCancellation, which
    // scopes this to non-Omani employees / template-mandatory cases), and is not Completed/Waived.
    // Employees for whom the task was never mandatory (e.g. Omani nationals) must not be blocked.
    const visaCancellationTask = c.tasks.find((t) => t.group === "Visa & Work Permit Cancellation");
    if (
      visaCancellationTask &&
      visaCancellationTask.isMandatory &&
      visaCancellationTask.status !== "Completed" &&
      visaCancellationTask.status !== "Waived"
    ) {
      throw new Error(
        `Cannot finalise: task '${visaCancellationTask.title}' must be marked Completed or Waived before offboarding can be closed.`,
      );
    }

    if (c.progressPercentage < 100) {
      throw new Error("Cannot finalise: mandatory tasks are still outstanding.");
    }
    if (!c.financialClearanceAt) {
      throw new Error("Cannot finalise: Accounts has not confirmed financial clearance.");
    }
    if (!c.legalClearanceAt) {
      throw new Error("Cannot finalise: HR has not confirmed legal/document closure.");
    }

    c.status = "Completed";
    c.finalizedAt = new Date().toISOString();
    c.finalizedBy = context.actor.userId;
    const saved = this.casesRepo.update(c.id, c, context);

    this.empService.finalizeEmployment(c.employeeId, c.lastWorkingDate, c.reasonCategory, context);

    return saved;
  }
}
