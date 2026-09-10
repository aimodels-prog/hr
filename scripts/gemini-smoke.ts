import { GoogleGenAI } from "@google/genai";

const apiKey = process.env["GEMINI_API_KEY"]?.trim() ?? "";
const model = process.env["VIA_HR_GEMINI_MODEL"]?.trim() || "gemini-3.6-flash";

if (!apiKey || apiKey.startsWith("PASTE_")) {
  throw new Error("GEMINI_API_KEY is not configured.");
}

function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 1_000);
}

try {
  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model,
    contents: "Return the word OK and nothing else.",
    config: { maxOutputTokens: 200, temperature: 0 },
  });
  if (!response.text?.trim()) throw new Error("Gemini returned an empty response.");
  console.log(JSON.stringify({ ok: true, model, responseReceived: true }));
} catch (error) {
  const details = error as { name?: unknown; status?: unknown; code?: unknown };
  console.error(
    JSON.stringify({
      ok: false,
      name: typeof details.name === "string" ? details.name : "Error",
      status: details.status ?? details.code ?? null,
      message: safeMessage(error),
    }),
  );
  process.exitCode = 1;
}
