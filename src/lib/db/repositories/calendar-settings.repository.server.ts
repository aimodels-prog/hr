import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabaseClient } from "../client.ts";
import { appSettings } from "../schema/organisation.ts";
import { googleCalendarConnections, googleCalendarOAuthStates } from "../schema/google-calendar.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export const DEFAULT_CALENDAR_EMAIL = "hr@via-int.com";
export function calendarEmailFromSettings(settings: Record<string, unknown>) {
  return z
    .string()
    .email()
    .parse(settings["calendarOrganiserEmail"] ?? DEFAULT_CALENDAR_EMAIL)
    .trim()
    .toLowerCase();
}
export async function getCalendarOrganiserEmail(organisationId: string) {
  const [row] = await getDatabaseClient()
    .select({ settings: appSettings.additionalSettings })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId));
  if (!row) throw new Error("Company settings have not been initialised.");
  return calendarEmailFromSettings(row.settings);
}
export async function saveCalendarOrganiserEmail(
  organisationId: string,
  email: string,
  actor: AuditActorContext,
) {
  if (!actor.userId || !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR or a Super Admin can change the calendar account.");
  const accountEmail = z.string().trim().email().max(254).parse(email).toLowerCase();
  return getDatabaseClient().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .for("update");
    if (!row) throw new Error("Company settings have not been initialised.");
    const previous = calendarEmailFromSettings(row.additionalSettings);
    if (previous === accountEmail) return accountEmail;
    const [linked] = await tx.execute(
      sql`SELECT id FROM interviews WHERE organisation_id=${organisationId} AND calendar_event_reference IS NOT NULL LIMIT 1`,
    );
    if (linked)
      throw new Error(
        "This account has linked interviews. An administrator must migrate those calendar bookings before changing the organising account.",
      );
    await tx
      .delete(googleCalendarOAuthStates)
      .where(eq(googleCalendarOAuthStates.organisationId, organisationId));
    await tx
      .delete(googleCalendarConnections)
      .where(eq(googleCalendarConnections.organisationId, organisationId));
    await tx
      .update(appSettings)
      .set({
        additionalSettings: { ...row.additionalSettings, calendarOrganiserEmail: accountEmail },
        updatedBy: actor.userId,
        updatedAt: new Date(),
        recordVersion: sql`${appSettings.recordVersion}+1`,
      })
      .where(eq(appSettings.organisationId, organisationId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      action: "update",
      module: "settings",
      entityType: "calendar-settings",
      entityId: organisationId,
      beforeSummary: { accountEmail: previous },
      afterSummary: { accountEmail },
      reason: "Changed organising account; new Google authorisation required",
      riskLevel: "High",
    });
    return accountEmail;
  });
}
