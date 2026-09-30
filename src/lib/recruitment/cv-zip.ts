import { Zip, ZipPassThrough, strToU8 } from "fflate";

export const MAX_CV_ZIP_BYTES = 250 * 1024 * 1024;
export interface CvZipEntry {
  cvRecordId: string;
  candidateId: string;
  candidateName: string;
  name: string;
  size: number;
  checksum: string;
}
export interface CvZipManifest {
  entries: CvZipEntry[];
  withoutCv: { id: string; name: string }[];
  candidateCount: number;
}

export function safeZipName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    // Strip control characters and path separators from untrusted original filenames.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
    .replace(/^\.+|[. ]+$/g, "");
  return cleaned || "CV";
}

export function cvZipPath(entry: CvZipEntry): string {
  return `${safeZipName(entry.candidateName).slice(0, 70)}_${entry.candidateId}/${entry.cvRecordId}/${safeZipName(entry.name)}`;
}

/** Never returns a partial archive. File bytes are stored, not converted or recompressed. */
export async function buildCvZip(
  manifest: CvZipManifest,
  read: (entry: CvZipEntry) => Promise<Uint8Array>,
  progress: (done: number, total: number) => void = () => {},
  signal?: AbortSignal,
): Promise<Blob> {
  if (!manifest.entries.length) throw new Error("No uploaded CVs were found for these candidates.");
  if (manifest.entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_CV_ZIP_BYTES)
    throw new Error(
      "This export exceeds 250 MB. Filter the candidate list into smaller groups and try again.",
    );
  const chunks: BlobPart[] = [];
  let failure: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(new Uint8Array(chunk).buffer);
  });
  const add = (name: string, bytes: Uint8Array) => {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(bytes, true);
    if (failure) throw failure;
  };
  try {
    let done = 0;
    for (const entry of manifest.entries) {
      signal?.throwIfAborted();
      const bytes = await read(entry);
      signal?.throwIfAborted();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (bytes.length !== entry.size || hash !== entry.checksum)
        throw new Error(
          `The original CV could not be verified: ${entry.name}. No ZIP was downloaded. Please refresh and retry.`,
        );
      add(cvZipPath(entry), bytes);
      progress(++done, manifest.entries.length);
    }
    add(
      "EXPORT-SUMMARY.txt",
      strToU8(
        [
          "VIA HR — original CV export",
          `Created: ${new Date().toISOString()}`,
          `${manifest.candidateCount} candidates; ${manifest.entries.length} original CV files.`,
          "All saved, non-archived CV versions are included. Contents are unchanged; unsafe filename characters are replaced for safe extraction.",
          "Candidates with no saved CV:",
          ...manifest.withoutCv.map((candidate) => `${candidate.name} (${candidate.id})`),
          ...(manifest.withoutCv.length ? [] : ["None"]),
        ].join("\r\n"),
      ),
    );
    zip.end();
    if (failure) throw failure;
    return new Blob(chunks, { type: "application/zip" });
  } catch (error) {
    zip.terminate();
    chunks.length = 0;
    throw error;
  }
}
