import "@tanstack/react-start/server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export async function setNotificationStatusInDatabase(
  org: string,
  notificationId: string,
  status: "Unread" | "Read" | "Dismissed",
  actor: AuditActorContext,
  expectedVersion?: number,
): Promise<void> {
  if (!actor.userId) throw new Error("A verified user is required.");
  const actorUserId = actor.userId;
  const db = getDatabaseClient();
  const [ownership] = await db
    .select({ id: notifications.id, recipientUserId: notifications.recipientUserId })
    .from(notifications)
    .where(and(eq(notifications.organisationId, org), eq(notifications.id, notificationId)))
    .limit(1);
  if (!ownership) throw new Error("Notification not found.");
  if (ownership.recipientUserId !== actorUserId) {
    await db.insert(auditEvents).values({
      organisationId: org,
      actorUserId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "access-denied",
      module: "notifications",
      entityType: "notification",
      entityId: notificationId,
      reason: "Attempted to update another user's notification",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    throw new Error("You can only update your own notifications.");
  }
  await db.transaction(async (tx) => {
    const [notice] = await tx
      .select({
        id: notifications.id,
        recipientUserId: notifications.recipientUserId,
        status: notifications.status,
        recordVersion: notifications.recordVersion,
      })
      .from(notifications)
      .where(and(eq(notifications.organisationId, org), eq(notifications.id, notificationId)))
      .for("update")
      .limit(1);
    if (!notice) throw new Error("Notification not found.");
    if (notice.recipientUserId !== actorUserId)
      throw new Error("You can only update your own notifications.");
    if (expectedVersion !== undefined && notice.recordVersion !== expectedVersion)
      throw new Error("This notification changed after you opened it. Refresh and try again.");
    if (notice.status === status) return;
    await tx
      .update(notifications)
      .set({
        status,
        readAt: status === "Read" ? new Date().toISOString() : null,
        dismissedAt: status === "Dismissed" ? new Date().toISOString() : null,
        updatedAt: new Date(),
        updatedBy: actorUserId,
        recordVersion: sql`${notifications.recordVersion} + 1`,
      })
      .where(eq(notifications.id, notificationId));
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: status === "Read" ? "read" : status === "Unread" ? "unread" : "dismiss",
      module: "notifications",
      entityType: "notification",
      entityId: notificationId,
      afterSummary: { status },
      reason: `Marked notification ${status.toLowerCase()}`,
      riskLevel: "Low",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function setAllNotificationStatusesInDatabase(
  org: string,
  status: "Read" | "Dismissed",
  actor: AuditActorContext,
): Promise<number> {
  if (!actor.userId) throw new Error("A verified user is required.");
  const actorUserId = actor.userId;
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(notifications)
      .set({
        status,
        readAt: status === "Read" ? new Date().toISOString() : null,
        dismissedAt: status === "Dismissed" ? new Date().toISOString() : null,
        updatedAt: new Date(),
        updatedBy: actorUserId,
        recordVersion: sql`${notifications.recordVersion} + 1`,
      })
      .where(
        and(
          eq(notifications.organisationId, org),
          eq(notifications.recipientUserId, actorUserId),
          status === "Read"
            ? eq(notifications.status, "Unread")
            : sql`${notifications.status} <> 'Dismissed'`,
        ),
      )
      .returning({ id: notifications.id });
    if (changed.length)
      await tx.insert(auditEvents).values({
        organisationId: org,
        actorUserId,
        actorEmployeeId: actor.employeeId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole ?? null,
        actorRoles: actor.roles ?? [],
        action: status === "Read" ? "read-all" : "dismiss-all",
        module: "notifications",
        entityType: "notification",
        entityId: actorUserId,
        afterSummary: { status, count: changed.length },
        reason: `${status === "Read" ? "Read" : "Dismissed"} all matching notifications`,
        riskLevel: "Low",
      } as typeof auditEvents.$inferInsert);
    return changed.length;
  });
}

export async function listNotificationsForUserInDatabase(org: string, userId: string) {
  const db = getDatabaseClient();
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organisationId, org), eq(notifications.recipientUserId, userId)))
    .orderBy(sql`${notifications.createdAt} desc`);
}
