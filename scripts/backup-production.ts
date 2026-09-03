import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

import {
  createStorageClient,
  databaseConnectionArgument,
  databaseEnvironment,
  encryptBackupFile,
  getBackupStorageConfig,
  getPrimaryStorageConfig,
  recordAdministrationAudit,
  runCommand,
  sha256File,
  writeEncryptedJson,
} from "./backup-support.ts";

interface ObjectManifestEntry {
  sourceKey: string;
  backupKey: string;
  encryptedSize: number;
  sourceEtag?: string;
}

interface BackupManifest {
  format: "via-hr-production-backup";
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  database: { key: string; encryptedBytes: number; sha256: string };
  tableCounts: Record<string, number>;
  objects: ObjectManifestEntry[];
}

function backupId(): string {
  return `${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}-${randomUUID()}`;
}

async function dumpConsistentSnapshot(
  databaseUrl: string,
  dumpPath: string,
): Promise<Record<string, number>> {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await client.begin(async (transaction) => {
      await transaction.unsafe("set transaction isolation level repeatable read read only");
      const snapshots = await transaction<{ snapshot_id: string }[]>`
        select pg_export_snapshot() as snapshot_id
      `;
      const snapshotId = snapshots[0]?.snapshot_id;
      if (!snapshotId) throw new Error("PostgreSQL could not create a consistent backup snapshot.");
      await runCommand(
        "pg_dump",
        [
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          `--snapshot=${snapshotId}`,
          `--file=${dumpPath}`,
          `--dbname=${databaseConnectionArgument(databaseUrl)}`,
        ],
        databaseEnvironment(databaseUrl),
      );
      const tables = await transaction<{ table_name: string }[]>`
        select tablename as table_name from pg_tables where schemaname = 'public' order by tablename
      `;
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const rows = await transaction<{ count: string }[]>`
          select count(*)::text as count from ${transaction(table.table_name)}
        `;
        counts[table.table_name] = Number(rows[0]?.count ?? 0);
      }
      return counts;
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const primary = getPrimaryStorageConfig();
  const offsite = getBackupStorageConfig();
  if (primary.endpoint === offsite.endpoint) {
    throw new Error("The backup destination must use a separate off-server storage endpoint.");
  }

  const offsiteClient = createStorageClient(offsite);
  const primaryClient = createStorageClient(primary);
  await offsiteClient.send(new HeadBucketCommand({ Bucket: offsite.bucket }));

  const id = backupId();
  const prefix = `backups/${id}`;
  const workspace = await mkdtemp(join(tmpdir(), "via-hr-backup-"));
  const dumpPath = join(workspace, "database.dump");
  const encryptedDumpPath = join(workspace, "database.dump.via");
  const manifestPath = join(workspace, "manifest.json.via");
  try {
    const tableCounts = await dumpConsistentSnapshot(databaseUrl, dumpPath);
    await encryptBackupFile(dumpPath, encryptedDumpPath);
    await rm(dumpPath, { force: true });
    const databaseKey = `${prefix}/database.dump.via`;
    const dumpInfo = await stat(encryptedDumpPath);
    const dumpChecksum = await sha256File(encryptedDumpPath);
    await offsiteClient.send(
      new PutObjectCommand({
        Bucket: offsite.bucket,
        Key: databaseKey,
        Body: createReadStream(encryptedDumpPath),
        ContentLength: dumpInfo.size,
        ContentType: "application/octet-stream",
        Metadata: { format: "via-backup-aes-256-gcm-v1", sha256: dumpChecksum },
      }),
    );

    const objects: ObjectManifestEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const page = await primaryClient.send(
        new ListObjectsV2Command({ Bucket: primary.bucket, ContinuationToken: continuationToken }),
      );
      for (const item of page.Contents ?? []) {
        if (!item.Key || !item.Size) continue;
        const source = await primaryClient.send(
          new GetObjectCommand({ Bucket: primary.bucket, Key: item.Key }),
        );
        if (!source.Body) throw new Error(`Object ${item.Key} has no readable body.`);
        const keyDigest = createHash("sha256").update(item.Key).digest("hex");
        const destinationKey = `${prefix}/objects/${keyDigest}.via`;
        await offsiteClient.send(
          new PutObjectCommand({
            Bucket: offsite.bucket,
            Key: destinationKey,
            Body: source.Body,
            ContentLength: item.Size,
            ContentType: "application/octet-stream",
            Metadata: { sourcekeysha256: keyDigest, encryptedsource: "via-aes-256-gcm-v1" },
          }),
        );
        objects.push({
          sourceKey: item.Key,
          backupKey: destinationKey,
          encryptedSize: item.Size,
          ...(item.ETag ? { sourceEtag: item.ETag } : {}),
        });
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    const manifest: BackupManifest = {
      format: "via-hr-production-backup",
      formatVersion: 1,
      backupId: id,
      createdAt: new Date().toISOString(),
      database: { key: databaseKey, encryptedBytes: dumpInfo.size, sha256: dumpChecksum },
      tableCounts,
      objects,
    };
    await writeEncryptedJson(manifestPath, manifest);
    const manifestInfo = await stat(manifestPath);
    await offsiteClient.send(
      new PutObjectCommand({
        Bucket: offsite.bucket,
        Key: `${prefix}/manifest.json.via`,
        Body: createReadStream(manifestPath),
        ContentLength: manifestInfo.size,
        ContentType: "application/octet-stream",
        Metadata: { format: "via-backup-manifest-aes-256-gcm-v1", complete: "true" },
      }),
    );
    await writeFile(join(workspace, "completed"), id);
    await recordAdministrationAudit(databaseUrl, {
      action: "backup",
      entityType: "system-backup",
      reason: "Completed encrypted off-server PostgreSQL and object-storage backup.",
      riskLevel: "Critical",
      summary: {
        backupId: id,
        encryptedDatabaseBytes: dumpInfo.size,
        objectCount: objects.length,
        destinationBucket: offsite.bucket,
      },
    });
    console.log(
      JSON.stringify({
        status: "completed",
        backupId: id,
        encryptedDatabaseBytes: dumpInfo.size,
        objectCount: objects.length,
      }),
    );
  } finally {
    primaryClient.destroy();
    offsiteClient.destroy();
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backup failed.");
  process.exitCode = 1;
});
