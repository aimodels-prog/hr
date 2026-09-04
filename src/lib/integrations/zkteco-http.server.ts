import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { resolveDefaultOrganisationId } from "../db/organisation.server.ts";
import { ingestZktecoPunchBatch } from "../db/repositories/zkteco.repository.server.ts";

export const ZKTECO_INGEST_PATH = "/api/integrations/zkteco/punches";

const Punch = z
  .object({
    externalEventId: z
      .string()
      .trim()
      .min(16)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/),
    deviceUserId: z.string().trim().min(1).max(128),
    deviceUserName: z.string().trim().min(1).max(160).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    status: z.number().int().min(-1).max(255).nullable().optional(),
    punchMethod: z.number().int().min(-1).max(255).nullable().optional(),
  })
  .strict();

const Batch = z
  .object({
    serialNumber: z.string().trim().min(1).max(128).optional(),
    model: z.string().trim().min(1).max(128).optional(),
    punches: z.array(Punch).min(1).max(500),
  })
  .strict();

function json(payload: unknown, status: number): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function ingestSecret(): string {
  const secret = process.env["VIA_HR_ZKTECO_INGEST_SECRET"]?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("VIA_HR_ZKTECO_INGEST_SECRET must contain at least 32 characters.");
  }
  return secret;
}

interface ZktecoHttpDependencies {
  secret: () => string;
  organisationId: () => Promise<string>;
  ingest: typeof ingestZktecoPunchBatch;
}

const defaultDependencies: ZktecoHttpDependencies = {
  secret: ingestSecret,
  organisationId: resolveDefaultOrganisationId,
  ingest: ingestZktecoPunchBatch,
};

export function signZktecoPayload(timestamp: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

function validSignature(
  timestamp: string,
  body: string,
  supplied: string,
  secret: string,
): boolean {
  const normalized = supplied.startsWith("sha256=") ? supplied.slice(7) : supplied;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const expected = Buffer.from(signZktecoPayload(timestamp, body, secret), "hex");
  const actual = Buffer.from(normalized, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function resolveZktecoIntegrationRequest(
  request: Request,
  now = new Date(),
  dependencies: ZktecoHttpDependencies = defaultDependencies,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== ZKTECO_INGEST_PATH) return undefined;
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store, max-age=0" },
    });
  }
  const deviceCode = request.headers.get("x-via-device-id")?.trim().toLowerCase() ?? "";
  const timestamp = request.headers.get("x-via-timestamp")?.trim() ?? "";
  const signature = request.headers.get("x-via-signature")?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(deviceCode) || !/^\d{10,13}$/.test(timestamp)) {
    return json({ error: "invalid_device_authentication" }, 401);
  }
  const timestampMs = timestamp.length === 10 ? Number(timestamp) * 1000 : Number(timestamp);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now.getTime() - timestampMs) > 5 * 60_000) {
    return json({ error: "expired_device_request" }, 401);
  }
  let body = "";
  try {
    body = await request.text();
    if (!validSignature(timestamp, body, signature, dependencies.secret())) {
      return json({ error: "invalid_device_authentication" }, 401);
    }
    const batch = Batch.parse(JSON.parse(body));
    const organisationId = await dependencies.organisationId();
    const result = await dependencies.ingest(organisationId, deviceCode, batch);
    return json(result, 200);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json({ error: "invalid_punch_batch" }, 400);
    }
    const message = error instanceof Error ? error.message : "";
    if (
      message === "The attendance device is not registered or is inactive." ||
      message === "The terminal serial number does not match the registered device."
    ) {
      return json({ error: "device_not_accepted" }, 403);
    }
    console.error("A signed ZKTeco attendance batch could not be processed.", error);
    return json({ error: "attendance_ingestion_failed" }, 500);
  }
}
