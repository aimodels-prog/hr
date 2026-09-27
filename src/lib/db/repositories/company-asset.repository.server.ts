import "@tanstack/react-start/server-only";

import { and, asc, desc, eq, isNull, ne, notExists, sql } from "drizzle-orm";

import type {
  AssetAssignment,
  AssetCondition,
  AssetType,
  AvailableCompanyAsset,
} from "../../data/asset-types.ts";
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
  if (!actor.userId) throw new Error("Sign in first.");
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage company equipment.");
  }
}

export async function listAvailableCompanyAssets(
  organisationId: string,
  actor: AuditActorContext,
): Promise<AvailableCompanyAsset[]> {
  requireManager(actor);
  const db = getDatabaseClient();
  const rows = await db
    .select({
      id: companyAssets.id,
      recordVersion: companyAssets.recordVersion,
      assetType: companyAssets.assetType,
      assetTag: companyAssets.assetTag,
      description: companyAssets.description,
      currentCondition: companyAssets.currentCondition,
      // Keep the outer-table qualifier: single-table projections otherwise strip Drizzle's column qualifier.
      lastReturnedDate: sql<string | null>`(SELECT max(returned_date)::text FROM asset_assignments
      WHERE asset_id = "company_assets"."id" AND organisation_id = ${organisationId} AND status = 'Returned')`,
    })
    .from(companyAssets)
    .where(
      and(
        eq(companyAssets.organisationId, organisationId),
        isNull(companyAssets.archivedAt),
        eq(companyAssets.status, "Available"),
        ne(companyAssets.currentCondition, "Damaged"),
        notExists(
          db
            .select({ id: assetAssignments.id })
            .from(assetAssignments)
            .where(
              and(
                eq(assetAssignments.assetId, companyAssets.id),
                eq(assetAssignments.status, "Assigned"),
                isNull(assetAssignments.archivedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(companyAssets.assetTag));
  return rows.map((row) => ({ ...row, assetType: row.assetType as AssetType }));
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
    .innerJoin(
      companyAssets,
      and(
        eq(assetAssignments.assetId, companyAssets.id),
        eq(companyAssets.organisationId, organisationId),
      ),
    )
    .innerJoin(
      employees,
      and(
        eq(assetAssignments.employeeId, employees.id),
        eq(employees.organisationId, organisationId),
      ),
    )
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
      assetId: asset.id,
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
    assignedDate: string;
    notes?: string;
  } & (
    | { assetId: string; expectedVersion: number }
    | {
        assetType: AssetType;
        assetTag: string;
        description: string;
        conditionAtAssignment: AssetCondition;
      }
  ),
  actor: AuditActorContext,
): Promise<string> {
  requireManager(actor);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.assignedDate) ||
    !Number.isFinite(Date.parse(input.assignedDate)) ||
    new Date(input.assignedDate).toISOString().slice(0, 10) !== input.assignedDate
  )
    throw new Error("Choose a valid assignment date.");
  if (!("assetId" in input)) {
    if (!assetTypes.has(input.assetType) || !conditions.has(input.conditionAtAssignment))
      throw new Error("Select a valid equipment type and condition.");
    if (input.conditionAtAssignment === "Damaged")
      throw new Error("Damaged equipment cannot be assigned.");
    if (input.assetTag.trim().length < 2 || input.description.trim().length < 3)
      throw new Error("Asset tag and description are required.");
  }
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id, status: employees.status })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.id, input.employeeId),
          isNull(employees.archivedAt),
        ),
      )
      .limit(1);
    if (!employee || employee.status === "Inactive" || employee.status === "Archived")
      throw new Error("Choose a current employee in your organisation.");
    let asset: typeof companyAssets.$inferSelect;
    if ("assetId" in input) {
      const [existing] = await tx
        .select()
        .from(companyAssets)
        .where(
          and(
            eq(companyAssets.organisationId, organisationId),
            eq(companyAssets.id, input.assetId),
            isNull(companyAssets.archivedAt),
          ),
        )
        .for("update");
      if (!existing) throw new Error("Equipment was not found in your organisation.");
      if (existing.recordVersion !== input.expectedVersion)
        throw new Error(
          "This equipment has changed. Refresh available equipment and select it again.",
        );
      if (existing.status !== "Available" || existing.currentCondition === "Damaged")
        throw new Error("Only available, undamaged equipment can be assigned.");
      const [current] = await tx
        .select({ id: assetAssignments.id })
        .from(assetAssignments)
        .where(
          and(
            eq(assetAssignments.assetId, existing.id),
            eq(assetAssignments.status, "Assigned"),
            isNull(assetAssignments.archivedAt),
          ),
        )
        .limit(1);
      if (current) throw new Error("This equipment is already assigned. Record its return first.");
      const [lastReturn] = await tx
        .select({ date: assetAssignments.returnedDate })
        .from(assetAssignments)
        .where(
          and(
            eq(assetAssignments.organisationId, organisationId),
            eq(assetAssignments.assetId, existing.id),
            eq(assetAssignments.status, "Returned"),
          ),
        )
        .orderBy(desc(assetAssignments.returnedDate))
        .limit(1);
      if (lastReturn?.date && input.assignedDate < lastReturn.date)
        throw new Error("The assignment date cannot be before the equipment's latest return.");
      if (input.assignedDate > new Date().toISOString().slice(0, 10))
        throw new Error("Assign available equipment on the handover date, not a future date.");
      const [updated] = await tx
        .update(companyAssets)
        .set({
          status: "Assigned",
          updatedAt: new Date(),
          updatedBy: actor.userId!,
          recordVersion: sql`${companyAssets.recordVersion} + 1`,
        })
        .where(eq(companyAssets.id, existing.id))
        .returning();
      asset = updated!;
    } else {
      const [created] = await tx
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
        .onConflictDoNothing()
        .returning();
      if (!created)
        throw new Error(
          "This asset tag is already registered. Select it from available equipment after its return.",
        );
      asset = created;
    }
    const [assignment] = await tx
      .insert(assetAssignments)
      .values({
        organisationId,
        assetId: asset!.id,
        employeeId: input.employeeId,
        assignedDate: input.assignedDate,
        conditionAtAssignment: asset.currentCondition,
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
        assetType: asset.assetType,
        assetTag: asset.assetTag,
        reusedExistingAsset: "assetId" in input,
        assignedDate: input.assignedDate,
        conditionAtAssignment: asset.currentCondition,
      },
      reason:
        "assetId" in input
          ? "Assigned available company equipment; previous handovers retained"
          : "Assigned new company equipment",
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
    if (!assignment || assignment.archivedAt || assignment.status !== "Assigned")
      throw new Error("Only assigned equipment can be closed.");
    const [asset] = await tx
      .select()
      .from(companyAssets)
      .where(
        and(
          eq(companyAssets.id, assignment.assetId),
          eq(companyAssets.organisationId, organisationId),
          isNull(companyAssets.archivedAt),
        ),
      )
      .for("update");
    if (!asset || asset.status !== "Assigned")
      throw new Error("Equipment is no longer assigned. Refresh and try again.");
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
        status:
          outcome === "Returned" ? (condition === "Damaged" ? "Damaged" : "Available") : outcome,
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
