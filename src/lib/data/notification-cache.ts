import { getApplicationDataServices } from "./application-data.ts";
import type { ActorContext, Notification } from "./types.ts";

export async function notificationServerActor(context: ActorContext) {
  const users = getApplicationDataServices().storage.readCollection<{
    id: string;
    databaseId?: string;
    workspaceEmail?: string;
  }>("users");
  const user = users.find(
    (item) => item.id === context.actor.userId || item.databaseId === context.actor.userId,
  );
  const actorEmail = context.actor.workspaceEmail ?? user?.workspaceEmail;
  return {
    actorId: context.actor.userId,
    ...(actorEmail ? { actorEmail } : {}),
    activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
  } as const;
}

export async function hydrateNotificationCache(context: ActorContext): Promise<Notification[]> {
  if (typeof window === "undefined") return [];
  const { storage } = getApplicationDataServices();
  const users = storage.readCollection<{ id: string; databaseId?: string }>("users");
  const localUserId = (id: string) => users.find((user) => user.databaseId === id)?.id ?? id;
  const { getMyNotificationsFn } = await import("../server-functions/notification.server.ts");
  const rows = await getMyNotificationsFn({
    data: { actor: await notificationServerActor(context) },
  });
  const records: Notification[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    recordVersion: row.recordVersion,
    recipientUserId: localUserId(row.recipientUserId),
    type: row.type,
    title: row.title,
    message: row.message,
    priority: row.priority,
    status: row.status,
    ...(row.dueAt ? { dueAt: row.dueAt } : {}),
    ...(row.readAt ? { readAt: row.readAt } : {}),
    ...(row.dismissedAt ? { dismissedAt: row.dismissedAt } : {}),
    ...(row.deduplicationKey ? { deduplicationKey: row.deduplicationKey } : {}),
    ...(row.link ? { link: row.link } : {}),
  }));
  storage.writeCollection("notifications", records);
  window.dispatchEvent(new CustomEvent("via_hr:notifications_changed"));
  return records;
}
