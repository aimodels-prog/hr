import { LocalRepository, type NewRecord, type RecordChanges } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type { ActorContext, Employee, MasterRecord, Project } from "./types.ts";

export type MasterDataCollection =
  | "departments"
  | "locations"
  | "costCentres"
  | "positions"
  | "grades"
  | "employmentTypes"
  | "workingTimes"
  | "publicHolidays"
  | "currencies"
  | "activityCodes";

export function getMasterDataRepository(collection: MasterDataCollection) {
  const { storage, audit } = getApplicationDataServices();
  return new LocalRepository<MasterRecord>(collection, storage, audit, {
    module: "settings",
    entityType: collection,
  });
}

export function getProjectRepository() {
  const { storage, audit } = getApplicationDataServices();
  return new LocalRepository<Project>("projects", storage, audit, {
    module: "settings",
    entityType: "project",
  });
}

/**
 * Permission-controlled write facade for Settings. Operational services may continue to use the
 * repository helpers above for read-only lookups, but user-facing settings screens must mutate
 * master data through this service.
 */
export class MasterDataService {
  // Synchronous read methods for unmigrated modules (leave, timesheets, etc.)
  list(collection: MasterDataCollection, includeArchived = true): MasterRecord[] {
    return getMasterDataRepository(collection).list({ includeArchived });
  }

  listProjects(includeArchived = true): Project[] {
    return getProjectRepository().list({ includeArchived });
  }

  // Async methods for the settings UI (H3.5A PostgreSQL cutover)
  async listAsync(
    collection: MasterDataCollection,
    includeArchived = true,
  ): Promise<MasterRecord[]> {
    try {
      const { listMasterDataFn } = await import("../server-functions/master-data.server.ts");
      const result = (await listMasterDataFn({
        data: { collection, includeArchived },
      })) as unknown as MasterRecord[];
      if (result) return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }
    return this.list(collection, includeArchived);
  }

  async listProjectsAsync(includeArchived = true): Promise<Project[]> {
    try {
      const { listProjectsFn } = await import("../server-functions/master-data.server.ts");
      const result = (await listProjectsFn({
        data: { includeArchived },
      })) as unknown as Project[];
      if (result) return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }
    return this.listProjects(includeArchived);
  }

  async create(
    collection: MasterDataCollection,
    input: NewRecord<MasterRecord>,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `create a ${collection} record`);
    this.validateMasterRecord(collection, input);
    this.requireUnique(collection, input.name, input.code);

    try {
      const { createMasterDataFn } = await import("../server-functions/master-data.server.ts");
      const result = (await createMasterDataFn({
        data: {
          collection,
          input: {
            name: input.name,
            code: input.code,
            description: input.description,
            isActive: input.isActive,
            orderIndex: input.orderIndex,
            date: "date" in input && typeof input.date === "string" ? input.date : undefined,
          },
          actorId: context.actor.userId,
        },
      })) as unknown as MasterRecord;

      if (result) {
        try {
          getMasterDataRepository(collection).create(result, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return getMasterDataRepository(collection).create(input, context);
  }

  async update(
    collection: MasterDataCollection,
    id: string,
    changes: RecordChanges<MasterRecord>,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `update a ${collection} record`);
    const repository = getMasterDataRepository(collection);
    const existing = repository.getById(id);
    if (!existing) throw new Error("The selected setting was not found.");
    const candidate = { ...existing, ...changes };
    this.validateMasterRecord(collection, candidate);
    this.requireUnique(collection, candidate.name, candidate.code, id);

    try {
      const { updateMasterDataFn } = await import("../server-functions/master-data.server.ts");
      const result = (await updateMasterDataFn({
        data: {
          collection,
          id,
          changes: {
            name: changes.name,
            code: changes.code,
            description: changes.description,
            isActive: changes.isActive,
            orderIndex: changes.orderIndex,
            date: "date" in changes && typeof changes.date === "string" ? changes.date : undefined,
          },
          actorId: context.actor.userId,
        },
      })) as unknown as MasterRecord;

      if (result) {
        try {
          repository.update(id, result, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return repository.update(id, changes, context);
  }

  async archive(
    collection: MasterDataCollection,
    id: string,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `archive a ${collection} record`);
    const repository = getMasterDataRepository(collection);
    const existing = repository.getById(id);
    if (!existing || existing.archivedAt) {
      throw new Error("The selected setting was not found or is already archived.");
    }
    const dependencyBlock = this.findActiveDependency(collection, existing);
    if (dependencyBlock) throw new Error(dependencyBlock);

    try {
      const { archiveMasterDataFn } = await import("../server-functions/master-data.server.ts");
      const result = (await archiveMasterDataFn({
        data: {
          collection,
          id,
          actorId: context.actor.userId,
        },
      })) as unknown as MasterRecord;

      if (result) {
        try {
          repository.archive(id, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return repository.archive(id, context);
  }

  async restore(
    collection: MasterDataCollection,
    id: string,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `restore a ${collection} record`);
    const repository = getMasterDataRepository(collection);
    const existing = repository.getById(id);
    if (!existing) throw new Error("The selected setting was not found.");
    this.requireUnique(collection, existing.name, existing.code, id);

    try {
      const { restoreMasterDataFn } = await import("../server-functions/master-data.server.ts");
      const result = (await restoreMasterDataFn({
        data: {
          collection,
          id,
          actorId: context.actor.userId,
        },
      })) as unknown as MasterRecord;

      if (result) {
        try {
          repository.restore(id, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return repository.restore(id, context);
  }

  async createProject(input: NewRecord<Project>, context: ActorContext): Promise<Project> {
    this.requireAdministrator(context, "create a project");
    this.validateProject(input);
    this.requireUniqueProject(input.name, input.code);

    try {
      const { createProjectFn } = await import("../server-functions/master-data.server.ts");
      const result = (await createProjectFn({
        data: {
          input: {
            name: input.name,
            code: input.code,
            description: input.description,
            client: input.client,
            type: input.type,
            startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
            endDate: input.endDate,
            costCentreId: input.costCentreId,
            managerId: input.managerId,
            locationId: input.locationId,
            status: input.status ?? "Draft",
            orderIndex: input.orderIndex,
            isActive: input.isActive,
          },
          actorId: context.actor.userId,
        },
      })) as unknown as Project;

      if (result) {
        try {
          getProjectRepository().create(result, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return getProjectRepository().create(input, context);
  }

  async updateProject(
    id: string,
    changes: RecordChanges<Project>,
    context: ActorContext,
  ): Promise<Project> {
    this.requireAdministrator(context, "update a project");
    const repository = getProjectRepository();
    const existing = repository.getById(id);
    if (!existing) throw new Error("The selected project was not found.");
    const candidate = { ...existing, ...changes };
    this.validateProject(candidate);
    this.requireUniqueProject(candidate.name, candidate.code, id);

    try {
      const { updateProjectFn } = await import("../server-functions/master-data.server.ts");
      const result = (await updateProjectFn({
        data: {
          id,
          changes: {
            name: changes.name,
            code: changes.code,
            description: changes.description,
            client: changes.client,
            type: changes.type,
            startDate: changes.startDate,
            endDate: changes.endDate,
            costCentreId: changes.costCentreId,
            managerId: changes.managerId,
            locationId: changes.locationId,
            status: changes.status,
            orderIndex: changes.orderIndex,
            isActive: changes.isActive,
          },
          actorId: context.actor.userId,
        },
      })) as unknown as Project;

      if (result) {
        try {
          repository.update(id, result, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return repository.update(id, changes, context);
  }

  async archiveProject(id: string, context: ActorContext): Promise<Project> {
    this.requireAdministrator(context, "archive a project");
    const repository = getProjectRepository();
    const existing = repository.getById(id);
    if (!existing || existing.archivedAt) {
      throw new Error("The selected project was not found or is already archived.");
    }
    const { storage } = getApplicationDataServices();
    const activeEmployees = storage
      .readCollection<Employee>("employees")
      .filter(
        (employee) =>
          employee.projectId === id && !["Inactive", "Archived"].includes(employee.status),
      );
    if (activeEmployees.length) {
      throw new Error(
        `Reassign ${activeEmployees.length} active employee${activeEmployees.length === 1 ? "" : "s"} before archiving this project.`,
      );
    }

    try {
      const { archiveProjectFn } = await import("../server-functions/master-data.server.ts");
      const result = (await archiveProjectFn({
        data: {
          id,
          actorId: context.actor.userId,
        },
      })) as unknown as Project;

      if (result) {
        try {
          repository.archive(id, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return repository.archive(id, context);
  }

  async restoreProject(id: string, context: ActorContext): Promise<Project> {
    this.requireAdministrator(context, "restore a project");
    const repository = getProjectRepository();
    const existing = repository.getById(id);
    if (!existing) throw new Error("The selected project was not found.");
    this.requireUniqueProject(existing.name, existing.code, id);

    try {
      const { restoreProjectFn } = await import("../server-functions/master-data.server.ts");
      const result = (await restoreProjectFn({
        data: {
          id,
          actorId: context.actor.userId,
        },
      })) as unknown as Project;

      if (result) {
        try {
          repository.restore(id, context);
        } catch {
          // Ignore
        }
        return result;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("No Start context") && !message.includes("is not a function")) {
        throw err;
      }
    }

    return repository.restore(id, context);
  }

  private requireAdministrator(context: ActorContext, action: string): void {
    if (context.actor.activeRole === "Super Admin") return;
    const { audit } = getApplicationDataServices();
    audit.record({
      context,
      action: "access-denied",
      module: "settings",
      entityType: "master-data",
      entityId: action,
      reason: `Only a Super Admin can ${action}.`,
      riskLevel: "High",
    });
    throw new Error(`Only a Super Admin can ${action}.`);
  }

  private validateMasterRecord(
    collection: MasterDataCollection,
    record: Pick<MasterRecord, "name" | "code" | "orderIndex"> & Record<string, unknown>,
  ): void {
    if (!record.name.trim()) throw new Error("Name is required.");
    if (!Number.isInteger(record.orderIndex) || record.orderIndex < 0) {
      throw new Error("Display order must be a whole number of zero or greater.");
    }
    if (record.code !== undefined && record.code.trim().length > 30) {
      throw new Error("Code must be 30 characters or fewer.");
    }
    if (collection === "publicHolidays") {
      const date = record["date"];
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Holiday date is required.");
      }
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error("Holiday date is invalid.");
      }
    }
  }

  private validateProject(
    record: Pick<Project, "name" | "code" | "startDate" | "endDate" | "costCentreId" | "managerId">,
  ): void {
    if (!record.name.trim()) throw new Error("Project name is required.");
    if (!record.startDate) throw new Error("Project start date is required.");
    if (record.endDate && record.endDate <= record.startDate) {
      throw new Error("Project end date must be after its start date.");
    }
    if (record.costCentreId) {
      const costCentre = getMasterDataRepository("costCentres").getById(record.costCentreId);
      if (!costCentre || !costCentre.isActive) throw new Error("Select an active cost centre.");
    }
    if (record.managerId) {
      const manager = getApplicationDataServices()
        .storage.readCollection<Employee>("employees")
        .find(
          (employee) =>
            employee.id === record.managerId && !["Inactive", "Archived"].includes(employee.status),
        );
      if (!manager) throw new Error("Select an active project manager.");
    }
  }

  private requireUnique(
    collection: MasterDataCollection,
    name: string,
    code?: string,
    exceptId?: string,
  ): void {
    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();
    const duplicate = getMasterDataRepository(collection)
      .list({ includeArchived: true })
      .find(
        (record) =>
          record.id !== exceptId &&
          (record.name.trim().toLowerCase() === normalizedName ||
            (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode)),
      );
    if (duplicate) throw new Error("A record with the same name or code already exists.");
  }

  private requireUniqueProject(name: string, code?: string, exceptId?: string): void {
    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();
    const duplicate = getProjectRepository()
      .list({ includeArchived: true })
      .find(
        (project) =>
          project.id !== exceptId &&
          (project.name.trim().toLowerCase() === normalizedName ||
            (normalizedCode && project.code?.trim().toLowerCase() === normalizedCode)),
      );
    if (duplicate) throw new Error("A project with the same name or code already exists.");
  }

  private findActiveDependency(
    collection: MasterDataCollection,
    record: MasterRecord,
  ): string | undefined {
    const { storage } = getApplicationDataServices();
    const activeEmployees = storage
      .readCollection<Employee>("employees")
      .filter((employee) => !["Inactive", "Archived"].includes(employee.status));
    const matches = activeEmployees.filter((employee) => {
      if (collection === "departments") return employee.department === record.name;
      if (collection === "positions") return employee.position === record.name;
      if (collection === "locations") return employee.location === record.name;
      if (collection === "grades") return employee.grade === record.name;
      if (collection === "employmentTypes") return employee.employmentType === record.name;
      if (collection === "costCentres") return employee.costCentreId === record.id;
      return false;
    });
    if (matches.length) {
      return `Reassign ${matches.length} active employee${matches.length === 1 ? "" : "s"} before archiving this setting.`;
    }
    if (collection === "costCentres") {
      const activeProjects = getProjectRepository()
        .list()
        .filter((project) => project.costCentreId === record.id);
      if (activeProjects.length) {
        return `Update ${activeProjects.length} active project${activeProjects.length === 1 ? "" : "s"} before archiving this cost centre.`;
      }
    }
    return undefined;
  }
}
