import { createServerFn } from "@tanstack/react-start";
import { getDatabaseClient } from "../db/client.ts";
import { auditEvents } from "../db/schema/system.ts";
import { getAppSettings, saveAppSettings } from "../db/repositories/settings.repository.server.ts";
import { resolveDefaultOrganisationId } from "../db/utils.server.ts";
import type { AppSettings, Role } from "../data/types.ts";

export const getAppSettingsFn = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    const orgId = await resolveDefaultOrganisationId();
    return getAppSettings(orgId);
  });

export const saveAppSettingsFn = createServerFn({ method: "POST" })
  .validator((input: { settings: AppSettings; actorId: string; activeRole: Role }) => input)
  .handler(async ({ data }) => {
    const orgId = await resolveDefaultOrganisationId();
    const previous = await getAppSettings(orgId);

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

    const hrReminderOnly =
      data.activeRole === "HR" &&
      changedKeys.length > 0 &&
      changedKeys.every((key) => key === "documentReminderDays");

    if (data.activeRole !== "Super Admin" && !hrReminderOnly) {
      const db = getDatabaseClient();
      await db.insert(auditEvents).values({
        organisationId: orgId,
        actorUserId: data.actorId,
        actorDisplayName: "System",
        activeRole: data.activeRole,
        action: "access-denied",
        module: "settings",
        entityType: "app_settings",
        entityId: data.settings.id || "settings-primary",
        reason: "Only a Super Admin can change organisation-wide settings.",
        riskLevel: "High",
      });
      throw new Error("Only a Super Admin can change organisation-wide settings.");
    }

    const { settings } = data;
    if (!settings.organisationName.trim()) throw new Error("Organisation name is required.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: settings.timezone }).format();
    } catch {
      throw new Error("Enter a valid IANA timezone, such as Asia/Muscat.");
    }
    if (!/^[A-Z]{3}$/.test(settings.baseCurrency)) {
      throw new Error("Base currency must be a three-letter code, such as OMR.");
    }
    if (
      settings.workingDays.length === 0 ||
      settings.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(settings.workingDays).size !== settings.workingDays.length
    ) {
      throw new Error("Select at least one valid working day without duplicates.");
    }
    if (
      !Number.isFinite(settings.standardDailyHours) ||
      settings.standardDailyHours <= 0 ||
      settings.standardDailyHours > 24
    ) {
      throw new Error("Standard daily hours must be greater than 0 and no more than 24.");
    }
    if (
      !Number.isFinite(settings.standardWeeklyHours) ||
      settings.standardWeeklyHours < settings.standardDailyHours ||
      settings.standardWeeklyHours > 168
    ) {
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
    if (
      settings.documentReminderDays.length === 0 ||
      settings.documentReminderDays.some((day) => !Number.isInteger(day) || day < 1 || day > 3650) ||
      new Set(settings.documentReminderDays).size !== settings.documentReminderDays.length
    ) {
      throw new Error("Document reminder days must be unique whole numbers between 1 and 3650.");
    }
    if (!settings.employeeNumberFormat.includes("{0000}")) {
      throw new Error("Employee number format must include {0000}.");
    }
    if (!settings.candidateReferenceFormat.includes("{00000}")) {
      throw new Error("Candidate reference format must include {00000}.");
    }

    const result = await saveAppSettings(orgId, settings, data.actorId);

    const db = getDatabaseClient();
    await db.insert(auditEvents).values({
      organisationId: orgId,
      actorUserId: data.actorId,
      actorDisplayName: "System",
      activeRole: data.activeRole,
      action: "update",
      module: "system",
      entityType: "app_settings",
      entityId: result.id,
      beforeSummary: previous,
      afterSummary: result,
      riskLevel: "Medium",
    });

    return result;
  });
