export const CV_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function getSupportedCvMimeType(file: { name: string; type?: string }): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = (file.type ?? "").toLowerCase();
  const supportedByMime =
    mimeType === "application/pdf" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (supportedByMime) return mimeType;
  return CV_MIME_BY_EXTENSION[extension] ?? null;
}
