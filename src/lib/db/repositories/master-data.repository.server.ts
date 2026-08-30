import "@tanstack/react-start/server-only";

import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import * as schema from "../schema/master-data.ts";
import { organisations } from "../schema/organisation.ts";
import type { MasterDataCollection } from "../../data/master-data.ts";

const TABLE_MAP = {
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

export async function resolveDefaultOrganisationId(): Promise<string> {
  const db = getDatabaseClient();
  const [org] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isActive, true))
    .limit(1);
  if (!org) throw new Error("No active organisation found");
  return org.id;
}

export async function listCollection(
  orgId: string,
  collection: MasterDataCollection,
  includeArchived: boolean,
) {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];

  const whereClause = includeArchived
    ? eq(table.organisationId, orgId)
    : and(eq(table.organisationId, orgId), isNull(table.archivedAt));

  return db.select().from(table).where(whereClause).orderBy(asc(table.orderIndex), asc(table.name));
}

export async function getCollectionRecordById(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
) {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];
  const [record] = await db
    .select()
    .from(table)
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)));
  return record;
}

export async function createCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  input: any,
  actorId: string,
) {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];
  const [record] = await db
    .insert(table)
    .values({
      ...input,
      organisationId: orgId,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();
  return record;
}

export async function updateCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
  changes: any,
  actorId: string,
) {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];
  const [record] = await db
    .update(table)
    .set({
      ...changes,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
      recordVersion: sql`${table.recordVersion} + 1`,
    })
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
    .returning();
  return record;
}

export async function archiveCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
  actorId: string,
) {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];
  const [record] = await db
    .update(table)
    .set({
      archivedAt: new Date().toISOString(),
      isActive: false,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
      recordVersion: sql`${table.recordVersion} + 1`,
    } as any)
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
    .returning();
  return record;
}

export async function restoreCollectionRecord(
  orgId: string,
  collection: MasterDataCollection,
  id: string,
  actorId: string,
) {
  const db = getDatabaseClient();
  const table = TABLE_MAP[collection];
  const [record] = await db
    .update(table)
    .set({
      archivedAt: null,
      isActive: true,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
      recordVersion: sql`${table.recordVersion} + 1`,
    } as any)
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
    .returning();
  return record;
}

export async function listProjects(orgId: string, includeArchived: boolean) {
  const db = getDatabaseClient();
  const table = schema.projects;
  const whereClause = includeArchived
    ? eq(table.organisationId, orgId)
    : and(eq(table.organisationId, orgId), isNull(table.archivedAt));
  return db.select().from(table).where(whereClause).orderBy(asc(table.orderIndex), asc(table.name));
}

export async function getProjectById(orgId: string, id: string) {
  const db = getDatabaseClient();
  const table = schema.projects;
  const [record] = await db
    .select()
    .from(table)
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)));
  return record;
}

export async function createProject(orgId: string, input: any, actorId: string) {
  const db = getDatabaseClient();
  const table = schema.projects;
  const [record] = await db
    .insert(table)
    .values({
      ...input,
      organisationId: orgId,
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning();
  return record;
}

export async function updateProject(orgId: string, id: string, changes: any, actorId: string) {
  const db = getDatabaseClient();
  const table = schema.projects;
  const [record] = await db
    .update(table)
    .set({
      ...changes,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
      recordVersion: sql`${table.recordVersion} + 1`,
    })
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
    .returning();
  return record;
}

export async function archiveProject(orgId: string, id: string, actorId: string) {
  const db = getDatabaseClient();
  const table = schema.projects;
  const [record] = await db
    .update(table)
    .set({
      archivedAt: new Date().toISOString(),
      isActive: false,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
      recordVersion: sql`${table.recordVersion} + 1`,
    })
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
    .returning();
  return record;
}

export async function restoreProject(orgId: string, id: string, actorId: string) {
  const db = getDatabaseClient();
  const table = schema.projects;
  const [record] = await db
    .update(table)
    .set({
      archivedAt: null,
      isActive: true,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
      recordVersion: sql`${table.recordVersion} + 1`,
    })
    .where(and(eq(table.organisationId, orgId), eq(table.id, id)))
    .returning();
  return record;
}

export async function countActiveEmployeesForMasterRecord(
  orgId: string,
  collection: MasterDataCollection,
  recordId: string,
) {
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

export async function countActiveProjectsForCostCentre(orgId: string, costCentreId: string) {
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

export async function countActiveEmployeesForProject(orgId: string, projectId: string) {
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
