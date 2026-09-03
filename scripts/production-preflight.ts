import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PreflightResult {
  checks: string[];
  errors: string[];
}

const PLACEHOLDER = /(replace[-_ ]with|change[-_ ]me|example|placeholder|your[-_ ])/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unquote(value: string): string {
  if (value.length >= 2 && value[0] === value[value.length - 1] && /["']/.test(value[0]!)) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvironmentFile(contents: string): {
  values: Record<string, string>;
  duplicateKeys: string[];
} {
  const values: Record<string, string> = {};
  const duplicateKeys = new Set<string>();
  for (const [index, rawLine] of contents
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`Invalid environment assignment on line ${index + 1}.`);
    const key = match[1]!;
    if (Object.hasOwn(values, key)) duplicateKeys.add(key);
    values[key] = unquote(match[2]!.trim());
  }
  return { values, duplicateKeys: [...duplicateKeys].sort() };
}

function validBase64Key(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value;
}

function readKeyring(
  values: Record<string, string>,
  activeName: string,
  keyringName: string,
  singleKeyName?: string,
): { activeKey?: Buffer; error?: string } {
  const active = values[activeName]?.trim();
  const serialized = values[keyringName]?.trim();
  const single = singleKeyName ? values[singleKeyName]?.trim() : undefined;
  if (!active || !/^[A-Za-z0-9_-]{1,40}$/.test(active)) {
    return { error: `${activeName} must contain a valid key identifier.` };
  }
  let parsed: unknown;
  try {
    parsed = serialized ? JSON.parse(serialized) : single ? { [active]: single } : null;
  } catch {
    return { error: `${keyringName} must be a valid JSON object.` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: `${keyringName} must contain a versioned keyring.` };
  }
  const entries = Object.entries(parsed);
  if (
    entries.length === 0 ||
    entries.some(
      ([id, value]) =>
        !/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof value !== "string" || !validBase64Key(value),
    )
  ) {
    return { error: `${keyringName} entries must be base64-encoded 32-byte keys.` };
  }
  const encoded = (parsed as Record<string, string>)[active];
  if (!encoded) return { error: `${activeName} is not present in ${keyringName}.` };
  return { activeKey: Buffer.from(encoded, "base64") };
}

function integer(
  values: Record<string, string>,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = Number(values[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : undefined;
}

export function validateProductionEnvironment(values: Record<string, string>): PreflightResult {
  const errors: string[] = [];
  const checks: string[] = [];
  const required = [
    "VIA_HR_IMAGE_TAG",
    "VIA_HR_POSTGRES_DB",
    "VIA_HR_POSTGRES_USER",
    "VIA_HR_POSTGRES_PASSWORD",
    "VIA_HR_DATABASE_URL",
    "VIA_HR_ORGANISATION_ID",
    "VIA_HR_CAREERS_ORIGIN",
    "PORTAL_URL",
    "PORTAL_SSO_ISSUER",
    "PORTAL_SSO_AUDIENCE",
    "PORTAL_APP_SLUG",
    "PORTAL_SSO_ALGORITHM",
    "PORTAL_SSO_SECRET",
    "ALLOWED_EMAIL_DOMAIN",
    "APP_ORIGIN",
    "PORTAL_CALLBACK_URL",
    "POST_LOGIN_URL",
    "POST_LOGOUT_URL",
    "VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID",
    "VIA_HR_FIELD_ENCRYPTION_KEYS",
    "VIA_HR_OBJECT_STORAGE_BUCKET",
    "VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID",
    "VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY",
    "VIA_HR_BACKUP_S3_ENDPOINT",
    "VIA_HR_BACKUP_S3_BUCKET",
    "VIA_HR_BACKUP_S3_ACCESS_KEY_ID",
    "VIA_HR_BACKUP_S3_SECRET_ACCESS_KEY",
    "VIA_HR_BACKUP_ACTIVE_KEY_ID",
  ];
  for (const name of required) {
    const value = values[name]?.trim();
    if (!value || PLACEHOLDER.test(value))
      errors.push(`${name} is missing or still contains a placeholder.`);
  }
  if (errors.length === 0) checks.push("required production values are present");

  const imageTag = values["VIA_HR_IMAGE_TAG"]?.trim();
  if (
    !imageTag ||
    /^(local|latest|development|dev|main|master)$/i.test(imageTag) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/.test(imageTag)
  ) {
    errors.push(
      "VIA_HR_IMAGE_TAG must be an immutable release or commit identifier, not a mutable development tag.",
    );
  } else if (!errors.some((error) => error.includes("VIA_HR_IMAGE_TAG"))) {
    checks.push("release image tag is immutable");
  }

  if (values["VIA_HR_APP_BIND_ADDRESS"] !== "127.0.0.1")
    errors.push("VIA_HR_APP_BIND_ADDRESS must be 127.0.0.1.");
  if (!integer(values, "VIA_HR_APP_PORT", 1024, 65_535))
    errors.push("VIA_HR_APP_PORT must be between 1024 and 65535.");
  if (!integer(values, "VIA_HR_CAREERS_APP_PORT", 1024, 65_535))
    errors.push("VIA_HR_CAREERS_APP_PORT must be between 1024 and 65535.");
  if (values["VIA_HR_CAREERS_APP_PORT"] === values["VIA_HR_APP_PORT"])
    errors.push("Staff and careers containers must use different host ports.");
  if (values["VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT"] !== "true")
    errors.push("Attendance network enforcement must be enabled in production.");
  if (values["VIA_HR_TRUST_PROXY"] !== "true")
    errors.push("Trusted-proxy processing must be enabled behind the reviewed reverse proxy.");
  if (!UUID.test(values["VIA_HR_ORGANISATION_ID"] ?? ""))
    errors.push("VIA_HR_ORGANISATION_ID must be a UUID.");
  if (!errors.some((error) => /app_bind|app_port|attendance|proxy|organisation/i.test(error)))
    checks.push("network binding and organisation scope are safe");

  if (values["PORTAL_SSO_ENABLED"] !== "true")
    errors.push("VIA Portal SSO must be enabled in production.");
  if (values["VIA_HR_ALLOW_PASSWORD_LOGIN"] !== "false")
    errors.push("Password login must remain disabled in production.");
  if (values["VIA_HR_ALLOW_INSECURE_LOOPBACK"] === "true")
    errors.push("Insecure loopback origins are permitted only in isolated release tests.");
  if (values["PORTAL_SSO_ISSUER"] !== "via-portal")
    errors.push("PORTAL_SSO_ISSUER must be via-portal.");
  if (values["PORTAL_SSO_AUDIENCE"] !== "via-hr")
    errors.push("PORTAL_SSO_AUDIENCE must be via-hr.");
  if (values["PORTAL_APP_SLUG"] !== "via-hr") errors.push("PORTAL_APP_SLUG must be via-hr.");
  if (values["PORTAL_SSO_ALGORITHM"] !== "HS256")
    errors.push("PORTAL_SSO_ALGORITHM must be HS256.");
  if (values["ALLOWED_EMAIL_DOMAIN"] !== "via-int.com")
    errors.push("ALLOWED_EMAIL_DOMAIN must be via-int.com.");
  if (!integer(values, "PORTAL_TOKEN_LIFETIME_SECONDS", 1, 300))
    errors.push("PORTAL_TOKEN_LIFETIME_SECONDS must be between 1 and 300 seconds.");
  if (!integer(values, "VIA_HR_SESSION_LIFETIME_SECONDS", 1, 28_800))
    errors.push("VIA_HR_SESSION_LIFETIME_SECONDS must not exceed eight hours.");
  if (Buffer.byteLength(values["PORTAL_SSO_SECRET"] ?? "", "utf8") < 32)
    errors.push("PORTAL_SSO_SECRET must contain at least 32 bytes.");

  let portalUrl: URL | undefined;
  let appOrigin: URL | undefined;
  let careersOrigin: URL | undefined;
  let callbackUrl: URL | undefined;
  let postLoginUrl: URL | undefined;
  let postLogoutUrl: URL | undefined;
  for (const [name, assign] of [
    ["PORTAL_URL", (url: URL) => (portalUrl = url)],
    ["APP_ORIGIN", (url: URL) => (appOrigin = url)],
    ["VIA_HR_CAREERS_ORIGIN", (url: URL) => (careersOrigin = url)],
    ["PORTAL_CALLBACK_URL", (url: URL) => (callbackUrl = url)],
    ["POST_LOGIN_URL", (url: URL) => (postLoginUrl = url)],
    ["POST_LOGOUT_URL", (url: URL) => (postLogoutUrl = url)],
  ] as const) {
    try {
      const parsed = new URL(values[name] ?? "");
      if (parsed.protocol !== "https:") throw new Error("HTTPS required");
      assign(parsed);
    } catch {
      errors.push(`${name} must be a valid HTTPS URL.`);
    }
  }
  if (portalUrl?.origin !== "https://portal.via-int.com")
    errors.push("PORTAL_URL must identify https://portal.via-int.com.");
  if (appOrigin?.origin !== "https://hr.via-int.com")
    errors.push("APP_ORIGIN must identify the private https://hr.via-int.com staff application.");
  if (careersOrigin?.origin !== "https://careers.via-int.com")
    errors.push("VIA_HR_CAREERS_ORIGIN must identify https://careers.via-int.com.");
  if (appOrigin && careersOrigin && appOrigin.origin === careersOrigin.origin)
    errors.push("The private HR and public careers origins must be different.");
  if (
    appOrigin &&
    callbackUrl &&
    (callbackUrl.origin !== appOrigin.origin || callbackUrl.pathname !== "/auth/portal/callback")
  ) {
    errors.push("PORTAL_CALLBACK_URL must be APP_ORIGIN/auth/portal/callback.");
  }
  if (
    appOrigin &&
    postLoginUrl &&
    (postLoginUrl.origin !== appOrigin.origin || postLoginUrl.pathname !== "/dashboard")
  ) {
    errors.push("POST_LOGIN_URL must be APP_ORIGIN/dashboard.");
  }
  if (portalUrl && postLogoutUrl && postLogoutUrl.origin !== portalUrl.origin)
    errors.push("POST_LOGOUT_URL must return to VIA Portal.");
  if (!errors.some((error) => /PORTAL|APP_ORIGIN|Password login|eight hours/i.test(error)))
    checks.push("VIA Portal SSO and local session policy are safe");

  let databaseUrl: URL | undefined;
  try {
    databaseUrl = new URL(values["VIA_HR_DATABASE_URL"] ?? "");
  } catch {
    errors.push("VIA_HR_DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (databaseUrl) {
    if (!/^postgres(?:ql)?:$/.test(databaseUrl.protocol))
      errors.push("VIA_HR_DATABASE_URL must use PostgreSQL.");
    if (databaseUrl.hostname !== "postgres" || databaseUrl.port !== "5432")
      errors.push(
        "The production database URL must use the private postgres:5432 Compose service.",
      );
    if (decodeURIComponent(databaseUrl.username) !== values["VIA_HR_POSTGRES_USER"])
      errors.push("The database URL user does not match VIA_HR_POSTGRES_USER.");
    if (decodeURIComponent(databaseUrl.password) !== values["VIA_HR_POSTGRES_PASSWORD"])
      errors.push("The database URL password does not match VIA_HR_POSTGRES_PASSWORD.");
    if (decodeURIComponent(databaseUrl.pathname.slice(1)) !== values["VIA_HR_POSTGRES_DB"])
      errors.push("The database URL name does not match VIA_HR_POSTGRES_DB.");
  }
  if ((values["VIA_HR_POSTGRES_PASSWORD"]?.length ?? 0) < 24)
    errors.push("The PostgreSQL password must contain at least 24 characters.");
  if (!errors.some((error) => /database|postgres/i.test(error)))
    checks.push("database isolation and credentials are consistent");

  const fieldKeys = readKeyring(
    values,
    "VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID",
    "VIA_HR_FIELD_ENCRYPTION_KEYS",
  );
  if (fieldKeys.error) errors.push(fieldKeys.error);
  else checks.push("field-encryption keyring is valid");
  const backupKeys = readKeyring(
    values,
    "VIA_HR_BACKUP_ACTIVE_KEY_ID",
    "VIA_HR_BACKUP_KEYS",
    "VIA_HR_BACKUP_KEY_BASE64",
  );
  if (backupKeys.error) errors.push(backupKeys.error);
  else checks.push("backup-encryption keyring is valid");
  if (
    fieldKeys.activeKey &&
    backupKeys.activeKey &&
    fieldKeys.activeKey.equals(backupKeys.activeKey)
  )
    errors.push("Field encryption and backup encryption must use different keys.");

  const databaseSecret = values["VIA_HR_POSTGRES_PASSWORD"];
  const objectSecret = values["VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY"];
  const backupSecret = values["VIA_HR_BACKUP_S3_SECRET_ACCESS_KEY"];
  const portalSecret = values["PORTAL_SSO_SECRET"];
  if ((values["VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID"]?.length ?? 0) < 12)
    errors.push("The object-storage access key must contain at least 12 characters.");
  if ((objectSecret?.length ?? 0) < 32)
    errors.push("The object-storage secret must contain at least 32 characters.");
  if ((backupSecret?.length ?? 0) < 24)
    errors.push("The backup-storage secret must contain at least 24 characters.");
  if (
    [databaseSecret, objectSecret, backupSecret, portalSecret].filter(Boolean).length !==
    new Set([databaseSecret, objectSecret, backupSecret, portalSecret].filter(Boolean)).size
  )
    errors.push(
      "Database, object-storage, backup-storage and Portal SSO secrets must be different.",
    );

  let backupEndpoint: URL | undefined;
  try {
    backupEndpoint = new URL(values["VIA_HR_BACKUP_S3_ENDPOINT"] ?? "");
  } catch {
    errors.push("VIA_HR_BACKUP_S3_ENDPOINT is not a valid URL.");
  }
  if (
    backupEndpoint &&
    (backupEndpoint.protocol !== "https:" ||
      /^(localhost|127\.0\.0\.1|object-storage|minio)$/i.test(backupEndpoint.hostname))
  ) {
    errors.push("The backup destination must be an HTTPS endpoint outside the VIA server stack.");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values["VIA_HR_OBJECT_STORAGE_BUCKET"] ?? ""))
    errors.push("The object-storage bucket name is invalid.");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(values["VIA_HR_BACKUP_S3_BUCKET"] ?? ""))
    errors.push("The backup bucket name is invalid.");
  if (values["VIA_HR_OBJECT_STORAGE_BUCKET"] === values["VIA_HR_BACKUP_S3_BUCKET"])
    errors.push("Primary object storage and off-server backup storage must use different buckets.");
  if (!errors.some((error) => /object.storage|backup|secret/i.test(error)))
    checks.push("primary and off-server storage are separated");

  const maxFile = integer(values, "VIA_HR_MAX_FILE_BYTES", 1_048_576, 52_428_800);
  const maxRequest = integer(values, "VIA_HR_MAX_REQUEST_BYTES", 1_048_576, 104_857_600);
  if (!maxFile) errors.push("VIA_HR_MAX_FILE_BYTES must be between 1 MiB and 50 MiB.");
  if (!maxRequest || (maxFile !== undefined && maxRequest < maxFile))
    errors.push(
      "VIA_HR_MAX_REQUEST_BYTES must be at least the file limit and no more than 100 MiB.",
    );
  if (!integer(values, "VIA_HR_DATABASE_POOL_SIZE", 2, 50))
    errors.push("VIA_HR_DATABASE_POOL_SIZE must be between 2 and 50.");
  if (
    !integer(values, "VIA_HR_MUTATION_RATE_LIMIT", 1, 100_000) ||
    !integer(values, "VIA_HR_READ_RATE_LIMIT", 1, 100_000)
  )
    errors.push("Read and mutation rate limits must be positive integers no greater than 100000.");
  if (!integer(values, "VIA_HR_BACKUP_RETENTION_DAYS", 7, 3650))
    errors.push("VIA_HR_BACKUP_RETENTION_DAYS must be between 7 and 3650.");
  if (!errors.some((error) => /BYTES|POOL|rate limits|RETENTION/.test(error)))
    checks.push("resource, rate and retention limits are valid");

  return { checks, errors: [...new Set(errors)] };
}

export function runProductionPreflight(path: string): PreflightResult {
  const absolutePath = resolve(path);
  const { values, duplicateKeys } = parseEnvironmentFile(readFileSync(absolutePath, "utf8"));
  const result = validateProductionEnvironment(values);
  if (duplicateKeys.length > 0)
    result.errors.unshift(`Duplicate environment keys: ${duplicateKeys.join(", ")}.`);
  if (process.platform !== "win32" && (statSync(absolutePath).mode & 0o077) !== 0) {
    result.errors.unshift(
      "The production environment file must be restricted to its owner (chmod 600).",
    );
  }
  return result;
}

function main(): void {
  const argumentIndex = process.argv.indexOf("--env-file");
  const envFile = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : ".env.production";
  if (!envFile) throw new Error("Provide a path after --env-file.");
  const result = runProductionPreflight(envFile);
  for (const check of result.checks) console.log(`PASS: ${check}`);
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: VIA HR production configuration is ready for deployment.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `FAIL: ${error instanceof Error ? error.message : "Production preflight failed."}`,
    );
    process.exitCode = 1;
  }
}
