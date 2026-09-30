import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { appSettings } from "../schema/organisation.ts";
import { auditEvents } from "../schema/system.ts";
import {
  reminderRulesFromSettings,
  ReminderRulesSchema,
  type ReminderRules,
} from "../../data/reminder-rules.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
export async function getReminderRules(org: string) {
  const [row] = await getDatabaseClient()
    .select({ settings: appSettings.additionalSettings })
    .from(appSettings)
    .where(eq(appSettings.organisationId, org));
  return reminderRulesFromSettings(row?.settings);
}
export async function saveReminderRules(
  org: string,
  input: ReminderRules,
  actor: AuditActorContext,
) {
  if (!actor.userId || !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR or a Super Admin can change reminders.");
  const rules = ReminderRulesSchema.parse(input);
  return getDatabaseClient().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, org))
      .for("update");
    if (!row) throw new Error("Company settings are not available.");
    await tx
      .update(appSettings)
      .set({
        additionalSettings: { ...row.additionalSettings, reminderRules: rules },
        updatedBy: actor.userId,
        updatedAt: new Date(),
        recordVersion: sql`${appSettings.recordVersion}+1`,
      })
      .where(eq(appSettings.organisationId, org));
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      action: "update",
      module: "settings",
      entityType: "reminder-rules",
      entityId: org,
      beforeSummary: reminderRulesFromSettings(row.additionalSettings),
      afterSummary: rules,
      reason: "HR updated reminder settings",
      riskLevel: "Low",
    });
    return rules;
  });
}
