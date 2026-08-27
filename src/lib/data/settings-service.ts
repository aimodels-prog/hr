import { getApplicationDataServices } from "./application-data.ts";
import type { ActorContext, AppSettings } from "./types.ts";

const SETTINGS_COLLECTION = "appSettings";

export class SettingsService {
  getAppSettings(): AppSettings {
    const { storage } = getApplicationDataServices();
    const [stored] = storage.readCollection<AppSettings>(SETTINGS_COLLECTION);
    if (!stored) throw new Error("Application settings have not been initialised.");
    return stored;
  }

  saveAppSettings(settings: AppSettings, context: ActorContext): AppSettings {
    const { storage, audit } = getApplicationDataServices();
    const previous = this.getAppSettings();
    const updated: AppSettings = {
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: context.actor.userId,
      recordVersion: previous.recordVersion + 1,
    };
    storage.writeCollection(SETTINGS_COLLECTION, [updated]);
    audit.record({
      context,
      action: "update",
      module: "system",
      entityType: "app_settings",
      entityId: updated.id,
      before: previous,
      after: updated,
    });
    return updated;
  }
}
