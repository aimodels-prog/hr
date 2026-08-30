import "@tanstack/react-start/server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "via1";
const IV_BYTES = 12;

export class FieldEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldEncryptionConfigurationError";
  }
}

interface Keyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

function readKeyring(): Keyring {
  const activeKeyId = process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"]?.trim();
  const serializedKeys = process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"]?.trim();
  if (!activeKeyId || !serializedKeys) {
    throw new FieldEncryptionConfigurationError(
      "VIA HR field-encryption keys are not configured in the server environment.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedKeys);
  } catch {
    throw new FieldEncryptionConfigurationError(
      "VIA_HR_FIELD_ENCRYPTION_KEYS must be a valid JSON object.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldEncryptionConfigurationError(
      "VIA_HR_FIELD_ENCRYPTION_KEYS must be a JSON object keyed by key ID.",
    );
  }

  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId) || typeof encoded !== "string") {
      throw new FieldEncryptionConfigurationError("A field-encryption key entry is invalid.");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) {
      throw new FieldEncryptionConfigurationError(
        `Field-encryption key ${keyId} must decode to exactly 32 bytes.`,
      );
    }
    keys.set(keyId, key);
  }
  if (!keys.has(activeKeyId)) {
    throw new FieldEncryptionConfigurationError(
      "The active field-encryption key ID is not present in the configured keyring.",
    );
  }
  return { activeKeyId, keys };
}

/**
 * Encrypts a JSON-safe value into a versioned AES-256-GCM envelope.
 * The key ID enables rotation without placing any key material in PostgreSQL.
 */
export function encryptSensitiveJson(value: unknown): string {
  const { activeKeyId, keys } = readKeyring();
  const key = keys.get(activeKeyId);
  if (!key) throw new FieldEncryptionConfigurationError("The active encryption key is missing.");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    activeKeyId,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSensitiveJson<T>(envelope: string): T {
  const [version, keyId, encodedIv, encodedTag, encodedCiphertext, ...extra] = envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !keyId ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra.length > 0
  ) {
    throw new Error("The encrypted field has an unsupported or invalid format.");
  }

  const { keys } = readKeyring();
  const key = keys.get(keyId);
  if (!key) throw new Error("The encrypted field uses an unavailable key version.");

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new Error("The encrypted field could not be authenticated or decrypted.");
  }
}

export function isEncryptedFieldEnvelope(value: string): boolean {
  return value.startsWith(`${ENVELOPE_VERSION}.`) && value.split(".").length === 5;
}
