/* eslint-disable @typescript-eslint/no-explicit-any */
import "@tanstack/react-start/server-only";

import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import * as schema from "../schema/master-data.ts";
import { auditEvents } from "../schema/system.ts";
import type { MasterDataCollection } from "../../data/master-data.ts";
import type { Role } from "../../data/types.ts";

export const TABLE_MAP = {
  departments: schema.departments,
  locations: schema.locations,
  costCentres: schema.costCentres,
  positions: schema.positions,
  grades: schema.grades,
  employmentTypes: schema.employmentTypes,
  workingTimes: schema.workingTimes,
  publicHolidays: schema.publicHolidays,
  currencies: schema.currencies,
  activityCodes: schema.activityCodes,
} as const;

export interface MasterRecordDTO {
  id: string;
  name: string;
  code?: string;
  description?: string;
  isActive: boolean;
  orderIndex: number;
  date?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  isClockInSite?: boolean;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  workingDays?: number[];
  symbol?: string;
  decimalPlaces?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  archivedAt?: string;
  recordVersion: number;
}

export interface ProjectDTO {
  id: string;
  name: string;
  code?: string;
  description?: string;
  client?: string;
  type?: string;
  startDate: string;
  endDate?: string;
  costCentreId?: string;
  managerId?: string;
  locationId?: string;
  status: string;
  isActive: boolean;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  archivedAt?: string;
  recordVersion: number;
}

export interface AuditActorContext {
  userId?: string;
  employeeId?: string;
  displayName: string;
  activeRole: Role;
  roles?: Role[];
}

function mapMasterRecordToDTO(record: any): MasterRecordDTO {
  return {
    id: record.id,
    name: record.name,
    code: record.code ?? undefined,
    description: record.description ?? undefined,
    isActive: Boolean(record.isActive),
    orderIndex: Number(record.orderIndex ?? 0),
    date: record.holidayDate ?? record.date ?? undefined,
    latitude: record.latitude ?? undefined,
    longitude: record.longitude ?? undefined,
    radiusMeters: record.radiusMeters ?? undefined,
    isClockInSite: record.isClockInSite ?? undefined,
    startTime: record.startTime ?? undefined,
    endTime: record.endTime ?? undefined,
    breakMinutes: record.breakMinutes ?? undefined,
    workingDays: record.workingDays ?? undefined,
    symbol: record.symbol ?? undefined,
    decimalPlaces: record.decimalPlaces ?? undefined,
    createdAt:
      record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
    updatedAt:
      record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt),
    createdBy: String(record.createdBy),
    updatedBy: String(record.updatedBy),
    archivedAt:
      record.archivedAt instanceof Date
        ? record.archivedAt.toISOString()
        : (record.archivedAt ?? undefined),
    recordVersion: Number(record.recordVersion ?? 1),
  };
}

function mapProjectToDTO(record: any): ProjectDTO {
  return {
    id: record.id,
    name: record.name,
    code: record.code ?? undefined,
    description: record.description ?? undefined,
    client: record.client ?? undefined,
    type: record.type ?? undefined,
    startDate: record.startDate,
    endDate: record.endDate ?? undefined,
    costCentreId: record.costCentreId ?? undefined,
    managerId: record.managerId ?? undefined,
    locationId: record.locationId ?? undefined,
    status: record.status ?? "Draft",
    isActive: Boolean(record.isActive),
    orderIndex: Number(record.orderIndex ?? 0),
    createdAt:
      record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
    updatedAt:
      record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt),
    createdBy: String(record.createdBy),
    updatedBy: String(record.updatedBy),
    archivedAt:
      record.archivedAt instanceof Date
        ? record.archivedAt.toISOString()
        : (record.archivedAt ?? undefined),
    recordVersion: Number(record.recordVersion ?? 1),
  };
}

export async function listCollection(
  orgId: string,
  collection: MasterDataCollection,
  includeArchived = false,
): Promise<MasterRecordDTO[]> {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];

  const whereClause = includeArchived
    ? eq(table.organisationId, orgId)
    : and(eq(table.organisationId, orgId), isNull(table.archivedAt));

  const rows = await db
    .select()
    .from(table)
    .where(whereClause)
    .orderBy(asc(table.orderIndex), asc(table.name));
  return rows.map(mapMasterRecordToDTO);
}

export async function getCollectionRecordById(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
): Promise<MasterRecordDTO | null> {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];
  const [record] = await db
    .select()
    .from(table)
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)));
  return record ? mapMasterRecordToDTO(record) : null;
}

export async function createCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  input: {
    name: string;
    code?: string | undefined;
    description?: string | undefined;
    isActive?: boolean | undefined;
    orderIndex?: number | undefined;
    date?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    radiusMeters?: number | undefined;
    isClockInSite?: boolean | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    breakMinutes?: number | undefined;
    workingDays?: number[] | undefined;
    symbol?: string | undefined;
    decimalPlaces?: number | undefined;
  },
  actor: AuditActorContext,
): Promise<MasterRecordDTO> {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];

  return db.transaction(async (tx) => {
    const [record] = await tx
      .insert(table)
      .values({
        name: input.name,
        code: input.code,
        description: input.description,
        isActive: input.isActive ?? true,
        orderIndex: input.orderIndex ?? 0,
        ...(collection === "publicHolidays" && input.date ? { holidayDate: input.date } : {}),
        ...(collection === "locations"
          ? {
              latitude: input.latitude,
              longitude: input.longitude,
              radiusMeters: input.radiusMeters,
              isClockInSite: input.isClockInSite ?? false,
            }
          : {}),
        ...(collection === "workingTimes"
          ? {
              startTime: input.startTime ?? "08:00:00",
              endTime: input.endTime ?? "17:00:00",
              breakMinutes: input.breakMinutes ?? 60,
              workingDays: input.workingDays ?? [0, 1, 2, 3, 4],
            }
          : {}),
        ...(collection === "currencies"
          ? { symbol: input.symbol, decimalPlaces: input.decimalPlaces ?? 2 }
          : {}),
        organisationId: orgId,
        createdBy: actor.userId ?? orgId,
        updatedBy: actor.userId ?? orgId,
      } as any)
      .returning();

    if (!record) throw new Error("Failed to create master data record.");

    const dto = mapMasterRecordToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "create",
      module: "settings",
      entityType: collection,
      entityId: record.id,
      afterSummary: dto,
      riskLevel: "Medium",
    });

    return dto;
  });
}

export async function updateCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
  changes: {
    name?: string | undefined;
    code?: string | undefined;
    description?: string | undefined;
    isActive?: boolean | undefined;
    orderIndex?: number | undefined;
    date?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    radiusMeters?: number | undefined;
    isClockInSite?: boolean | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    breakMinutes?: number | undefined;
    workingDays?: number[] | undefined;
    symbol?: string | undefined;
    decimalPlaces?: number | undefined;
  },
  actor: AuditActorContext,
): Promise<MasterRecordDTO> {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)));

    if (!existing) throw new Error("Record not found.");

    const { date } = changes;
    const [record] = await tx
      .update(table)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.code !== undefined ? { code: changes.code } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
        ...(changes.orderIndex !== undefined ? { orderIndex: changes.orderIndex } : {}),
        ...(collection === "publicHolidays" && date ? { holidayDate: date } : {}),
        ...(collection === "locations"
          ? {
              ...(changes.latitude !== undefined ? { latitude: changes.latitude } : {}),
              ...(changes.longitude !== undefined ? { longitude: changes.longitude } : {}),
              ...(changes.radiusMeters !== undefined ? { radiusMeters: changes.radiusMeters } : {}),
              ...(changes.isClockInSite !== undefined
                ? { isClockInSite: changes.isClockInSite }
                : {}),
            }
          : {}),
        ...(collection === "workingTimes"
          ? {
              ...(changes.startTime !== undefined ? { startTime: changes.startTime } : {}),
              ...(changes.endTime !== undefined ? { endTime: changes.endTime } : {}),
              ...(changes.breakMinutes !== undefined ? { breakMinutes: changes.breakMinutes } : {}),
              ...(changes.workingDays !== undefined ? { workingDays: changes.workingDays } : {}),
            }
          : {}),
        ...(collection === "currencies"
          ? {
              ...(changes.symbol !== undefined ? { symbol: changes.symbol } : {}),
              ...(changes.decimalPlaces !== undefined
                ? { decimalPlaces: changes.decimalPlaces }
                : {}),
            }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${table.recordVersion} + 1`,
      } as any)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
      .returning();

    if (!record) throw new Error("Failed to update master data record.");

    const dto = mapMasterRecordToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update",
      module: "settings",
      entityType: collection,
      entityId: record.id,
      beforeSummary: mapMasterRecordToDTO(existing),
      afterSummary: dto,
      riskLevel: "Medium",
    });

    return dto;
  });
}

export async function archiveCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
  actor: AuditActorContext,
): Promise<MasterRecordDTO> {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)));

    if (!existing) throw new Error("Record not found.");

    const [record] = await tx
      .update(table)
      .set({
        archivedAt: new Date(),
        isActive: false,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${table.recordVersion} + 1`,
      } as any)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
      .returning();

    if (!record) throw new Error("Failed to archive master data record.");

    const dto = mapMasterRecordToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "archive",
      module: "settings",
      entityType: collection,
      entityId: record.id,
      beforeSummary: mapMasterRecordToDTO(existing),
      afterSummary: dto,
      riskLevel: "High",
    });

    return dto;
  });
}

export async function restoreCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
  actor: AuditActorContext,
): Promise<MasterRecordDTO> {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)));

    if (!existing) throw new Error("Record not found.");

    const [record] = await tx
      .update(table)
      .set({
        archivedAt: null,
        isActive: true,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${table.recordVersion} + 1`,
      } as any)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
      .returning();

    if (!record) throw new Error("Failed to restore master data record.");

    const dto = mapMasterRecordToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "restore",
      module: "settings",
      entityType: collection,
      entityId: record.id,
      beforeSummary: mapMasterRecordToDTO(existing),
      afterSummary: dto,
      riskLevel: "Medium",
    });

    return dto;
  });
}

export async function listProjects(orgId: string, includeArchived = false): Promise<ProjectDTO[]> {
  const db = getDatabaseClient();
  const table = schema.projects;
  const whereClause = includeArchived
    ? eq(table.organisationId, orgId)
    : and(eq(table.organisationId, orgId), isNull(table.archivedAt));
  const rows = await db
    .select()
    .from(table)
    .where(whereClause)
    .orderBy(asc(table.orderIndex), asc(table.name));
  return rows.map(mapProjectToDTO);
}

export async function getProjectById(orgId: string, id: string): Promise<ProjectDTO | null> {
  const db = getDatabaseClient();
  const table = schema.projects;
  const [record] = await db
    .select()
    .from(table)
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)));
  return record ? mapProjectToDTO(record) : null;
}

export async function createProject(
  orgId: string,
  input: {
    name: string;
    code?: string | undefined;
    description?: string | undefined;
    client?: string | undefined;
    type?: string | undefined;
    startDate: string;
    endDate?: string | undefined;
    costCentreId?: string | undefined;
    managerId?: string | undefined;
    locationId?: string | undefined;
    status?: "Draft" | "Active" | "On Hold" | "Completed" | "Archived" | undefined;
    orderIndex?: number | undefined;
    isActive?: boolean | undefined;
  },
  actor: AuditActorContext,
): Promise<ProjectDTO> {
  const db = getDatabaseClient();
  const table = schema.projects;

  return db.transaction(async (tx) => {
    const [record] = await tx
      .insert(table)
      .values({
        name: input.name,
        code: input.code,
        description: input.description,
        client: input.client,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        costCentreId: input.costCentreId,
        managerId: input.managerId,
        locationId: input.locationId,
        status: input.status ?? "Draft",
        isActive: input.isActive ?? true,
        orderIndex: input.orderIndex ?? 0,
        organisationId: orgId,
        createdBy: actor.userId ?? orgId,
        updatedBy: actor.userId ?? orgId,
      } as any)
      .returning();

    if (!record) throw new Error("Failed to create project.");

    const dto = mapProjectToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "create",
      module: "settings",
      entityType: "project",
      entityId: record.id,
      afterSummary: dto,
      riskLevel: "Medium",
    });

    return dto;
  });
}

export async function updateProject(
  orgId: string,
  id: string,
  changes: {
    name?: string | undefined;
    code?: string | undefined;
    description?: string | undefined;
    client?: string | undefined;
    type?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    costCentreId?: string | undefined;
    managerId?: string | undefined;
    locationId?: string | undefined;
    status?: "Draft" | "Active" | "On Hold" | "Completed" | "Archived" | undefined;
    orderIndex?: number | undefined;
    isActive?: boolean | undefined;
  },
  actor: AuditActorContext,
): Promise<ProjectDTO> {
  const db = getDatabaseClient();
  const table = schema.projects;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)));

    if (!existing) throw new Error("Project not found.");

    const [record] = await tx
      .update(table)
      .set({
        ...changes,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${table.recordVersion} + 1`,
      } as any)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
      .returning();

    if (!record) throw new Error("Failed to update project.");

    const dto = mapProjectToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update",
      module: "settings",
      entityType: "project",
      entityId: record.id,
      beforeSummary: mapProjectToDTO(existing),
      afterSummary: dto,
      riskLevel: "Medium",
    });

    return dto;
  });
}

export async function archiveProject(
  orgId: string,
  id: string,
  actor: AuditActorContext,
): Promise<ProjectDTO> {
  const db = getDatabaseClient();
  const table = schema.projects;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)));

    if (!existing) throw new Error("Project not found.");

    const [record] = await tx
      .update(table)
      .set({
        archivedAt: new Date(),
        isActive: false,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${table.recordVersion} + 1`,
      } as any)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
      .returning();

    if (!record) throw new Error("Failed to archive project.");

    const dto = mapProjectToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "archive",
      module: "settings",
      entityType: "project",
      entityId: record.id,
      beforeSummary: mapProjectToDTO(existing),
      afterSummary: dto,
      riskLevel: "High",
    });

    return dto;
  });
}

export async function restoreProject(
  orgId: string,
  id: string,
  actor: AuditActorContext,
): Promise<ProjectDTO> {
  const db = getDatabaseClient();
  const table = schema.projects;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)));

    if (!existing) throw new Error("Project not found.");

    const [record] = await tx
      .update(table)
      .set({
        archivedAt: null,
        isActive: true,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${table.recordVersion} + 1`,
      } as any)
      .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
      .returning();

    if (!record) throw new Error("Failed to restore project.");

    const dto = mapProjectToDTO(record);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "restore",
      module: "settings",
      entityType: "project",
      entityId: record.id,
      beforeSummary: mapProjectToDTO(existing),
      afterSummary: dto,
      riskLevel: "Medium",
    });

    return dto;
  });
}

export async function countActiveEmployeesForMasterRecord(
  orgId: string,
  collection: MasterDataCollection,
  recordId: string,
): Promise<number> {
  const db = getDatabaseClient();
  let fkCol;
  switch (collection) {
    case "departments":
      fkCol = employees.departmentId;
      break;
    case "positions":
      fkCol = employees.positionId;
      break;
    case "locations":
      fkCol = employees.locationId;
      break;
    case "grades":
      fkCol = employees.gradeId;
      break;
    case "employmentTypes":
      fkCol = employees.employmentTypeId;
      break;
    case "costCentres":
      fkCol = employees.costCentreId;
      break;
    default:
      return 0;
  }

  const [result] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, orgId),
        eq(fkCol, recordId),
        notInArray(employees.status, ["Inactive", "Archived"]),
      ),
    );
  return result?.count ?? 0;
}

export async function countActiveProjectsForCostCentre(
  orgId: string,
  costCentreId: string,
): Promise<number> {
  const db = getDatabaseClient();
  const [result] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.organisationId, orgId),
        eq(schema.projects.costCentreId, costCentreId),
        isNull(schema.projects.archivedAt),
      ),
    );
  return result?.count ?? 0;
}

export async function countActiveEmployeesForProject(
  orgId: string,
  projectId: string,
): Promise<number> {
  const db = getDatabaseClient();
  const [result] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, orgId),
        eq(employees.projectId, projectId),
        notInArray(employees.status, ["Inactive", "Archived"]),
      ),
    );
  return result?.count ?? 0;
}
