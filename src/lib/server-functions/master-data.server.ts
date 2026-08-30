import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { getDatabaseClient } from "../db/client.ts";
import {
  archiveCollectionRecord,
  archiveProject,
  countActiveEmployeesForMasterRecord,
  countActiveEmployeesForProject,
  countActiveProjectsForCostCentre,
  createCollectionRecord,
  createProject,
  listCollection,
  listProjects,
  type MasterRecordDTO,
  type ProjectDTO,
  restoreCollectionRecord,
  restoreProject,
  updateCollectionRecord,
  updateProject,
} from "../db/repositories/master-data.repository.server.ts";
import { auditEvents } from "../db/schema/system.ts";
import { resolveDefaultOrganisationId, verifyServerActorRole } from "../db/utils.server.ts";

const MasterDataCollectionEnum = z.enum([
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
]);

const MasterDataInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
  code: z.string().trim().max(30, "Code cannot exceed 30 characters").optional(),
  description: z.string().trim().max(500, "Description cannot exceed 500 characters").optional(),
  isActive: z.boolean().optional().default(true),
  orderIndex: z
    .number()
    .int()
    .min(0, "Display order must be a non-negative integer")
    .optional()
    .default(0),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
    .optional(),
});

const MasterDataUpdateInputSchema = MasterDataInputSchema.partial();

const ProjectInputSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(100),
  code: z.string().trim().max(30).optional(),
  description: z.string().trim().max(500).optional(),
  client: z.string().trim().max(100).optional(),
  type: z.string().trim().max(50).optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  costCentreId: z.string().uuid("Invalid cost centre UUID").optional(),
  managerId: z.string().uuid("Invalid manager UUID").optional(),
  locationId: z.string().uuid("Invalid location UUID").optional(),
  status: z
    .enum(["Draft", "Active", "On Hold", "Completed", "Archived"])
    .optional()
    .default("Draft"),
  orderIndex: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const ProjectUpdateInputSchema = ProjectInputSchema.partial();

export const listMasterDataFn = createServerFn({ method: "GET" })
  .validator(
    (input: {
      collection: z.infer<typeof MasterDataCollectionEnum>;
      includeArchived?: boolean;
    }) => {
      return z
        .object({
          collection: MasterDataCollectionEnum,
          includeArchived: z.boolean().optional().default(false),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<MasterRecordDTO[]> => {
    const orgId = await resolveDefaultOrganisationId();
    return listCollection(orgId, data.collection, data.includeArchived);
  });

export const createMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: z.infer<typeof MasterDataCollectionEnum>;
      input: z.infer<typeof MasterDataInputSchema>;
      actorId: string;
    }) => {
      return z
        .object({
          collection: MasterDataCollectionEnum,
          input: MasterDataInputSchema,
          actorId: z.string().min(1),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<MasterRecordDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: data.collection,
        entityId: orgId,
        reason: error ?? "Only a Super Admin can create master data.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can create master data."}`);
    }

    const { name, code, date } = data.input;

    if (data.collection === "publicHolidays") {
      if (!date) throw new Error("Holiday date is required.");
      const parsed = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
        throw new Error("Holiday date is invalid.");
      }
    }

    const existing = await listCollection(orgId, data.collection, true);
    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();

    const duplicate = existing.find(
      (record) =>
        record.name.trim().toLowerCase() === normalizedName ||
        (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode),
    );
    if (duplicate) throw new Error("A record with the same name or code already exists.");

    return createCollectionRecord(orgId, data.collection, data.input, actor);
  });

export const updateMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: z.infer<typeof MasterDataCollectionEnum>;
      id: string;
      changes: z.infer<typeof MasterDataUpdateInputSchema>;
      actorId: string;
    }) => {
      return z
        .object({
          collection: MasterDataCollectionEnum,
          id: z.string().min(1),
          changes: MasterDataUpdateInputSchema,
          actorId: z.string().min(1),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<MasterRecordDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: data.collection,
        entityId: data.id,
        reason: error ?? "Only a Super Admin can update master data.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can update master data."}`);
    }

    const existingList = await listCollection(orgId, data.collection, true);
    const current = existingList.find((r) => r.id === data.id);
    if (!current) throw new Error("The selected record was not found.");

    const candidate = { ...current, ...data.changes };

    if (data.collection === "publicHolidays" && candidate.date) {
      const parsed = new Date(`${candidate.date}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate.date) {
        throw new Error("Holiday date is invalid.");
      }
    }

    const name = candidate.name ?? current.name;
    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = candidate.code?.trim().toLowerCase();

    const duplicate = existingList.find(
      (record) =>
        record.id !== data.id &&
        (record.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A record with the same name or code already exists.");

    return updateCollectionRecord(orgId, data.collection, data.id, data.changes, actor);
  });

export const archiveMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: z.infer<typeof MasterDataCollectionEnum>;
      id: string;
      actorId: string;
    }) => {
      return z
        .object({
          collection: MasterDataCollectionEnum,
          id: z.string().min(1),
          actorId: z.string().min(1),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<MasterRecordDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: data.collection,
        entityId: data.id,
        reason: error ?? "Only a Super Admin can archive master data.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can archive master data."}`);
    }

    const existingList = await listCollection(orgId, data.collection, false);
    const current = existingList.find((r) => r.id === data.id);
    if (!current) throw new Error("The selected record was not found or is already archived.");

    const activeCount = await countActiveEmployeesForMasterRecord(orgId, data.collection, data.id);
    if (activeCount > 0) {
      throw new Error(
        `Cannot archive: ${activeCount} active employee${activeCount === 1 ? " is" : "s are"} currently assigned to this record.`,
      );
    }

    if (data.collection === "costCentres") {
      const activeProjects = await countActiveProjectsForCostCentre(orgId, data.id);
      if (activeProjects > 0) {
        throw new Error(
          `Cannot archive: ${activeProjects} active project${activeProjects === 1 ? " is" : "s are"} currently assigned to this cost centre.`,
        );
      }
    }

    return archiveCollectionRecord(orgId, data.collection, data.id, actor);
  });

export const restoreMasterDataFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      collection: z.infer<typeof MasterDataCollectionEnum>;
      id: string;
      actorId: string;
    }) => {
      return z
        .object({
          collection: MasterDataCollectionEnum,
          id: z.string().min(1),
          actorId: z.string().min(1),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<MasterRecordDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: data.collection,
        entityId: data.id,
        reason: error ?? "Only a Super Admin can restore master data.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can restore master data."}`);
    }

    const existingList = await listCollection(orgId, data.collection, true);
    const current = existingList.find((r) => r.id === data.id);
    if (!current) throw new Error("The selected record was not found.");

    const normalizedName = current.name.trim().toLowerCase();
    const normalizedCode = current.code?.trim().toLowerCase();

    const duplicate = existingList.find(
      (record) =>
        record.id !== data.id &&
        !record.archivedAt &&
        (record.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && record.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A record with the same name or code already exists.");

    return restoreCollectionRecord(orgId, data.collection, data.id, actor);
  });

export const listProjectsFn = createServerFn({ method: "GET" })
  .validator((input: { includeArchived?: boolean } = {}) => {
    return z
      .object({
        includeArchived: z.boolean().optional().default(false),
      })
      .parse(input);
  })
  .handler(async ({ data }): Promise<ProjectDTO[]> => {
    const orgId = await resolveDefaultOrganisationId();
    return listProjects(orgId, data.includeArchived);
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((input: { input: z.infer<typeof ProjectInputSchema>; actorId: string }) => {
    return z
      .object({
        input: ProjectInputSchema,
        actorId: z.string().min(1),
      })
      .parse(input);
  })
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: "project",
        entityId: orgId,
        reason: error ?? "Only a Super Admin can create a project.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can create a project."}`);
    }

    const { name, code, startDate, endDate, costCentreId } = data.input;
    if (endDate && endDate <= startDate) {
      throw new Error("Project end date must be after its start date.");
    }

    if (costCentreId) {
      const costCentres = await listCollection(orgId, "costCentres", false);
      const cc = costCentres.find((c) => c.id === costCentreId && c.isActive);
      if (!cc) throw new Error("Select an active cost centre.");
    }

    const existing = await listProjects(orgId, true);
    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();

    const duplicate = existing.find(
      (p) =>
        p.name.trim().toLowerCase() === normalizedName ||
        (normalizedCode && p.code?.trim().toLowerCase() === normalizedCode),
    );
    if (duplicate) throw new Error("A project with the same name or code already exists.");

    return createProject(orgId, data.input, actor);
  });

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator(
    (input: { id: string; changes: z.infer<typeof ProjectUpdateInputSchema>; actorId: string }) => {
      return z
        .object({
          id: z.string().min(1),
          changes: ProjectUpdateInputSchema,
          actorId: z.string().min(1),
        })
        .parse(input);
    },
  )
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: "project",
        entityId: data.id,
        reason: error ?? "Only a Super Admin can update a project.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can update a project."}`);
    }

    const existing = await listProjects(orgId, true);
    const current = existing.find((p) => p.id === data.id);
    if (!current) throw new Error("The selected project was not found.");

    const candidate = { ...current, ...data.changes };
    const name = candidate.name ?? current.name;
    const startDate = candidate.startDate ?? current.startDate;
    const endDate = candidate.endDate ?? current.endDate;
    const costCentreId = candidate.costCentreId ?? current.costCentreId;
    const code = candidate.code ?? current.code;

    if (endDate && endDate <= startDate) {
      throw new Error("Project end date must be after its start date.");
    }

    if (costCentreId) {
      const costCentres = await listCollection(orgId, "costCentres", false);
      const cc = costCentres.find((c) => c.id === costCentreId && c.isActive);
      if (!cc) throw new Error("Select an active cost centre.");
    }

    const normalizedName = name.trim().toLowerCase();
    const normalizedCode = code?.trim().toLowerCase();

    const duplicate = existing.find(
      (p) =>
        p.id !== data.id &&
        (p.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && p.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A project with the same name or code already exists.");

    return updateProject(orgId, data.id, data.changes, actor);
  });

export const archiveProjectFn = createServerFn({ method: "POST" })
  .validator((input: { id: string; actorId: string }) => {
    return z
      .object({
        id: z.string().min(1),
        actorId: z.string().min(1),
      })
      .parse(input);
  })
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: "project",
        entityId: data.id,
        reason: error ?? "Only a Super Admin can archive a project.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can archive a project."}`);
    }

    const existing = await listProjects(orgId, false);
    const current = existing.find((p) => p.id === data.id);
    if (!current) throw new Error("The selected project was not found or is already archived.");

    const activeEmployeesCount = await countActiveEmployeesForProject(orgId, data.id);
    if (activeEmployeesCount > 0) {
      throw new Error(
        `Reassign ${activeEmployeesCount} active employee${activeEmployeesCount === 1 ? "" : "s"} before archiving this project.`,
      );
    }

    return archiveProject(orgId, data.id, actor);
  });

export const restoreProjectFn = createServerFn({ method: "POST" })
  .validator((input: { id: string; actorId: string }) => {
    return z
      .object({
        id: z.string().min(1),
        actorId: z.string().min(1),
      })
      .parse(input);
  })
  .handler(async ({ data }): Promise<ProjectDTO> => {
    const orgId = await resolveDefaultOrganisationId();
    const { verified, actor, error } = await verifyServerActorRole(
      orgId,
      data.actorId,
      "Super Admin",
    );

    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: "project",
        entityId: data.id,
        reason: error ?? "Only a Super Admin can restore a project.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Only a Super Admin can restore a project."}`);
    }

    const existing = await listProjects(orgId, true);
    const current = existing.find((p) => p.id === data.id);
    if (!current) throw new Error("The selected project was not found.");

    const normalizedName = current.name.trim().toLowerCase();
    const normalizedCode = current.code?.trim().toLowerCase();

    const duplicate = existing.find(
      (p) =>
        p.id !== data.id &&
        !p.archivedAt &&
        (p.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && p.code?.trim().toLowerCase() === normalizedCode)),
    );
    if (duplicate) throw new Error("A project with the same name or code already exists.");

    return restoreProject(orgId, data.id, actor);
  });
