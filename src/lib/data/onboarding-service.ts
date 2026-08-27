import { LocalRepository } from "./repository.ts";
import type {
  OnboardingCase,
  OnboardingTemplate,
  OnboardingTask,
  OnboardingTaskStatus,
} from "./onboarding-types.ts";
import type {
  ActorContext,
  DocumentType,
  Employee,
  EmployeeDocument,
  Role,
  User,
} from "./types.ts";
import { SYSTEM_ACTOR } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";

import { getApplicationDataServices } from "./application-data.ts";

const generateId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `via-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const TEMPLATE_ROLES: Role[] = ["Employee", "Line Manager", "HR", "Accounts", "IT", "Super Admin"];

export class OnboardingService {
  private casesRepo: LocalRepository<OnboardingCase>;
  private templatesRepo: LocalRepository<OnboardingTemplate>;
  private empService = new EmployeeService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.casesRepo = new LocalRepository<OnboardingCase>("onboardingCases", storage, audit, {
      module: "hr",
      entityType: "onboarding-case",
    });
    this.templatesRepo = new LocalRepository<OnboardingTemplate>(
      "onboardingTemplates",
      storage,
      audit,
      { module: "hr", entityType: "onboarding-template" },
    );
    this.seedDefaultTemplate();
  }

  private activeRole(context: ActorContext): Role | undefined {
    return (
      context.actor.activeRole ??
      (context.actor.roles.length === 1 ? context.actor.roles[0] : undefined)
    );
  }

  private currentDate(): string {
    const timezone = getApplicationDataServices().storage.readCollection<{ timezone?: string }>(
      "appSettings",
    )[0]?.timezone;
    const parts = new Intl.DateTimeFormat("en-GB", {
      ...(timezone ? { timeZone: timezone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  private deny(action: string, entityId: string, reason: string, context: ActorContext): never {
    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "onboarding",
      entityType: "onboarding-task",
      entityId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
    throw new Error(reason);
  }

  private requireCaseManager(context: ActorContext, action: string): void {
    const role = this.activeRole(context);
    if (role !== "HR" && role !== "Super Admin") {
      this.deny(
        action,
        "onboarding",
        "Only HR or a Super Admin can manage onboarding cases and templates.",
        context,
      );
    }
  }

  private requireTaskAction(
    c: OnboardingCase,
    task: OnboardingTask,
    status: OnboardingTaskStatus,
    context: ActorContext,
  ): void {
    const role = this.activeRole(context);
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId);
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
          "waive onboarding task",
          task.id,
          "Only HR or a Super Admin can waive an onboarding task.",
          context,
        );
      }
      return;
    }
    if (!isOwner && role !== "Super Admin") {
      this.deny(
        "complete onboarding task",
        task.id,
        "This task is assigned to another person or role.",
        context,
      );
    }
  }

  private validateSelfServiceCompletion(
    c: OnboardingCase,
    task: OnboardingTask,
    evidenceFileId: string | undefined,
  ): void {
    if (!task.selfServiceFormKey && !task.requiresBankDetails && !task.verificationDocumentType) {
      return;
    }
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId);
    if (!employee) throw new Error("Employee not found");
    if (task.selfServiceFormKey === "personal_details") {
      if (
        !employee.dateOfBirth ||
        !employee.gender ||
        !employee.nationality ||
        !employee.address ||
        !employee.phone ||
        !employee.emergencyContacts?.length
      ) {
        throw new Error(
          "Complete and save the required personal and emergency-contact details first.",
        );
      }
    }
    if (task.selfServiceFormKey === "bank_details") {
      if (
        !employee.bankDetails?.bankName ||
        !employee.bankDetails.accountNumber ||
        !employee.bankDetails.iban
      ) {
        throw new Error("Complete and save the required bank details first.");
      }
    }
    if (task.selfServiceFormKey === "document_upload") {
      if (!evidenceFileId) throw new Error("Upload the required document first.");
      const matchingDocument = getApplicationDataServices()
        .storage.readCollection<EmployeeDocument>("employee_documents")
        .some(
          (document) =>
            document.employeeId === c.employeeId &&
            document.fileId === evidenceFileId &&
            (!task.documentType || document.type === task.documentType),
        );
      if (!matchingDocument)
        throw new Error("The uploaded evidence is not linked to this employee and task.");
    }
    if (task.requiresBankDetails) {
      if (
        !employee.bankDetails?.bankName ||
        !employee.bankDetails.accountNumber ||
        !employee.bankDetails.iban
      ) {
        throw new Error(
          "The employee must submit complete bank details before this task can close.",
        );
      }
    }
    if (task.verificationDocumentType) {
      const verifiedDocument = getApplicationDataServices()
        .storage.readCollection<EmployeeDocument>("employee_documents")
        .some(
          (document) =>
            document.employeeId === c.employeeId &&
            document.type === task.verificationDocumentType &&
            document.status === "Valid" &&
            !document.archivedAt,
        );
      if (!verifiedDocument) {
        throw new Error("Verify the required employee document before completing this task.");
      }
    }
  }

  private seedDefaultTemplate() {
    if (this.templatesRepo.list().length === 0) {
      this.templatesRepo.create(
        {
          id: "tmpl-default",
          name: "Standard Global Onboarding",
          description: "Default onboarding process for all employees",
          isActive: true,
          countries: [],
          legalEntities: [],
          departments: [],
          roles: [],
          employmentTypes: [],
          tasks: [
            {
              id: "t0",
              title: "Complete Personal Details",
              group: "Personal & Legal Documents",
              checkpoint: "Pre-Arrival",
              ownerRole: "Employee",
              offsetDaysFromStart: -7,
              isMandatory: true,
              requiresEvidence: false,
              selfServiceFormKey: "personal_details",
            },
            {
              id: "t1",
              title: "Upload Signed Contract",
              group: "Contract & Payroll",
              checkpoint: "Pre-Arrival",
              ownerRole: "Employee",
              offsetDaysFromStart: -7,
              isMandatory: true,
              requiresEvidence: true,
              selfServiceFormKey: "document_upload",
              documentType: "contract",
            },
            {
              id: "t1b",
              title: "Upload Passport Copy",
              group: "Personal & Legal Documents",
              checkpoint: "Pre-Arrival",
              ownerRole: "Employee",
              offsetDaysFromStart: -7,
              isMandatory: true,
              requiresEvidence: true,
              selfServiceFormKey: "document_upload",
              documentType: "passport",
            },
            {
              id: "t1c",
              title: "Upload Visa / Work Permit",
              group: "Personal & Legal Documents",
              checkpoint: "Pre-Arrival",
              ownerRole: "Employee",
              offsetDaysFromStart: -7,
              isMandatory: true,
              requiresEvidence: true,
              selfServiceFormKey: "document_upload",
              documentType: "visa",
            },
            {
              id: "t1d",
              title: "Upload National ID Copy",
              group: "Personal & Legal Documents",
              checkpoint: "Pre-Arrival",
              ownerRole: "Employee",
              offsetDaysFromStart: -7,
              isMandatory: true,
              requiresEvidence: true,
              selfServiceFormKey: "document_upload",
              documentType: "national_id",
            },
            {
              id: "t2",
              title: "Provide Bank Details",
              group: "Contract & Payroll",
              checkpoint: "Pre-Arrival",
              ownerRole: "Employee",
              offsetDaysFromStart: -5,
              isMandatory: true,
              requiresEvidence: false,
              selfServiceFormKey: "bank_details",
            },
            {
              id: "t3",
              title: "Provision Laptop",
              group: "IT & Equipment",
              checkpoint: "Pre-Arrival",
              ownerRole: "IT",
              offsetDaysFromStart: -3,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "t4",
              title: "Confirm Work Email Is Ready",
              group: "IT & Equipment",
              checkpoint: "Pre-Arrival",
              ownerRole: "IT",
              offsetDaysFromStart: -3,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "t4b",
              title: "Prepare Building and System Access",
              group: "Access & Security",
              checkpoint: "Pre-Arrival",
              ownerRole: "Super Admin",
              offsetDaysFromStart: -2,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["t4"],
            },
            {
              id: "t2b",
              title: "Confirm Bank Details for Payroll",
              group: "Contract & Payroll",
              checkpoint: "Pre-Arrival",
              ownerRole: "Accounts",
              offsetDaysFromStart: -2,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["t2"],
              requiresBankDetails: true,
            },
            ...(
              [
                ["contract", "t1", "Verify Signed Contract"],
                ["passport", "t1b", "Verify Passport"],
                ["visa", "t1c", "Verify Visa or Work Permit"],
                ["national_id", "t1d", "Verify National ID"],
              ] as const
            ).map(([documentType, dependency, title], index) => ({
              id: `t-verify-${index}`,
              title,
              group:
                documentType === "contract"
                  ? ("Contract & Payroll" as const)
                  : ("Visa, Work Permit & ID" as const),
              checkpoint: "Pre-Arrival" as const,
              ownerRole: "HR" as const,
              offsetDaysFromStart: -2,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: [dependency],
              verificationDocumentType: documentType as DocumentType,
            })),
            {
              id: "t5",
              title: "First Day Induction",
              group: "HSE & Induction",
              checkpoint: "Day 1",
              ownerRole: "HR",
              offsetDaysFromStart: 0,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "t6",
              title: "Department Welcome",
              group: "Department Introduction",
              checkpoint: "Week 1",
              ownerRole: "Line Manager",
              offsetDaysFromStart: 7,
              isMandatory: true,
              requiresEvidence: false,
            },
            {
              id: "t7",
              title: "30-Day Check-in",
              group: "Manager Plan",
              checkpoint: "Day 30",
              ownerRole: "Line Manager",
              offsetDaysFromStart: 30,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["t6"],
            },
            {
              id: "t8",
              title: "Set Probation Goals",
              group: "Probation Goals",
              checkpoint: "Day 30",
              ownerRole: "Line Manager",
              offsetDaysFromStart: 30,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["t6"],
            },
            {
              id: "t9",
              title: "60-Day Check-in",
              group: "Manager Plan",
              checkpoint: "Day 60",
              ownerRole: "Line Manager",
              offsetDaysFromStart: 60,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["t7"],
            },
            {
              id: "t10",
              title: "90-Day Onboarding Review",
              group: "Probation Goals",
              checkpoint: "Day 90",
              ownerRole: "Line Manager",
              offsetDaysFromStart: 90,
              isMandatory: true,
              requiresEvidence: false,
              dependsOnTaskIds: ["t9"],
            },
          ],
        },
        { actor: { userId: "system", displayName: "System", roles: ["Super Admin"] } },
      );
    }
    const existing = this.templatesRepo.getById("tmpl-default");
    if (!existing) return;
    const upgrades: OnboardingTemplate["tasks"] = [
      {
        id: "t2b",
        title: "Confirm Bank Details for Payroll",
        group: "Contract & Payroll",
        checkpoint: "Pre-Arrival",
        ownerRole: "Accounts",
        offsetDaysFromStart: -2,
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: ["t2"],
        requiresBankDetails: true,
      },
      {
        id: "t4b",
        title: "Prepare Building and System Access",
        group: "Access & Security",
        checkpoint: "Pre-Arrival",
        ownerRole: "Super Admin",
        offsetDaysFromStart: -2,
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: ["t4"],
      },
      ...(
        [
          ["contract", "t1", "Verify Signed Contract"],
          ["passport", "t1b", "Verify Passport"],
          ["visa", "t1c", "Verify Visa or Work Permit"],
          ["national_id", "t1d", "Verify National ID"],
        ] as const
      ).map(([documentType, dependency, title], index) => ({
        id: `t-verify-${index}`,
        title,
        group:
          documentType === "contract"
            ? ("Contract & Payroll" as const)
            : ("Visa, Work Permit & ID" as const),
        checkpoint: "Pre-Arrival" as const,
        ownerRole: "HR" as const,
        offsetDaysFromStart: -2,
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: [dependency],
        verificationDocumentType: documentType as DocumentType,
      })),
      {
        id: "t8",
        title: "Set Probation Goals",
        group: "Probation Goals",
        checkpoint: "Day 30",
        ownerRole: "Line Manager",
        offsetDaysFromStart: 30,
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: ["t6"],
      },
      {
        id: "t9",
        title: "60-Day Check-in",
        group: "Manager Plan",
        checkpoint: "Day 60",
        ownerRole: "Line Manager",
        offsetDaysFromStart: 60,
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: ["t7"],
      },
      {
        id: "t10",
        title: "90-Day Onboarding Review",
        group: "Probation Goals",
        checkpoint: "Day 90",
        ownerRole: "Line Manager",
        offsetDaysFromStart: 90,
        isMandatory: true,
        requiresEvidence: false,
        dependsOnTaskIds: ["t9"],
      },
    ];
    const existingIds = new Set(existing.tasks.map((task) => task.id));
    const missing = upgrades.filter((task) => !existingIds.has(task.id));
    const workEmailTask = existing.tasks.find((task) => task.id === "t4");
    const needsWordingUpdate = workEmailTask?.title === "Create Email Account";
    const needsEntityField = !Array.isArray(existing.legalEntities);
    if (missing.length || needsWordingUpdate || needsEntityField) {
      this.templatesRepo.update(
        existing.id,
        {
          legalEntities: existing.legalEntities ?? [],
          tasks: [
            ...existing.tasks.map((task) =>
              task.id === "t4" ? { ...task, title: "Confirm Work Email Is Ready" } : task,
            ),
            ...missing,
          ],
        },
        {
          actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" },
          reason: "Updated the standard onboarding checklist",
        },
      );
    }
  }

  getTemplates() {
    return this.templatesRepo.list().map((template) => ({
      ...template,
      countries: template.countries ?? [],
      legalEntities: template.legalEntities ?? [],
      departments: template.departments ?? [],
      roles: template.roles ?? [],
      employmentTypes: template.employmentTypes ?? [],
    }));
  }

  private validateTemplate(template: OnboardingTemplate): void {
    if (template.name.trim().length < 3) throw new Error("Template name is required.");
    if (template.description.trim().length < 5) {
      throw new Error("Add a short description explaining when this template is used.");
    }
    if (template.tasks.length === 0) throw new Error("Add at least one onboarding task.");
    const taskIds = new Set<string>();
    const users = this.empService.getUserRepository().list();
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
      if (!Number.isInteger(task.offsetDaysFromStart) || Math.abs(task.offsetDaysFromStart) > 365) {
        throw new Error("Task due-date offsets must be whole days between -365 and 365.");
      }
      if (task.selfServiceFormKey === "document_upload" && !task.documentType) {
        throw new Error(`Choose a document type for “${task.title}”.`);
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
    if (duplicate) throw new Error("Another onboarding template already uses this name.");
  }

  saveTemplate(template: OnboardingTemplate, context: ActorContext) {
    this.requireCaseManager(context, "save onboarding template");
    const normalized: OnboardingTemplate = {
      ...template,
      name: template.name.trim(),
      description: template.description.trim(),
      countries: [
        ...new Set((template.countries ?? []).map((value) => value.trim()).filter(Boolean)),
      ],
      legalEntities: [
        ...new Set((template.legalEntities ?? []).map((value) => value.trim()).filter(Boolean)),
      ],
      departments: [
        ...new Set((template.departments ?? []).map((value) => value.trim()).filter(Boolean)),
      ],
      roles: [...new Set((template.roles ?? []).map((value) => value.trim()).filter(Boolean))],
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
    this.requireCaseManager(context, "archive onboarding template");
    const template = this.templatesRepo.getById(id);
    if (!template) throw new Error("Onboarding template not found.");
    if (template.isActive && this.getTemplates().filter((item) => item.isActive).length <= 1) {
      throw new Error("Keep at least one active onboarding template.");
    }
    return this.templatesRepo.archive(id, context);
  }

  getCases() {
    return this.casesRepo.list();
  }

  getCasesForContext(context: ActorContext): OnboardingCase[] {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return this.getCases();
    return this.getCases().filter((onboardingCase) => this.canAccessCase(onboardingCase, context));
  }

  getCaseById(id: string) {
    return this.casesRepo.getById(id);
  }

  getCaseByEmployeeId(employeeId: string) {
    return this.casesRepo
      .list()
      .filter((onboardingCase) => onboardingCase.employeeId === employeeId)
      .sort((a, b) => {
        const activeDifference =
          Number(b.status === "In Progress") - Number(a.status === "In Progress");
        return activeDifference || b.updatedAt.localeCompare(a.updatedAt);
      })[0];
  }

  canAccessCase(c: OnboardingCase, context: ActorContext): boolean {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return true;
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId);
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

  requireCaseAccess(c: OnboardingCase, context: ActorContext): void {
    if (!this.canAccessCase(c, context)) {
      this.deny(
        "view onboarding case",
        c.id,
        "This onboarding case is not assigned to you or your active role.",
        context,
      );
    }
  }

  getTasksForContext(c: OnboardingCase, context: ActorContext): OnboardingTask[] {
    const role = this.activeRole(context);
    if (role === "HR" || role === "Super Admin") return c.tasks;
    const employee = this.empService.getEmployeeRepository().getById(c.employeeId);
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

  /** Mandatory tasks the new hire themselves must action - the self-service intake form. */
  getSelfServiceTasks(employeeId: string, context: ActorContext): OnboardingTask[] {
    if (context.actor.employeeId !== employeeId) {
      this.deny(
        "view employee onboarding form",
        employeeId,
        "You can view only your own onboarding form.",
        context,
      );
    }
    const c = this.getCaseByEmployeeId(employeeId);
    if (!c) return [];
    return c.tasks.filter((t) => t.ownerRole === "Employee" && t.isMandatory);
  }

  /** True while the employee still has required self-service onboarding items outstanding. */
  hasIncompleteSelfServiceTasks(employeeId: string, context: ActorContext): boolean {
    if (context.actor.employeeId !== employeeId) {
      this.deny(
        "check employee onboarding form",
        employeeId,
        "You can check only your own onboarding requirements.",
        context,
      );
    }
    const c = this.getCaseByEmployeeId(employeeId);
    if (!c || c.status !== "In Progress") return false;
    return c.tasks.some(
      (t) =>
        t.ownerRole === "Employee" &&
        t.isMandatory &&
        t.status !== "Completed" &&
        t.status !== "Waived",
    );
  }

  findMatchingTemplate(employee: Employee): OnboardingTemplate | undefined {
    // Basic matching: find first active template that matches or has no restrictions
    const templates = this.templatesRepo.list().filter((t) => t.isActive);

    // Sort by most specific first (those with the most restrictions)
    templates.sort((a, b) => {
      const aScore =
        (a.countries?.length ?? 0) +
        (a.legalEntities?.length ?? 0) +
        a.departments.length +
        a.roles.length +
        a.employmentTypes.length;
      const bScore =
        (b.countries?.length ?? 0) +
        (b.legalEntities?.length ?? 0) +
        b.departments.length +
        b.roles.length +
        b.employmentTypes.length;
      return bScore - aScore;
    });

    for (const t of templates) {
      const country = employee.country || employee.location;
      const matchesCountry = !t.countries?.length || t.countries.includes(country);
      const matchesEntity =
        !t.legalEntities?.length ||
        Boolean(employee.legalEntity && t.legalEntities.includes(employee.legalEntity));
      const matchesDept = t.departments.length === 0 || t.departments.includes(employee.department);
      const matchesRole = t.roles.length === 0 || t.roles.includes(employee.position);
      const matchesEmpType =
        t.employmentTypes.length === 0 || t.employmentTypes.includes(employee.employmentType);

      if (matchesCountry && matchesEntity && matchesDept && matchesRole && matchesEmpType) {
        return t;
      }
    }
    return undefined;
  }

  private notifyCaseStarted(
    onboardingCase: OnboardingCase,
    employee: Employee,
    users: User[],
    context: ActorContext,
  ): void {
    const assignments = new Map<string, number>();
    for (const task of onboardingCase.tasks) {
      const recipients = task.assignedUserId
        ? users.filter((user) => user.id === task.assignedUserId)
        : users.filter((user) => user.status === "Active" && user.roles.includes(task.ownerRole));
      for (const recipient of recipients) {
        assignments.set(recipient.id, (assignments.get(recipient.id) ?? 0) + 1);
      }
    }
    for (const [recipientUserId, count] of assignments) {
      const recipient = users.find((user) => user.id === recipientUserId);
      const isEmployee = recipient?.employeeId === employee.id;
      getApplicationDataServices().notifications.create(
        {
          recipientUserId,
          type: "onboarding.assigned",
          title: isEmployee ? "Complete your onboarding" : "Onboarding work assigned",
          message: isEmployee
            ? `Welcome to VIA. Please complete your ${count} onboarding item${count === 1 ? "" : "s"}.`
            : `${count} onboarding task${count === 1 ? "" : "s"} for ${employee.legalName} require your attention.`,
          priority: "High",
          status: "Unread",
          deduplicationKey: `onboarding-started-${onboardingCase.id}-${recipientUserId}`,
          link: {
            entityType: "onboarding-case",
            entityId: onboardingCase.id,
            path: isEmployee ? "/staff/me/onboarding" : `/staff/onboarding/${onboardingCase.id}`,
          },
        },
        context,
      );
    }
  }

  createCaseForEmployee(
    employeeId: string,
    context: ActorContext,
    options: { templateId?: string; assignedHRId?: string } = {},
  ) {
    this.requireCaseManager(context, "create onboarding case");
    const employee = this.empService.getEmployeeRepository().getById(employeeId);
    if (!employee) throw new Error("Employee not found");
    if (employee.status !== "Onboarding") {
      throw new Error("Onboarding can be started only for an employee with Onboarding status.");
    }
    const existingCase = this.casesRepo
      .list()
      .find((item) => item.employeeId === employeeId && item.status === "In Progress");
    if (existingCase) throw new Error("This employee already has an active onboarding case.");

    const template = options.templateId
      ? this.templatesRepo.getById(options.templateId)
      : this.findMatchingTemplate(employee);
    if (!template || !template.isActive) {
      throw new Error("Select an active onboarding template before starting this case.");
    }

    // Calculate dates
    const startDate = new Date(employee.startDate);
    if (Number.isNaN(startDate.getTime())) throw new Error("Employee start date is invalid.");
    const users = this.empService.getUserRepository().list();
    const assignedHRId =
      options.assignedHRId ||
      (this.activeRole(context) === "HR"
        ? context.actor.userId
        : users.find((user) => user.status === "Active" && user.roles.includes("HR"))?.id);
    if (options.assignedHRId) {
      const assignedHR = users.find((user) => user.id === options.assignedHRId);
      if (!assignedHR || assignedHR.status !== "Active" || !assignedHR.roles.includes("HR")) {
        throw new Error("Select an active HR owner for this onboarding case.");
      }
    }
    const employeeUser = users.find((user) => user.employeeId === employee.id);
    const managerUser = users.find((user) => user.employeeId === employee.lineManagerId);
    if (
      template.tasks.some((task) => task.isMandatory && task.ownerRole === "Employee") &&
      !employeeUser
    ) {
      throw new Error("Create the employee's portal access record before starting onboarding.");
    }
    const unavailableNamedOwner = template.tasks.find(
      (task) =>
        task.assignedUserId &&
        !users.some((user) => user.id === task.assignedUserId && user.status === "Active"),
    );
    if (unavailableNamedOwner) {
      throw new Error(`The named owner for “${unavailableNamedOwner.title}” is no longer active.`);
    }

    const tasks: OnboardingTask[] = [];

    if (template) {
      // Map template tasks to instance tasks
      // Need a mapping to resolve dependencies (template task id -> instance task id)
      const idMap = new Map<string, string>();

      for (const tt of template.tasks) {
        const instanceId = generateId();
        idMap.set(tt.id, instanceId);
      }

      for (const tt of template.tasks) {
        const dueDate = new Date(startDate);
        dueDate.setDate(dueDate.getDate() + tt.offsetDaysFromStart);

        tasks.push({
          id: idMap.get(tt.id)!,
          templateTaskId: tt.id,
          title: tt.title,
          group: tt.group,
          checkpoint: tt.checkpoint,
          ownerRole: tt.ownerRole,
          ...(tt.assignedUserId ||
          (tt.ownerRole === "Employee" ? employeeUser?.id : undefined) ||
          (tt.ownerRole === "Line Manager" ? managerUser?.id : undefined) ||
          (tt.ownerRole === "HR" ? assignedHRId : undefined)
            ? {
                assignedUserId:
                  tt.assignedUserId ||
                  (tt.ownerRole === "Employee" ? employeeUser?.id : undefined) ||
                  (tt.ownerRole === "Line Manager" ? managerUser?.id : undefined) ||
                  assignedHRId,
              }
            : {}),
          offsetDaysFromStart: tt.offsetDaysFromStart,
          dueDate: dueDate.toISOString().split("T")[0]!,
          isMandatory: tt.isMandatory,
          requiresEvidence: tt.requiresEvidence,
          ...(tt.instructions !== undefined ? { instructions: tt.instructions } : {}),
          ...(tt.selfServiceFormKey !== undefined
            ? { selfServiceFormKey: tt.selfServiceFormKey }
            : {}),
          ...(tt.documentType !== undefined ? { documentType: tt.documentType } : {}),
          ...(tt.verificationDocumentType !== undefined
            ? { verificationDocumentType: tt.verificationDocumentType }
            : {}),
          ...(tt.requiresBankDetails !== undefined
            ? { requiresBankDetails: tt.requiresBankDetails }
            : {}),
          dependsOnTaskIds: (tt.dependsOnTaskIds || [])
            .map((dtid) => idMap.get(dtid)!)
            .filter(Boolean),
          status: "Pending", // Will be re-evaluated to Blocked if dependencies exist
        });
      }
    }

    // Older browser datasets may contain the pre-upgrade default template. Ensure every newly
    // converted employee still receives the complete statutory document intake checklist.
    for (const requiredDocument of template.id === "tmpl-default"
      ? ([
          { type: "passport", title: "Upload Passport Copy" },
          { type: "visa", title: "Upload Visa / Work Permit" },
          { type: "national_id", title: "Upload National ID Copy" },
        ] as const)
      : []) {
      if (tasks.some((task) => task.documentType === requiredDocument.type)) continue;
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() - 7);
      tasks.push({
        id: generateId(),
        templateTaskId: `required-${requiredDocument.type}`,
        title: requiredDocument.title,
        group: "Personal & Legal Documents",
        checkpoint: "Pre-Arrival",
        ownerRole: "Employee",
        ...(employeeUser ? { assignedUserId: employeeUser.id } : {}),
        offsetDaysFromStart: -7,
        dueDate: dueDate.toISOString().split("T")[0]!,
        isMandatory: true,
        requiresEvidence: true,
        selfServiceFormKey: "document_upload",
        documentType: requiredDocument.type,
        dependsOnTaskIds: [],
        status: "Pending",
      });
    }

    const obCase: OnboardingCase = {
      id: generateId(),
      employeeId,
      ...(template?.id !== undefined ? { templateId: template.id } : {}),
      status: "In Progress",
      tasks,
      progressPercentage: 0,
      isReadyForStartDate: false,
      ...(assignedHRId ? { assignedHRId } : {}),
      createdAt: new Date().toISOString(),
      createdBy: context.actor.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: context.actor.userId,
      recordVersion: 1,
    };

    const saved = this.casesRepo.create(obCase, context);
    const updated = this.recalculateCaseProgress(saved.id, context, { internal: true });
    this.notifyCaseStarted(updated, employee, users, context);
    return updated;
  }

  rescheduleCase(caseId: string, context: ActorContext): OnboardingCase {
    this.requireCaseManager(context, "reschedule onboarding case");
    const onboardingCase = this.casesRepo.getById(caseId);
    if (!onboardingCase) throw new Error("Onboarding case not found.");
    if (onboardingCase.status !== "In Progress") {
      throw new Error("Only an active onboarding case can be rescheduled.");
    }
    const employee = this.empService.getEmployeeRepository().getById(onboardingCase.employeeId);
    if (!employee) throw new Error("Employee not found.");
    const startDate = new Date(employee.startDate);
    if (Number.isNaN(startDate.getTime())) throw new Error("Employee start date is invalid.");
    const template = onboardingCase.templateId
      ? this.templatesRepo.getById(onboardingCase.templateId)
      : undefined;
    let changed = 0;
    const tasks = onboardingCase.tasks.map((task) => {
      if (task.status === "Completed" || task.status === "Waived") return task;
      const offset =
        task.offsetDaysFromStart ??
        template?.tasks.find((templateTask) => templateTask.id === task.templateTaskId)
          ?.offsetDaysFromStart;
      if (offset === undefined) return task;
      const dueDate = new Date(startDate);
      dueDate.setDate(dueDate.getDate() + offset);
      const nextDueDate = dueDate.toISOString().slice(0, 10);
      if (nextDueDate === task.dueDate) return task;
      changed += 1;
      return { ...task, offsetDaysFromStart: offset, dueDate: nextDueDate };
    });
    if (changed === 0) throw new Error("Task due dates already match the employee start date.");
    return this.casesRepo.update(
      caseId,
      { tasks },
      { ...context, reason: context.reason || "Aligned open tasks to the employee start date" },
    );
  }

  cancelCase(caseId: string, reason: string, context: ActorContext): OnboardingCase {
    this.requireCaseManager(context, "cancel onboarding case");
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) throw new Error("A cancellation reason is required.");
    const onboardingCase = this.casesRepo.getById(caseId);
    if (!onboardingCase) throw new Error("Onboarding case not found.");
    if (onboardingCase.status !== "In Progress") {
      throw new Error("Only an open onboarding case can be cancelled.");
    }
    const actionContext = { ...context, reason: trimmedReason };
    const updated = this.casesRepo.update(caseId, { status: "Cancelled" }, actionContext);
    const employee = this.empService
      .getEmployeeRepository()
      .getById(onboardingCase.employeeId, { includeArchived: true });
    if (employee?.status === "Onboarding") {
      this.empService
        .getEmployeeRepository()
        .update(employee.id, { status: "Inactive" }, actionContext);
      this.empService.getHistoryRepository().create(
        {
          employeeId: employee.id,
          effectiveDate: this.currentDate(),
          field: "status",
          oldValue: "Onboarding",
          newValue: "Inactive",
          reason: trimmedReason,
        },
        actionContext,
      );
      const user = this.empService
        .getUserRepository()
        .list({ includeArchived: true })
        .find((item) => item.employeeId === employee.id);
      if (user && user.status === "Active") {
        this.empService.getUserRepository().update(user.id, { status: "Suspended" }, actionContext);
      }
    }
    this.notifyMilestone(
      updated,
      "Onboarding cancelled",
      `The onboarding process was cancelled: ${trimmedReason}`,
      actionContext,
      "cancelled",
    );
    return updated;
  }

  updateTaskStatus(
    caseId: string,
    taskId: string,
    status: OnboardingTaskStatus,
    context: ActorContext,
    evidenceFileId?: string,
    waiverReason?: string,
  ) {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    if (c.status !== "In Progress") {
      throw new Error("Only an active onboarding case can be updated.");
    }

    const task = c.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");
    if (task.status === "Completed" || task.status === "Waived") {
      throw new Error("This onboarding task is already resolved.");
    }

    if (status !== "Completed" && status !== "Waived") {
      throw new Error("Tasks can be completed or waived only from this workflow.");
    }
    this.requireTaskAction(c, task, status, context);

    if (status === "Completed" && task.requiresEvidence && !evidenceFileId) {
      throw new Error("This task requires evidence to be completed.");
    }
    if (status === "Completed") this.validateSelfServiceCompletion(c, task, evidenceFileId);

    if (status === "Waived" && (!waiverReason || waiverReason.trim().length < 5)) {
      throw new Error("A reason must be provided to waive a task.");
    }

    // Check dependencies
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
    return this.recalculateCaseProgress(c.id, context, { internal: true });
  }

  recalculateCaseProgress(
    caseId: string,
    context: ActorContext,
    options: { internal?: boolean } = {},
  ) {
    const c = this.casesRepo.getById(caseId);
    if (!c) throw new Error("Case not found");
    if (!options.internal) this.requireCaseManager(context, "recalculate onboarding case");
    const wasReady = c.isReadyForStartDate;
    const previousStatus = c.status;

    // Update Blocked statuses
    for (const task of c.tasks) {
      if (task.status === "Pending") {
        const hasUnmetDependencies = task.dependsOnTaskIds.some((depId) => {
          const dt = c.tasks.find((t) => t.id === depId);
          return dt && dt.status !== "Completed" && dt.status !== "Waived";
        });
        if (hasUnmetDependencies) {
          task.status = "Blocked";
        }
      } else if (task.status === "Blocked") {
        const hasUnmetDependencies = task.dependsOnTaskIds.some((depId) => {
          const dt = c.tasks.find((t) => t.id === depId);
          return dt && dt.status !== "Completed" && dt.status !== "Waived";
        });
        if (!hasUnmetDependencies) {
          task.status = "Pending";
        }
      }
    }

    const mandatoryTasks = c.tasks.filter((t) => t.isMandatory);
    const completedMandatory = mandatoryTasks.filter(
      (t) => t.status === "Completed" || t.status === "Waived",
    ).length;

    c.progressPercentage =
      mandatoryTasks.length > 0
        ? Math.round((completedMandatory / mandatoryTasks.length) * 100)
        : 100;

    const preArrivalMandatory = mandatoryTasks.filter((t) => t.checkpoint === "Pre-Arrival");
    const preArrivalCompleted = preArrivalMandatory.filter(
      (t) => t.status === "Completed" || t.status === "Waived",
    ).length;

    c.isReadyForStartDate =
      preArrivalMandatory.length === 0 || preArrivalCompleted === preArrivalMandatory.length;

    if (c.progressPercentage === 100 && c.status !== "Cancelled") {
      c.status = "Completed";
    }

    const updated = this.casesRepo.update(c.id, c, context);
    if (!wasReady && updated.isReadyForStartDate) {
      this.notifyMilestone(
        updated,
        "Start-date preparation is complete",
        "All required pre-arrival work is complete. The employee is ready for their start date.",
        context,
        "ready",
      );
    }
    if (previousStatus !== "Completed" && updated.status === "Completed") {
      this.notifyMilestone(
        updated,
        "Onboarding completed",
        "All required onboarding work has been completed or formally waived.",
        context,
        "completed",
      );
    }
    this.activateEmployeeIfReady(updated);
    return updated;
  }

  private notifyMilestone(
    onboardingCase: OnboardingCase,
    title: string,
    message: string,
    context: ActorContext,
    milestone: string,
  ): void {
    const users = this.empService.getUserRepository().list();
    const recipientIds = new Set<string>();
    const employeeUser = users.find((user) => user.employeeId === onboardingCase.employeeId);
    if (employeeUser) recipientIds.add(employeeUser.id);
    if (onboardingCase.assignedHRId) recipientIds.add(onboardingCase.assignedHRId);
    for (const user of users) {
      if (user.status === "Active" && user.roles.includes("Super Admin")) recipientIds.add(user.id);
    }
    for (const recipientUserId of recipientIds) {
      const isEmployee = employeeUser?.id === recipientUserId;
      getApplicationDataServices().notifications.create(
        {
          recipientUserId,
          type: `onboarding.${milestone}`,
          title,
          message,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `onboarding-${milestone}-${onboardingCase.id}-${recipientUserId}`,
          link: {
            entityType: "onboarding-case",
            entityId: onboardingCase.id,
            path: isEmployee ? "/staff/me/onboarding" : `/staff/onboarding/${onboardingCase.id}`,
          },
        },
        context,
      );
    }
  }

  private activateEmployeeIfReady(onboardingCase: OnboardingCase): void {
    if (!onboardingCase.isReadyForStartDate || onboardingCase.status === "Cancelled") return;
    const employee = this.empService.getEmployeeRepository().getById(onboardingCase.employeeId);
    if (!employee || employee.status !== "Onboarding") return;
    const today = this.currentDate();
    if (employee.startDate > today) return;
    const nextStatus =
      employee.probationEndDate && employee.probationEndDate >= today ? "Probation" : "Active";
    const systemContext: ActorContext = {
      actor: { ...SYSTEM_ACTOR, activeRole: "Super Admin" },
      reason: "Start date reached and required pre-arrival onboarding work is complete",
    };
    this.empService.changeEmployeeStatus(
      employee.id,
      nextStatus,
      systemContext.reason!,
      systemContext,
    );
    const employeeUser = this.empService
      .getUserRepository()
      .list()
      .find((user) => user.employeeId === employee.id);
    if (employeeUser) {
      getApplicationDataServices().notifications.create(
        {
          recipientUserId: employeeUser.id,
          type: "onboarding.employee-activated",
          title: "Your employee record is active",
          message: `Your start-date requirements are complete and your status is now ${nextStatus}.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `onboarding-activated-${onboardingCase.id}`,
          link: {
            entityType: "employee",
            entityId: employee.id,
            path: "/staff/me/profile",
          },
        },
        systemContext,
      );
    }
  }

  reconcileStartDates(): number {
    let activated = 0;
    for (const onboardingCase of this.casesRepo.list()) {
      const before = this.empService.getEmployeeRepository().getById(onboardingCase.employeeId);
      this.activateEmployeeIfReady(onboardingCase);
      const after = this.empService.getEmployeeRepository().getById(onboardingCase.employeeId);
      if (before?.status === "Onboarding" && after?.status !== "Onboarding") activated += 1;
    }
    return activated;
  }
}
