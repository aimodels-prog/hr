import "@tanstack/react-start/server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "via1";
const IV_BYTES = 12;
const FILE_MAGIC = Buffer.from("VIAF1", "ascii");

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

/** Encrypts arbitrary file bytes without expanding them into base64. */
export function encryptSensitiveBytes(value: Uint8Array): Buffer {
  const { activeKeyId, keys } = readKeyring();
  const key = keys.get(activeKeyId);
  if (!key) throw new FieldEncryptionConfigurationError("The active encryption key is missing.");
  const keyId = Buffer.from(activeKeyId, "utf8");
  if (keyId.length > 40) throw new FieldEncryptionConfigurationError("The key ID is too long.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([
    FILE_MAGIC,
    Buffer.from([keyId.length]),
    keyId,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

/** Authenticates and decrypts a VIA file envelope. */
export function decryptSensitiveBytes(envelope: Uint8Array): Buffer {
  const bytes = Buffer.from(envelope);
  if (bytes.length < FILE_MAGIC.length + 1 + IV_BYTES + 16) {
    throw new Error("The encrypted file has an invalid format.");
  }
  if (!bytes.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    throw new Error("The encrypted file has an unsupported format.");
  }
  const keyIdLength = bytes[FILE_MAGIC.length] ?? 0;
  const keyIdStart = FILE_MAGIC.length + 1;
  const ivStart = keyIdStart + keyIdLength;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + 16;
  if (keyIdLength < 1 || ciphertextStart > bytes.length) {
    throw new Error("The encrypted file has an invalid format.");
  }
  const keyId = bytes.subarray(keyIdStart, ivStart).toString("utf8");
  const { keys } = readKeyring();
  const key = keys.get(keyId);
  if (!key) throw new Error("The encrypted file uses an unavailable key version.");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, bytes.subarray(ivStart, tagStart));
    decipher.setAuthTag(bytes.subarray(tagStart, ciphertextStart));
    return Buffer.concat([decipher.update(bytes.subarray(ciphertextStart)), decipher.final()]);
  } catch {
    throw new Error("The encrypted file could not be authenticated or decrypted.");
  }
}
