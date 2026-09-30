import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import {
  buildCvZip,
  cvZipPath,
  safeZipName,
  MAX_CV_ZIP_BYTES,
} from "../src/lib/recruitment/cv-zip.ts";

const bytes = new Uint8Array([0, 255, 17, 4, 25, 0, 200]);
const entry = {
  cvRecordId: "cv-1",
  candidateId: "person-1",
  candidateName: "Alex",
  name: "original résumé.docx",
  size: bytes.length,
  checksum: createHash("sha256").update(bytes).digest("hex"),
};
test("CV ZIP keeps every byte, Unicode filenames, duplicate filenames and older versions", async () => {
  const entries = [
    entry,
    { ...entry, cvRecordId: "cv-2" },
    { ...entry, cvRecordId: "cv-3", candidateId: "person-2" },
  ];
  const progress: number[] = [];
  const blob = await buildCvZip(
    { entries, candidateCount: 3, withoutCv: [{ id: "person-3", name: "No CV" }] },
    async () => bytes,
    (done) => progress.push(done),
  );
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(Object.keys(files).length, 4);
  for (const item of entries) assert.deepEqual(files[cvZipPath(item)], bytes);
  assert.match(strFromU8(files["EXPORT-SUMMARY.txt"]!), /No CV \(person-3\)/);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(safeZipName("../../evil\\cv.pdf"), "_.._evil_cv.pdf");
});
test("CV ZIP fails closed on changed/missing files, cancellation, empty and oversized exports", async () => {
  const manifest = { entries: [entry], candidateCount: 1, withoutCv: [] };
  await assert.rejects(
    buildCvZip(manifest, async () => new Uint8Array([0])),
    /verified/,
  );
  await assert.rejects(
    buildCvZip(manifest, async () => {
      throw new Error("Unavailable");
    }),
    /Unavailable/,
  );
  await assert.rejects(
    buildCvZip({ ...manifest, entries: [] }, async () => bytes),
    /No uploaded/,
  );
  await assert.rejects(
    buildCvZip(
      { ...manifest, entries: [{ ...entry, size: MAX_CV_ZIP_BYTES + 1 }] },
      async () => bytes,
    ),
    /250 MB/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(buildCvZip(manifest, async () => bytes, undefined, abort.signal));
});
