import { getApplicationDataServices } from "./application-data.ts";
import type { ActorContext, AppSettings } from "./types.ts";

const SETTINGS_COLLECTION = "appSettings";

export class SettingsService {
  getAppSettingsSync(): AppSettings {
    const { storage } = getApplicationDataServices();
    const [stored] = storage.readCollection<AppSettings>(SETTINGS_COLLECTION);
    if (!stored) throw new Error("Application settings have not been initialised.");
    return stored;
  }

  async getAppSettings(): Promise<AppSettings> {
    const { getAppSettingsFn } = await import("../server-functions/settings.server.ts");
    return getAppSettingsFn() as unknown as Promise<AppSettings>;
  }

  async saveAppSettings(settings: AppSettings, context: ActorContext): Promise<AppSettings> {
    const { saveAppSettingsFn } = await import("../server-functions/settings.server.ts");
    return saveAppSettingsFn({
      data: {
        settings,
        actorId: context.actor.userId,
        activeRole: context.actor.activeRole,
      },
    }) as unknown as Promise<AppSettings>;
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
