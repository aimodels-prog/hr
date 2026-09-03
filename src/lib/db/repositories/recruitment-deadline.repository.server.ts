import "@tanstack/react-start/server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { roles, userRoles, users } from "../schema/employee.ts";
import { candidates, jobOffers } from "../schema/recruitment.ts";
import { auditEvents, notifications } from "../schema/system.ts";

export async function processRecruitmentDeadlines(
  now = new Date(),
): Promise<{ expiredOffers: number; reminders: number }> {
  const db = getDatabaseClient();
  const expiringSoon = new Date(now.getTime() + 48 * 60 * 60_000);
  let expiredOffers = 0;
  let reminders = 0;
  const organisations = await db.execute(sql`select id from organisations where is_active=true`);
  for (const organisation of organisations) {
    const organisationId = String(organisation["id"]);
    const recipients = await db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.status, "Active"),
          inArray(roles.code, ["HR", "Super Admin"]),
        ),
      );
    const recipientIds = [...new Set(recipients.map((item) => item.userId))];
    const offers = await db
      .select({
        id: jobOffers.id,
        status: jobOffers.status,
        position: jobOffers.position,
        candidateName: sql<string>`${candidates.firstName} || ' ' || ${candidates.lastName}`,
        responseDeadline: jobOffers.responseDeadline,
        createdBy: jobOffers.createdBy,
      })
      .from(jobOffers)
      .innerJoin(candidates, eq(candidates.id, jobOffers.candidateId))
      .where(
        and(
          eq(jobOffers.organisationId, organisationId),
          eq(jobOffers.status, "Sent"),
          lt(jobOffers.responseDeadline, expiringSoon.toISOString()),
        ),
      );
    for (const offer of offers) {
      const deadline = offer.responseDeadline ? new Date(offer.responseDeadline) : undefined;
      if (!deadline) continue;
      const expired = deadline.getTime() < now.getTime();
      await db.transaction(async (tx) => {
        if (expired) {
          const [updated] = await tx
            .update(jobOffers)
            .set({
              status: "Expired",
              updatedAt: now,
              updatedBy: offer.createdBy,
              recordVersion: sql`${jobOffers.recordVersion} + 1`,
            })
            .where(and(eq(jobOffers.id, offer.id), eq(jobOffers.status, "Sent")))
            .returning({ id: jobOffers.id });
          if (!updated) return;
          expiredOffers += 1;
          await tx.insert(auditEvents).values({
            organisationId,
            actorDisplayName: "VIA background worker",
            activeRole: "Super Admin",
            actorRoles: ["Super Admin"],
            action: "expire",
            module: "recruitment",
            entityType: "job-offer",
            entityId: offer.id,
            afterSummary: { status: "Expired", responseDeadline: offer.responseDeadline },
            reason: "The candidate response deadline passed without a recorded decision.",
            riskLevel: "High",
          });
        }
        for (const recipientUserId of recipientIds) {
          const inserted = await tx
            .insert(notifications)
            .values({
              organisationId,
              recipientUserId,
              type: expired ? "offer_expired" : "offer_deadline",
              title: expired ? "Offer response deadline passed" : "Offer response due soon",
              message: `${offer.candidateName}'s offer for ${offer.position} ${expired ? "has expired" : "is due within 48 hours"}.`,
              priority: expired ? "High" : "Normal",
              status: "Unread",
              deduplicationKey: `offer-${expired ? "expired" : "deadline"}-${offer.id}-${deadline.toISOString().slice(0, 10)}`,
              link: { entityType: "job-offer", entityId: offer.id, path: "/staff/offers" },
              createdBy: recipientUserId,
              updatedBy: recipientUserId,
            })
            .onConflictDoNothing()
            .returning({ id: notifications.id });
          reminders += inserted.length;
        }
      });
    }
  }
  return { expiredOffers, reminders };
}
