import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEnvironmentFile,
  validateProductionEnvironment,
} from "../scripts/production-preflight.ts";

const fieldKey = Buffer.alloc(32, 7).toString("base64");
const backupKey = Buffer.alloc(32, 8).toString("base64");

function validEnvironment(): Record<string, string> {
  const databasePassword = "database-secret-1234567890-ab";
  return {
    VIA_HR_APP_BIND_ADDRESS: "127.0.0.1",
    VIA_HR_APP_PORT: "8082",
    VIA_HR_CAREERS_APP_PORT: "8083",
    VIA_HR_IMAGE_TAG: "release-2026.09.02-a1b2c3d",
    VIA_HR_POSTGRES_DB: "via_hr",
    VIA_HR_POSTGRES_USER: "via_hr_app",
    VIA_HR_POSTGRES_PASSWORD: databasePassword,
    VIA_HR_DATABASE_URL: `postgresql://via_hr_app:${databasePassword}@postgres:5432/via_hr`,
    VIA_HR_ORGANISATION_ID: "72c7c2fe-cfc4-4fae-af4d-b37c4d752c84",
    VIA_HR_DATABASE_POOL_SIZE: "10",
    VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT: "true",
    VIA_HR_TRUST_PROXY: "true",
    PORTAL_SSO_ENABLED: "true",
    PORTAL_URL: "https://portal.via-int.com",
    PORTAL_SSO_ISSUER: "via-portal",
    PORTAL_SSO_AUDIENCE: "via-hr",
    PORTAL_APP_SLUG: "via-hr",
    PORTAL_SSO_ALGORITHM: "HS256",
    PORTAL_TOKEN_LIFETIME_SECONDS: "120",
    PORTAL_SSO_SECRET: "portal-sso-secret-1234567890-abcdefgh",
    ALLOWED_EMAIL_DOMAIN: "via-int.com",
    APP_ORIGIN: "https://hr.via-int.com",
    VIA_HR_CAREERS_ORIGIN: "https://careers.via-int.com",
    PORTAL_CALLBACK_URL: "https://hr.via-int.com/auth/portal/callback",
    POST_LOGIN_URL: "https://hr.via-int.com/dashboard",
    POST_LOGOUT_URL: "https://portal.via-int.com",
    VIA_HR_SESSION_LIFETIME_SECONDS: "28800",
    VIA_HR_ALLOW_PASSWORD_LOGIN: "false",
    VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID: "field-v1",
    VIA_HR_FIELD_ENCRYPTION_KEYS: JSON.stringify({ "field-v1": fieldKey }),
    VIA_HR_OBJECT_STORAGE_BUCKET: "via-hr-files",
    VIA_HR_OBJECT_STORAGE_ACCESS_KEY_ID: "viahraccesskey01",
    VIA_HR_OBJECT_STORAGE_SECRET_ACCESS_KEY: "object-secret-1234567890-abcdefghij",
    VIA_HR_MAX_FILE_BYTES: "10485760",
    VIA_HR_MAX_REQUEST_BYTES: "16777216",
    VIA_HR_MUTATION_RATE_LIMIT: "1200",
    VIA_HR_READ_RATE_LIMIT: "3000",
    VIA_HR_BACKUP_S3_ENDPOINT: "https://s3.backups.via-international.com",
    VIA_HR_BACKUP_S3_BUCKET: "via-hr-offsite-backups",
    VIA_HR_BACKUP_S3_ACCESS_KEY_ID: "backup-access-key",
    VIA_HR_BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret-1234567890-abcdef",
    VIA_HR_BACKUP_ACTIVE_KEY_ID: "backup-v1",
    VIA_HR_BACKUP_KEYS: JSON.stringify({ "backup-v1": backupKey }),
    VIA_HR_BACKUP_RETENTION_DAYS: "35",
  };
}

test("production preflight accepts an isolated, encrypted configuration", () => {
  const result = validateProductionEnvironment(validEnvironment());
  assert.deepEqual(result.errors, []);
  assert.ok(result.checks.length >= 7);
});

test("production preflight rejects placeholders, mutable releases and unsafe storage", () => {
  const values = validEnvironment();
  values["VIA_HR_IMAGE_TAG"] = "latest";
  values["VIA_HR_POSTGRES_PASSWORD"] = "replace-with-password";
  values["VIA_HR_DATABASE_URL"] = "postgresql://via_hr_app:wrong@localhost:5432/via_hr";
  values["VIA_HR_BACKUP_S3_ENDPOINT"] = "http://object-storage:9000";
  values["VIA_HR_BACKUP_KEYS"] = values["VIA_HR_FIELD_ENCRYPTION_KEYS"];
  values["VIA_HR_BACKUP_ACTIVE_KEY_ID"] = "field-v1";
  values["VIA_HR_ALLOW_INSECURE_LOOPBACK"] = "true";
  const result = validateProductionEnvironment(values);
  assert.match(result.errors.join("\n"), /placeholder/i);
  assert.match(result.errors.join("\n"), /immutable/i);
  assert.match(result.errors.join("\n"), /private postgres/i);
  assert.match(result.errors.join("\n"), /outside the VIA server/i);
  assert.match(result.errors.join("\n"), /different keys/i);
  assert.match(result.errors.join("\n"), /loopback/i);
  assert.ok(!result.checks.includes("release image tag is immutable"));
  assert.ok(!result.checks.includes("database isolation and credentials are consistent"));
});

test("environment parser handles comments and reports duplicate assignments", () => {
  const parsed = parseEnvironmentFile(
    "# VIA\nVIA_HR_IMAGE_TAG=release-1\nexport VIA_HR_APP_PORT='8082'\nVIA_HR_APP_PORT=8083\n",
  );
  assert.equal(parsed.values["VIA_HR_IMAGE_TAG"], "release-1");
  assert.equal(parsed.values["VIA_HR_APP_PORT"], "8083");
  assert.deepEqual(parsed.duplicateKeys, ["VIA_HR_APP_PORT"]);
});

test("environment parser rejects malformed lines", () => {
  assert.throws(() => parseEnvironmentFile("VIA_HR_IMAGE_TAG release"), /line 1/i);
});
