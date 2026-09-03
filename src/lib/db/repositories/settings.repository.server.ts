import "@tanstack/react-start/server-only";

import { eq, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import type { AppSettings } from "../../data/types.ts";

function mapAppSettings(
  settingsRow: typeof appSettings.$inferSelect,
  orgRow: typeof organisations.$inferSelect,
): AppSettings {
  return {
    id: settingsRow.id,
    createdAt: settingsRow.createdAt?.toISOString() ?? new Date().toISOString(),
    createdBy: settingsRow.createdBy,
    updatedAt: settingsRow.updatedAt?.toISOString() ?? new Date().toISOString(),
    updatedBy: settingsRow.updatedBy,
    archivedAt: settingsRow.archivedAt?.toISOString() ?? undefined,
    recordVersion: settingsRow.recordVersion ?? 1,
    organisationName: orgRow.name,
    timezone: settingsRow.timezone,
    baseCurrency: settingsRow.baseCurrency,
    workingDays: settingsRow.workingDays ?? [],
    standardDailyHours: Number(settingsRow.standardDailyHours),
    standardWeeklyHours: Number(settingsRow.standardWeeklyHours),
    leaveYearStart: settingsRow.leaveYearStart,
    leaveYearEnd: settingsRow.leaveYearEnd,
    documentReminderDays: settingsRow.documentReminderDays ?? [],
    employeeNumberFormat: settingsRow.employeeNumberFormat,
    candidateReferenceFormat: settingsRow.candidateReferenceFormat,
    schemaVersion: settingsRow.schemaVersion ?? 1,
    requireOnboardingCompletionBeforeDashboard:
      settingsRow.requireOnboardingCompletionBeforeDashboard ?? true,
  };
}

export async function getAppSettings(orgId: string): Promise<AppSettings> {
  const db = getDatabaseClient();
  const [settingsRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, orgId));

  const [orgRow] = await db.select().from(organisations).where(eq(organisations.id, orgId));

  if (!settingsRow || !orgRow) {
    throw new Error("Application settings have not been initialised.");
  }

  return mapAppSettings(settingsRow, orgRow);
}

export async function saveAppSettings(
  orgId: string,
  settings: AppSettings,
  actor: AuditActorContext,
): Promise<AppSettings> {
  const db = getDatabaseClient();

  return db.transaction(async (tx) => {
    const now = new Date();

    const [existing] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, orgId));
    const [existingOrg] = await tx.select().from(organisations).where(eq(organisations.id, orgId));
    if (!existing || !existingOrg) {
      throw new Error("Application settings have not been initialised.");
    }
    const previous = mapAppSettings(existing, existingOrg);

    // Update organisation name
    await tx
      .update(organisations)
      .set({
        name: settings.organisationName,
        updatedAt: now,
        updatedBy: actor.userId ?? orgId,
      })
      .where(eq(organisations.id, orgId));

    // Update or insert app settings
    await tx
      .update(appSettings)
      .set({
        timezone: settings.timezone,
        baseCurrency: settings.baseCurrency,
        workingDays: settings.workingDays,
        standardDailyHours: String(settings.standardDailyHours),
        standardWeeklyHours: String(settings.standardWeeklyHours),
        leaveYearStart: settings.leaveYearStart,
        leaveYearEnd: settings.leaveYearEnd,
        documentReminderDays: settings.documentReminderDays,
        employeeNumberFormat: settings.employeeNumberFormat,
        candidateReferenceFormat: settings.candidateReferenceFormat,
        requireOnboardingCompletionBeforeDashboard:
          settings.requireOnboardingCompletionBeforeDashboard,
        updatedAt: now,
        updatedBy: actor.userId ?? orgId,
        recordVersion: sql`${appSettings.recordVersion} + 1`,
      })
      .where(eq(appSettings.organisationId, orgId));

    const [updatedSettingsRow] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, orgId));

    const [updatedOrgRow] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.id, orgId));

    if (!updatedSettingsRow || !updatedOrgRow) {
      throw new Error("Failed to retrieve updated organisation settings.");
    }

    const dto = mapAppSettings(updatedSettingsRow, updatedOrgRow);

    await tx.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "update",
      module: "settings",
      entityType: "app_settings",
      entityId: updatedSettingsRow.id,
      beforeSummary: previous,
      afterSummary: dto,
      riskLevel: "High",
    });

    return dto;
  });
}

export async function getOrganisation(orgId: string) {
  const db = getDatabaseClient();
  const [orgRow] = await db.select().from(organisations).where(eq(organisations.id, orgId));
  return orgRow;
}
