import "@tanstack/react-start/server-only";

import type { CandidateCvExtractedFields } from "../data/types.ts";

export const CV_PROCESSOR_VERSION = "via-cv-processor-2";

export interface ProductionCvExtractionResult {
  fields: CandidateCvExtractedFields;
  confidence: Partial<Record<keyof CandidateCvExtractedFields, number>>;
  warnings: string[];
  evidence: string[];
  method: "Python Service";
  documentRoute: "Direct Text" | "Searchable PDF" | "Word Document" | "OCR Required" | "Unknown";
  textQuality: number;
  semanticText: string;
}

function endpoint(): string {
  const value = process.env["VIA_HR_CV_PROCESSOR_URL"]?.trim();
  if (!value) throw new Error("The private CV processing service is not configured.");
  const parsed = new URL(value);
  if (
    process.env["NODE_ENV"] === "production" &&
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  )
    throw new Error("The CV processing service URL is invalid.");
  return parsed.toString().replace(/\/$/, "");
}

async function postProcessor(path: string, body: unknown, timeoutMilliseconds: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await fetch(`${endpoint()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isResult(value: unknown): value is Omit<ProductionCvExtractionResult, "method"> {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result["fields"] === "object" &&
    typeof result["confidence"] === "object" &&
    Array.isArray(result["warnings"]) &&
    Array.isArray(result["evidence"]) &&
    typeof result["documentRoute"] === "string" &&
    typeof result["textQuality"] === "number" &&
    typeof result["semanticText"] === "string" &&
    result["semanticText"].length > 0
  );
}

export async function extractCandidateCv(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}): Promise<ProductionCvExtractionResult> {
  const maximum = Number(process.env["VIA_HR_MAX_FILE_BYTES"] || 10 * 1024 * 1024);
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > maximum)
    throw new Error("The CV is empty or exceeds the permitted file size.");
  try {
    const response = await postProcessor(
      "/v1/extract",
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        contentBase64: Buffer.from(input.bytes).toString("base64"),
      },
      Number(process.env["VIA_HR_CV_PROCESSOR_TIMEOUT_MS"] || 120_000),
    );
    if (!response.ok) throw new Error(`CV processing failed with status ${response.status}.`);
    const result: unknown = await response.json();
    if (!isResult(result)) throw new Error("The CV processing service returned an invalid result.");
    return {
      ...result,
      method: "Python Service",
      textQuality: Math.max(0, Math.min(1, result.textQuality)),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The CV processing service timed out.");
    throw error;
  }
}

export async function calculateCvSemanticSimilarity(input: {
  vacancyText: string;
  candidateText: string;
}): Promise<{ score: number; model: string }> {
  try {
    const response = await postProcessor(
      "/v1/similarity",
      input,
      Number(process.env["VIA_HR_CV_SEMANTIC_TIMEOUT_MS"] || 30_000),
    );
    if (!response.ok) throw new Error(`Semantic matching failed with status ${response.status}.`);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object")
      throw new Error("Semantic matching returned no result.");
    const data = result as Record<string, unknown>;
    if (typeof data["score"] !== "number" || typeof data["model"] !== "string")
      throw new Error("Semantic matching returned an invalid result.");
    return { score: Math.max(0, Math.min(100, data["score"])), model: data["model"] };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("Semantic CV matching timed out.");
    throw error;
  }
}

export async function calculateCvSemanticSimilarities(input: {
  vacancyText: string;
  candidates: Array<{ candidateId: string; candidateText: string }>;
}): Promise<{ model: string; results: Array<{ candidateId: string; score: number }> }> {
  if (input.candidates.length < 1 || input.candidates.length > 500)
    throw new Error("A Candidate Pool matching batch must contain between 1 and 500 candidates.");
  try {
    const response = await postProcessor(
      "/v1/similarities",
      input,
      Number(process.env["VIA_HR_CV_SEMANTIC_TIMEOUT_MS"] || 30_000),
    );
    if (!response.ok)
      throw new Error(`Candidate Pool matching failed with status ${response.status}.`);
    const result: unknown = await response.json();
    if (!result || typeof result !== "object")
      throw new Error("Candidate Pool matching returned no result.");
    const data = result as Record<string, unknown>;
    if (typeof data["model"] !== "string" || !Array.isArray(data["results"]))
      throw new Error("Candidate Pool matching returned an invalid result.");
    const results = data["results"].map((item) => {
      if (!item || typeof item !== "object") throw new Error("A pool match is invalid.");
      const row = item as Record<string, unknown>;
      if (typeof row["candidateId"] !== "string" || typeof row["score"] !== "number")
        throw new Error("A pool match is invalid.");
      return {
        candidateId: row["candidateId"],
        score: Math.max(0, Math.min(100, row["score"])),
      };
    });
    return { model: data["model"], results };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("Candidate Pool semantic matching timed out.");
    throw error;
  }
}
