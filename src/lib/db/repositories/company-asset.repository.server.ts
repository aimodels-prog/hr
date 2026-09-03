import "@tanstack/react-start/server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { AssetAssignment, AssetCondition, AssetType } from "../../data/asset-types.ts";
import { getDatabaseClient } from "../client.ts";
import { assetAssignments, companyAssets } from "../schema/documents.ts";
import { employees } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const assetTypes = new Set<AssetType>([
  "Laptop",
  "Desktop",
  "Monitor",
  "Phone",
  "SIM Card",
  "Access Card",
  "Vehicle",
  "Other",
]);
const conditions = new Set<AssetCondition>(["New", "Good", "Fair", "Damaged"]);

function requireManager(actor: AuditActorContext) {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage company equipment.");
  }
}

export async function listCompanyAssetAssignmentsForActor(
  organisationId: string,
  actor: AuditActorContext,
): Promise<AssetAssignment[]> {
  const rows = await getDatabaseClient()
    .select({
      assignment: assetAssignments,
      asset: companyAssets,
      managerId: employees.lineManagerId,
    })
    .from(assetAssignments)
    .innerJoin(companyAssets, eq(assetAssignments.assetId, companyAssets.id))
    .innerJoin(employees, eq(assetAssignments.employeeId, employees.id))
    .where(
      and(eq(assetAssignments.organisationId, organisationId), isNull(assetAssignments.archivedAt)),
    )
    .orderBy(asc(assetAssignments.assignedDate));
  return rows
    .filter(
      ({ assignment, managerId }) =>
        actor.activeRole === "HR" ||
        actor.activeRole === "Super Admin" ||
        assignment.employeeId === actor.employeeId ||
        (actor.activeRole === "Line Manager" && managerId === actor.employeeId),
    )
    .map(({ assignment, asset }) => ({
      id: assignment.id,
      createdAt: assignment.createdAt.toISOString(),
      createdBy: assignment.createdBy,
      updatedAt: assignment.updatedAt.toISOString(),
      updatedBy: assignment.updatedBy,
      ...(assignment.archivedAt ? { archivedAt: assignment.archivedAt.toISOString() } : {}),
      recordVersion: assignment.recordVersion,
      employeeId: assignment.employeeId,
      assetType: asset.assetType as AssetType,
      assetTag: asset.assetTag,
      description: asset.description,
      assignedDate: assignment.assignedDate,
      conditionAtAssignment: assignment.conditionAtAssignment,
      status: assignment.status,
      ...(assignment.returnedDate ? { returnedDate: assignment.returnedDate } : {}),
      ...(assignment.returnCondition ? { returnCondition: assignment.returnCondition } : {}),
      ...(assignment.notes ? { notes: assignment.notes } : {}),
    }));
}

export async function assignCompanyAssetInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    assetType: AssetType;
    assetTag: string;
    description: string;
    assignedDate: string;
    conditionAtAssignment: AssetCondition;
    notes?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  requireManager(actor);
  if (!assetTypes.has(input.assetType) || !conditions.has(input.conditionAtAssignment))
    throw new Error("Select a valid equipment type and condition.");
  if (input.assetTag.trim().length < 2 || input.description.trim().length < 3)
    throw new Error("Asset tag and description are required.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.id, input.employeeId),
          isNull(employees.archivedAt),
        ),
      )
      .limit(1);
    if (!employee) throw new Error("Employee not found.");
    const [existing] = await tx
      .select({ id: companyAssets.id })
      .from(companyAssets)
      .where(
        and(
          eq(companyAssets.organisationId, organisationId),
          eq(companyAssets.assetTag, input.assetTag.trim()),
        ),
      )
      .limit(1);
    if (existing) throw new Error("This asset tag is already registered.");
    const [asset] = await tx
      .insert(companyAssets)
      .values({
        organisationId,
        assetType: input.assetType,
        assetTag: input.assetTag.trim(),
        description: input.description.trim(),
        currentCondition: input.conditionAtAssignment,
        status: "Assigned",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof companyAssets.$inferInsert)
      .returning({ id: companyAssets.id });
    const [assignment] = await tx
      .insert(assetAssignments)
      .values({
        organisationId,
        assetId: asset!.id,
        employeeId: input.employeeId,
        assignedDate: input.assignedDate,
        conditionAtAssignment: input.conditionAtAssignment,
        status: "Assigned",
        ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
        createdBy: actor.userId,
        updatedBy: actor.userId,
      } as typeof assetAssignments.$inferInsert)
      .returning({ id: assetAssignments.id });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "assign",
      module: "core-hr",
      entityType: "company-asset",
      entityId: asset!.id,
      afterSummary: {
        assignmentId: assignment!.id,
        employeeId: input.employeeId,
        assetType: input.assetType,
        assetTag: input.assetTag.trim(),
      },
      reason: "Assigned company equipment",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return assignment!.id;
  });
}

export async function closeCompanyAssetAssignmentInDatabase(
  organisationId: string,
  assignmentId: string,
  outcome: "Returned" | "Lost" | "Damaged",
  condition: AssetCondition | undefined,
  notes: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  requireManager(actor);
  if (outcome === "Returned" && (!condition || !conditions.has(condition)))
    throw new Error("Record the equipment's return condition.");
  if (outcome !== "Returned" && (notes?.trim().length ?? 0) < 3)
    throw new Error("Describe the loss or damage.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(assetAssignments)
      .where(
        and(
          eq(assetAssignments.organisationId, organisationId),
          eq(assetAssignments.id, assignmentId),
        ),
      )
      .for("update")
      .limit(1);
    if (!assignment || assignment.status !== "Assigned")
      throw new Error("Only assigned equipment can be closed.");
    const today = new Date().toISOString().slice(0, 10);
    await tx
      .update(assetAssignments)
      .set({
        status: outcome,
        returnedDate: outcome === "Returned" ? today : null,
        returnCondition: outcome === "Returned" ? condition! : null,
        notes: notes?.trim() || assignment.notes,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${assetAssignments.recordVersion} + 1`,
      })
      .where(eq(assetAssignments.id, assignmentId));
    await tx
      .update(companyAssets)
      .set({
        status: outcome === "Returned" ? "Available" : outcome,
        currentCondition:
          outcome === "Returned"
            ? condition!
            : outcome === "Damaged"
              ? "Damaged"
              : assignment.conditionAtAssignment,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${companyAssets.recordVersion} + 1`,
      })
      .where(eq(companyAssets.id, assignment.assetId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: outcome.toLowerCase(),
      module: "core-hr",
      entityType: "company-asset",
      entityId: assignment.assetId,
      afterSummary: { assignmentId, employeeId: assignment.employeeId, outcome, condition },
      reason: notes?.trim() || `Equipment ${outcome.toLowerCase()}`,
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}
