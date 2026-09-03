import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSafeRestoreTarget,
  databaseConnectionArgument,
  decryptBackupFile,
  encryptBackupFile,
  readEncryptedJson,
  writeEncryptedJson,
} from "../scripts/backup-support.ts";

const key = Buffer.alloc(32, 71).toString("base64");

test("production backup envelopes round-trip files and manifests", async () => {
  const beforeKeyId = process.env["VIA_HR_BACKUP_ACTIVE_KEY_ID"];
  const beforeKeys = process.env["VIA_HR_BACKUP_KEYS"];
  process.env["VIA_HR_BACKUP_ACTIVE_KEY_ID"] = "test-v1";
  process.env["VIA_HR_BACKUP_KEYS"] = JSON.stringify({ "test-v1": key });
  const directory = await mkdtemp(join(tmpdir(), "via-backup-test-"));
  try {
    const source = join(directory, "source.dump");
    const encrypted = join(directory, "source.dump.via");
    const restored = join(directory, "restored.dump");
    await writeFile(source, Buffer.from("private VIA HR database material"));
    await encryptBackupFile(source, encrypted);
    assert.notDeepEqual(await readFile(encrypted), await readFile(source));
    await decryptBackupFile(encrypted, restored);
    assert.deepEqual(await readFile(restored), await readFile(source));

    const manifestPath = join(directory, "manifest.via");
    const manifest = { format: "via-hr-production-backup", objects: 4 };
    await writeEncryptedJson(manifestPath, manifest);
    assert.deepEqual(await readEncryptedJson(manifestPath), manifest);
  } finally {
    if (beforeKeyId === undefined) delete process.env["VIA_HR_BACKUP_ACTIVE_KEY_ID"];
    else process.env["VIA_HR_BACKUP_ACTIVE_KEY_ID"] = beforeKeyId;
    if (beforeKeys === undefined) delete process.env["VIA_HR_BACKUP_KEYS"];
    else process.env["VIA_HR_BACKUP_KEYS"] = beforeKeys;
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted backups reject tampering", async () => {
  process.env["VIA_HR_BACKUP_ACTIVE_KEY_ID"] = "tamper-v1";
  process.env["VIA_HR_BACKUP_KEYS"] = JSON.stringify({ "tamper-v1": key });
  const directory = await mkdtemp(join(tmpdir(), "via-backup-tamper-"));
  try {
    const source = join(directory, "source");
    const encrypted = join(directory, "encrypted");
    const restored = join(directory, "restored");
    await writeFile(source, "sensitive");
    await encryptBackupFile(source, encrypted);
    const bytes = await readFile(encrypted);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await writeFile(encrypted, bytes);
    await assert.rejects(decryptBackupFile(encrypted, restored), /authenticate|decrypt/i);
  } finally {
    delete process.env["VIA_HR_BACKUP_ACTIVE_KEY_ID"];
    delete process.env["VIA_HR_BACKUP_KEYS"];
    await rm(directory, { recursive: true, force: true });
  }
});

test("restore target guard refuses live and ambiguously named databases", () => {
  const live = "postgresql://via:secret@db:5432/via_hr";
  assert.throws(() => assertSafeRestoreTarget(live, live), /target database name|live database/i);
  assert.throws(
    () => assertSafeRestoreTarget("postgresql://via:secret@db:5432/accounting", live),
    /must contain restore/i,
  );
  assert.equal(
    assertSafeRestoreTarget("postgresql://via:secret@db:5432/via_hr_restore_drill", live),
    "via_hr_restore_drill",
  );
  assert.equal(databaseConnectionArgument(live).includes("secret"), false);
});
