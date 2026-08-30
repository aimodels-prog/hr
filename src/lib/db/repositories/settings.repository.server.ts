import "@tanstack/react-start/server-only";

import { eq } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { appSettings, organisations } from "../schema/organisation.ts";
import type { AppSettings } from "../../data/types.ts";

export async function getAppSettings(orgId: string): Promise<AppSettings> {
  const db = getDatabaseClient();
  const [settingsRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, orgId));

  const [orgRow] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, orgId));

  if (!settingsRow || !orgRow) {
    throw new Error("Application settings have not been initialised.");
  }

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

export async function saveAppSettings(
  orgId: string,
  settings: AppSettings,
  actorId: string,
): Promise<AppSettings> {
  const db = getDatabaseClient();
  const now = new Date();

  // Update organisation name
  await db
    .update(organisations)
    .set({
      name: settings.organisationName,
      updatedAt: now,
      updatedBy: actorId,
    })
    .where(eq(organisations.id, orgId));

  // Update or insert app settings
  const [existing] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, orgId));

  if (existing) {
    await db
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
        updatedBy: actorId,
      })
      .where(eq(appSettings.organisationId, orgId));
  } else {
    await db.insert(appSettings).values({
      organisationId: orgId,
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
      createdBy: actorId,
      updatedBy: actorId,
    });
  }

  return getAppSettings(orgId);
}

export async function getOrganisation(orgId: string) {
  const db = getDatabaseClient();
  const [orgRow] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, orgId));
  return orgRow;
}
