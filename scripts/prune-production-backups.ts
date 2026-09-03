import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import { createStorageClient, getBackupStorageConfig } from "./backup-support.ts";

async function main(): Promise<void> {
  const retentionDays = Number(process.env["VIA_HR_BACKUP_RETENTION_DAYS"] ?? "35");
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) {
    throw new Error("VIA_HR_BACKUP_RETENTION_DAYS must be between 7 and 3650.");
  }
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const config = getBackupStorageConfig();
  const client = createStorageClient(config);
  try {
    let continuationToken: string | undefined;
    const deletions: string[] = [];
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: "backups/",
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified && object.LastModified.getTime() < cutoff)
          deletions.push(object.Key);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    for (let index = 0; index < deletions.length; index += 1000) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Quiet: true,
            Objects: deletions.slice(index, index + 1000).map((Key) => ({ Key })),
          },
        }),
      );
    }
    console.log(
      JSON.stringify({ status: "completed", retentionDays, deletedObjects: deletions.length }),
    );
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backup retention failed.");
  process.exitCode = 1;
});
