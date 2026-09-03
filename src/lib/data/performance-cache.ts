import type { ActorContext } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";

export async function performanceServerActor(context: ActorContext) {
  const users = getApplicationDataServices().storage.readCollection<{
    id: string;
    workspaceEmail?: string;
  }>("users");
  const actorEmail =
    context.actor.workspaceEmail ??
    users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
  return {
    actorId: context.actor.userId,
    ...(actorEmail ? { actorEmail } : {}),
    activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
  } as const;
}

export function performanceDatabaseId(collection: string, id: string) {
  const record = getApplicationDataServices()
    .storage.readCollection<{ id: string; databaseId?: string }>(collection)
    .find((item) => item.id === id || item.databaseId === id);
  const value = record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
  if (!value) {
    throw new Error(
      `The ${collection.replaceAll(/([A-Z])/g, " $1").toLowerCase()} record "${id}" is not connected to PostgreSQL yet.`,
    );
  }
  return value;
}

export function performanceMasterDataId(collection: string, value: string) {
  const normalized = value.trim().toLowerCase();
  const record = getApplicationDataServices()
    .storage.readCollection<{ id: string; databaseId?: string; name?: string; code?: string }>(
      collection,
    )
    .find(
      (item) =>
        item.id === value ||
        item.databaseId === value ||
        item.name?.trim().toLowerCase() === normalized ||
        item.code?.trim().toLowerCase() === normalized,
    );
  const id = record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(value) ? value : undefined);
  if (!id) throw new Error(`Select a valid ${collection.replaceAll("_", " ")} value.`);
  return id;
}

export async function hydratePerformanceCache(context: ActorContext) {
  if (typeof window === "undefined") return;
  const { storage } = getApplicationDataServices();
  const employeeMap = new Map(
    storage
      .readCollection<{ id: string; databaseId?: string }>("employees")
      .filter((item) => item.databaseId)
      .map((item) => [item.databaseId!, item.id]),
  );
  const masterName = (collection: string, id: string) =>
    storage
      .readCollection<{ databaseId?: string; name?: string }>(collection)
      .find((item) => item.databaseId === id)?.name ?? id;
  const { getPerformanceSnapshotFn } = await import("../server-functions/performance.server.ts");
  const snapshot = await getPerformanceSnapshotFn({
    data: { actor: await performanceServerActor(context) },
  });
  storage.writeCollection("performanceTemplates", snapshot.templates);
  storage.writeCollection(
    "performanceCycles",
    snapshot.cycles.map((item) => ({
      ...item,
      departments: item.departments.map((id) => masterName("departments", id)),
      employmentTypes: item.employmentTypes.map((id) => masterName("employmentTypes", id)),
    })),
  );
  storage.writeCollection(
    "performanceReviews",
    snapshot.reviews.map((item) => ({
      ...item,
      employeeId: employeeMap.get(item.employeeId) ?? item.employeeId,
    })),
  );
  storage.writeCollection(
    "employeeGoals",
    snapshot.goals.map((item) => ({
      ...item,
      employeeId: employeeMap.get(item.employeeId) ?? item.employeeId,
    })),
  );
}
