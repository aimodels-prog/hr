import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

import {
  createStorageClient,
  assertSafeRestoreTarget,
  databaseConnectionArgument,
  databaseEnvironment,
  databaseTableCounts,
  decryptBackupFile,
  getBackupStorageConfig,
  getPrimaryStorageConfig,
  readEncryptedJson,
  recordAdministrationAudit,
  runCommand,
  sha256File,
} from "./backup-support.ts";

interface BackupManifest {
  format: "via-hr-production-backup";
  formatVersion: 1;
  backupId: string;
  createdAt: string;
  database: { key: string; encryptedBytes: number; sha256: string };
  tableCounts: Record<string, number>;
  objects: Array<{ sourceKey: string; backupKey: string; encryptedSize: number }>;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function download(
  client: ReturnType<typeof createStorageClient>,
  bucket: string,
  key: string,
  path: string,
) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Backup object ${key} is empty.`);
  await pipeline(
    Readable.fromWeb(result.Body.transformToWebStream() as ReadableStream<Uint8Array>),
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
}

async function main(): Promise<void> {
  const id = argument("--backup-id")?.trim();
  const targetUrl = process.env["VIA_HR_RESTORE_DATABASE_URL"]?.trim();
  if (!id || !/^\d{14}-[0-9a-f-]{36}$/i.test(id))
    throw new Error("Use --backup-id with a valid backup identifier.");
  if (!targetUrl) throw new Error("VIA_HR_RESTORE_DATABASE_URL is required.");
  const targetDatabase = assertSafeRestoreTarget(targetUrl, process.env["DATABASE_URL"]?.trim());

  const sql = postgres(targetUrl, { max: 1, prepare: false });
  const existing = await sql<{ count: string }[]>`
    select count(*)::text as count from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `;
  if (Number(existing[0]?.count ?? 0) > 0) {
    await sql.end();
    throw new Error("Restore target is not empty. Create a new isolated database for the drill.");
  }
  await sql.end();

  const offsite = getBackupStorageConfig();
  const offsiteClient = createStorageClient(offsite);
  const workspace = await mkdtemp(join(tmpdir(), "via-hr-restore-"));
  const encryptedManifest = join(workspace, "manifest.json.via");
  const encryptedDump = join(workspace, "database.dump.via");
  const plainDump = join(workspace, "database.dump");
  let restoreClient: ReturnType<typeof createStorageClient> | undefined;
  try {
    const prefix = `backups/${id}`;
    await download(offsiteClient, offsite.bucket, `${prefix}/manifest.json.via`, encryptedManifest);
    const manifest = await readEncryptedJson<BackupManifest>(encryptedManifest);
    if (
      manifest.format !== "via-hr-production-backup" ||
      manifest.formatVersion !== 1 ||
      manifest.backupId !== id
    ) {
      throw new Error("Backup manifest identity or format is invalid.");
    }
    await download(offsiteClient, offsite.bucket, manifest.database.key, encryptedDump);
    const encryptedInfo = await stat(encryptedDump);
    if (
      encryptedInfo.size !== manifest.database.encryptedBytes ||
      (await sha256File(encryptedDump)) !== manifest.database.sha256
    ) {
      throw new Error("Encrypted database dump failed its checksum validation.");
    }
    await decryptBackupFile(encryptedDump, plainDump);
    await runCommand(
      "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        databaseConnectionArgument(targetUrl),
        plainDump,
      ],
      databaseEnvironment(targetUrl),
    );

    let restoredObjects = 0;
    if (process.argv.includes("--restore-objects")) {
      const primary = getPrimaryStorageConfig();
      const restoreBucket = process.env["VIA_HR_RESTORE_OBJECT_STORAGE_BUCKET"]?.trim();
      if (!restoreBucket)
        throw new Error("VIA_HR_RESTORE_OBJECT_STORAGE_BUCKET is required for object restoration.");
      if (primary.endpoint === offsite.endpoint && restoreBucket === offsite.bucket) {
        throw new Error("Restore object bucket cannot be the off-site backup bucket.");
      }
      if (restoreBucket === primary.bucket)
        throw new Error("Refusing to restore over the live object bucket.");
      restoreClient = createStorageClient({ ...primary, bucket: restoreBucket });
      await restoreClient.send(new HeadBucketCommand({ Bucket: restoreBucket }));
      const prior = await restoreClient.send(
        new ListObjectsV2Command({ Bucket: restoreBucket, MaxKeys: 1 }),
      );
      if ((prior.KeyCount ?? 0) > 0) throw new Error("Restore object bucket must be empty.");
      for (const item of manifest.objects) {
        const source = await offsiteClient.send(
          new GetObjectCommand({ Bucket: offsite.bucket, Key: item.backupKey }),
        );
        if (!source.Body || Number(source.ContentLength) !== item.encryptedSize) {
          throw new Error(`Backed-up object ${item.backupKey} failed validation.`);
        }
        await restoreClient.send(
          new PutObjectCommand({
            Bucket: restoreBucket,
            Key: item.sourceKey,
            Body: source.Body,
            ContentLength: item.encryptedSize,
            ContentType: "application/octet-stream",
            Metadata: { restoredfrom: id, encryption: "via-aes-256-gcm-v1" },
          }),
        );
        const restored = await restoreClient.send(
          new HeadObjectCommand({ Bucket: restoreBucket, Key: item.sourceKey }),
        );
        if (Number(restored.ContentLength) !== item.encryptedSize) {
          throw new Error(`Restored object ${item.sourceKey} failed size reconciliation.`);
        }
        restoredObjects += 1;
      }
    }

    const counts = await databaseTableCounts(targetUrl);
    const expectedEntries = Object.entries(manifest.tableCounts ?? {});
    const differences = expectedEntries.filter(([table, expected]) => counts[table] !== expected);
    const unexpectedTables = Object.keys(counts).filter(
      (table) => !(table in manifest.tableCounts),
    );
    if (expectedEntries.length === 0 || differences.length > 0 || unexpectedTables.length > 0) {
      throw new Error(
        `Database reconciliation failed for ${differences.length + unexpectedTables.length} table(s).`,
      );
    }
    const liveUrl = process.env["DATABASE_URL"]?.trim();
    if (liveUrl) {
      await recordAdministrationAudit(liveUrl, {
        action: "restore-drill",
        entityType: "system-backup",
        reason: "Verified an encrypted backup in an isolated restore environment.",
        riskLevel: "Critical",
        summary: {
          backupId: id,
          targetDatabase,
          tableCount: Object.keys(counts).length,
          restoredObjects,
        },
      });
    }
    console.log(
      JSON.stringify({
        status: "verified",
        backupId: id,
        targetDatabase,
        tableCount: Object.keys(counts).length,
        restoredObjects,
      }),
    );
  } finally {
    restoreClient?.destroy();
    offsiteClient.destroy();
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Restore drill failed.");
  process.exitCode = 1;
});
