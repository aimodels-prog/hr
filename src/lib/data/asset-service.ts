import { LocalRepository, type NewRecord } from "./repository.ts";
import type { AssetAssignment, AssetCondition } from "./asset-types.ts";
import type { ActorContext } from "./types.ts";
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
