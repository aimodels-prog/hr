import { AuditService } from "./audit-service.ts";
import {
  createStructuredBackup,
  previewStructuredRestore,
  restoreStructuredBackup,
  serializeStructuredBackup,
  type RestorePreview,
  type RestoreResult,
} from "./backup-service.ts";
import { IndexedDbFileRepository } from "./file-repository.ts";
import { NotificationService } from "./notification-service.ts";
import { resetStructuredDemoData, initializeSeedData, type SeedResult } from "./seed-service.ts";
import { getBrowserStorageDriver } from "./storage-driver.ts";
import { VersionedStorageService } from "./storage.ts";
import { VIA_HR_STORAGE_MIGRATIONS } from "./storage-migrations.ts";
import type { ActorContext } from "./types.ts";

export interface ApplicationDataServices {
  storage: VersionedStorageService;
  audit: AuditService;
  notifications: NotificationService;
  files: IndexedDbFileRepository;
}

let browserServices: ApplicationDataServices | undefined;

/** Dependency-injection hook for isolated tests and future server-backed adapters. */
export function configureApplicationDataServices(
  services: ApplicationDataServices | undefined,
): void {
  browserServices = services;
}

export function getApplicationDataServices(): ApplicationDataServices {
  if (browserServices) return browserServices;
  const storage = new VersionedStorageService(getBrowserStorageDriver(), {
    migrations: VIA_HR_STORAGE_MIGRATIONS,
  });
  const audit = new AuditService(storage);
  browserServices = {
    storage,
    audit,
    notifications: new NotificationService(storage, audit),
    files: new IndexedDbFileRepository({ audit }),
  };
  return browserServices;
}

export function initializeApplicationData(): SeedResult | null {
  if (typeof window === "undefined") return null;
  return initializeSeedData(getApplicationDataServices().storage);
}

function requireBackupAdministrator(context: ActorContext, action: string): void {
  if (context.actor.activeRole === "Super Admin") return;
  const { audit } = getApplicationDataServices();
  audit.record({
    context,
    action: "access-denied",
    module: "data-management",
    entityType: "structured-backup",
    entityId: action,
    reason: `Only a Super Admin can ${action}.`,
    riskLevel: "Critical",
  });
  throw new Error(`Only a Super Admin can ${action}.`);
}

export function exportApplicationBackup(context: ActorContext): string {
  requireBackupAdministrator(context, "download a system backup");
  const { storage, audit } = getApplicationDataServices();
  audit.record({
    context,
    action: "export",
    module: "data-management",
    entityType: "structured-backup",
    entityId: crypto.randomUUID(),
    riskLevel: "High",
  });
  const backup = createStructuredBackup(storage);
  return serializeStructuredBackup(backup);
}

export function previewApplicationRestore(input: string | unknown): RestorePreview {
  const { storage } = getApplicationDataServices();
  return previewStructuredRestore(input, storage.schemaVersion);
}

export function restoreApplicationBackup(
  input: string | unknown,
  context: ActorContext,
): RestoreResult {
  requireBackupAdministrator(context, "restore a system backup");
  const { storage, audit } = getApplicationDataServices();
  const result = restoreStructuredBackup(storage, input);
  audit.record({
    context,
    action: "restore",
    module: "data-management",
    entityType: "structured-backup",
    entityId: crypto.randomUUID(),
    after: result.collectionCounts,
    riskLevel: "High",
  });
  return result;
}

export async function resetApplicationDemoData(context: ActorContext): Promise<SeedResult> {
  requireBackupAdministrator(context, "reset the sample workspace");
  const { storage, files, audit } = getApplicationDataServices();
  await files.clear();
  const result = resetStructuredDemoData(storage);
  audit.record({
    context,
    action: "reset",
    module: "data-management",
    entityType: "demo-data",
    entityId: "via-hr-demo-data",
    after: result.collectionCounts,
    riskLevel: "Critical",
  });
  return result;
}
