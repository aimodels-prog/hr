import { z } from "zod";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_UPLOAD_BYTES / 3);

/** Exact binary contents, with bounded transport overhead (10 MB becomes ~13.34 MB). */
export async function encodeUploadFile(file: Blob): Promise<string> {
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES)
    throw new Error("Choose a non-empty file no larger than 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(chunks.join(""));
}

export function uploadByteLength(value: string | number[]): number {
  return typeof value === "string"
    ? (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0)
    : value.length;
}

function validBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  // No repeating capture groups: validation stays safe for multi-megabyte strings.
  return !/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding));
}

export function uploadBytesSchema(minimum = 1) {
  return z
    .union([
      z.string().min(4).max(MAX_BASE64_LENGTH).refine(validBase64, "Invalid file encoding."),
      // Accept old browser sessions while new clients use compact encoding.
      z.array(z.number().int().min(0).max(255)).min(minimum).max(MAX_UPLOAD_BYTES),
    ])
    .refine(
      (value) => uploadByteLength(value) >= minimum && uploadByteLength(value) <= MAX_UPLOAD_BYTES,
      "The file must be no larger than 10 MB and must not be empty.",
    );
}

export function decodeUploadBytes(value: string | number[]): Uint8Array {
  const validated = uploadBytesSchema().parse(value);
  if (Array.isArray(validated)) return Uint8Array.from(validated);
  const binary = atob(validated);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
