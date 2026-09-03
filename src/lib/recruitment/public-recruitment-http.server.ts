import "@tanstack/react-start/server-only";

import { ZodError } from "zod";

import { processNextCandidateCvJob } from "../db/repositories/candidate-cv-intake.repository.server.ts";
import { submitPublicApplicationToDatabase } from "../db/repositories/public-application.repository.server.ts";
import { listVacanciesForOrganisation } from "../db/repositories/vacancy.repository.server.ts";
import { resolveDefaultOrganisationId } from "../db/organisation.server.ts";
import {
  PublicApplicationSchema,
  validatePublicCv,
} from "./public-application-validation.server.ts";

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" },
  });
}

export async function resolvePublicRecruitmentRequest(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/api/public/vacancies") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const organisationId = await resolveDefaultOrganisationId();
    const vacancies = await listVacanciesForOrganisation(organisationId, false);
    return json(
      vacancies
        .filter((vacancy) => vacancy.status === "Open" && !vacancy.archivedAt)
        .map((vacancy) => ({
          ...vacancy,
          hiringManagerId: undefined,
          assignedOwnerId: undefined,
          notes: "",
        })),
    );
  }

  if (url.pathname !== "/api/public/applications") return undefined;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const data = PublicApplicationSchema.parse(await request.json());
    const bytes = Buffer.from(data.fileBase64, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
      return json({ error: "CV must be no larger than 10 MB." }, 400);
    }
    const mimeType = validatePublicCv(data.fileName, data.mimeType, bytes);
    const organisationId = await resolveDefaultOrganisationId();
    const result = await submitPublicApplicationToDatabase(organisationId, {
      ...data,
      mimeType,
      fileBytes: bytes,
    });
    void processNextCandidateCvJob(`public-submit:${result.applicationId}`, result.jobId).catch(
      () => undefined,
    );
    return json(
      {
        referenceId: result.referenceId,
        candidateId: result.candidateId,
        applicationId: result.applicationId,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return json({ error: "Application information is incomplete or invalid." }, 400);
    }
    if (error instanceof SyntaxError)
      return json({ error: "The application could not be read." }, 400);
    const message = error instanceof Error ? error.message : "";
    if (message === "DUPLICATE_APPLICATION") {
      return json({ error: message }, 409);
    }
    if (
      message === "This vacancy is no longer open for applications." ||
      message.startsWith("Upload a ") ||
      message.startsWith("The CV content") ||
      message === "Enter a valid phone number."
    ) {
      return json({ error: message }, 400);
    }
    console.error("Public application could not be completed.", error);
    return json({ error: "Your application could not be submitted. Please try again." }, 500);
  }
}
