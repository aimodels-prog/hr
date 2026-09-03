import { AuditService } from "./audit-service.ts";
import { IndexedDbFileRepository } from "./file-repository.ts";
import { NotificationService } from "./notification-service.ts";
import { initializeSeedData, type SeedResult } from "./seed-service.ts";
import { getBrowserCacheStorageDriver } from "./storage-driver.ts";
import { VersionedStorageService } from "./storage.ts";
import { VIA_HR_STORAGE_MIGRATIONS } from "./storage-migrations.ts";

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
  const storage = new VersionedStorageService(getBrowserCacheStorageDriver(), {
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
