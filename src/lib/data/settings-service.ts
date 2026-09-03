import { getApplicationDataServices } from "./application-data.ts";
import type { ActorContext, AppSettings } from "./types.ts";

const SETTINGS_COLLECTION = "appSettings";

let memoryCachedSettings: AppSettings | null = null;

function usesBrowserServerFunctions(): boolean {
  return typeof window !== "undefined";
}

export class SettingsService {
  getAppSettingsSync(): AppSettings {
    if (memoryCachedSettings) {
      return memoryCachedSettings;
    }
    try {
      const { storage } = getApplicationDataServices();
      const [stored] = storage.readCollection<AppSettings>(SETTINGS_COLLECTION);
      if (stored) {
        memoryCachedSettings = stored;
        return stored;
      }
    } catch {
      // Fallback for isolated runtime
    }
    // Default system fallback
    const fallback: AppSettings = {
      id: "settings-primary",
      organisationName: "VIA HR",
      timezone: "Asia/Muscat",
      baseCurrency: "OMR",
      workingDays: [0, 1, 2, 3, 4],
      standardDailyHours: 8,
      standardWeeklyHours: 40,
      leaveYearStart: "01-01",
      leaveYearEnd: "12-31",
      documentReminderDays: [30, 15, 7],
      requireOnboardingCompletionBeforeDashboard: false,
      employeeNumberFormat: "VIA-{0000}",
      candidateReferenceFormat: "CAND-{00000}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: "system",
      updatedBy: "system",
      recordVersion: 1,
      schemaVersion: 1,
    };
    memoryCachedSettings = fallback;
    return fallback;
  }

  async getAppSettings(): Promise<AppSettings> {
    if (!usesBrowserServerFunctions()) return this.getAppSettingsSync();

    const { getAppSettingsFn } = await import("../server-functions/settings.server.ts");
    const settings = (await getAppSettingsFn({ data: {} })) as unknown as AppSettings;
    memoryCachedSettings = settings;
    return settings;
  }

  async saveAppSettings(settings: AppSettings, context: ActorContext): Promise<AppSettings> {
    this.validate(settings);

    const previous = this.getAppSettingsSync();
    const ignored = new Set([
      "updatedAt",
      "updatedBy",
      "recordVersion",
      "createdAt",
      "createdBy",
      "id",
      "organisationId",
    ]);

    const changedKeys = Object.keys(settings).filter(
      (key) =>
        !ignored.has(key) &&
        JSON.stringify(settings[key as keyof AppSettings]) !==
          JSON.stringify(previous[key as keyof AppSettings]),
    );

    const isSuperAdmin = context.actor.activeRole === "Super Admin";
    const isHr = context.actor.activeRole === "HR";
    const hrReminderOnly =
      isHr && changedKeys.length > 0 && changedKeys.every((key) => key === "documentReminderDays");

    if (!isSuperAdmin && !hrReminderOnly) {
      try {
        const { audit } = getApplicationDataServices();
        audit.record({
          context,
          action: "access-denied",
          module: "settings",
          entityType: "app_settings",
          entityId: settings.id || "settings-primary",
          reason: "Only a Super Admin can change organisation-wide settings.",
          riskLevel: "High",
        });
      } catch {
        // Ignore if services not configured
      }
      throw new Error("Only a Super Admin can change organisation-wide settings.");
    }

    if (!usesBrowserServerFunctions()) {
      memoryCachedSettings = settings;
      const { storage, audit } = getApplicationDataServices();
      storage.writeCollection(SETTINGS_COLLECTION, [settings]);
      audit.record({
        context,
        action: "update",
        module: "system",
        entityType: "app_settings",
        entityId: settings.id,
        after: settings,
        riskLevel: "Medium",
      });
      return settings;
    }

    const { saveAppSettingsFn } = await import("../server-functions/settings.server.ts");
    const result = (await saveAppSettingsFn({
      data: {
        settings,
        actorId: context.actor.userId,
        ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
      },
    })) as unknown as AppSettings;
    memoryCachedSettings = result;
    return result;
  }

  private validate(settings: AppSettings): void {
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
      settings.documentReminderDays.some(
        (day) => !Number.isInteger(day) || day < 1 || day > 3650,
      ) ||
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
  }
}
