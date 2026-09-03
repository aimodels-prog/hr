import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

import { S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";

const MAGIC = Buffer.from("VIAB1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface BackupStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function getBackupStorageConfig(): BackupStorageConfig {
  return {
    endpoint: required("VIA_HR_BACKUP_S3_ENDPOINT").replace(/\/$/, ""),
    region: process.env["VIA_HR_BACKUP_S3_REGION"]?.trim() || "us-east-1",
    bucket: required("VIA_HR_BACKUP_S3_BUCKET"),
    accessKeyId: required("VIA_HR_BACKUP_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("VIA_HR_BACKUP_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env["VIA_HR_BACKUP_S3_FORCE_PATH_STYLE"] !== "false",
  };
}

export function getPrimaryStorageConfig(): BackupStorageConfig {
  return {
    endpoint: required("VIA_HR_OBJECT_STORAGE_ENDPOINT").replace(/\/$/, ""),
    region: process.env["VIA_HR_OBJECT_STORAGE_REGION"]?.trim() || "us-east-1",
    bucket: required("VIA_HR_OBJECT_STORAGE_BUCKET"),
    accessKeyId: required("VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: required("VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    forcePathStyle: process.env["VIA_HR_OBJECT_STORAGE_FORCE_PATH_STYLE"] !== "false",
  };
}

export function createStorageClient(config: BackupStorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function readBackupKeyring(): { activeKeyId: string; keys: Map<string, Buffer> } {
  const activeKeyId = required("VIA_HR_BACKUP_ACTIVE_KEY_ID");
  const singleKey = process.env["VIA_HR_BACKUP_KEY_BASE64"]?.trim();
  const serialized = process.env["VIA_HR_BACKUP_KEYS"]?.trim();
  let parsed: unknown;
  try {
    parsed = serialized ? JSON.parse(serialized) : singleKey ? { [activeKeyId]: singleKey } : null;
  } catch {
    throw new Error("VIA_HR_BACKUP_KEYS must be a JSON object of base64-encoded keys.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Configure VIA_HR_BACKUP_KEYS or VIA_HR_BACKUP_KEY_BASE64.");
  }
  const keys = new Map<string, Buffer>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof value !== "string") {
      throw new Error("A backup encryption key entry is invalid.");
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) throw new Error(`Backup key ${id} must decode to 32 bytes.`);
    keys.set(id, key);
  }
  if (!keys.has(activeKeyId)) throw new Error("The active backup key is missing from the keyring.");
  return { activeKeyId, keys };
}

export async function encryptBackupFile(source: string, destination: string): Promise<void> {
  const { activeKeyId, keys } = readBackupKeyring();
  const key = keys.get(activeKeyId)!;
  const keyId = Buffer.from(activeKeyId, "utf8");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(destination, Buffer.concat([MAGIC, Buffer.from([keyId.length]), keyId, iv]), {
    flag: "wx",
  });
  await pipeline(createReadStream(source), cipher, createWriteStream(destination, { flags: "a" }));
  await writeFile(destination, cipher.getAuthTag(), { flag: "a" });
}

export async function decryptBackupFile(source: string, destination: string): Promise<void> {
  const info = await stat(source);
  const handle = await open(source, "r");
  try {
    const fixed = Buffer.alloc(MAGIC.length + 1);
    await handle.read(fixed, 0, fixed.length, 0);
    if (!fixed.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Backup envelope format is not supported.");
    }
    const keyLength = fixed[MAGIC.length] ?? 0;
    if (keyLength < 1 || keyLength > 40) throw new Error("Backup key identifier is invalid.");
    const headerLength = MAGIC.length + 1 + keyLength + IV_BYTES;
    if (info.size <= headerLength + TAG_BYTES) throw new Error("Backup envelope is truncated.");
    const variable = Buffer.alloc(keyLength + IV_BYTES);
    await handle.read(variable, 0, variable.length, fixed.length);
    const keyId = variable.subarray(0, keyLength).toString("utf8");
    const iv = variable.subarray(keyLength);
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, tag.length, info.size - TAG_BYTES);
    const key = readBackupKeyring().keys.get(keyId);
    if (!key) throw new Error(`Backup requires unavailable key ${keyId}.`);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(source, { start: headerLength, end: info.size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}

export async function writeEncryptedJson(path: string, value: unknown): Promise<void> {
  const plainPath = `${path}.plain`;
  await writeFile(plainPath, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  try {
    await encryptBackupFile(plainPath, path);
  } finally {
    const { unlink } = await import("node:fs/promises");
    await unlink(plainPath).catch(() => undefined);
  }
}

export async function readEncryptedJson<T>(path: string): Promise<T> {
  const plainPath = `${path}.plain`;
  await decryptBackupFile(path, plainPath);
  try {
    return JSON.parse(await readFile(plainPath, "utf8")) as T;
  } finally {
    const { unlink } = await import("node:fs/promises");
    await unlink(plainPath).catch(() => undefined);
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? `exit ${code ?? "unknown"}`}).`));
    });
  });
}

export function databaseEnvironment(url: string): NodeJS.ProcessEnv {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("Database URL is invalid.");
  return { ...process.env, PGDATABASE: url, PGPASSWORD: parsed.password };
}

/** Connection argument without a password; libpq receives the password through PGPASSWORD. */
export function databaseConnectionArgument(url: string): string {
  const parsed = new URL(url);
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("Database URL is invalid.");
  parsed.password = "";
  return parsed.toString();
}

export function assertSafeRestoreTarget(targetUrl: string, liveUrl?: string): string {
  const target = new URL(targetUrl);
  if (!/^postgres(ql)?:$/.test(target.protocol))
    throw new Error("Restore database URL is invalid.");
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/(restore|drill|test|scratch)/i.test(databaseName)) {
    throw new Error("Restore target database name must contain restore, drill, test or scratch.");
  }
  if (liveUrl && targetUrl === liveUrl)
    throw new Error("Refusing to restore over the live database.");
  return databaseName;
}

export async function recordAdministrationAudit(
  databaseUrl: string,
  input: {
    action: string;
    entityType: string;
    reason: string;
    riskLevel: "Low" | "Medium" | "High" | "Critical";
    summary: Record<string, unknown>;
  },
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const configuredOrganisation = process.env["VIA_HR_ORGANISATION_ID"]?.trim();
    const organisations = configuredOrganisation
      ? await sql<
          { id: string }[]
        >`select id::text from organisations where id = ${configuredOrganisation}::uuid and is_active = true`
      : await sql<
          { id: string }[]
        >`select id::text from organisations where is_active = true order by created_at limit 2`;
    if (organisations.length !== 1 || !organisations[0]) {
      throw new Error("A single active organisation is required to audit administration work.");
    }
    await sql`
      insert into audit_events (
        id, organisation_id, actor_display_name, active_role, actor_roles,
        action, module, entity_type, entity_id, after_summary, reason, risk_level
      ) values (
        ${randomUUID()}::uuid,
        ${organisations[0].id}::uuid,
        'VIA HR administration service', 'Super Admin', array['Super Admin'],
        ${input.action}, 'administration', ${input.entityType},
        ${randomUUID()}::uuid,
        ${sql.json(input.summary)}, ${input.reason}, ${input.riskLevel}::audit_risk_level
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function databaseTableCounts(databaseUrl: string): Promise<Record<string, number>> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const tables = await sql<{ table_name: string }[]>`
      select tablename as table_name from pg_tables where schemaname = 'public' order by tablename
    `;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await sql<{ count: string }[]>`
        select count(*)::text as count from ${sql(table.table_name)}
      `;
      counts[table.table_name] = Number(rows[0]?.count ?? 0);
    }
    return counts;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
