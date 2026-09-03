import { LocalRepository, type NewRecord } from "./repository.ts";
import type { AssetAssignment, AssetCondition } from "./asset-types.ts";
import type { ActorContext } from "./types.ts";
import type { Employee, User } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";

export class AssetService {
  private repo: LocalRepository<AssetAssignment>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.repo = new LocalRepository<AssetAssignment>("assetAssignments", storage, audit, {
      module: "hr",
      entityType: "asset-assignment",
    });
  }

  private async serverActor(context: ActorContext) {
    const users = getApplicationDataServices().storage.readCollection<User>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    } as const;
  }

  async hydrateCompatibilityCache(context: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const { getCompanyAssetAssignmentsFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    const assignments = await getCompanyAssetAssignmentsFn({
      data: { actor: await this.serverActor(context) },
    });
    const { storage } = getApplicationDataServices();
    const employees = storage.readCollection<Employee & { databaseId?: string }>("employees");
    const employeeIdMap = new Map(
      employees.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    storage.writeCollection(
      "assetAssignments",
      assignments.map((assignment) => ({
        ...assignment,
        employeeId: employeeIdMap.get(assignment.employeeId) ?? assignment.employeeId,
      })),
    );
  }

  async assignAssetAsync(
    data: Omit<NewRecord<AssetAssignment>, "status">,
    context: ActorContext,
  ): Promise<AssetAssignment> {
    const { storage } = getApplicationDataServices();
    const employee = storage
      .readCollection<Employee & { databaseId?: string }>("employees")
      .find((item) => item.id === data.employeeId);
    if (!data.assetTag?.trim()) throw new Error("An asset tag or serial number is required.");
    const { assignCompanyAssetFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    const id = await assignCompanyAssetFn({
      data: {
        actor: await this.serverActor(context),
        employeeId: employee?.databaseId ?? data.employeeId,
        assetType: data.assetType,
        assetTag: data.assetTag,
        description: data.description,
        assignedDate: data.assignedDate,
        conditionAtAssignment: data.conditionAtAssignment,
        ...(data.notes ? { notes: data.notes } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
    const created = this.repo.getById(id);
    if (!created) throw new Error("Equipment was assigned but could not be reloaded.");
    return created;
  }

  async closeAssignmentAsync(
    id: string,
    outcome: "Returned" | "Lost" | "Damaged",
    returnCondition: AssetCondition | undefined,
    notes: string | undefined,
    context: ActorContext,
  ): Promise<void> {
    const { closeCompanyAssetAssignmentFn } =
      await import("../server-functions/core-hr-lifecycle.server.ts");
    await closeCompanyAssetAssignmentFn({
      data: {
        actor: await this.serverActor(context),
        assignmentId: id,
        outcome,
        ...(returnCondition ? { condition: returnCondition } : {}),
        ...(notes ? { notes } : {}),
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  getAllAssignments(): AssetAssignment[] {
    return this.repo.list();
  }

  getAssignmentsForEmployee(employeeId: string): AssetAssignment[] {
    return this.repo.list().filter((a) => a.employeeId === employeeId);
  }

  private assertCanManage(context: ActorContext, entityId: string): void {
    if (["HR", "Super Admin"].includes(context.actor.activeRole || "")) return;
    getApplicationDataServices().audit.record({
      context,
      action: "access-denied",
      module: "equipment",
      entityType: "asset-assignment",
      entityId,
      reason: "Attempted to manage employee equipment without HR or Super Admin access",
      riskLevel: "High",
    });
    throw new Error("Only HR or a Super Admin can manage employee equipment.");
  }

  assignAsset(
    data: Omit<NewRecord<AssetAssignment>, "status">,
    context: ActorContext,
  ): AssetAssignment {
    this.assertCanManage(context, data.employeeId);
    return this.repo.create({ ...data, status: "Assigned" }, context);
  }

  returnAsset(
    id: string,
    returnCondition: AssetCondition,
    notes: string | undefined,
    context: ActorContext,
  ): AssetAssignment {
    this.assertCanManage(context, id);
    const asset = this.repo.getById(id);
    if (!asset) throw new Error("Asset assignment not found");
    if (asset.status !== "Assigned")
      throw new Error("Only currently-assigned assets can be returned.");

    return this.repo.update(
      id,
      {
        status: "Returned",
        returnedDate: new Date().toISOString().split("T")[0]!,
        returnCondition,
        ...(notes !== undefined ? { notes } : {}),
      },
      context,
    );
  }

  reportLostOrDamaged(
    id: string,
    status: "Lost" | "Damaged",
    notes: string,
    context: ActorContext,
  ): AssetAssignment {
    this.assertCanManage(context, id);
    const asset = this.repo.getById(id);
    if (!asset) throw new Error("Asset assignment not found");
    if (!notes || notes.trim().length < 3)
      throw new Error("A description of the incident is required.");

    return this.repo.update(id, { status, notes }, context);
  }
}
