import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";

import type { FileMetadata, FileOwner } from "../data/types.ts";
import { scanUploadForMalware } from "../malware-scanner.server.ts";
import { getDatabaseClient } from "./client.ts";
import { fileMetadata } from "./schema/documents.ts";
import { auditEvents } from "./schema/system.ts";
import { decryptSensitiveBytes, encryptSensitiveBytes } from "./encryption.server.ts";

export interface FileAuditActor {
  userId?: string;
  employeeId?: string;
  displayName: string;
  activeRole: string;
  roles?: string[];
}

interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  autoCreateBucket: boolean;
}

let clientCache: { config: ObjectStorageConfig; client: S3Client } | undefined;
let bucketReady: Promise<void> | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for secure file storage.`);
  return value;
}

export function getObjectStorageConfig(): ObjectStorageConfig {
  const endpoint = required("VIA_HR_OBJECT_STORAGE_ENDPOINT");
  const parsed = new URL(endpoint);
  const privateHttpAllowed = process.env["VIA_HR_OBJECT_STORAGE_ALLOW_PRIVATE_HTTP"] === "true";
  const privateHttpHost =
    parsed.hostname === "object-storage" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (
    process.env["NODE_ENV"] === "production" &&
    parsed.protocol !== "https:" &&
    !(privateHttpAllowed && privateHttpHost)
  ) {
    throw new Error(
      "Production object storage must use HTTPS or an explicitly allowed private endpoint.",
    );
  }
  return {
    endpoint: parsed.toString().replace(/\/$/, ""),
    region: process.env["VIA_HR_OBJECT_STORAGE_REGION"]?.trim() || "us-east-1",
    bucket: required("VIA_HR_OBJECT_STORAGE_BUCKET"),
    accessKeyId: required("VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env["VIA_HR_OBJECT_STORAGE_FORCE_PATH_STYLE"] !== "false",
    autoCreateBucket: process.env["VIA_HR_OBJECT_STORAGE_AUTO_CREATE_BUCKET"] === "true",
  };
}

function getClient() {
  const config = getObjectStorageConfig();
  const signature = JSON.stringify(config);
  if (!clientCache || JSON.stringify(clientCache.config) !== signature) {
    clientCache = {
      config,
      client: new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      }),
    };
    bucketReady = undefined;
  }
  return clientCache;
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const { client, config } = getClient();
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
      if (!config.autoCreateBucket) {
        throw new Error("The secure file bucket is unavailable or access was refused.", {
          cause: error,
        });
      }
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    }
  })();
  try {
    await bucketReady;
  } catch (error) {
    bucketReady = undefined;
    throw error;
  }
}

function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
  return cleaned || "document";
}

function toMetadata(row: typeof fileMetadata.$inferSelect): FileMetadata {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    owner: { entityType: row.ownerEntityType, entityId: row.ownerEntityId },
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    ...(row.archivedAt ? { archivedAt: row.archivedAt.toISOString() } : {}),
    recordVersion: row.recordVersion,
    ...(row.checksum ? { checksum: row.checksum } : {}),
  };
}

export async function saveObjectFile(input: {
  id?: string;
  organisationId: string;
  bytes: Uint8Array;
  name: string;
  mimeType: string;
  owner: FileOwner;
  actor: FileAuditActor;
}): Promise<FileMetadata> {
  if (input.bytes.byteLength < 1) throw new Error("The uploaded file is empty.");
  await scanUploadForMalware(input.bytes);
  await ensureBucket();
  const { client, config } = getClient();
  const id = input.id ?? randomUUID();
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const encryptedBytes = encryptSensitiveBytes(input.bytes);
  const storageKey = `${input.organisationId}/${id}/${safeName(input.name)}`;
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: storageKey,
      Body: encryptedBytes,
      ContentLength: encryptedBytes.byteLength,
      ContentType: "application/octet-stream",
      Metadata: {
        checksum,
        originalsize: String(input.bytes.byteLength),
        encryption: "via-aes-256-gcm-v1",
        organisation: input.organisationId,
        fileid: id,
      },
    }),
  );
  try {
    const db = getDatabaseClient();
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(fileMetadata)
        .values({
          id,
          organisationId: input.organisationId,
          name: input.name,
          mimeType: input.mimeType,
          size: input.bytes.byteLength,
          checksum,
          storageKey,
          storageStatus: "Available",
          ownerEntityType: input.owner.entityType,
          ownerEntityId: input.owner.entityId,
          createdBy: input.actor.userId ?? input.owner.entityId,
          updatedBy: input.actor.userId ?? input.owner.entityId,
        })
        .returning();
      if (!created) throw new Error("File metadata could not be saved.");
      await tx.insert(auditEvents).values({
        organisationId: input.organisationId,
        actorUserId: input.actor.userId,
        actorEmployeeId: input.actor.employeeId,
        actorDisplayName: input.actor.displayName,
        activeRole: input.actor.activeRole,
        actorRoles: input.actor.roles ?? [input.actor.activeRole],
        action: "upload",
        module: "files",
        entityType: "file",
        entityId: id,
        afterSummary: {
          name: input.name,
          mimeType: input.mimeType,
          size: input.bytes.byteLength,
          checksum,
          owner: input.owner,
        },
        riskLevel: "High",
      });
      return created;
    });
    return toMetadata(row);
  } catch (error) {
    await client
      .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }))
      .catch(() => undefined);
    throw error;
  }
}

export async function verifyObjectFile(
  organisationId: string,
  fileId: string,
): Promise<FileMetadata> {
  const db = getDatabaseClient();
  const [row] = await db
    .select()
    .from(fileMetadata)
    .where(
      and(
        eq(fileMetadata.organisationId, organisationId),
        eq(fileMetadata.id, fileId),
        eq(fileMetadata.storageStatus, "Available"),
      ),
    )
    .limit(1);
  if (!row?.storageKey) throw new Error("The requested file is not available.");
  await ensureBucket();
  const { client, config } = getClient();
  const head = await client.send(
    new HeadObjectCommand({ Bucket: config.bucket, Key: row.storageKey }),
  );
  if (
    Number(head.Metadata?.["originalsize"]) !== row.size ||
    head.Metadata?.["checksum"] !== row.checksum ||
    head.Metadata?.["encryption"] !== "via-aes-256-gcm-v1" ||
    Number(head.ContentLength) <= row.size
  ) {
    throw new Error("The stored file failed its integrity check.");
  }
  return toMetadata(row);
}

export async function readObjectFile(
  organisationId: string,
  fileId: string,
  actor: FileAuditActor,
  reason: string,
): Promise<{ metadata: FileMetadata; bytes: Uint8Array }> {
  const metadata = await verifyObjectFile(organisationId, fileId);
  const db = getDatabaseClient();
  const [row] = await db
    .select({ storageKey: fileMetadata.storageKey })
    .from(fileMetadata)
    .where(and(eq(fileMetadata.organisationId, organisationId), eq(fileMetadata.id, fileId)));
  if (!row?.storageKey) throw new Error("The requested file is not available.");
  const { client, config } = getClient();
  const object = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: row.storageKey }),
  );
  if (!object.Body) throw new Error("The stored file has no content.");
  const encryptedBytes = await object.Body.transformToByteArray();
  const bytes = decryptSensitiveBytes(encryptedBytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== metadata.size || checksum !== metadata.checksum) {
    throw new Error("The stored file failed its integrity check.");
  }
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [actor.activeRole],
    action: "download",
    module: "files",
    entityType: "file",
    entityId: fileId,
    reason,
    riskLevel: "High",
  });
  return { metadata, bytes };
}

export async function reassignObjectFile(
  organisationId: string,
  fileId: string,
  owner: FileOwner,
  actor: FileAuditActor,
  reason: string,
): Promise<FileMetadata> {
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(fileMetadata)
      .where(and(eq(fileMetadata.organisationId, organisationId), eq(fileMetadata.id, fileId)))
      .limit(1);
    if (!before || before.storageStatus !== "Available") {
      throw new Error("The requested file is not available.");
    }
    const [updated] = await tx
      .update(fileMetadata)
      .set({
        ownerEntityType: owner.entityType,
        ownerEntityId: owner.entityId,
        updatedAt: new Date(),
        updatedBy: actor.userId ?? owner.entityId,
        recordVersion: sql`${fileMetadata.recordVersion} + 1`,
      })
      .where(eq(fileMetadata.id, fileId))
      .returning();
    if (!updated) throw new Error("The file owner could not be changed.");
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "reassign-owner",
      module: "files",
      entityType: "file",
      entityId: fileId,
      beforeSummary: {
        owner: { entityType: before.ownerEntityType, entityId: before.ownerEntityId },
      },
      afterSummary: { owner },
      reason,
      riskLevel: "High",
    });
    return toMetadata(updated);
  });
}

export async function deleteObjectFile(
  organisationId: string,
  fileId: string,
  actor: FileAuditActor,
  reason: string,
): Promise<void> {
  const db = getDatabaseClient();
  const storageKey = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(fileMetadata)
      .where(and(eq(fileMetadata.organisationId, organisationId), eq(fileMetadata.id, fileId)))
      .limit(1);
    if (!before || before.storageStatus === "Deleted") return null;
    await tx
      .update(fileMetadata)
      .set({
        storageStatus: "Deleted",
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId ?? before.ownerEntityId,
        recordVersion: sql`${fileMetadata.recordVersion} + 1`,
      })
      .where(eq(fileMetadata.id, fileId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: "delete",
      module: "files",
      entityType: "file",
      entityId: fileId,
      beforeSummary: {
        name: before.name,
        checksum: before.checksum,
        owner: { entityType: before.ownerEntityType, entityId: before.ownerEntityId },
      },
      reason,
      riskLevel: "Critical",
    });
    return before.storageKey;
  });
  if (!storageKey) return;
  await ensureBucket();
  const { client, config } = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey }));
}

export function clearObjectStorageCacheForTests(): void {
  clientCache?.client.destroy();
  clientCache = undefined;
  bucketReady = undefined;
}
