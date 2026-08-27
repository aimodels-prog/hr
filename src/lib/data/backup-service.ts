import { createSeedCollections } from "./seeds.ts";
import type { CollectionState, VersionedStorageService } from "./storage.ts";

export const BACKUP_FORMAT = "via-hr-structured-backup";

export interface StructuredBackup {
  format: typeof BACKUP_FORMAT;
  product: "VIA HR System";
  schemaVersion: number;
  exportedAt: string;
  collections: CollectionState;
}

export interface RestorePreview {
  valid: boolean;
  schemaVersion?: number;
  exportedAt?: string;
  collectionCounts: Record<string, number>;
  warnings: string[];
  errors: string[];
}

export interface RestoreResult {
  restored: boolean;
  collectionCounts: Record<string, number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBackup(input: string | unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

function validateRecord(record: unknown, collection: string, index: number): string[] {
  if (!isObject(record)) return [`${collection}[${index}] must be an object.`];
  if (typeof record["id"] !== "string" || record["id"].trim() === "") {
    return [`${collection}[${index}] must have a non-empty string id.`];
  }
  if (collection !== "auditEvents" && typeof record["recordVersion"] !== "number") {
    return [`${collection}[${index}] must have a numeric recordVersion.`];
  }
  return [];
}

export function createStructuredBackup(
  storage: VersionedStorageService,
  now: () => string = () => new Date().toISOString(),
): StructuredBackup {
  storage.initialize();
  return {
    format: BACKUP_FORMAT,
    product: "VIA HR System",
    schemaVersion: storage.schemaVersion,
    exportedAt: now(),
    collections: storage.exportState(),
  };
}

export function serializeStructuredBackup(backup: StructuredBackup): string {
  return JSON.stringify(backup, null, 2);
}

export function previewStructuredRestore(
  input: string | unknown,
  supportedSchemaVersion: number,
): RestorePreview {
  const parsed = parseBackup(input);
  const errors: string[] = [];
  const warnings: string[] = [];
  const collectionCounts: Record<string, number> = {};

  if (!isObject(parsed)) {
    return { valid: false, collectionCounts, warnings, errors: ["Backup is not valid JSON data."] };
  }
  if (parsed["format"] !== BACKUP_FORMAT) errors.push("Backup format is not supported.");
  if (parsed["product"] !== "VIA HR System") errors.push("Backup belongs to a different product.");
  if (typeof parsed["schemaVersion"] !== "number") {
    errors.push("Backup schemaVersion must be a number.");
  } else if (parsed["schemaVersion"] > supportedSchemaVersion) {
    errors.push("This backup was created by a newer version of VIA HR System.");
  } else if (parsed["schemaVersion"] < supportedSchemaVersion) {
    errors.push("This older backup must be updated before it can be restored.");
  }
  if (typeof parsed["exportedAt"] !== "string" || Number.isNaN(Date.parse(parsed["exportedAt"]))) {
    errors.push("Backup exportedAt must be a valid ISO date string.");
  }
  if (!isObject(parsed["collections"])) {
    errors.push("Backup collections must be an object.");
  } else {
    for (const [collection, records] of Object.entries(parsed["collections"])) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(collection)) {
        errors.push(`Collection name ${collection} is invalid.`);
        continue;
      }
      if (!Array.isArray(records)) {
        errors.push(`Collection ${collection} must be an array.`);
        continue;
      }
      collectionCounts[collection] = records.length;
      records.forEach((record, index) => errors.push(...validateRecord(record, collection, index)));
      const ids = records.flatMap((record) =>
        isObject(record) && typeof record["id"] === "string" ? [record["id"]] : [],
      );
      if (new Set(ids).size !== ids.length) {
        errors.push(`Collection ${collection} contains duplicate record ids.`);
      }
    }
  }

  for (const expected of Object.keys(createSeedCollections())) {
    if (!(expected in collectionCounts)) warnings.push(`Collection ${expected} is missing.`);
  }

  return {
    valid: errors.length === 0,
    ...(typeof parsed["schemaVersion"] === "number"
      ? { schemaVersion: parsed["schemaVersion"] }
      : {}),
    ...(typeof parsed["exportedAt"] === "string" ? { exportedAt: parsed["exportedAt"] } : {}),
    collectionCounts,
    warnings,
    errors,
  };
}

export function restoreStructuredBackup(
  storage: VersionedStorageService,
  input: string | unknown,
): RestoreResult {
  const preview = previewStructuredRestore(input, storage.schemaVersion);
  if (!preview.valid) {
    throw new Error(`Backup validation failed: ${preview.errors.join(" ")}`);
  }

  const parsed = parseBackup(input) as StructuredBackup;
  storage.replaceState(parsed.collections);
  return { restored: true, collectionCounts: preview.collectionCounts };
}
