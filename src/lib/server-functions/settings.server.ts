import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { getDatabaseClient } from "../db/client.ts";
import { getAppSettings, saveAppSettings } from "../db/repositories/settings.repository.server.ts";
import { auditEvents } from "../db/schema/system.ts";
import { resolveDefaultOrganisationId, verifyServerActorRole } from "../db/utils.server.ts";
import type { AppSettings } from "../data/types.ts";

const AppSettingsInputSchema = z.object({
  organisationName: z.string().trim().min(1, "Organisation name is required").max(100),
  timezone: z.string().trim().min(1, "Timezone is required"),
  baseCurrency: z.string().trim().length(3, "Currency code must be 3 characters").toUpperCase(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1, "Select at least one working day"),
  standardDailyHours: z.number().positive().max(24, "Daily hours cannot exceed 24"),
  standardWeeklyHours: z.number().positive().max(168, "Weekly hours cannot exceed 168"),
  leaveYearStart: z.string().regex(/^\d{2}-\d{2}$/, "Format must be MM-DD"),
  leaveYearEnd: z.string().regex(/^\d{2}-\d{2}$/, "Format must be MM-DD"),
  documentReminderDays: z.array(z.number().int().min(1).max(3650)),
  employeeNumberFormat: z.string().min(1).includes("{0000}", { message: "Must include {0000}" }),
  candidateReferenceFormat: z
    .string()
    .min(1)
    .includes("{00000}", { message: "Must include {00000}" }),
  requireOnboardingCompletionBeforeDashboard: z.boolean().optional().default(true),
  id: z.string().optional(),
  createdAt: z.string().optional(),
  createdBy: z.string().optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
  archivedAt: z.string().optional(),
  recordVersion: z.number().int().optional(),
  schemaVersion: z.number().int().optional(),
});

export const getAppSettingsFn = createServerFn({ method: "GET" })
  .validator((input: { orgId?: string } = {}) => input)
  .handler(async ({ data }): Promise<AppSettings> => {
    const orgId = data?.orgId ?? (await resolveDefaultOrganisationId());
    return getAppSettings(orgId);
  });

export const saveAppSettingsFn = createServerFn({ method: "POST" })
  .validator((input: { settings: z.infer<typeof AppSettingsInputSchema>; actorId: string }) => {
    return z
      .object({
        settings: AppSettingsInputSchema,
        actorId: z.string().min(1),
      })
      .parse(input);
  })
  .handler(async ({ data }): Promise<AppSettings> => {
    const orgId = await resolveDefaultOrganisationId();
    const previous = await getAppSettings(orgId);

    // Verify actor in database
    const { verified, actor, error } = await verifyServerActorRole(orgId, data.actorId);
    if (!verified || !actor) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "Unverified Actor",
        activeRole: "Employee",
        action: "access-denied",
        module: "settings",
        entityType: "app_settings",
        entityId: previous.id,
        reason: error ?? "Unverified actor attempting to save settings.",
        riskLevel: "High",
      });
      throw new Error(`Unauthorized: ${error ?? "Actor is not authorized."}`);
    }

    const ignored = new Set([
      "updatedAt",
      "updatedBy",
      "recordVersion",
      "createdAt",
      "createdBy",
      "id",
      "organisationId",
    ]);

    const changedKeys = Object.keys(data.settings).filter(
      (key) =>
        !ignored.has(key) &&
        JSON.stringify(data.settings[key as keyof AppSettings]) !==
          JSON.stringify(previous[key as keyof AppSettings]),
    );

    const isSuperAdmin = actor.roles.includes("Super Admin");
    const isHr = actor.roles.includes("HR");

    const hrReminderOnly =
      isHr && changedKeys.length > 0 && changedKeys.every((key) => key === "documentReminderDays");

    if (!isSuperAdmin && !hrReminderOnly) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName,
        activeRole: actor.activeRole,
        action: "access-denied",
        module: "settings",
        entityType: "app_settings",
        entityId: previous.id,
        reason: "Only a Super Admin can change organisation-wide settings.",
        riskLevel: "High",
      });
      throw new Error("Only a Super Admin can change organisation-wide settings.");
    }

    const { settings } = data;
    try {
      new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format();
    } catch {
      throw new Error("Enter a valid IANA timezone, such as Asia/Muscat.");
    }

    if (
      settings.workingDays.length === 0 ||
      settings.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(settings.workingDays).size !== settings.workingDays.length
    ) {
      throw new Error("Select at least one valid working day without duplicates.");
    }

    if (settings.standardWeeklyHours < settings.standardDailyHours) {
      throw new Error("Standard weekly hours must be between the daily hours and 168.");
    }

    const validMonthDay = (value: string) => {
      const match = /^(\d{2})-(\d{2})$/.exec(value);
      if (!match) return false;
      const month = Number(match[1]);
      const day = Number(match[2]);
      const parsed = new Date(Date.UTC(2024, month - 1, day));
      return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    };

    if (!validMonthDay(settings.leaveYearStart) || !validMonthDay(settings.leaveYearEnd)) {
      throw new Error("Leave year dates must use valid MM-DD values.");
    }

    if (settings.leaveYearStart === settings.leaveYearEnd) {
      throw new Error("Leave year start and end dates must be different.");
    }

    if (new Set(settings.documentReminderDays).size !== settings.documentReminderDays.length) {
      throw new Error("Document reminder days must be unique whole numbers between 1 and 3650.");
    }

    const completeSettings: AppSettings = {
      ...previous,
      ...settings,
      id: previous.id,
      createdAt: settings.createdAt ?? previous.createdAt ?? new Date().toISOString(),
      createdBy: settings.createdBy ?? previous.createdBy ?? actor.userId,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.userId,
      recordVersion: (settings.recordVersion ?? previous.recordVersion ?? 1) + 1,
      baseCurrency: settings.baseCurrency.toUpperCase(),
      schemaVersion: settings.schemaVersion ?? previous.schemaVersion ?? 1,
    };

    return saveAppSettings(orgId, completeSettings, actor);
  });
