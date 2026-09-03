import { getApplicationDataServices } from "./application-data.ts";
import type { ActorContext } from "./types.ts";

export async function trainingServerActor(context: ActorContext) {
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

export function trainingDatabaseId(collection: string, id: string) {
  const record = getApplicationDataServices()
    .storage.readCollection<{ id: string; databaseId?: string }>(collection)
    .find((item) => item.id === id || item.databaseId === id);
  const value = record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
  if (!value) throw new Error("This training record is not connected to PostgreSQL yet.");
  return value;
}

export function trainingMasterDataId(collection: string, value: string) {
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

export async function hydrateTrainingCache(context: ActorContext) {
  if (typeof window === "undefined") return;
  const { storage } = getApplicationDataServices();
  const employeeMap = new Map(
    storage
      .readCollection<{ id: string; databaseId?: string }>("employees")
      .filter((item) => item.databaseId)
      .map((item) => [item.databaseId!, item.id]),
  );
  const localMasterId = (collection: string, id: string) =>
    storage
      .readCollection<{ id: string; databaseId?: string }>(collection)
      .find((item) => item.databaseId === id)?.id ?? id;
  const { getTrainingSnapshotFn } = await import("../server-functions/training.server.ts");
  const snapshot = await getTrainingSnapshotFn({
    data: { actor: await trainingServerActor(context) },
  });
  storage.writeCollection(
    "training_courses",
    snapshot.courses.map((item) => ({
      ...item,
      requiredLocations: item.requiredLocations.map((id) => localMasterId("locations", id)),
      requiredProjects: item.requiredProjects.map((id) => localMasterId("projects", id)),
    })),
  );
  storage.writeCollection(
    "training_requests",
    snapshot.requests.map((item) => ({
      ...item,
      employeeId: employeeMap.get(item.employeeId) ?? item.employeeId,
    })),
  );
  storage.writeCollection("training_sessions", snapshot.sessions);
  storage.writeCollection(
    "training_enrollments",
    snapshot.enrollments.map((item) => ({
      ...item,
      employeeId: employeeMap.get(item.employeeId) ?? item.employeeId,
    })),
  );
  storage.writeCollection(
    "training_records",
    snapshot.records.map((item) => ({
      ...item,
      employeeId: employeeMap.get(item.employeeId) ?? item.employeeId,
    })),
  );
}
