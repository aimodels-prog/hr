import type { StorageDriver } from "./storage-driver.ts";

export const VIA_HR_STORAGE_PREFIX = "via_hr";
export const VIA_HR_SCHEMA_VERSION = 2;

const META_SUFFIX = "meta";
const COLLECTION_SEGMENT = "collection";

export interface StorageMeta {
  product: "VIA HR System";
  schemaVersion: number;
  initializedAt: string;
  updatedAt: string;
}

export interface CollectionEnvelope<T> {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  items: T[];
}

export type CollectionState = Record<string, unknown[]>;

export interface StorageMigration {
  fromVersion: number;
  toVersion: number;
  migrate(collections: CollectionState): CollectionState;
}

export interface VersionedStorageOptions {
  prefix?: string;
  schemaVersion?: number;
  migrations?: StorageMigration[];
  now?: () => string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

export class VersionedStorageService {
  readonly prefix: string;
  readonly schemaVersion: number;

  private readonly migrations: StorageMigration[];
  private readonly now: () => string;

  constructor(
    private readonly driver: StorageDriver,
    options: VersionedStorageOptions = {},
  ) {
    this.prefix = options.prefix ?? VIA_HR_STORAGE_PREFIX;
    this.schemaVersion = options.schemaVersion ?? VIA_HR_SCHEMA_VERSION;
    this.migrations = options.migrations ?? [];
    this.now = options.now ?? (() => new Date().toISOString());
  }

  initialize(): StorageMeta {
    const current = this.readMeta();
    if (!current) {
      const now = this.now();
      const meta: StorageMeta = {
        product: "VIA HR System",
        schemaVersion: this.schemaVersion,
        initializedAt: now,
        updatedAt: now,
      };
      this.writeMeta(meta);
      return meta;
    }

    if (current.schemaVersion > this.schemaVersion) {
      throw new Error("These saved records were created by a newer version of VIA HR System.");
    }

    if (current.schemaVersion === this.schemaVersion) return current;
    return this.runMigrations(current);
  }

  isNamespaceEmpty(): boolean {
    return this.namespaceKeys().length === 0;
  }

  readCollection<T>(collection: string): T[] {
    const raw = this.driver.getItem(this.collectionKey(collection));
    if (raw === null) return [];

    const parsed = parseJson(raw, `Collection ${collection}`);
    if (!isObject(parsed) || !Array.isArray(parsed["items"])) {
      throw new Error(`Collection ${collection} has an invalid envelope.`);
    }
    if (
      typeof parsed["schemaVersion"] !== "number" ||
      parsed["schemaVersion"] > this.schemaVersion
    ) {
      throw new Error(`The saved ${collection} records cannot be opened by this version.`);
    }

    return structuredClone(parsed["items"]) as T[];
  }

  writeCollection<T>(collection: string, items: readonly T[]): void {
    const key = this.collectionKey(collection);
    const previous = this.readEnvelope<T>(collection);
    const envelope: CollectionEnvelope<T> = {
      schemaVersion: this.schemaVersion,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: this.now(),
      items: structuredClone([...items]),
    };
    this.driver.setItem(key, JSON.stringify(envelope));
    this.touchMeta();
  }

  listCollections(): string[] {
    const prefix = `${this.prefix}:${COLLECTION_SEGMENT}:`;
    return this.namespaceKeys()
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  exportState(): CollectionState {
    return Object.fromEntries(
      this.listCollections().map((collection) => [collection, this.readCollection(collection)]),
    );
  }

  replaceState(collections: CollectionState): void {
    const snapshot = this.createRawSnapshot();
    try {
      this.clearNamespace();
      this.initialize();
      for (const [collection, items] of Object.entries(collections)) {
        this.writeCollection(collection, items);
      }
    } catch (error) {
      this.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  clearNamespace(): void {
    for (const key of this.namespaceKeys()) this.driver.removeItem(key);
  }

  createRawSnapshot(): Record<string, string> {
    return Object.fromEntries(
      this.namespaceKeys().flatMap((key) => {
        const value = this.driver.getItem(key);
        return value === null ? [] : [[key, value]];
      }),
    );
  }

  restoreRawSnapshot(snapshot: Record<string, string>): void {
    this.clearNamespace();
    for (const [key, value] of Object.entries(snapshot)) {
      if (!key.startsWith(`${this.prefix}:`)) {
        throw new Error(`Snapshot contains an invalid key: ${key}`);
      }
      this.driver.setItem(key, value);
    }
  }

  private runMigrations(current: StorageMeta): StorageMeta {
    let version = current.schemaVersion;
    let collections = this.exportState();

    while (version < this.schemaVersion) {
      const migration = this.migrations.find((item) => item.fromVersion === version);
      if (!migration || migration.toVersion <= version) {
        throw new Error(`Saved records from version ${version} could not be updated.`);
      }
      collections = migration.migrate(structuredClone(collections));
      version = migration.toVersion;
    }

    if (version !== this.schemaVersion) {
      throw new Error(
        `The saved-record update stopped at version ${version} and could not be completed.`,
      );
    }

    const snapshot = this.createRawSnapshot();
    try {
      for (const key of this.namespaceKeys()) {
        if (key !== this.metaKey()) this.driver.removeItem(key);
      }
      for (const [collection, items] of Object.entries(collections)) {
        this.writeCollection(collection, items);
      }
      const migrated: StorageMeta = { ...current, schemaVersion: version, updatedAt: this.now() };
      this.writeMeta(migrated);
      return migrated;
    } catch (error) {
      this.restoreRawSnapshot(snapshot);
      throw error;
    }
  }

  private readEnvelope<T>(collection: string): CollectionEnvelope<T> | null {
    const raw = this.driver.getItem(this.collectionKey(collection));
    if (raw === null) return null;
    const parsed = parseJson(raw, `Collection ${collection}`);
    if (!isObject(parsed) || !Array.isArray(parsed["items"])) return null;
    return parsed as unknown as CollectionEnvelope<T>;
  }

  private readMeta(): StorageMeta | null {
    const raw = this.driver.getItem(this.metaKey());
    if (raw === null) return null;
    const parsed = parseJson(raw, "Storage metadata");
    if (
      !isObject(parsed) ||
      parsed["product"] !== "VIA HR System" ||
      typeof parsed["schemaVersion"] !== "number" ||
      typeof parsed["initializedAt"] !== "string" ||
      typeof parsed["updatedAt"] !== "string"
    ) {
      throw new Error("Storage metadata is invalid.");
    }
    return parsed as unknown as StorageMeta;
  }

  private writeMeta(meta: StorageMeta): void {
    this.driver.setItem(this.metaKey(), JSON.stringify(meta));
  }

  private touchMeta(): void {
    const meta = this.readMeta();
    if (!meta) return;
    this.writeMeta({ ...meta, updatedAt: this.now() });
  }

  private namespaceKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.driver.length; index += 1) {
      const key = this.driver.key(index);
      if (key?.startsWith(`${this.prefix}:`)) keys.push(key);
    }
    return keys;
  }

  private collectionKey(collection: string): string {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(collection)) {
      throw new Error(`Invalid collection name: ${collection}`);
    }
    return `${this.prefix}:${COLLECTION_SEGMENT}:${collection}`;
  }

  private metaKey(): string {
    return `${this.prefix}:${META_SUFFIX}`;
  }
}
