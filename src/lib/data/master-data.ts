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

export const MASTER_DATA_COLLECTIONS: readonly MasterDataCollection[] = [
  "departments",
  "locations",
  "costCentres",
  "positions",
  "grades",
  "employmentTypes",
  "workingTimes",
  "publicHolidays",
  "currencies",
  "activityCodes",
];

function usesBrowserServerFunctions(): boolean {
  return typeof window !== "undefined";
}

function naturalKey(record: Pick<MasterRecord, "code" | "name">): string {
  return `${record.code?.trim().toLowerCase() || ""}|${record.name.trim().toLowerCase()}`;
}

function replaceCompatibilityCache<T extends MasterRecord>(collection: string, records: T[]): T[] {
  const storage = getApplicationDataServices().storage;
  const existingByNaturalKey = new Map(
    storage.readCollection<T>(collection).map((record) => [naturalKey(record), record] as const),
  );
  const compatible = records.map((record) => {
    const existing = existingByNaturalKey.get(naturalKey(record));
    if (!existing || existing.id === record.id) return record;
    return { ...record, id: existing.id, databaseId: record.id };
  });
  storage.writeCollection(collection, compatible);
  return compatible;
}

function resolveDatabaseId(record: MasterRecord | null | undefined, requestedId: string): string {
  return record?.databaseId || requestedId;
}

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
    if (!usesBrowserServerFunctions()) return this.list(collection, includeArchived);

    const { listMasterDataFn } = await import("../server-functions/master-data.server.ts");
    const result = (await listMasterDataFn({
      data: { collection, includeArchived },
    })) as unknown as MasterRecord[];
    return replaceCompatibilityCache(collection, result);
  }

  async listProjectsAsync(includeArchived = true): Promise<Project[]> {
    if (!usesBrowserServerFunctions()) return this.listProjects(includeArchived);

    const { listProjectsFn } = await import("../server-functions/master-data.server.ts");
    const result = (await listProjectsFn({
      data: { includeArchived },
    })) as unknown as Project[];
    return replaceCompatibilityCache("projects", result);
  }

  async hydrateCompatibilityCache(): Promise<void> {
    if (!usesBrowserServerFunctions()) return;
    await Promise.all([
      ...MASTER_DATA_COLLECTIONS.map((collection) => this.listAsync(collection, true)),
      this.listProjectsAsync(true),
    ]);
  }

  async create(
    collection: MasterDataCollection,
    input: NewRecord<MasterRecord>,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `create a ${collection} record`);
    this.validateMasterRecord(collection, input);
    if (!usesBrowserServerFunctions()) {
      this.requireUnique(collection, input.name, input.code);
      return getMasterDataRepository(collection).create(input, context);
    }

    const { createMasterDataFn } = await import("../server-functions/master-data.server.ts");
    const result = (await createMasterDataFn({
      data: {
        collection,
        input: {
          ...this.toServerMasterDataInput(input),
          name: input.name,
          isActive: input.isActive,
          orderIndex: input.orderIndex,
        },
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as MasterRecord;
    await this.listAsync(collection, true);
    return result;
  }

  async update(
    collection: MasterDataCollection,
    id: string,
    changes: RecordChanges<MasterRecord>,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `update a ${collection} record`);
    const repository = getMasterDataRepository(collection);
    if (!usesBrowserServerFunctions()) {
      const existing = repository.getById(id);
      if (!existing) throw new Error("The selected setting was not found.");
      const candidate = { ...existing, ...changes };
      this.validateMasterRecord(collection, candidate);
      this.requireUnique(collection, candidate.name, candidate.code, id);
      return repository.update(id, changes, context);
    }

    const { updateMasterDataFn } = await import("../server-functions/master-data.server.ts");
    const result = (await updateMasterDataFn({
      data: {
        collection,
        id: resolveDatabaseId(repository.getById(id), id),
        changes: this.toServerMasterDataInput(changes),
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as MasterRecord;
    await this.listAsync(collection, true);
    return result;
  }

  async archive(
    collection: MasterDataCollection,
    id: string,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `archive a ${collection} record`);
    const repository = getMasterDataRepository(collection);
    if (!usesBrowserServerFunctions()) {
      const existing = repository.getById(id);
      if (!existing || existing.archivedAt) {
        throw new Error("The selected setting was not found or is already archived.");
      }
      const dependencyBlock = this.findActiveDependency(collection, existing);
      if (dependencyBlock) throw new Error(dependencyBlock);
      return repository.archive(id, context);
    }

    const { archiveMasterDataFn } = await import("../server-functions/master-data.server.ts");
    const result = (await archiveMasterDataFn({
      data: {
        collection,
        id: resolveDatabaseId(repository.getById(id), id),
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as MasterRecord;
    await this.listAsync(collection, true);
    return result;
  }

  async restore(
    collection: MasterDataCollection,
    id: string,
    context: ActorContext,
  ): Promise<MasterRecord> {
    this.requireAdministrator(context, `restore a ${collection} record`);
    const repository = getMasterDataRepository(collection);
    if (!usesBrowserServerFunctions()) {
      const existing = repository.getById(id);
      if (!existing) throw new Error("The selected setting was not found.");
      this.requireUnique(collection, existing.name, existing.code, id);
      return repository.restore(id, context);
    }

    const { restoreMasterDataFn } = await import("../server-functions/master-data.server.ts");
    const result = (await restoreMasterDataFn({
      data: {
        collection,
        id: resolveDatabaseId(repository.getById(id), id),
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as MasterRecord;
    await this.listAsync(collection, true);
    return result;
  }

  async createProject(input: NewRecord<Project>, context: ActorContext): Promise<Project> {
    this.requireAdministrator(context, "create a project");
    if (!usesBrowserServerFunctions()) {
      this.validateProject(input);
      this.requireUniqueProject(input.name, input.code);
      return getProjectRepository().create(input, context);
    }

    const { createProjectFn } = await import("../server-functions/master-data.server.ts");
    const result = (await createProjectFn({
      data: {
        input: {
          ...this.toServerProjectInput(input, true),
          name: input.name,
          startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
          status: input.status ?? "Draft",
          orderIndex: input.orderIndex,
          isActive: input.isActive,
        },
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as Project;
    await this.listProjectsAsync(true);
    return result;
  }

  async updateProject(
    id: string,
    changes: RecordChanges<Project>,
    context: ActorContext,
  ): Promise<Project> {
    this.requireAdministrator(context, "update a project");
    const repository = getProjectRepository();
    if (!usesBrowserServerFunctions()) {
      const existing = repository.getById(id);
      if (!existing) throw new Error("The selected project was not found.");
      const candidate = { ...existing, ...changes };
      this.validateProject(candidate);
      this.requireUniqueProject(candidate.name, candidate.code, id);
      return repository.update(id, changes, context);
    }

    const { updateProjectFn } = await import("../server-functions/master-data.server.ts");
    const result = (await updateProjectFn({
      data: {
        id: resolveDatabaseId(repository.getById(id), id),
        changes: this.toServerProjectInput(changes, false),
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as Project;
    await this.listProjectsAsync(true);
    return result;
  }

  async archiveProject(id: string, context: ActorContext): Promise<Project> {
    this.requireAdministrator(context, "archive a project");
    const repository = getProjectRepository();
    if (!usesBrowserServerFunctions()) {
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
      return repository.archive(id, context);
    }

    const { archiveProjectFn } = await import("../server-functions/master-data.server.ts");
    const result = (await archiveProjectFn({
      data: {
        id: resolveDatabaseId(repository.getById(id), id),
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as Project;
    await this.listProjectsAsync(true);
    return result;
  }

  async restoreProject(id: string, context: ActorContext): Promise<Project> {
    this.requireAdministrator(context, "restore a project");
    const repository = getProjectRepository();
    if (!usesBrowserServerFunctions()) {
      const existing = repository.getById(id);
      if (!existing) throw new Error("The selected project was not found.");
      this.requireUniqueProject(existing.name, existing.code, id);
      return repository.restore(id, context);
    }

    const { restoreProjectFn } = await import("../server-functions/master-data.server.ts");
    const result = (await restoreProjectFn({
      data: {
        id: resolveDatabaseId(repository.getById(id), id),
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as Project;
    await this.listProjectsAsync(true);
    return result;
  }

  private toServerMasterDataInput(input: Partial<MasterRecord>) {
    return {
      name: input.name,
      code: input.code,
      description: input.description,
      isActive: input.isActive,
      orderIndex: input.orderIndex,
      date: input.date,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      isClockInSite: input.isClockInSite,
      startTime: input.startTime,
      endTime: input.endTime,
      breakMinutes: input.breakMinutes,
      workingDays: input.workingDays,
      symbol: input.symbol,
      decimalPlaces: input.decimalPlaces,
    };
  }

  private toServerProjectInput(input: Partial<Project>, creating: boolean) {
    return {
      name: input.name,
      code: input.code,
      description: input.description,
      client: input.client,
      type: input.type,
      startDate: input.startDate ?? (creating ? new Date().toISOString().slice(0, 10) : undefined),
      endDate: input.endDate,
      costCentreId: input.costCentreId,
      managerId: input.managerId,
      locationId: input.locationId,
      status: input.status ?? (creating ? "Draft" : undefined),
      orderIndex: input.orderIndex,
      isActive: input.isActive,
    };
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
