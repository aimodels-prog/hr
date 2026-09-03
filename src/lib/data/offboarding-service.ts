import { SYSTEM_CONTEXT } from "./types.ts";
import { LocalRepository } from "./repository.ts";
import type {
  OffboardingCase,
  OffboardingConfidentialityLevel,
  OffboardingTemplate,
  OffboardingTask,
  OffboardingTaskStatus,
  OffboardingReasonCategory,
} from "./offboarding-types.ts";
import type { ActorContext, Employee, Role, User } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";
import { OnboardingService } from "./onboarding-service.ts";

import { getApplicationDataServices } from "./application-data.ts";

const generateId = () => Math.random().toString(36).substring(2, 9);

const TEMPLATE_ROLES: Role[] = ["Employee", "Line Manager", "HR", "Accounts", "IT", "Super Admin"];

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

  async hydrateCompatibilityCache(context: ActorContext): Promise<void> {
    await new OnboardingService().hydrateCompatibilityCache(context);
  }

  private async serverActor(context: ActorContext) {
    const { storage } = getApplicationDataServices();
    const actorEmail =
      context.actor.workspaceEmail ??
      storage.readCollection<User>("users").find((user) => user.id === context.actor.userId)
        ?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    } as const;
  }

  async startCaseAsync(
    employeeId: string,
    reasonCategory: OffboardingReasonCategory,
    noticeDate: string,
    lastWorkingDate: string,
    rehireEligible: boolean,
    confidentialNotes: string | undefined,
    context: ActorContext,
    options: {
      templateId: string;
      assignedHRId: string;
      confidentialityLevel: OffboardingConfidentialityLevel;
    },
  ): Promise<OffboardingCase> {
    const { storage } = getApplicationDataServices();
    const employees = storage.readCollection<Employee & { databaseId?: string }>("employees");
    const users = storage.readCollection<User>("users");
    const employee = employees.find((item) => item.id === employeeId);
    const hrOwnerUser = users.find((item) => item.id === options.assignedHRId);
    const hrOwner = employees.find((item) => item.id === hrOwnerUser?.employeeId);
    const { startOffboardingCaseFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    const caseId = await startOffboardingCaseFn({
      data: {
        actor: await this.serverActor(context),
        employeeId: employee?.databaseId ?? employeeId,
        templateId: options.templateId,
        assignedHRId: hrOwner?.databaseId ?? options.assignedHRId,
        reasonCategory,
        noticeDate,
        lastWorkingDate,
        confidentialityLevel: options.confidentialityLevel,
        ...(confidentialNotes?.trim() ? { confidentialNotes: confidentialNotes.trim() } : {}),
        rehireEligible,
      },
    });
    await this.hydrateCompatibilityCache(context);
    const created = this.casesRepo.getById(caseId);
    if (!created) throw new Error("Offboarding was saved but could not be reloaded.");
    return created;
  }

  async assignTaskOwnerAsync(
    caseId: string,
    taskId: string,
    assignedUserId: string | undefined,
    context: ActorContext,
  ): Promise<OffboardingCase> {
    const users = getApplicationDataServices().storage.readCollection<
      User & { databaseId?: string }
    >("users");
    const assigned = assignedUserId ? users.find((user) => user.id === assignedUserId) : undefined;
    const { assignOffboardingTaskFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    await assignOffboardingTaskFn({
      data: {
        actor: await this.serverActor(context),
        caseId,
        taskId,
        ...(assignedUserId ? { assignedUserId: assigned?.databaseId ?? assignedUserId } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const updated = this.casesRepo.getById(caseId);
    if (!updated) throw new Error("Offboarding was updated but could not be reloaded.");
    return updated;
  }

  async applyActionAsync(
    caseId: string,
    action: "financial-clearance" | "legal-clearance" | "finalise",
    context: ActorContext,
  ): Promise<OffboardingCase> {
    const { applyOffboardingActionFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    await applyOffboardingActionFn({
      data: { actor: await this.serverActor(context), caseId, action },
    });
    await Promise.all([
      this.hydrateCompatibilityCache(context),
      this.empService.hydrateCompatibilityCache(context),
    ]);
    const updated = this.casesRepo.getById(caseId);
    if (!updated) throw new Error("Offboarding was updated but could not be reloaded.");
    return updated;
  }

  async cancelCaseAsync(
    caseId: string,
    reason: string,
    context: ActorContext,
  ): Promise<OffboardingCase> {
    const { cancelOffboardingCaseFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    await cancelOffboardingCaseFn({
      data: { actor: await this.serverActor(context), caseId, reason },
    });
    await Promise.all([
      this.hydrateCompatibilityCache(context),
      this.empService.hydrateCompatibilityCache(context),
    ]);
    const updated = this.casesRepo.getById(caseId);
    if (!updated) throw new Error("Offboarding was updated but could not be reloaded.");
    return updated;
  }

  async saveTemplateAsync(
    template: OffboardingTemplate,
    context: ActorContext,
  ): Promise<OffboardingTemplate> {
    const { storage } = getApplicationDataServices();
    const users = storage.readCollection<User & { databaseId?: string }>("users");
    const master = [
      ...storage.readCollection<{ id: string; databaseId?: string; name: string }>("departments"),
      ...storage.readCollection<{ id: string; databaseId?: string; name: string }>(
        "employmentTypes",
      ),
    ];
    const masterId = (value: string) =>
      master.find((item) => item.id === value || item.name === value || item.databaseId === value)
        ?.databaseId ?? value;
    const { saveOffboardingTemplateFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    const id = await saveOffboardingTemplateFn({
      data: {
        actor: await this.serverActor(context),
        template: {
          id: template.id,
          recordVersion: template.recordVersion,
          name: template.name,
          description: template.description,
          isActive: template.isActive,
          departments: template.departments.map(masterId),
          employmentTypes: template.employmentTypes.map(masterId),
          tasks: template.tasks.map((task) => ({
            ...task,
            ...(task.assignedUserId
              ? {
                  assignedUserId:
                    users.find((user) => user.id === task.assignedUserId)?.databaseId ??
                    task.assignedUserId,
                }
              : {}),
          })),
        },
      },
    });
    await this.hydrateCompatibilityCache(context);
    const saved = this.templatesRepo.getById(id);
    if (!saved) throw new Error("The checklist was saved but could not be reloaded.");
    return saved;
  }

  async archiveTemplateAsync(id: string, reason: string, context: ActorContext): Promise<void> {
    const { archiveLifecycleTemplateFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    await archiveLifecycleTemplateFn({
      data: {
        actor: await this.serverActor(context),
        workflow: "offboarding",
        templateId: id,
        reason,
      },
    });
    await this.hydrateCompatibilityCache(context);
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
    const employee = this.empService.getEmployeeRepository(SYSTEM_CONTEXT).getById(c.employeeId, {
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
      (task.ownerRole === role &&
        task.ownerRole !== "Employee" &&
        task.ownerRole !== "Line Manager");

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

  getTemplates(context: ActorContext) {
    this.requireRole(
      context,
      ["HR", "Super Admin"],
      "view offboarding templates",
      "offboarding-templates",
    );
    return this.templatesRepo.list();
  }

  // Mirrors OnboardingService's validateTemplate/saveTemplate - saving a template must not be
  // able to introduce a broken checklist (duplicate/self-referential task IDs, a dependency
  // loop, an owner assigned to a role they don't hold) that would only surface later, when an
  // actual offboarding case is started from it.
  private validateTemplate(template: OffboardingTemplate): void {
    if (template.name.trim().length < 3) throw new Error("Template name is required.");
    if (template.description.trim().length < 5) {
      throw new Error("Add a short description explaining when this template is used.");
    }
    if (template.tasks.length === 0) throw new Error("Add at least one offboarding task.");
    const taskIds = new Set<string>();
    const users = this.empService.getUserRepository(SYSTEM_CONTEXT).list();
    for (const task of template.tasks) {
      if (!task.id || taskIds.has(task.id)) throw new Error("Every task must have a unique ID.");
      taskIds.add(task.id);
      if (task.title.trim().length < 3) throw new Error("Every task needs a clear title.");
      if (!TEMPLATE_ROLES.includes(task.ownerRole)) throw new Error("Select a valid task owner.");
      if (task.assignedUserId) {
        const assignedUser = users.find((user) => user.id === task.assignedUserId);
        if (
          !assignedUser ||
          assignedUser.status !== "Active" ||
          !assignedUser.roles.includes(task.ownerRole)
        ) {
          throw new Error(`Select an active ${task.ownerRole} owner for “${task.title}”.`);
        }
      }
      if (
        !Number.isInteger(task.offsetDaysFromLastWorkingDate) ||
        Math.abs(task.offsetDaysFromLastWorkingDate) > 365
      ) {
        throw new Error("Task due-date offsets must be whole days between -365 and 365.");
      }
    }
    for (const task of template.tasks) {
      for (const dependencyId of task.dependsOnTaskIds ?? []) {
        if (dependencyId === task.id || !taskIds.has(dependencyId)) {
          throw new Error(`“${task.title}” has an invalid dependency.`);
        }
      }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byId = new Map(template.tasks.map((task) => [task.id, task]));
    const visit = (taskId: string): void => {
      if (visiting.has(taskId)) throw new Error("Task dependencies cannot form a loop.");
      if (visited.has(taskId)) return;
      visiting.add(taskId);
      for (const dependencyId of byId.get(taskId)?.dependsOnTaskIds ?? []) visit(dependencyId);
      visiting.delete(taskId);
      visited.add(taskId);
    };
    for (const task of template.tasks) visit(task.id);

    const duplicate = this.templatesRepo
      .list()
      .find(
        (item) =>
          item.id !== template.id &&
          !item.archivedAt &&
          item.name.trim().toLowerCase() === template.name.trim().toLowerCase(),
      );
    if (duplicate) throw new Error("Another offboarding template already uses this name.");
  }

  saveTemplate(template: OffboardingTemplate, context: ActorContext) {
    this.requireRole(context, ["HR", "Super Admin"], "save an offboarding template", template.id);
    const normalized: OffboardingTemplate = {
      ...template,
      name: template.name.trim(),
      description: template.description.trim(),
      departments: [
        ...new Set((template.departments ?? []).map((value) => value.trim()).filter(Boolean)),
      ],
      employmentTypes: [
        ...new Set((template.employmentTypes ?? []).map((value) => value.trim()).filter(Boolean)),
      ],
      tasks: template.tasks.map((task) => ({
        ...task,
        title: task.title.trim(),
        ...(task.instructions?.trim() ? { instructions: task.instructions.trim() } : {}),
        dependsOnTaskIds: [...new Set(task.dependsOnTaskIds ?? [])],
      })),
    };
    this.validateTemplate(normalized);
    if (this.templatesRepo.getById(template.id)) {
      return this.templatesRepo.update(template.id, normalized, context);
    }
    return this.templatesRepo.create(normalized, context);
  }

  deleteTemplate(id: string, context: ActorContext) {
    this.requireRole(context, ["HR", "Super Admin"], "archive an offboarding template", id);
    const template = this.templatesRepo.getById(id);
    if (!template) throw new Error("Offboarding template not found.");
    if (
      template.isActive &&
      this.templatesRepo.list().filter((item) => item.isActive).length <= 1
    ) {
      throw new Error("Keep at least one active offboarding template.");
    }
    return this.templatesRepo.archive(id, context);
  }

  private getCasesInternal() {
    return this.casesRepo.list();
  }

  // Mirrors OnboardingService.getCasesForContext: HR/Super Admin see every case; everyone
  // else only sees cases they can actually act on, per canAccessCase. UI code that renders a
  // list of offboarding cases (rather than a single case already reached through an
  // access-checked path) should call this instead of getCases() directly.
  getCasesForContext(context: ActorContext): OffboardingCase[] {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return this.getCasesInternal();
    return this.getCasesInternal().filter((offboardingCase) =>
      this.canAccessCase(offboardingCase, context),
    );
  }

  getCaseById(id: string, context: ActorContext) {
    const offboardingCase = this.casesRepo.getById(id);
    if (!offboardingCase) return undefined;
    this.requireCaseAccess(offboardingCase, context);
    return this.redactCaseForViewer(offboardingCase, context);
  }

  private getCaseByEmployeeIdInternal(employeeId: string) {
    return this.casesRepo
      .list()
      .find((c) => c.employeeId === employeeId && c.status !== "Cancelled");
  }

  getCaseByEmployeeId(employeeId: string, context: ActorContext) {
    const offboardingCase = this.getCaseByEmployeeIdInternal(employeeId);
    if (!offboardingCase) return undefined;
    this.requireCaseAccess(offboardingCase, context);
    return this.redactCaseForViewer(offboardingCase, context);
  }

  canAccessCase(c: OffboardingCase, context: ActorContext): boolean {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return true;
    const employee = this.empService.getEmployeeRepository(SYSTEM_CONTEXT).getById(c.employeeId, {
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
        // Employee/Line Manager are relationship-scoped by the two branches above and must
        // never fall through here, or any employee/manager could reach someone else's
        // unrelated case purely by sharing its task's owner role. IT/Accounts/HR are genuine
        // shared-service functions - anyone holding that role legitimately handles any
        // employee's task of that type, so the bare role match is correct only for those.
        (task.ownerRole === role &&
          task.ownerRole !== "Employee" &&
          task.ownerRole !== "Line Manager"),
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

  private canSeeConfidentialNotes(c: OffboardingCase, context: ActorContext): boolean {
    const role = this.activeRole(context);
    if (role === "Super Admin") return true;
    if (role === "HR") return c.confidentialityLevel !== "Restricted";
    return false;
  }

  // Strips confidentialNotes unless the viewer is specifically entitled to see it (Super Admin
  // always; HR only when the case isn't Restricted). Callers that already hold a case fresh
  // from a mutating method (which always returns the full, unredacted record) must pass it
  // through this before putting it into any state a denied-for-confidential viewer could read.
  redactCaseForViewer(c: OffboardingCase, context: ActorContext): OffboardingCase {
    if (this.canSeeConfidentialNotes(c, context)) return c;
    const { confidentialNotes: _omit, ...redacted } = c;
    return redacted;
  }

  // A page must never hold the raw case (including confidentialNotes) in memory before it has
  // confirmed the viewer may see it - even a render path that hides confidential fields behind
  // a permission check still leaves them sitting in component state/devtools if the unredacted
  // object was fetched first. Returns undefined if the viewer cannot access the case at all.
  getCaseForViewer(caseId: string, context: ActorContext): OffboardingCase | undefined {
    const c = this.casesRepo.getById(caseId);
    if (!c) return undefined;
    if (!this.canAccessCase(c, context)) {
      getApplicationDataServices().audit.record({
        context,
        action: "access-denied",
        module: "offboarding",
        entityType: "offboarding_case",
        entityId: caseId,
        reason: "Attempted to view an offboarding case outside the viewer's assignment.",
        riskLevel: "High",
      });
      return undefined;
    }
    return this.redactCaseForViewer(c, context);
  }

  getTasksForContext(c: OffboardingCase, context: ActorContext): OffboardingTask[] {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return c.tasks;
    const employee = this.empService.getEmployeeRepository(SYSTEM_CONTEXT).getById(c.employeeId, {
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
        (task.ownerRole === role &&
          task.ownerRole !== "Employee" &&
          task.ownerRole !== "Line Manager"),
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

  // Mirrors OnboardingService.notifyCaseStarted: whoever ends up responsible for a task -
  // the specifically assigned person if the template named one, otherwise everyone currently
  // holding the task's ownerRole - is told they now have offboarding work to do.
  private notifyCaseStarted(
    offboardingCase: OffboardingCase,
    employee: Employee,
    context: ActorContext,
  ): void {
    const users = this.empService.getUserRepository(SYSTEM_CONTEXT).list();
    const assignments = new Map<string, number>();
    for (const task of offboardingCase.tasks) {
      const recipients = task.assignedUserId
        ? users.filter((user) => user.id === task.assignedUserId)
        : users.filter((user) => user.status === "Active" && user.roles.includes(task.ownerRole));
      for (const recipient of recipients) {
        assignments.set(recipient.id, (assignments.get(recipient.id) ?? 0) + 1);
      }
    }
    for (const [recipientUserId, count] of assignments) {
      getApplicationDataServices().notifications.create(
        {
          recipientUserId,
          type: "offboarding.assigned",
          title: "Offboarding work assigned",
          message: `${count} offboarding task${count === 1 ? "" : "s"} for ${employee.legalName} require your attention.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `offboarding-started-${offboardingCase.id}-${recipientUserId}`,
          link: {
            entityType: "offboarding-case",
            entityId: offboardingCase.id,
            path: `/staff/offboarding/${offboardingCase.id}`,
          },
        },
        context,
      );
    }
  }

  // Mirrors OnboardingService.notifyMilestone: the departing employee, the HR owner of the
  // case, and every active Super Admin are told about case-level state changes (cancelled,
  // completed) that a per-task assignment notification would never reach.
  private notifyMilestone(
    offboardingCase: OffboardingCase,
    title: string,
    message: string,
    context: ActorContext,
    milestone: string,
  ): void {
    const users = this.empService.getUserRepository(SYSTEM_CONTEXT).list();
    const recipientIds = new Set<string>();
    const employeeUser = users.find((user) => user.employeeId === offboardingCase.employeeId);
    if (employeeUser) recipientIds.add(employeeUser.id);
    if (offboardingCase.assignedHRId) recipientIds.add(offboardingCase.assignedHRId);
    for (const user of users) {
      if (user.status === "Active" && user.roles.includes("Super Admin")) recipientIds.add(user.id);
    }
    for (const recipientUserId of recipientIds) {
      const isEmployee = employeeUser?.id === recipientUserId;
      getApplicationDataServices().notifications.create(
        {
          recipientUserId,
          type: `offboarding.${milestone}`,
          title,
          message,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `offboarding-${milestone}-${offboardingCase.id}-${recipientUserId}`,
          link: {
            entityType: "offboarding-case",
            entityId: offboardingCase.id,
            path: isEmployee ? "/staff/my-tasks" : `/staff/offboarding/${offboardingCase.id}`,
          },
        },
        context,
      );
    }
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
    options: {
      templateId?: string;
      assignedHRId?: string;
      confidentialityLevel?: OffboardingConfidentialityLevel;
    } = {},
  ): OffboardingCase {
    this.requireRole(context, ["HR", "Super Admin"], "start an offboarding case", employeeId);
    const employee = this.empService.getEmployeeRepository(SYSTEM_CONTEXT).getById(employeeId);
    if (!employee) throw new Error("Employee not found");

    if (this.getCaseByEmployeeIdInternal(employeeId)) {
      throw new Error("An active offboarding case already exists for this employee.");
    }

    const noticeDateMs = new Date(noticeDate).getTime();
    const lastWorkingDateMs = new Date(lastWorkingDate).getTime();
    if (Number.isNaN(noticeDateMs)) {
      throw new Error("Notice date is not a valid date.");
    }
    if (Number.isNaN(lastWorkingDateMs)) {
      throw new Error("Last working date is not a valid date.");
    }
    if (noticeDateMs > lastWorkingDateMs) {
      throw new Error("Notice date cannot be after the last working date.");
    }

    const template = options.templateId
      ? this.templatesRepo.getById(options.templateId)
      : this.findMatchingTemplate(employee);
    if (!template || !template.isActive) {
      throw new Error("Select an active offboarding template before starting this case.");
    }

    const users = this.empService.getUserRepository(SYSTEM_CONTEXT).list();
    const assignedHRId =
      options.assignedHRId ||
      (this.activeRole(context) === "HR"
        ? context.actor.userId
        : users.find((user) => user.status === "Active" && user.roles.includes("HR"))?.id);
    if (options.assignedHRId) {
      const assignedHR = users.find((user) => user.id === options.assignedHRId);
      if (!assignedHR || assignedHR.status !== "Active" || !assignedHR.roles.includes("HR")) {
        throw new Error("Select an active HR owner for this offboarding case.");
      }
    }

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
        const resolvedAssignee =
          tt.assignedUserId || (tt.ownerRole === "HR" ? assignedHRId : undefined);

        tasks.push({
          id: idMap.get(tt.id)!,
          templateTaskId: tt.id,
          title: tt.title,
          group: tt.group,
          ownerRole: tt.ownerRole,
          ...(resolvedAssignee ? { assignedUserId: resolvedAssignee } : {}),
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
      ...(assignedHRId ? { assignedHRId } : {}),
      confidentialityLevel: options.confidentialityLevel ?? "Standard",
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

    // Case creation, the employee's status change, and the initial progress calculation are
    // three separate writes - if a later one fails, we must not leave a case behind whose
    // employee never actually moved to Notice status (or vice versa).
    const { storage } = getApplicationDataServices();
    const snapshot = storage.exportState();
    try {
      const saved = this.casesRepo.create(obCase, context);

      // Employee moves to Notice status immediately so the whole org can see they're leaving.
      this.empService.changeEmployeeStatus(
        employeeId,
        "Notice",
        `Offboarding started: ${reasonCategory}`,
        context,
      );

      const withProgress = this.recalculateCaseProgress(saved.id, context);
      this.notifyCaseStarted(withProgress, employee, context);
      return withProgress;
    } catch (err) {
      storage.replaceState(snapshot);
      throw new Error(
        `Failed to start offboarding: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async updateTaskStatus(
    caseId: string,
    taskId: string,
    status: OffboardingTaskStatus,
    context: ActorContext,
    evidenceFileId?: string,
    waiverReason?: string,
  ) {
    if (typeof window !== "undefined") {
      const { updateOffboardingTaskFn } =
        await import("../server-functions/core-hr-lifecycle.server.ts");
      await updateOffboardingTaskFn({
        data: {
          actor: await this.serverActor(context),
          caseId,
          taskId,
          status,
          ...(evidenceFileId ? { evidenceFileId } : {}),
          ...(waiverReason ? { waiverReason } : {}),
        },
      });
      await this.hydrateCompatibilityCache(context);
      const updated = this.casesRepo.getById(caseId);
      if (!updated) throw new Error("Offboarding was updated but could not be reloaded.");
      return updated;
    }
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
    // The workflow service must not just trust that a caller-supplied evidenceFileId is real and
    // actually belongs to this case - re-verify it independently here, the same way
    // LifecycleTaskService.openEvidence() already does when VIEWING evidence, so completing a
    // task has the same guarantee as viewing one rather than relying on every future caller to
    // have uploaded the file correctly.
    if (status === "Completed" && evidenceFileId) {
      const { files } = getApplicationDataServices();
      const metadata = await files.getMetadata(evidenceFileId);
      if (
        !metadata ||
        metadata.owner.entityType !== "offboarding-case" ||
        metadata.owner.entityId !== caseId
      ) {
        throw new Error("The uploaded evidence file could not be verified. Please re-upload it.");
      }
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

  /**
   * Names a specific person as the owner of a single task on an already-started case -
   * independent of the template's own named-owner setting, for when the template's default
   * assignee is unavailable (on leave, has left, etc.) and the task needs reassigning without
   * waiting for a new template to be authored.
   */
  assignTaskOwner(
    caseId: string,
    taskId: string,
    userId: string | undefined,
    context: ActorContext,
  ): OffboardingCase {
    this.requireRole(context, ["HR", "Super Admin"], "reassign an offboarding task", caseId);
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    if (c.status === "Completed" || c.status === "Cancelled") {
      throw new Error(`This offboarding case is already ${c.status} and can no longer be updated.`);
    }
    const task = c.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");

    let assignedUser: User | undefined;
    if (userId) {
      assignedUser = this.empService.getUserRepository(SYSTEM_CONTEXT).getById(userId) ?? undefined;
      if (!assignedUser || assignedUser.status !== "Active") {
        throw new Error("The selected owner must be an active user.");
      }
      if (!assignedUser.roles.includes(task.ownerRole)) {
        throw new Error(`The selected owner must hold the ${task.ownerRole} role.`);
      }
    }

    if (userId) task.assignedUserId = userId;
    else delete task.assignedUserId;

    const saved = this.casesRepo.update(c.id, c, context);

    if (assignedUser) {
      getApplicationDataServices().notifications.create(
        {
          recipientUserId: assignedUser.id,
          type: "offboarding.assigned",
          title: "Offboarding task assigned to you",
          message: `You have been assigned "${task.title}" for an offboarding case.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `offboarding-reassigned-${c.id}-${task.id}-${assignedUser.id}`,
          link: {
            entityType: "offboarding-case",
            entityId: c.id,
            path: `/staff/offboarding/${c.id}`,
          },
        },
        context,
      );
    }

    return saved;
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

  // Notifies whoever needs to act next once a clearance is granted: if the other clearance is
  // still outstanding, its owning role is nudged; once both are in, HR/Super Admin are told the
  // case is ready to finalise. Without this, "waiting for Accounts"/"waiting for HR" on the case
  // page is the only signal, and nobody is proactively told to go look.
  private notifyClearanceProgress(c: OffboardingCase, context: ActorContext): void {
    const users = this.empService.getUserRepository(SYSTEM_CONTEXT).list();
    const bothGranted = Boolean(c.financialClearanceAt && c.legalClearanceAt);
    if (bothGranted) {
      const recipients = users.filter(
        (u) =>
          u.status === "Active" && (u.roles.includes("Super Admin") || u.id === c.assignedHRId),
      );
      for (const recipient of recipients) {
        getApplicationDataServices().notifications.create(
          {
            recipientUserId: recipient.id,
            type: "offboarding.ready_to_finalise",
            title: "Offboarding ready to finalise",
            message:
              "Both financial and HR clearance are confirmed - this case can now be completed.",
            priority: "High",
            status: "Unread",
            deduplicationKey: `offboarding-ready-${c.id}`,
            link: {
              entityType: "offboarding-case",
              entityId: c.id,
              path: `/staff/offboarding/${c.id}`,
            },
          },
          context,
        );
      }
      return;
    }
    const waitingOnRole: Role | undefined = !c.financialClearanceAt
      ? "Accounts"
      : !c.legalClearanceAt
        ? "HR"
        : undefined;
    if (!waitingOnRole) return;
    const recipients = users.filter(
      (u) => u.status === "Active" && u.roles.includes(waitingOnRole),
    );
    for (const recipient of recipients) {
      getApplicationDataServices().notifications.create(
        {
          recipientUserId: recipient.id,
          type: "offboarding.clearance_needed",
          title: `${waitingOnRole} clearance needed`,
          message:
            "The other clearance is confirmed - this case is waiting on your sign-off to proceed.",
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `offboarding-clearance-needed-${c.id}-${waitingOnRole}`,
          link: {
            entityType: "offboarding-case",
            entityId: c.id,
            path: `/staff/offboarding/${c.id}`,
          },
        },
        context,
      );
    }
  }

  grantFinancialClearance(caseId: string, context: ActorContext): OffboardingCase {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    this.requireRole(context, ["Accounts", "Super Admin"], "confirm financial clearance", caseId);
    // A departing employee who also happens to hold Accounts or Super Admin must never be able
    // to grant clearance on their own case, independent of the role check above.
    if (context.actor.employeeId === c.employeeId) {
      this.deny(
        "confirm financial clearance",
        caseId,
        "You cannot confirm financial clearance on your own offboarding case.",
        context,
      );
    }
    if (c.progressPercentage < 100)
      throw new Error("All mandatory tasks must be complete before financial clearance.");

    c.financialClearanceAt = new Date().toISOString();
    c.financialClearanceBy = context.actor.userId;
    const saved = this.casesRepo.update(c.id, c, context);
    this.notifyClearanceProgress(saved, context);
    return saved;
  }

  grantLegalClearance(caseId: string, context: ActorContext): OffboardingCase {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    this.requireRole(context, ["HR", "Super Admin"], "confirm HR and document clearance", caseId);
    // A departing employee who also happens to hold HR or Super Admin must never be able to
    // grant clearance on their own case, independent of the role check above.
    if (context.actor.employeeId === c.employeeId) {
      this.deny(
        "confirm HR and document clearance",
        caseId,
        "You cannot confirm legal/document clearance on your own offboarding case.",
        context,
      );
    }
    if (c.progressPercentage < 100)
      throw new Error("All mandatory tasks must be complete before legal/document clearance.");

    c.legalClearanceAt = new Date().toISOString();
    c.legalClearanceBy = context.actor.userId;
    const saved = this.casesRepo.update(c.id, c, context);
    this.notifyClearanceProgress(saved, context);
    return saved;
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

    // Cancelling the case and reverting the employee's Notice status are two separate writes -
    // if the second fails, the case must not be left Cancelled with the employee stuck on Notice.
    const { storage } = getApplicationDataServices();
    const snapshot = storage.exportState();
    try {
      const saved = this.casesRepo.update(caseId, { status: "Cancelled" }, actionContext);

      const employee = this.empService
        .getEmployeeRepository(SYSTEM_CONTEXT)
        .getById(c.employeeId, { includeArchived: true });
      if (employee?.status === "Notice") {
        this.empService.changeEmployeeStatus(employee.id, "Active", trimmedReason, actionContext);
      }

      this.notifyMilestone(
        saved,
        "Offboarding cancelled",
        `The offboarding process was cancelled: ${trimmedReason}`,
        actionContext,
        "cancelled",
      );
      return saved;
    } catch (err) {
      storage.replaceState(snapshot);
      throw new Error(
        `Failed to cancel offboarding: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  finalizeCase(caseId: string, context: ActorContext): OffboardingCase {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    this.requireRole(context, ["Super Admin"], "complete offboarding", caseId);
    // A departing employee who also happens to hold Super Admin must never be able to
    // finalise their own departure, independent of the role check above.
    if (context.actor.employeeId === c.employeeId) {
      this.deny(
        "finalise offboarding",
        caseId,
        "You cannot finalise your own offboarding case.",
        context,
      );
    }

    // The employee must have actually reached their last working date - finalising early would
    // cut off their access and generate termination records before they were actually meant to
    // leave.
    const today = new Date().toISOString().split("T")[0] as string;
    if (c.lastWorkingDate > today) {
      throw new Error(
        `Cannot finalise before the employee's last working date (${c.lastWorkingDate}).`,
      );
    }

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

    // Closing the case and finalising the employee's own employment record (status, termination
    // date/reason, employment history) are separate writes across two services - if the latter
    // fails, the case must not be left showing Completed while the employee record disagrees.
    const { storage } = getApplicationDataServices();
    const snapshot = storage.exportState();
    try {
      const saved = this.casesRepo.update(c.id, c, context);
      this.empService.finalizeEmployment(
        c.employeeId,
        c.lastWorkingDate,
        c.reasonCategory,
        context,
      );
      this.notifyMilestone(
        saved,
        "Offboarding completed",
        "All clearances are confirmed and the employee's access has been made inactive.",
        context,
        "completed",
      );
      return saved;
    } catch (err) {
      storage.replaceState(snapshot);
      throw new Error(
        `Failed to finalise offboarding: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
