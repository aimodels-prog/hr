import { getApplicationDataServices } from "./application-data.ts";
import { getMasterDataRepository, getProjectRepository } from "./master-data.ts";
import { LocalRepository } from "./repository.ts";
import type {
  Employee,
  User,
  EmploymentHistory,
  Role,
  ActorContext,
  EmployeeStatus,
  EmployeeSalary,
  ProfileChangeRequest,
} from "./types.ts";
import { getRolePermissions, type CurrentUserContext } from "../auth/permissions.ts";
import { redactEmployee } from "../auth/redaction.ts";
import { getScopedEmployeesWithAncestors } from "../auth/record-scope.ts";

const PERSONAL_PROFILE_FIELDS = new Set<keyof Employee>([
  "preferredName",
  "phone",
  "personalEmail",
  "address",
  "dateOfBirth",
  "gender",
  "nationality",
  "maritalStatus",
  "emergencyContacts",
  "dependants",
]);

const EMPLOYMENT_EDIT_FIELDS = new Set<keyof Employee>([
  "department",
  "position",
  "grade",
  "location",
  "projectId",
  "costCentreId",
  "employmentType",
  "lineManagerId",
  "startDate",
  "probationEndDate",
  "weeklyHours",
  "salary",
]);

function hasOnlyPersonalProfileFields(changes: Partial<Employee>): boolean {
  const keys = Object.keys(changes) as Array<keyof Employee>;
  return keys.length > 0 && keys.every((key) => PERSONAL_PROFILE_FIELDS.has(key));
}

/**
 * Independently verifies every master-data reference an employee create/update touches,
 * rather than trusting that whatever the calling form's dropdown happened to submit is
 * necessarily a real, currently-active department/position/location/grade/employment
 * type/project/cost centre. department/position/location/grade/employmentType are stored on
 * Employee as the master record's name (not its id), matching how the "Add Employee" and
 * employment-update forms populate their <Select> options from these same repositories.
 */
function validateMasterDataReferences(
  changes: Pick<
    Partial<Employee>,
    | "department"
    | "position"
    | "location"
    | "grade"
    | "employmentType"
    | "projectId"
    | "costCentreId"
  >,
): void {
  if (changes.department !== undefined) {
    const match = getMasterDataRepository("departments")
      .list()
      .find((d) => d.name === changes.department && d.isActive);
    if (!match) throw new Error(`"${changes.department}" is not an active department.`);
  }
  if (changes.position !== undefined) {
    const match = getMasterDataRepository("positions")
      .list()
      .find((d) => d.name === changes.position && d.isActive);
    if (!match) throw new Error(`"${changes.position}" is not an active position.`);
  }
  if (changes.location !== undefined) {
    const match = getMasterDataRepository("locations")
      .list()
      .find((d) => d.name === changes.location && d.isActive);
    if (!match) throw new Error(`"${changes.location}" is not an active location.`);
  }
  if (changes.grade) {
    const match = getMasterDataRepository("grades")
      .list()
      .find((d) => d.name === changes.grade && d.isActive);
    if (!match) throw new Error(`"${changes.grade}" is not an active grade.`);
  }
  if (changes.employmentType !== undefined) {
    const match = getMasterDataRepository("employmentTypes")
      .list()
      .find((d) => d.name === changes.employmentType && d.isActive);
    if (!match) throw new Error(`"${changes.employmentType}" is not an active employment type.`);
  }
  if (changes.projectId) {
    const match = getProjectRepository().getById(changes.projectId);
    if (!match || !match.isActive) throw new Error("Selected project is invalid or inactive.");
  }
  if (changes.costCentreId) {
    const match = getMasterDataRepository("costCentres").getById(changes.costCentreId);
    if (!match || !match.isActive) throw new Error("Selected cost centre is invalid or inactive.");
  }
}

export class EmployeeService {
  private employeeRepo: LocalRepository<Employee>;
  private userRepo: LocalRepository<User>;
  private historyRepo: LocalRepository<EmploymentHistory>;
  private changeRequestRepo: LocalRepository<ProfileChangeRequest>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.employeeRepo = new LocalRepository<Employee>("employees", storage, audit, {
      module: "core-hr",
      entityType: "employee",
    });
    this.userRepo = new LocalRepository<User>("users", storage, audit, {
      module: "system",
      entityType: "user",
    });
    this.historyRepo = new LocalRepository<EmploymentHistory>(
      "employment_history",
      storage,
      audit,
      { module: "core-hr", entityType: "employment_history" },
    );
    this.changeRequestRepo = new LocalRepository<ProfileChangeRequest>(
      "profile_change_requests",
      storage,
      audit,
      { module: "core-hr", entityType: "profile_change_request" },
    );
  }

  /**
   * Loads the PostgreSQL Core HR snapshot and keeps legacy IDs only as a temporary compatibility
   * bridge for modules that have not completed their own H3.5 cutover.
   */
  async hydrateCompatibilityCache(actorContext: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail ??
      this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
        ?.workspaceEmail ??
      this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
        ?.workEmail;
    const { getCoreHrSnapshotFn } = await import("../server-functions/employee.server.ts");
    const snapshot = await getCoreHrSnapshotFn({
      data: {
        actorId: actorContext.actor.userId,
        ...(actorEmail ? { actorEmail } : {}),
        activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
      },
    });
    const { storage } = getApplicationDataServices();
    const existingEmployees = storage.readCollection<Employee>("employees");
    const existingUsers = storage.readCollection<User>("users");
    const employeeByNumber = new Map(
      existingEmployees.map((employee) => [employee.employeeNumber.toLowerCase(), employee]),
    );
    const employeeIdMap = new Map<string, string>();
    for (const employee of snapshot.employees) {
      const existing = employeeByNumber.get(employee.employeeNumber.toLowerCase());
      employeeIdMap.set(employee.id, existing?.id ?? employee.id);
    }
    const masterIdMap = new Map<string, string>();
    for (const collection of ["projects", "costCentres"] as const) {
      for (const record of storage.readCollection<{ id: string; databaseId?: string }>(
        collection,
      )) {
        if (record.databaseId) masterIdMap.set(record.databaseId, record.id);
      }
    }
    const compatibleEmployees = snapshot.employees.map((employee): Employee => {
      const compatibleId = employeeIdMap.get(employee.id) ?? employee.id;
      return {
        ...employee,
        id: compatibleId,
        databaseId: employee.id,
        ...(employee.lineManagerId
          ? { lineManagerId: employeeIdMap.get(employee.lineManagerId) ?? employee.lineManagerId }
          : {}),
        ...(employee.projectId
          ? { projectId: masterIdMap.get(employee.projectId) ?? employee.projectId }
          : {}),
        ...(employee.costCentreId
          ? { costCentreId: masterIdMap.get(employee.costCentreId) ?? employee.costCentreId }
          : {}),
      };
    });
    const existingUserByEmail = new Map(
      existingUsers.map((user) => [user.workspaceEmail.trim().toLowerCase(), user]),
    );
    const compatibleUsers = snapshot.users.map((user): User => {
      const existing = existingUserByEmail.get(user.workspaceEmail.trim().toLowerCase());
      const compatibleId = existing?.id ?? user.id;
      return {
        ...user,
        id: compatibleId,
        databaseId: user.id,
        ...(user.employeeId
          ? { employeeId: employeeIdMap.get(user.employeeId) ?? user.employeeId }
          : {}),
      };
    });
    const userIdMap = new Map(
      snapshot.users.map((user) => [
        user.id,
        compatibleUsers.find((compatible) => compatible.databaseId === user.id)?.id ?? user.id,
      ]),
    );
    const compatibleHistory = snapshot.employmentHistory.map((entry) => ({
      ...entry,
      employeeId: employeeIdMap.get(entry.employeeId) ?? entry.employeeId,
    }));
    const compatibleProfileRequests = snapshot.profileChangeRequests.map((request) => ({
      ...request,
      employeeId: employeeIdMap.get(request.employeeId) ?? request.employeeId,
      ...(request.reviewerId
        ? { reviewerId: userIdMap.get(request.reviewerId) ?? request.reviewerId }
        : {}),
    }));
    const compatibleUsersWithPreviewRecords = import.meta.env.DEV
      ? [
          ...existingUsers.filter(
            (existing) =>
              !compatibleUsers.some(
                (compatible) =>
                  compatible.workspaceEmail.trim().toLowerCase() ===
                  existing.workspaceEmail.trim().toLowerCase(),
              ),
          ),
          ...compatibleUsers,
        ]
      : compatibleUsers;
    let changed = false;
    const writeIfChanged = (collection: string, records: unknown[]) => {
      if (JSON.stringify(storage.readCollection(collection)) === JSON.stringify(records)) return;
      storage.writeCollection(collection, records);
      changed = true;
    };
    writeIfChanged("employees", compatibleEmployees);
    writeIfChanged("users", compatibleUsersWithPreviewRecords);
    writeIfChanged("employment_history", compatibleHistory);
    writeIfChanged("profile_change_requests", compatibleProfileRequests);
    if (changed) window.dispatchEvent(new CustomEvent("via_hr:data_changed"));
  }

  private notifyProfileReviewers(request: ProfileChangeRequest, actorContext: ActorContext): void {
    const { notifications } = getApplicationDataServices();
    const reviewers = this.userRepo
      .list()
      .filter(
        (user) =>
          user.status === "Active" &&
          (user.roles.includes("HR") || user.roles.includes("Super Admin")),
      );

    for (const reviewer of reviewers) {
      notifications.create(
        {
          recipientUserId: reviewer.id,
          type: "profile.change-request",
          title: "Profile update requires review",
          message: `${request.requestedBy} submitted changes to their personal details.`,
          priority: "Normal",
          status: "Unread",
          deduplicationKey: `profile-change-review-${request.id}-${reviewer.id}`,
          link: {
            entityType: "profile_change_request",
            entityId: request.id,
            path: `/staff/employees/${request.employeeId}`,
          },
        },
        actorContext,
      );
    }
  }

  private notifyEmployeeOfProfileDecision(
    employeeId: string,
    requestId: string,
    title: string,
    message: string,
    actorContext: ActorContext,
  ): void {
    const user = this.userRepo.list().find((item) => item.employeeId === employeeId);
    if (!user) return;
    getApplicationDataServices().notifications.create(
      {
        recipientUserId: user.id,
        type: "profile.change-decision",
        title,
        message,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `profile-change-decision-${requestId}-${user.id}`,
        link: {
          entityType: "profile_change_request",
          entityId: requestId,
          path: "/staff/me/profile",
        },
      },
      actorContext,
    );
  }

  private requireSystemRepositoryAccess(context: ActorContext, repository: string): void {
    if (context.actor.userId === "system" && context.actor.roles.includes("Super Admin")) return;
    this.denyProfileAction(
      `open raw ${repository} repository`,
      context.actor.employeeId ?? context.actor.userId,
      "Raw Core HR repositories are reserved for trusted system workflows.",
      context,
    );
  }

  private toViewerContext(context: ActorContext): CurrentUserContext {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0] ?? "Employee";
    return {
      userId: context.actor.userId,
      ...(context.actor.employeeId ? { employeeId: context.actor.employeeId } : {}),
      displayName: context.actor.displayName,
      workspaceEmail: "",
      assignedRoles: context.actor.roles,
      activeRole,
      permissions: getRolePermissions(activeRole),
    };
  }

  /** Trusted workflow-only repository access. User-facing code must use getEmployees/getById. */
  getEmployeeRepository(context: ActorContext) {
    this.requireSystemRepositoryAccess(context, "employee");
    return this.employeeRepo;
  }

  getEmployees(context: ActorContext, options: { includeArchived?: boolean } = {}): Employee[] {
    const viewer = this.toViewerContext(context);
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    const employees = this.employeeRepo.list(repositoryOptions);
    const scoped =
      viewer.activeRole === "HR" || viewer.activeRole === "Super Admin"
        ? employees
        : viewer.activeRole === "Line Manager" && viewer.employeeId
          ? employees.filter(
              (employee) =>
                employee.id === viewer.employeeId || employee.lineManagerId === viewer.employeeId,
            )
          : employees.filter((employee) => employee.id === viewer.employeeId);
    return scoped.map((employee) => redactEmployee(employee, viewer));
  }

  /**
   * Returns the viewer's permitted employees plus the reporting-line ancestors needed to
   * display their organisational context. Sensitive fields remain redacted for the viewer.
   */
  getEmployeesWithReportingLine(
    context: ActorContext,
    options: { includeArchived?: boolean } = {},
  ): Employee[] {
    const viewer = this.toViewerContext(context);
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    return getScopedEmployeesWithAncestors(this.employeeRepo.list(repositoryOptions), viewer).map(
      (employee) => redactEmployee(employee, viewer),
    );
  }

  /**
   * Company directory lookup for screens that only need names and work assignments. It never
   * returns compensation, identity documents, personal contacts, family data or HR notes.
   */
  getDirectoryEmployees(
    context: ActorContext,
    options: { includeArchived?: boolean } = {},
  ): Employee[] {
    const activeRole = context.actor.activeRole ?? context.actor.roles[0] ?? "Employee";
    if (!getRolePermissions(activeRole).has("employee:view_directory")) {
      this.denyProfileAction(
        "view employee directory",
        context.actor.employeeId ?? context.actor.userId,
        "You do not have permission to view the employee directory.",
        context,
      );
    }
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    return this.employeeRepo.list(repositoryOptions).map((employee) => {
      const {
        salary: _salary,
        bankDetails: _bankDetails,
        passportNumber: _passportNumber,
        nationalId: _nationalId,
        performanceRating: _performanceRating,
        performanceNotes: _performanceNotes,
        personalEmail: _personalEmail,
        phone: _phone,
        address: _address,
        emergencyContacts: _emergencyContacts,
        dependants: _dependants,
        dateOfBirth: _dateOfBirth,
        gender: _gender,
        nationality: _nationality,
        maritalStatus: _maritalStatus,
        socialInsuranceNumber: _socialInsuranceNumber,
        terminationReason: _terminationReason,
        ...directoryEmployee
      } = employee;
      return directoryEmployee;
    });
  }

  getById(
    id: string,
    context: ActorContext,
    options: { includeArchived?: boolean } = {},
  ): Employee | null {
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    const employee = this.employeeRepo.getById(id, repositoryOptions);
    if (!employee) return null;
    const permitted = this.getEmployees(context, options).find((item) => item.id === id);
    if (!permitted) {
      this.denyProfileAction(
        "view employee record",
        id,
        "You do not have permission to view this employee record.",
        context,
      );
    }
    return permitted;
  }

  addEmploymentHistory(
    entry: Omit<
      EmploymentHistory,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
    >,
    actorContext: ActorContext,
  ): EmploymentHistory {
    return this.historyRepo.create(entry, actorContext);
  }

  /** Trusted workflow-only repository access. User-facing code must use getUsers/getUserById. */
  getUserRepository(context: ActorContext) {
    this.requireSystemRepositoryAccess(context, "user");
    return this.userRepo;
  }

  getUsers(context: ActorContext, options: { includeArchived?: boolean } = {}): User[] {
    const role = context.actor.activeRole ?? context.actor.roles[0] ?? "Employee";
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    const users = this.userRepo.list(repositoryOptions);
    if (role === "HR" || role === "Super Admin") return users;
    return users.filter((user) => user.id === context.actor.userId);
  }

  getUserById(
    id: string,
    context: ActorContext,
    options: { includeArchived?: boolean } = {},
  ): User | null {
    const repositoryOptions =
      options.includeArchived === undefined ? {} : { includeArchived: options.includeArchived };
    const user = this.userRepo.getById(id, repositoryOptions);
    if (!user) return null;
    if (!this.getUsers(context, options).some((item) => item.id === id)) {
      this.denyProfileAction(
        "view user record",
        user.employeeId ?? id,
        "You do not have permission to view this user record.",
        context,
      );
    }
    return user;
  }

  /** Trusted workflow-only repository access. User-facing code must use getEmploymentHistory. */
  getHistoryRepository(context: ActorContext) {
    this.requireSystemRepositoryAccess(context, "employment history");
    return this.historyRepo;
  }

  getEmploymentHistory(employeeId: string, context: ActorContext): EmploymentHistory[] {
    this.getById(employeeId, context, { includeArchived: true });
    const activeRole = context.actor.activeRole ?? context.actor.roles[0] ?? "Employee";
    const canViewCompensation = getRolePermissions(activeRole).has("payroll:view");
    return this.historyRepo
      .list()
      .filter(
        (record) =>
          record.employeeId === employeeId &&
          (record.field !== "salary" ||
            canViewCompensation ||
            context.actor.employeeId === employeeId),
      );
  }

  /** Trusted workflow-only repository access. User-facing code must use getProfileChangeRequests. */
  getChangeRequestRepository(context: ActorContext) {
    this.requireSystemRepositoryAccess(context, "profile change request");
    return this.changeRequestRepo;
  }

  getProfileChangeRequests(employeeId: string, context: ActorContext): ProfileChangeRequest[] {
    const role = context.actor.activeRole ?? context.actor.roles[0] ?? "Employee";
    if (context.actor.employeeId !== employeeId && role !== "HR" && role !== "Super Admin") {
      this.denyProfileAction(
        "view profile change requests",
        employeeId,
        "You can view only your own profile requests unless you are acting as HR or Super Admin.",
        context,
      );
    }
    return this.changeRequestRepo.list().filter((request) => request.employeeId === employeeId);
  }

  private denyProfileAction(
    action: string,
    employeeId: string,
    reason: string,
    actorContext: ActorContext,
  ): never {
    getApplicationDataServices().audit.record({
      context: actorContext,
      action: "access-denied",
      module: "core-hr",
      entityType: "employee",
      entityId: employeeId,
      reason: `${action}: ${reason}`,
      riskLevel: "High",
    });
    throw new Error(reason);
  }

  updateUserAccess(
    userId: string,
    requestedRoles: Role[],
    status: User["status"],
    reason: string,
    actorContext: ActorContext,
  ): User {
    const actorRole = actorContext.actor.activeRole;
    const target = this.userRepo.getById(userId, { includeArchived: true });
    if (!target) throw new Error("User not found.");

    if (actorRole !== "HR" && actorRole !== "Super Admin") {
      getApplicationDataServices().audit.record({
        context: actorContext,
        action: "access-denied",
        module: "user-management",
        entityType: "user",
        entityId: userId,
        reason: "Attempted to change user access without permission",
        riskLevel: "High",
      });
      throw new Error("Only HR or a Super Admin can change user access.");
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      throw new Error("Please give a short reason for this change.");
    }

    const roles = Array.from(new Set<Role>(["Employee", ...requestedRoles]));
    const changesAccess =
      target.status !== status ||
      [...target.roles].sort().join("|") !== [...roles].sort().join("|");
    if (!changesAccess) return target;
    if (target.id === actorContext.actor.userId) {
      getApplicationDataServices().audit.record({
        context: actorContext,
        action: "access-denied",
        module: "user-management",
        entityType: "user",
        entityId: userId,
        reason: "A user attempted to change their own access or sign-in status.",
        riskLevel: "Critical",
      });
      throw new Error("Ask another authorised administrator to change your access.");
    }
    if (actorRole === "HR" && target.roles.includes("Super Admin")) {
      getApplicationDataServices().audit.record({
        context: actorContext,
        action: "access-denied",
        module: "user-management",
        entityType: "user",
        entityId: userId,
        reason: "HR attempted to change a Super Admin account",
        riskLevel: "Critical",
      });
      throw new Error("Only a Super Admin can change a Super Admin account.");
    }
    const changesSuperAdminAccess =
      target.roles.includes("Super Admin") !== roles.includes("Super Admin");
    if (actorRole !== "Super Admin" && changesSuperAdminAccess) {
      getApplicationDataServices().audit.record({
        context: actorContext,
        action: "access-denied",
        module: "user-management",
        entityType: "user",
        entityId: userId,
        reason: "HR attempted to change Super Admin access",
        riskLevel: "Critical",
      });
      throw new Error("Only a Super Admin can grant or remove Super Admin access.");
    }

    const wasActiveSuperAdmin = target.status === "Active" && target.roles.includes("Super Admin");
    const willBeActiveSuperAdmin = status === "Active" && roles.includes("Super Admin");
    if (wasActiveSuperAdmin && !willBeActiveSuperAdmin) {
      const activeSuperAdmins = this.userRepo
        .list()
        .filter((user) => user.status === "Active" && user.roles.includes("Super Admin"));
      if (activeSuperAdmins.length <= 1) {
        throw new Error("At least one active Super Admin must remain.");
      }
    }

    const employee = target.employeeId
      ? this.employeeRepo.getById(target.employeeId, { includeArchived: true })
      : null;
    if (status === "Active" && employee && ["Inactive", "Archived"].includes(employee.status)) {
      throw new Error("An inactive or archived employee cannot be given active system access.");
    }
    const activeReports = target.employeeId
      ? this.employeeRepo
          .list()
          .filter(
            (item) =>
              item.lineManagerId === target.employeeId &&
              !["Inactive", "Archived"].includes(item.status),
          )
      : [];
    if (activeReports.length > 0 && (!roles.includes("Line Manager") || status !== "Active")) {
      throw new Error(
        `Reassign ${activeReports.length} direct report${activeReports.length === 1 ? "" : "s"} before removing this supervisor's access.`,
      );
    }

    const { storage, notifications } = getApplicationDataServices();
    const snapshot = storage.exportState();
    try {
      const context = { actor: actorContext.actor, reason: trimmedReason };
      let updated: User;
      if (status === "Archived") {
        updated = this.userRepo.update(userId, { roles, status }, context);
        updated = this.userRepo.archive(userId, context);
      } else {
        if (target.archivedAt) this.userRepo.restore(userId, context);
        updated = this.userRepo.update(userId, { roles, status }, context);
      }
      notifications.create(
        {
          recipientUserId: target.id,
          type: "access.changed",
          title: "Your VIA HR access changed",
          message: `Your access is now ${status.toLowerCase()}. Responsibilities: ${roles.join(", ")}.`,
          priority: status === "Active" ? "Normal" : "High",
          status: "Unread",
          deduplicationKey: `access-change-${target.id}-${updated.recordVersion}`,
          link: { entityType: "user", entityId: target.id, path: "/staff" },
        },
        { ...actorContext, reason: trimmedReason },
      );
      return updated;
    } catch (error) {
      storage.replaceState(snapshot);
      throw error;
    }
  }

  async updateUserAccessAsync(
    userId: string,
    requestedRoles: Role[],
    status: User["status"],
    reason: string,
    actorContext: ActorContext,
  ): Promise<User> {
    if (typeof window === "undefined") {
      return this.updateUserAccess(userId, requestedRoles, status, reason, actorContext);
    }
    const target = this.userRepo.getById(userId, { includeArchived: true });
    if (!target) throw new Error("User not found.");
    if (!target.databaseId) {
      throw new Error("This user has not yet been linked to the PostgreSQL user register.");
    }
    const { updateUserAccessFn } = await import("../server-functions/employee.server.ts");
    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail ??
      this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
        ?.workspaceEmail ??
      this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
        ?.workEmail;
    await updateUserAccessFn({
      data: {
        userId: target.databaseId,
        roles: requestedRoles,
        status,
        reason,
        actor: {
          actorId: actorContext.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
        },
      },
    });
    await this.hydrateCompatibilityCache(actorContext);
    const refreshed = this.userRepo.getById(userId, { includeArchived: true });
    if (!refreshed) throw new Error("The updated user could not be reloaded.");
    return refreshed;
  }

  async createEmployee(
    data: Omit<
      Employee,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion" | "archivedAt"
    >,
    _roles: Role[],
    actorContext: ActorContext,
  ): Promise<{ employee: Employee; user?: User }> {
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      getApplicationDataServices().audit.record({
        context: actorContext,
        action: "access-denied",
        module: "core-hr",
        entityType: "employee",
        entityId: "new-employee",
        reason: "Attempted to add an employee without permission",
        riskLevel: "High",
      });
      throw new Error("Only HR or a Super Admin can add employees.");
    }

    // Uniqueness checks
    const allEmployees = this.employeeRepo.list({ includeArchived: true });
    if (allEmployees.some((e) => e.employeeNumber === data.employeeNumber)) {
      throw new Error(`Employee number ${data.employeeNumber} is already in use.`);
    }

    const allUsers = this.userRepo.list({ includeArchived: true });
    const workspaceEmail = data.workspaceEmail || data.workEmail;
    if (allUsers.some((u) => u.workspaceEmail.toLowerCase() === workspaceEmail.toLowerCase())) {
      throw new Error(`Workspace email ${workspaceEmail} is already assigned to a user.`);
    }

    if (data.probationEndDate && new Date(data.probationEndDate) < new Date(data.startDate)) {
      throw new Error("Probation end date cannot be before start date.");
    }

    if (!data.lineManagerId && allEmployees.length > 0) {
      throw new Error("A supervisor must be assigned before an employee record can be created.");
    }
    if (data.lineManagerId) {
      const manager = this.employeeRepo.getById(data.lineManagerId);
      if (!manager || manager.status === "Archived") {
        throw new Error("Selected line manager is invalid or archived.");
      }
    }

    // Salary and statutory-registration details are compensation/payroll data - the same
    // Accounts-or-Super-Admin boundary updateEmploymentRecord enforces for later changes must
    // also apply here, or HR could set (or see) payroll data simply by entering it at creation
    // instead of waiting for the controlled employment-update path. This method is already
    // restricted to HR/Super Admin above (Accounts cannot reach this point at all), so in
    // practice this specifically blocks HR from including payroll fields at creation time.
    if (
      (data.salary !== undefined || data.socialInsuranceNumber !== undefined) &&
      actorContext.actor.activeRole !== "Super Admin"
    ) {
      this.denyProfileAction(
        "add employee",
        "new-employee",
        "Only Accounts or a Super Admin can set salary or social-insurance details. Add these afterward via the employment record.",
        actorContext,
      );
    }

    validateMasterDataReferences(data);

    if (typeof window !== "undefined") {
      const resolveEmployeeDatabaseId = (id: string | undefined) => {
        if (!id) return undefined;
        const record = this.employeeRepo.getById(id, { includeArchived: true });
        return record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
      };
      const resolveMasterDatabaseId = (
        collection: "projects" | "costCentres",
        id: string | undefined,
      ) => {
        if (!id) return undefined;
        const record = getApplicationDataServices()
          .storage.readCollection<{ id: string; databaseId?: string }>(collection)
          .find((item) => item.id === id);
        return record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
      };
      const managerId = resolveEmployeeDatabaseId(data.lineManagerId);
      if (data.lineManagerId && !managerId) {
        throw new Error("The selected supervisor is not linked to PostgreSQL.");
      }
      const projectId = resolveMasterDatabaseId("projects", data.projectId);
      if (data.projectId && !projectId) {
        throw new Error("The selected project is not linked to PostgreSQL.");
      }
      const costCentreId = resolveMasterDatabaseId("costCentres", data.costCentreId);
      if (data.costCentreId && !costCentreId) {
        throw new Error("The selected cost centre is not linked to PostgreSQL.");
      }
      const { createEmployeeFn } = await import("../server-functions/employee.server.ts");
      const actorEmail =
        actorContext.actor.workspaceEmail ??
        this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })
          ?.workspaceEmail ??
        this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
          ?.workspaceEmail ??
        this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
          ?.workEmail;
      const result = await createEmployeeFn({
        data: {
          actor: {
            actorId: actorContext.actor.userId,
            ...(actorEmail ? { actorEmail } : {}),
            activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
          },
          employee: {
            ...data,
            lineManagerId: managerId,
            projectId,
            costCentreId,
          },
        },
      });
      await this.hydrateCompatibilityCache(actorContext);
      const employee = this.employeeRepo
        .list({ includeArchived: true })
        .find((item) => item.databaseId === result.employeeId || item.id === result.employeeId);
      const user = this.userRepo
        .list({ includeArchived: true })
        .find((item) => item.databaseId === result.userId || item.id === result.userId);
      if (!employee) throw new Error("The new employee could not be reloaded from PostgreSQL.");
      return user ? { employee, user } : { employee };
    }

    // Full-state snapshot/rollback: this is several separate writes (employee, user, initial
    // history, and possibly a supervisor role grant) - if any step after the first fails, we
    // must not leave a partially created employee behind.
    const { storage } = getApplicationDataServices();
    const snapshot = storage.exportState();
    try {
      const employee = this.employeeRepo.create(data, actorContext);
      let user: User | undefined = undefined;

      if (data.workEmail) {
        user = this.userRepo.create(
          {
            employeeId: employee.id,
            displayName: employee.preferredName,
            workspaceEmail,
            roles: ["Employee"],
            status:
              data.status === "Active" || data.status === "Onboarding" ? "Active" : "Suspended",
          },
          actorContext,
        );
      }

      // Create initial employment history record
      this.historyRepo.create(
        {
          employeeId: employee.id,
          effectiveDate: employee.startDate,
          reason: "Initial Employment",
          field: "status",
          newValue: employee.status,
        },
        actorContext,
      );

      if (employee.lineManagerId) {
        this.ensureSupervisorAccess(employee.lineManagerId, actorContext);
      }

      return user ? { employee, user } : { employee };
    } catch (err) {
      storage.replaceState(snapshot);
      throw new Error(
        `Failed to create employee: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Direct self-service write path for onboarding intake (personal details, bank details).
   * Unlike updateEmploymentRecord, this does not require an effective date/reason and does
   * not generate employment-history entries - these are record-keeping fields the new hire
   * is providing for the first time, not a negotiated change to employment terms.
   */
  submitSelfServiceOnboardingDetails(
    employeeId: string,
    changes: Partial<
      Pick<
        Employee,
        | "dateOfBirth"
        | "gender"
        | "nationality"
        | "maritalStatus"
        | "address"
        | "emergencyContacts"
        | "dependants"
        | "bankDetails"
        | "personalEmail"
        | "phone"
      >
    >,
    actorContext: ActorContext,
  ): Employee {
    const employee = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!employee) throw new Error("Employee not found");
    if (actorContext.actor.employeeId !== employeeId) {
      this.denyProfileAction(
        "submit onboarding details",
        employeeId,
        "You can only submit onboarding details for your own record.",
        actorContext,
      );
    }
    const activeOnboarding = getApplicationDataServices()
      .storage.readCollection<{ employeeId: string; status: string }>("onboardingCases")
      .some((item) => item.employeeId === employeeId && item.status === "In Progress");
    if (!activeOnboarding) {
      this.denyProfileAction(
        "submit onboarding details",
        employeeId,
        "Onboarding details can be submitted only while your onboarding process is active.",
        actorContext,
      );
    }
    return this.employeeRepo.update(employeeId, changes, actorContext);
  }

  validateHierarchy(employeeId: string, newManagerId: string | undefined): void {
    if (!newManagerId) return;
    if (employeeId === newManagerId) {
      throw new Error("An employee cannot report to themselves.");
    }

    const allEmployees = this.employeeRepo.list();
    const employeeMap = new Map(allEmployees.map((e) => [e.id, e.lineManagerId]));

    let currentManager = employeeMap.get(newManagerId);
    let depth = 0;
    while (currentManager) {
      if (currentManager === employeeId) {
        throw new Error(
          "Circular reporting line detected. The selected manager reports to this employee.",
        );
      }
      currentManager = employeeMap.get(currentManager);
      depth++;
      if (depth > 100) throw new Error("Hierarchy is too deep or contains an infinite loop.");
    }
  }

  updateEmploymentRecord(
    employeeId: string,
    changes: Partial<Employee>,
    effectiveDate: string,
    reason: string,
    actorContext: ActorContext,
  ): Employee {
    const employee = this.employeeRepo.getById(employeeId);
    if (!employee) throw new Error("Employee not found");

    const activeRole = actorContext.actor.activeRole;
    const changedFields = Object.keys(changes) as Array<keyof Employee>;
    if (
      changedFields.length === 0 ||
      changedFields.some((field) => !EMPLOYMENT_EDIT_FIELDS.has(field))
    ) {
      this.denyProfileAction(
        "update employment record",
        employeeId,
        "This page can change employment details only. Status and personal records use their own controlled workflows.",
        actorContext,
      );
    }
    const changesSalary = changedFields.includes("salary");
    const changesNonSalary = changedFields.some((field) => field !== "salary");
    if (changesSalary && activeRole !== "Accounts" && activeRole !== "Super Admin") {
      this.denyProfileAction(
        "update employment record",
        employeeId,
        "Only Accounts or a Super Admin can change compensation.",
        actorContext,
      );
    }
    if (changesNonSalary && activeRole !== "HR" && activeRole !== "Super Admin") {
      this.denyProfileAction(
        "update employment record",
        employeeId,
        "Only HR or a Super Admin can change employment details.",
        actorContext,
      );
    }
    if (!reason.trim() || !effectiveDate) {
      throw new Error("An effective date and reason are required.");
    }
    if (changes.salary) {
      if (changes.salary.baseMonthly <= 0 || !changes.salary.currency.trim()) {
        throw new Error("Compensation requires a positive base salary and currency.");
      }
      for (const allowance of [
        changes.salary.housingAllowance,
        changes.salary.transportAllowance,
      ]) {
        if (allowance !== undefined && allowance < 0) {
          throw new Error("Allowances cannot be negative.");
        }
      }
    }

    if ("lineManagerId" in changes && !changes.lineManagerId) {
      throw new Error("Every employee must have an assigned supervisor.");
    }
    if (changes.lineManagerId) {
      const manager = this.employeeRepo.getById(changes.lineManagerId);
      if (!manager || manager.status === "Archived") {
        throw new Error("Selected line manager is invalid or archived.");
      }
      this.validateHierarchy(employeeId, changes.lineManagerId);
    }
    validateMasterDataReferences(changes);
    if (changes.probationEndDate && changes.startDate) {
      if (new Date(changes.probationEndDate) < new Date(changes.startDate)) {
        throw new Error("Probation end date cannot be before start date.");
      }
    } else if (changes.probationEndDate && !changes.startDate) {
      if (new Date(changes.probationEndDate) < new Date(employee.startDate)) {
        throw new Error("Probation end date cannot be before start date.");
      }
    }

    const updated = this.employeeRepo.update(employeeId, changes, {
      actor: actorContext.actor,
      reason,
    });

    if (changes.lineManagerId) {
      this.ensureSupervisorAccess(changes.lineManagerId, actorContext);
    }

    // Create history records for tracked fields
    const trackableFields: (keyof Employee)[] = [
      "department",
      "position",
      "grade",
      "location",
      "employmentType",
      "lineManagerId",
      "status",
      "projectId",
      "costCentreId",
      "startDate",
      "probationEndDate",
      "weeklyHours",
      "salary",
    ];

    const formatTrackableValue = (field: keyof Employee, value: unknown): string => {
      if (field === "salary") {
        const salary = value as EmployeeSalary | undefined;
        return salary ? `${salary.baseMonthly.toLocaleString()} ${salary.currency}` : "";
      }
      return String(value || "");
    };

    for (const field of trackableFields) {
      if (!(field in changes)) continue;

      // Salary is an object, not a scalar, so a reference/identity check is not a valid
      // "did this actually change" test - compare by value instead. Scalar fields keep the
      // cheap identity comparison they already used.
      const hasChanged =
        field === "salary"
          ? JSON.stringify(changes[field] ?? null) !== JSON.stringify(employee[field] ?? null)
          : changes[field] !== employee[field];

      if (!hasChanged) continue;

      this.historyRepo.create(
        {
          employeeId,
          effectiveDate,
          field,
          oldValue: formatTrackableValue(field, employee[field]),
          newValue: formatTrackableValue(field, changes[field]),
          reason,
        },
        { actor: actorContext.actor, reason: `Recorded history for ${field}` },
      );
    }

    return updated;
  }

  async updateEmploymentRecordAsync(
    employeeId: string,
    changes: Partial<Employee>,
    effectiveDate: string,
    reason: string,
    actorContext: ActorContext,
  ): Promise<Employee> {
    if (typeof window === "undefined") {
      return this.updateEmploymentRecord(employeeId, changes, effectiveDate, reason, actorContext);
    }
    const employee = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!employee?.databaseId) {
      throw new Error("This employee has not yet been linked to the PostgreSQL employee register.");
    }
    const resolveEmployeeDatabaseId = (id: string | undefined) => {
      if (!id) return undefined;
      const record = this.employeeRepo.getById(id, { includeArchived: true });
      return record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    };
    const resolveMasterDatabaseId = (
      collection: "projects" | "costCentres",
      id: string | undefined,
    ) => {
      if (id === undefined || id === "") return id;
      const record = getApplicationDataServices()
        .storage.readCollection<{ id: string; databaseId?: string }>(collection)
        .find((item) => item.id === id);
      return record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    };
    const lineManagerId =
      changes.lineManagerId === undefined
        ? undefined
        : resolveEmployeeDatabaseId(changes.lineManagerId);
    if (changes.lineManagerId && !lineManagerId) {
      throw new Error("The selected supervisor is not linked to PostgreSQL.");
    }
    const projectId = resolveMasterDatabaseId("projects", changes.projectId);
    const costCentreId = resolveMasterDatabaseId("costCentres", changes.costCentreId);
    if (changes.projectId && !projectId)
      throw new Error("The selected project is not linked to PostgreSQL.");
    if (changes.costCentreId && !costCentreId)
      throw new Error("The selected cost centre is not linked to PostgreSQL.");

    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail ??
      this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
        ?.workspaceEmail ??
      this.employeeRepo.getById(actorContext.actor.employeeId ?? "", { includeArchived: true })
        ?.workEmail;
    const { updateEmploymentRecordFn } = await import("../server-functions/employee.server.ts");
    const allowedChanges = Object.fromEntries(
      Object.entries({
        department: changes.department,
        position: changes.position,
        grade: changes.grade,
        location: changes.location,
        employmentType: changes.employmentType,
        lineManagerId,
        projectId,
        costCentreId,
        startDate: changes.startDate,
        probationEndDate: changes.probationEndDate,
        weeklyHours: changes.weeklyHours,
        salary: changes.salary,
      }).filter(([, value]) => value !== undefined),
    );
    await updateEmploymentRecordFn({
      data: {
        actor: {
          actorId: actorContext.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
        },
        employeeId: employee.databaseId,
        changes: allowedChanges,
        effectiveDate,
        reason,
      },
    });
    await this.hydrateCompatibilityCache(actorContext);
    const refreshed = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!refreshed) throw new Error("The updated employee could not be reloaded.");
    return refreshed;
  }

  private ensureSupervisorAccess(supervisorEmployeeId: string, context: ActorContext): void {
    const user = this.userRepo
      .list()
      .find((candidate) => candidate.employeeId === supervisorEmployeeId);
    if (!user || user.roles.includes("Line Manager")) return;
    this.userRepo.update(
      user.id,
      { roles: [...new Set<Role>(["Employee", ...user.roles, "Line Manager"])] },
      {
        ...context,
        reason: "Supervisor access added because an employee now reports to this person",
      },
    );
  }

  changeEmployeeStatus(
    employeeId: string,
    newStatus: EmployeeStatus,
    reason: string,
    actorContext: ActorContext,
  ): void {
    const employee = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!employee) throw new Error("Employee not found");
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.denyProfileAction(
        "change employee status",
        employeeId,
        "Only HR or a Super Admin can change an employee's status.",
        actorContext,
      );
    }

    const oldStatus = employee.status;
    if (oldStatus === newStatus) return;

    if (["Notice", "Inactive", "Archived"].includes(newStatus)) {
      const offboardingCase = getApplicationDataServices()
        .storage.readCollection<{ employeeId: string; status: string }>("offboardingCases")
        .find((item) => item.employeeId === employeeId && item.status !== "Cancelled");
      const permitted =
        newStatus === "Notice"
          ? offboardingCase?.status === "In Progress" ||
            offboardingCase?.status === "Pending Clearance"
          : offboardingCase?.status === "Completed";
      if (!permitted) {
        this.denyProfileAction(
          "change employee status",
          employeeId,
          newStatus === "Notice"
            ? "Start an offboarding case before moving an employee to Notice."
            : "Complete the offboarding clearance before making an employee inactive or archived.",
          actorContext,
        );
      }
    }

    // Update Employee Status
    const effectiveDate = new Date().toISOString().split("T")[0] as string;
    this.employeeRepo.update(employeeId, { status: newStatus }, actorContext);
    this.historyRepo.create(
      {
        employeeId,
        effectiveDate,
        field: "status",
        oldValue: oldStatus,
        newValue: newStatus,
        reason,
      },
      actorContext,
    );

    // Sync User status if applicable
    const allUsers = this.userRepo.list({ includeArchived: true });
    const user = allUsers.find((u) => u.employeeId === employeeId);
    if (user) {
      let newUserStatus: User["status"] = user.status;
      if (newStatus === "Archived") newUserStatus = "Archived";
      else if (newStatus === "Inactive") newUserStatus = "Suspended";
      // Notice means the employee is still actively employed and working through their
      // notice period - they must keep login access to complete self-service offboarding
      // tasks (e.g. handover notes) assigned to them before their last working date.
      else if (newStatus === "Active" || newStatus === "Probation" || newStatus === "Notice")
        newUserStatus = "Active";

      if (newUserStatus !== user.status) {
        this.userRepo.update(
          user.id,
          { status: newUserStatus },
          {
            actor: actorContext.actor,
            reason: `Status synced with employee record to ${newUserStatus}`,
          },
        );
      }
    }

    // Perform Archive/Restore specifically if going into or out of Archived status
    if (newStatus === "Archived") {
      this.employeeRepo.archive(employeeId, { actor: actorContext.actor, reason });
      if (user) this.userRepo.archive(user.id, { actor: actorContext.actor, reason });
    } else if (oldStatus === "Archived") {
      this.employeeRepo.restore(employeeId, { actor: actorContext.actor, reason });
      if (user) this.userRepo.restore(user.id, { actor: actorContext.actor, reason });
    }
  }

  async changeEmployeeStatusAsync(
    employeeId: string,
    newStatus: EmployeeStatus,
    reason: string,
    actorContext: ActorContext,
  ): Promise<void> {
    if (typeof window === "undefined") {
      this.changeEmployeeStatus(employeeId, newStatus, reason, actorContext);
      return;
    }
    const employee = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!employee?.databaseId) throw new Error("This employee is not linked to PostgreSQL.");
    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail;
    const { changeEmployeeStatusFn } = await import("../server-functions/employee.server.ts");
    await changeEmployeeStatusFn({
      data: {
        actor: {
          actorId: actorContext.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
        },
        employeeId: employee.databaseId,
        status: newStatus,
        reason,
      },
    });
    await this.hydrateCompatibilityCache(actorContext);
  }

  finalizeEmployment(
    employeeId: string,
    terminationDate: string,
    terminationReason: string,
    actorContext: ActorContext,
  ): Employee {
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.denyProfileAction(
        "finalize employment",
        employeeId,
        "Only HR or a Super Admin can finalise employment.",
        actorContext,
      );
    }
    if (!terminationDate || terminationReason.trim().length < 3) {
      throw new Error("A last working date and termination reason are required.");
    }
    this.changeEmployeeStatus(employeeId, "Inactive", terminationReason, actorContext);
    const updated = this.employeeRepo.update(
      employeeId,
      { terminationDate, terminationReason },
      actorContext,
    );
    for (const [field, newValue] of [
      ["terminationDate", terminationDate],
      ["terminationReason", terminationReason],
    ] as const) {
      this.historyRepo.create(
        {
          employeeId,
          effectiveDate: terminationDate,
          field,
          newValue,
          reason: `Offboarding finalised: ${terminationReason}`,
        },
        actorContext,
      );
    }
    return updated;
  }

  requestProfileChange(
    employeeId: string,
    changes: Partial<Employee>,
    actorContext: ActorContext,
  ): ProfileChangeRequest {
    if (actorContext.actor.employeeId !== employeeId) {
      this.denyProfileAction(
        "request profile change",
        employeeId,
        "You can only request changes to your own profile.",
        actorContext,
      );
    }
    if (!hasOnlyPersonalProfileFields(changes)) {
      this.denyProfileAction(
        "request profile change",
        employeeId,
        "Profile requests can contain personal and contact details only.",
        actorContext,
      );
    }
    const alreadyPending = this.changeRequestRepo
      .list()
      .some((request) => request.employeeId === employeeId && request.status === "Pending");
    if (alreadyPending) throw new Error("A profile update is already awaiting HR review.");

    const request = this.changeRequestRepo.create(
      {
        employeeId,
        changes,
        status: "Pending",
        requestedBy: actorContext.actor.displayName,
      },
      actorContext,
    );
    this.notifyProfileReviewers(request, actorContext);
    return request;
  }

  updatePersonalRecord(
    employeeId: string,
    changes: Partial<Employee>,
    reason: string,
    actorContext: ActorContext,
  ): Employee {
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.denyProfileAction(
        "update personal record",
        employeeId,
        "Only HR or a Super Admin can directly correct an employee's personal record.",
        actorContext,
      );
    }
    if (!hasOnlyPersonalProfileFields(changes)) {
      throw new Error("Only personal and contact details can be changed here.");
    }
    if (reason.trim().length < 5) throw new Error("Please give a short reason for this change.");

    return this.employeeRepo.update(employeeId, changes, {
      actor: actorContext.actor,
      reason: reason.trim(),
    });
  }

  async updatePersonalRecordAsync(
    employeeId: string,
    changes: Partial<Employee>,
    reason: string,
    actorContext: ActorContext,
  ): Promise<Employee> {
    if (typeof window === "undefined") {
      return this.updatePersonalRecord(employeeId, changes, reason, actorContext);
    }
    const employee = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!employee?.databaseId) throw new Error("This employee is not linked to PostgreSQL.");
    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail;
    const { updatePersonalRecordFn } = await import("../server-functions/employee.server.ts");
    await updatePersonalRecordFn({
      data: {
        actor: {
          actorId: actorContext.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
        },
        employeeId: employee.databaseId,
        changes,
        reason,
      },
    });
    await this.hydrateCompatibilityCache(actorContext);
    const refreshed = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!refreshed) throw new Error("The updated employee could not be reloaded.");
    return refreshed;
  }

  async requestProfileChangeAsync(
    employeeId: string,
    changes: Partial<Employee>,
    actorContext: ActorContext,
  ): Promise<ProfileChangeRequest> {
    if (typeof window === "undefined") {
      return this.requestProfileChange(employeeId, changes, actorContext);
    }
    const employee = this.employeeRepo.getById(employeeId, { includeArchived: true });
    if (!employee?.databaseId) throw new Error("This employee is not linked to PostgreSQL.");
    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail;
    const { createProfileChangeRequestFn } = await import("../server-functions/employee.server.ts");
    const requestId = await createProfileChangeRequestFn({
      data: {
        actor: {
          actorId: actorContext.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
        },
        employeeId: employee.databaseId,
        changes,
      },
    });
    await this.hydrateCompatibilityCache(actorContext);
    const request = this.changeRequestRepo.getById(requestId);
    if (!request) throw new Error("The profile request could not be reloaded.");
    return request;
  }

  approveProfileChange(
    requestId: string,
    reviewerNotes: string | undefined,
    actorContext: ActorContext,
  ): void {
    const request = this.changeRequestRepo.getById(requestId);
    if (!request || request.status !== "Pending") throw new Error("Invalid or non-pending request");
    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.denyProfileAction(
        "approve profile change",
        request.employeeId,
        "Only HR or a Super Admin can approve profile changes.",
        actorContext,
      );
    }
    if (actorContext.actor.employeeId === request.employeeId) {
      this.denyProfileAction(
        "approve profile change",
        request.employeeId,
        "You cannot approve your own profile change request.",
        actorContext,
      );
    }
    if (!hasOnlyPersonalProfileFields(request.changes)) {
      throw new Error("This request contains fields that cannot be approved from the profile.");
    }

    // Apply changes
    this.employeeRepo.update(request.employeeId, request.changes, {
      actor: actorContext.actor,
      reason: "Approved personal-profile update",
    });

    this.changeRequestRepo.update(
      requestId,
      {
        status: "Approved",
        reviewerId: actorContext.actor.userId,
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewerNotes,
      },
      actorContext,
    );
    this.notifyEmployeeOfProfileDecision(
      request.employeeId,
      request.id,
      "Profile update approved",
      "HR approved the changes to your personal details.",
      actorContext,
    );
  }

  async decideProfileChangeAsync(
    requestId: string,
    decision: "Approved" | "Rejected",
    reviewerNotes: string,
    actorContext: ActorContext,
  ): Promise<void> {
    if (typeof window === "undefined") {
      if (decision === "Approved") {
        this.approveProfileChange(requestId, reviewerNotes || undefined, actorContext);
      } else {
        this.rejectProfileChange(requestId, reviewerNotes, actorContext);
      }
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
      throw new Error("This profile request is not linked to PostgreSQL.");
    }
    const actorEmail =
      actorContext.actor.workspaceEmail ??
      this.userRepo.getById(actorContext.actor.userId, { includeArchived: true })?.workspaceEmail;
    const { decideProfileChangeRequestFn } = await import("../server-functions/employee.server.ts");
    await decideProfileChangeRequestFn({
      data: {
        actor: {
          actorId: actorContext.actor.userId,
          ...(actorEmail ? { actorEmail } : {}),
          activeRole: actorContext.actor.activeRole ?? actorContext.actor.roles[0] ?? "Employee",
        },
        requestId,
        decision,
        reviewerNotes,
      },
    });
    await this.hydrateCompatibilityCache(actorContext);
  }

  rejectProfileChange(requestId: string, reviewerNotes: string, actorContext: ActorContext): void {
    const request = this.changeRequestRepo.getById(requestId);
    if (!request || request.status !== "Pending") throw new Error("Invalid or non-pending request");

    if (actorContext.actor.activeRole !== "HR" && actorContext.actor.activeRole !== "Super Admin") {
      this.denyProfileAction(
        "reject profile change",
        request.employeeId,
        "Only HR or a Super Admin can reject profile changes.",
        actorContext,
      );
    }
    if (actorContext.actor.employeeId === request.employeeId) {
      this.denyProfileAction(
        "reject profile change",
        request.employeeId,
        "You cannot reject your own profile change request.",
        actorContext,
      );
    }

    if (reviewerNotes.trim().length < 3) throw new Error("A rejection reason is required.");

    this.changeRequestRepo.update(
      requestId,
      {
        status: "Rejected",
        reviewerId: actorContext.actor.userId,
        reviewedAt: new Date().toISOString(),
        reviewNotes: reviewerNotes,
      },
      actorContext,
    );
    this.notifyEmployeeOfProfileDecision(
      request.employeeId,
      request.id,
      "Profile update needs changes",
      reviewerNotes.trim(),
      actorContext,
    );
  }
}
