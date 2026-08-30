import { createServerFn } from "@tanstack/react-start";
import { getDatabaseClient } from "../db/client.ts";
import { auditEvents } from "../db/schema/system.ts";
import {
  listCollection,
  createCollectionRecord,
  updateCollectionRecord,
  archiveCollectionRecord,
  restoreCollectionRecord,
  listProjects,
  createProject,
  updateProject,
  archiveProject,
  restoreProject,
} from "../db/repositories/master-data.repository.server.ts";
import { resolveDefaultOrganisationId } from "../db/utils.server.ts";
import type { MasterDataCollection } from "../data/master-data.ts";
import type { Role } from "../data/types.ts";

export const listMasterDataFn = createServerFn({ method: "GET" })
  .validator((input: { collection: MasterDataCollection; includeArchived?: boolean }) => input)
  .handler(async ({ data }) => {
    const orgId = await resolveDefaultOrganisationId();
    return listCollection(orgId, data.collection, data.includeArchived);
  });

export const createMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: { collection: MasterDataCollection; input: any; actorId: string; activeRole: Role }) =>
      input,
  )
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can create master data.");
    const { name, code, orderIndex, date } = data.input;
    if (!name || typeof name !== "string" || !name.trim()) throw new Error("Name is required.");
    if (!Number.isInteger(orderIndex) || orderIndex < 0) {
      throw new Error("Display order must be a whole number of zero or greater.");
    }
    if (code !== undefined && typeof code === "string" && code.trim().length > 30) {
      throw new Error("Code must be 30 characters or fewer.");
    }
    if (data.collection === "publicHolidays") {
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Holiday date is required.");
      }
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error("Holiday date is invalid.");
      }
    }

    const orgId = await resolveDefaultOrganisationId();
    const existing = await listCollection(orgId, data.collection, true);

    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();

    const duplicate = existing.find(
      (record: any) =>
        record.name.trim().toLowerCase() === normalizedName ||
        (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode),
    );
    if (duplicate) throw new Error("A record with the same name or code already exists.");

    const result = await createCollectionRecord(orgId, data.collection, data.input, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "create",
      module: "settings",
      entityType: data.collection,
      entityId: result.id,
      afterSummary: result,
      riskLevel: "Medium",
    });

    return result;
  });

export const updateMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: MasterDataCollection;
      id: string;
      changes: any;
      actorId: string;
      activeRole: Role;
    }) => input,
  )
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can update master data.");

    const orgId = await resolveDefaultOrganisationId();
    const existingList = await listCollection(orgId, data.collection, true);
    const current = existingList.find((r: any) => r.id === data.id);
    if (!current) throw new Error("The selected setting was not found.");

    const candidate = { ...current, ...data.changes };
    const { name, code, orderIndex, date } = candidate;

    if (!name || typeof name !== "string" || !name.trim()) throw new Error("Name is required.");
    if (!Number.isInteger(orderIndex) || orderIndex < 0) {
      throw new Error("Display order must be a whole number of zero or greater.");
    }
    if (code !== undefined && typeof code === "string" && code.trim().length > 30) {
      throw new Error("Code must be 30 characters or fewer.");
    }
    if (data.collection === "publicHolidays") {
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Holiday date is required.");
      }
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error("Holiday date is invalid.");
      }
    }

    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();

    const duplicate = existingList.find(
      (record: any) =>
        record.id !== data.id &&
        (record.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A record with the same name or code already exists.");

    const result = await updateCollectionRecord(orgId, data.collection, data.id, data.changes, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "update",
      module: "settings",
      entityType: data.collection,
      entityId: result.id,
      beforeSummary: current,
      afterSummary: result,
      riskLevel: "Medium",
    });

    return result;
  });

export const archiveMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: MasterDataCollection;
      id: string;
      actorId: string;
      activeRole: Role;
    }) => input,
  )
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can archive master data.");
    const orgId = await resolveDefaultOrganisationId();

    const existingList = await listCollection(orgId, data.collection, false);
    const current = existingList.find((r: any) => r.id === data.id);
    if (!current) throw new Error("The selected setting was not found or is already archived.");

    const db = getDatabaseClient();
    // Validate active employees depending on collection
    let matches: any[] = [];
    try {
      const activeEmployees = await (db.query as any).employees.findMany({
        where: (emp: any, { eq, notInArray, and }: any) =>
          and(
            eq(emp.organisationId, orgId),
            notInArray(emp.status, ["Inactive", "Archived"]),
          ),
      });

      if (activeEmployees.length) {
        matches = activeEmployees.filter((employee: any) => {
          if (data.collection === "departments") return employee.department === current.name;
          if (data.collection === "positions") return employee.position === current.name;
          if (data.collection === "locations") return employee.location === current.name;
          if (data.collection === "grades") return employee.grade === current.name;
          if (data.collection === "employmentTypes") return employee.employmentType === current.name;
          if (data.collection === "costCentres") return employee.costCentreId === current.id;
          return false;
        });
      }
    } catch {
      // safe fallback if employees not available yet
    }

    if (matches.length) {
      throw new Error(
        `Reassign ${matches.length} active employee${matches.length === 1 ? "" : "s"} before archiving this setting.`,
      );
    }

    if (data.collection === "costCentres") {
      const activeProjects = await listProjects(orgId, false);
      const matchedProjects = activeProjects.filter(
        (project: any) => project.costCentreId === current.id,
      );
      if (matchedProjects.length) {
        throw new Error(
          `Update ${matchedProjects.length} active project${matchedProjects.length === 1 ? "" : "s"} before archiving this cost centre.`,
        );
      }
    }

    const result = await archiveCollectionRecord(orgId, data.collection, data.id, data.actorId);

    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "archive",
      module: "settings",
      entityType: data.collection,
      entityId: result.id,
      riskLevel: "High",
    });

    return result;
  });

export const restoreMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: MasterDataCollection;
      id: string;
      actorId: string;
      activeRole: Role;
    }) => input,
  )
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can restore master data.");
    const orgId = await resolveDefaultOrganisationId();

    const existingList = await listCollection(orgId, data.collection, true);
    const current = existingList.find((r: any) => r.id === data.id);
    if (!current) throw new Error("The selected setting was not found.");

    const normalizedName = current.name.trim().toLowerCase();
    const normalizedCode = current.code?.trim().toLowerCase();

    const duplicate = existingList.find(
      (record: any) =>
        record.id !== data.id &&
        !record.archivedAt && // check uniqueness against active
        (record.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A record with the same name or code already exists.");

    const result = await restoreCollectionRecord(orgId, data.collection, data.id, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "restore",
      module: "settings",
      entityType: data.collection,
      entityId: result.id,
      riskLevel: "Medium",
    });

    return result;
  });

export const listProjectsFn = createServerFn({ method: "GET" })
  .validator((input: { includeArchived?: boolean }) => input)
  .handler(async ({ data }) => {
    const orgId = await resolveDefaultOrganisationId();
    return listProjects(orgId, data.includeArchived);
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((input: { input: any; actorId: string; activeRole: Role }) => input)
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can create a project.");
    const orgId = await resolveDefaultOrganisationId();

    const { name, code, startDate, endDate, costCentreId } = data.input;
    if (!name || typeof name !== "string" || !name.trim())
      throw new Error("Project name is required.");
    if (!startDate) throw new Error("Project start date is required.");
    if (endDate && endDate <= startDate)
      throw new Error("Project end date must be after its start date.");

    if (costCentreId) {
      const costCentres = await listCollection(orgId, "costCentres", false);
      const cc = costCentres.find((c: any) => c.id === costCentreId && c.isActive);
      if (!cc) throw new Error("Select an active cost centre.");
    }

    const existing = await listProjects(orgId, true);
    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();
    const duplicate = existing.find(
      (p: any) =>
        p.name.trim().toLowerCase() === normalizedName ||
        (normalizedCode && p.code?.trim().toLowerCase() === normalizedCode),
    );
    if (duplicate) throw new Error("A project with the same name or code already exists.");

    const result = await createProject(orgId, data.input, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "create",
      module: "settings",
      entityType: "project",
      entityId: result.id,
      afterSummary: result,
      riskLevel: "Medium",
    });

    return result;
  });

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator((input: { id: string; changes: any; actorId: string; activeRole: Role }) => input)
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can update a project.");
    const orgId = await resolveDefaultOrganisationId();

    const existing = await listProjects(orgId, true);
    const current = existing.find((p: any) => p.id === data.id);
    if (!current) throw new Error("The selected project was not found.");

    const candidate = { ...current, ...data.changes };
    const { name, code, startDate, endDate, costCentreId } = candidate;
    if (!name || typeof name !== "string" || !name.trim())
      throw new Error("Project name is required.");
    if (!startDate) throw new Error("Project start date is required.");
    if (endDate && endDate <= startDate)
      throw new Error("Project end date must be after its start date.");

    if (costCentreId) {
      const costCentres = await listCollection(orgId, "costCentres", false);
      const cc = costCentres.find((c: any) => c.id === costCentreId && c.isActive);
      if (!cc) throw new Error("Select an active cost centre.");
    }

    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();
    const duplicate = existing.find(
      (p: any) =>
        p.id !== data.id &&
        (p.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && p.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A project with the same name or code already exists.");

    const result = await updateProject(orgId, data.id, data.changes, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "update",
      module: "settings",
      entityType: "project",
      entityId: result.id,
      beforeSummary: current,
      afterSummary: result,
      riskLevel: "Medium",
    });

    return result;
  });

export const archiveProjectFn = createServerFn({ method: "POST" })
  .validator((input: { id: string; actorId: string; activeRole: Role }) => input)
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can archive a project.");
    const orgId = await resolveDefaultOrganisationId();

    const existing = await listProjects(orgId, false);
    const current = existing.find((p: any) => p.id === data.id);
    if (!current) throw new Error("The selected project was not found or is already archived.");

    const db = getDatabaseClient();
    let activeEmployees: any[] = [];
    try {
      activeEmployees = await (db.query as any).employees.findMany({
        where: (emp: any, { eq, notInArray, and }: any) =>
          and(
            eq(emp.organisationId, orgId),
            eq(emp.projectId, data.id),
            notInArray(emp.status, ["Inactive", "Archived"]),
          ),
      });
    } catch {
      // safe fallback
    }

    if (activeEmployees.length) {
      throw new Error(
        `Reassign ${activeEmployees.length} active employee${activeEmployees.length === 1 ? "" : "s"} before archiving this project.`,
      );
    }

    const result = await archiveProject(orgId, data.id, data.actorId);

    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "archive",
      module: "settings",
      entityType: "project",
      entityId: result.id,
      riskLevel: "High",
    });

    return result;
  });

export const restoreProjectFn = createServerFn({ method: "POST" })
  .validator((input: { id: string; actorId: string; activeRole: Role }) => input)
  .handler(async ({ data }) => {
    if (data.activeRole !== "Super Admin")
      throw new Error("Only a Super Admin can restore a project.");
    const orgId = await resolveDefaultOrganisationId();

    const existing = await listProjects(orgId, true);
    const current = existing.find((p: any) => p.id === data.id);
    if (!current) throw new Error("The selected project was not found.");

    const normalizedName = current.name.trim().toLowerCase();
    const normalizedCode = current.code?.trim().toLowerCase();
    const duplicate = existing.find(
      (p: any) =>
        p.id !== data.id &&
        !p.archivedAt && // uniqueness on restore
        (p.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && p.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A project with the same name or code already exists.");

    const result = await restoreProject(orgId, data.id, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "restore",
      module: "settings",
      entityType: "project",
      entityId: result.id,
      riskLevel: "Medium",
    });

    return result;
  });
