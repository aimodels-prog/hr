import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { cleanMandatoryCriteria } from "../data/job-description-criteria.ts";
import { ROLE_VALUES, type Role, type Vacancy } from "../data/types.ts";
import {
  listVacanciesForOrganisation,
  saveVacancyDraftInDatabase,
  transitionVacancyInDatabase,
  type VacancyDraftInput,
} from "../db/repositories/vacancy.repository.server.ts";
import {
  resolveDefaultOrganisationId,
  resolveOrganisationIdForActor,
  verifyServerActorRole,
} from "../db/utils.server.ts";

const ActorInput = z
  .object({
    actorId: z.string().min(1),
    actorEmail: z.string().email().optional(),
    activeRole: z.enum(ROLE_VALUES),
  })
  .strict();

async function verifyRecruitmentActor(data: z.infer<typeof ActorInput>) {
  const organisationId = await resolveOrganisationIdForActor(data.actorId, data.actorEmail);
  const verification = await verifyServerActorRole(
    organisationId,
    data.actorId,
    undefined,
    data.actorEmail,
  );
  if (!verification.verified || !verification.actor) {
    throw new Error("Your VIA HR user is not active or linked to this organisation.");
  }
  if (!verification.actor.roles.includes(data.activeRole as Role)) {
    throw new Error("The selected responsibility is not assigned to your account.");
  }
  if (data.activeRole !== "HR" && data.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage recruitment.");
  }
  return { organisationId, actor: { ...verification.actor, activeRole: data.activeRole } };
}

export const getPublicVacanciesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Vacancy[]> => {
    const organisationId = await resolveDefaultOrganisationId();
    const vacancies = await listVacanciesForOrganisation(organisationId, false);
    return vacancies
      .filter((vacancy) => vacancy.status === "Open" && !vacancy.archivedAt)
      .map((vacancy) => ({
        ...vacancy,
        hiringManagerId: undefined,
        assignedOwnerId: undefined,
        notes: "",
      }));
  },
);

export const getRecruitmentVacanciesFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof ActorInput>) => ActorInput.parse(input))
  .handler(async ({ data }): Promise<Vacancy[]> => {
    const verified = await verifyRecruitmentActor(data);
    return listVacanciesForOrganisation(verified.organisationId, true);
  });

const SalaryRange = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z.string().trim().length(3),
    visibleToPublic: z.boolean(),
  })
  .strict()
  .refine((value) => value.max >= value.min, "Maximum salary cannot be below minimum salary.");

const VacancyDraft = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().max(200).default(""),
    department: z.string().trim().min(1),
    location: z.string().trim().min(1),
    position: z.string().trim().min(1),
    grade: z.string().trim().min(1),
    employmentType: z.string().trim().min(1),
    hiringManagerId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    targetStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    assignedOwnerId: z.string().uuid().optional(),
    summary: z.string().max(10_000).default(""),
    responsibilities: z.array(z.string().trim().min(1)).max(100).default([]),
    requirements: z.array(z.string().trim().min(1)).max(100).default([]),
    headcount: z.number().int().positive().max(100),
    salaryRange: SalaryRange.optional(),
    hiringReason: z.string().trim().max(1000).default(""),
    education: z.string().max(3000).default(""),
    minimumExperience: z.string().max(1000).default(""),
    skills: z
      .object({
        required: z.array(z.string().trim().min(1)).max(100),
        preferred: z.array(z.string().trim().min(1)).max(100),
      })
      .strict(),
    certifications: z.array(z.string().trim().min(1)).max(100).default([]),
    languages: z.array(z.string().trim().min(1)).max(100).default([]),
    mandatoryCriteria: z.array(z.string()).max(100).optional(),
    notes: z.string().max(10_000).default(""),
    screeningQuestions: z.array(z.string().trim().min(1)).max(30).default([]),
  })
  .strict()
  .transform((value) => ({
    ...value,
    mandatoryCriteria: cleanMandatoryCriteria(value.mandatoryCriteria ?? []),
  }));

const SaveDraftRequest = z.object({ actor: ActorInput, vacancy: VacancyDraft }).strict();

export const saveVacancyDraftFn = createServerFn({ method: "POST" })
  .validator((input: z.input<typeof SaveDraftRequest>) => SaveDraftRequest.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    return saveVacancyDraftInDatabase(
      verified.organisationId,
      data.vacancy as VacancyDraftInput,
      verified.actor,
    );
  });

const TransitionRequest = z
  .object({
    actor: ActorInput,
    vacancyId: z.string().uuid(),
    status: z.enum(["Draft", "Pending Approval", "Open", "Paused", "Closed", "Archived"]),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const transitionVacancyFn = createServerFn({ method: "POST" })
  .validator((input: z.infer<typeof TransitionRequest>) => TransitionRequest.parse(input))
  .handler(async ({ data }) => {
    const verified = await verifyRecruitmentActor(data.actor);
    await transitionVacancyInDatabase(
      verified.organisationId,
      data.vacancyId,
      data.status,
      data.reason,
      verified.actor,
    );
  });
