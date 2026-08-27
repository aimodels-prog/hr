import { createSeedCollections } from "./seeds.ts";
import type { VersionedStorageService } from "./storage.ts";

export interface SeedResult {
  seeded: boolean;
  collectionCounts: Record<string, number>;
}

export function initializeSeedData(storage: VersionedStorageService): SeedResult {
  const hadNamespaceData = !storage.isNamespaceEmpty();
  storage.initialize();

  if (hadNamespaceData) {
    return {
      seeded: false,
      collectionCounts: Object.fromEntries(
        storage.listCollections().map((name) => [name, storage.readCollection(name).length]),
      ),
    };
  }

  const collections = createSeedCollections();
  for (const [name, records] of Object.entries(collections)) {
    storage.writeCollection(name, records);
  }
  return {
    seeded: true,
    collectionCounts: Object.fromEntries(
      Object.entries(collections).map(([name, records]) => [name, records.length]),
    ),
  };
}

export function resetStructuredDemoData(storage: VersionedStorageService): SeedResult {
  storage.clearNamespace();
  return initializeSeedData(storage);
}
