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
  async listAsync(collection: MasterDataCollection, includeArchived = true): Promise<MasterRecord[]> {
    const { listMasterDataFn } = await import("../server-functions/master-data.server.ts");
    return listMasterDataFn({ data: { collection, includeArchived } }) as unknown as Promise<MasterRecord[]>;
  }

  async listProjectsAsync(includeArchived = true): Promise<Project[]> {
    const { listProjectsFn } = await import("../server-functions/master-data.server.ts");
    return listProjectsFn({ data: { includeArchived } }) as unknown as Promise<Project[]>;
  }

  async create(
    collection: MasterDataCollection,
    input: NewRecord<MasterRecord>,
    context: ActorContext,
  ): Promise<MasterRecord> {
    const { createMasterDataFn } = await import("../server-functions/master-data.server.ts");
    return createMasterDataFn({
      data: {
        collection,
        input,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<MasterRecord>;
  }

  async update(
    collection: MasterDataCollection,
    id: string,
    changes: RecordChanges<MasterRecord>,
    context: ActorContext,
  ): Promise<MasterRecord> {
    const { updateMasterDataFn } = await import("../server-functions/master-data.server.ts");
    return updateMasterDataFn({
      data: {
        collection,
        id,
        changes,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<MasterRecord>;
  }

  async archive(collection: MasterDataCollection, id: string, context: ActorContext): Promise<MasterRecord> {
    const { archiveMasterDataFn } = await import("../server-functions/master-data.server.ts");
    return archiveMasterDataFn({
      data: {
        collection,
        id,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<MasterRecord>;
  }

  async restore(collection: MasterDataCollection, id: string, context: ActorContext): Promise<MasterRecord> {
    const { restoreMasterDataFn } = await import("../server-functions/master-data.server.ts");
    return restoreMasterDataFn({
      data: {
        collection,
        id,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<MasterRecord>;
  }

  async createProject(input: NewRecord<Project>, context: ActorContext): Promise<Project> {
    const { createProjectFn } = await import("../server-functions/master-data.server.ts");
    return createProjectFn({
      data: {
        input,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<Project>;
  }

  async updateProject(id: string, changes: RecordChanges<Project>, context: ActorContext): Promise<Project> {
    const { updateProjectFn } = await import("../server-functions/master-data.server.ts");
    return updateProjectFn({
      data: {
        id,
        changes,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<Project>;
  }

  async archiveProject(id: string, context: ActorContext): Promise<Project> {
    const { archiveProjectFn } = await import("../server-functions/master-data.server.ts");
    return archiveProjectFn({
      data: {
        id,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<Project>;
  }

  async restoreProject(id: string, context: ActorContext): Promise<Project> {
    const { restoreProjectFn } = await import("../server-functions/master-data.server.ts");
    return restoreProjectFn({
      data: {
        id,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<Project>;
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
