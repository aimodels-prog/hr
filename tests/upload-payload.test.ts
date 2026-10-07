import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  encodeUploadFile,
  decodeUploadBytes,
  uploadBytesSchema,
  uploadByteLength,
  MAX_UPLOAD_BYTES,
} from "../src/lib/upload-payload.ts";

test("a full 10 MB binary file fits the 16 MB request limit without changing a byte", async () => {
  const original = new Uint8Array(MAX_UPLOAD_BYTES);
  for (let i = 0; i < original.length; i++) original[i] = i % 256;
  const encoded = await encodeUploadFile(new Blob([original]));
  assert.ok(
    Buffer.byteLength(JSON.stringify({ bytes: encoded, fileName: "large.pdf" })) < 16 * 1024 * 1024,
  );
  assert.equal(uploadByteLength(encoded), MAX_UPLOAD_BYTES);
  assert.ok(uploadBytesSchema().safeParse(encoded).success);
  const decoded = decodeUploadBytes(encoded);
  assert.equal(
    createHash("sha256").update(decoded).digest("hex"),
    createHash("sha256").update(original).digest("hex"),
  );
});

test("encoding is exact for every base64 padding length and supports old clients", async () => {
  for (const length of [1, 2, 3, 4, 5, 6, 1024]) {
    const bytes = Uint8Array.from({ length }, (_, i) => i % 256);
    const encoded = await encodeUploadFile(new Blob([bytes]));
    assert.equal(uploadByteLength(encoded), length);
    assert.deepEqual(decodeUploadBytes(encoded), bytes);
  }
  assert.deepEqual(decodeUploadBytes([0, 127, 255]), new Uint8Array([0, 127, 255]));
  assert.equal(uploadByteLength([1, 2, 3]), 3);
});

test("empty, malformed and oversized uploads are rejected, not truncated", async () => {
  for (const value of [
    "",
    "%%%%",
    "A===",
    "AA=A",
    "AAAA=",
    "data:application/pdf;base64,AAAA",
    [-1],
    [256],
    [1.5],
  ])
    assert.equal(uploadBytesSchema().safeParse(value).success, false);
  await assert.rejects(encodeUploadFile(new Blob([])), /non-empty/);
  await assert.rejects(encodeUploadFile(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)])), /10 MB/);
  const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64");
  assert.equal(uploadBytesSchema().safeParse(oversized).success, false);
  assert.equal(uploadBytesSchema(5).safeParse("AAAA").success, false);
});
