import "@tanstack/react-start/server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Vacancy, VacancyStatus } from "../../data/types.ts";
import {
  cleanMandatoryCriteria,
  findMissingMandatoryCriteria,
} from "../../data/job-description-criteria.ts";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { employees } from "../schema/employee.ts";
import {
  departments,
  employmentTypes,
  grades,
  locations,
  positions,
  projects,
} from "../schema/master-data.ts";
import { vacancies, vacancyVersions } from "../schema/recruitment.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const TRANSITIONS: Record<VacancyStatus, VacancyStatus[]> = {
  Draft: ["Pending Approval", "Closed"],
  "Pending Approval": ["Open", "Draft", "Closed"],
  Open: ["Paused", "Closed"],
  Paused: ["Open", "Closed"],
  Closed: ["Archived"],
  Archived: [],
};

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function assertReadyToPublish(vacancy: Vacancy): void {
  const missing: string[] = [];
  if (!vacancy.title.trim()) missing.push("title");
  if (!vacancy.summary.trim()) missing.push("summary");
  if (vacancy.responsibilities.length === 0) missing.push("at least one responsibility");
  if (vacancy.requirements.length === 0) missing.push("at least one requirement");
  const mandatory = cleanMandatoryCriteria(vacancy.mandatoryCriteria ?? []);
  if (mandatory.length === 0) missing.push("at least one compulsory criterion");
  const criteriaMissing = findMissingMandatoryCriteria(mandatory, vacancy.requirements);
  if (criteriaMissing.length > 0) {
    missing.push(`compulsory criteria in the final requirements: ${criteriaMissing.join("; ")}`);
  }
  if (vacancy.headcount < 1) missing.push("a headcount of at least 1");
  if (missing.length > 0) {
    throw new Error(`This vacancy cannot be published yet - it is missing: ${missing.join(", ")}.`);
  }
}

export async function listVacanciesForOrganisation(
  organisationId: string,
  includeInternalSalary: boolean,
): Promise<Vacancy[]> {
  const db = getDatabaseClient();
  const [rows, departmentRows, locationRows, positionRows, gradeRows, employmentTypeRows] =
    await Promise.all([
      db
        .select()
        .from(vacancies)
        .where(eq(vacancies.organisationId, organisationId))
        .orderBy(asc(vacancies.createdAt)),
      db.select().from(departments).where(eq(departments.organisationId, organisationId)),
      db.select().from(locations).where(eq(locations.organisationId, organisationId)),
      db.select().from(positions).where(eq(positions.organisationId, organisationId)),
      db.select().from(grades).where(eq(grades.organisationId, organisationId)),
      db.select().from(employmentTypes).where(eq(employmentTypes.organisationId, organisationId)),
    ]);
  const names = (values: Array<{ id: string; name: string }>) =>
    new Map(values.map((value) => [value.id, value.name]));
  const departmentNames = names(departmentRows);
  const locationNames = names(locationRows);
  const positionNames = names(positionRows);
  const gradeNames = names(gradeRows);
  const employmentTypeNames = names(employmentTypeRows);
  return rows.map((row) => {
    const salary = row.salaryRangeEncrypted
      ? decryptSensitiveJson<{ min: number; max: number; currency: string }>(
          row.salaryRangeEncrypted,
        )
      : undefined;
    return {
      id: row.id,
      databaseId: row.id,
      createdAt: iso(row.createdAt)!,
      createdBy: row.createdBy,
      updatedAt: iso(row.updatedAt)!,
      updatedBy: row.updatedBy,
      ...(row.archivedAt ? { archivedAt: iso(row.archivedAt) } : {}),
      recordVersion: row.recordVersion,
      title: row.title,
      department: departmentNames.get(row.departmentId) ?? "Unavailable",
      location: locationNames.get(row.locationId) ?? "Unavailable",
      position: positionNames.get(row.positionId) ?? "Unavailable",
      grade: gradeNames.get(row.gradeId) ?? "Unavailable",
      employmentType: employmentTypeNames.get(row.employmentTypeId) ?? "Unavailable",
      ...(row.hiringManagerId ? { hiringManagerId: row.hiringManagerId } : {}),
      ...(row.projectId ? { projectId: row.projectId } : {}),
      ...(row.targetStartDate ? { targetStartDate: row.targetStartDate } : {}),
      ...(row.assignedOwnerId ? { assignedOwnerId: row.assignedOwnerId } : {}),
      status: row.status,
      summary: row.summary,
      responsibilities: row.responsibilities,
      requirements: row.requirements,
      applicantCount: row.applicantCount,
      headcount: row.headcount,
      ...(salary && (includeInternalSalary || row.salaryVisibleToPublic)
        ? { salaryRange: { ...salary, visibleToPublic: row.salaryVisibleToPublic } }
        : {}),
      hiringReason: row.hiringReason,
      education: row.education,
      minimumExperience: row.minimumExperience,
      skills: row.skills,
      certifications: row.certifications,
      languages: row.languages,
      ...(row.mandatoryCriteria ? { mandatoryCriteria: row.mandatoryCriteria } : {}),
      notes: row.notes,
      screeningQuestions: row.screeningQuestions,
    } satisfies Vacancy;
  });
}

export type VacancyDraftInput = Omit<
  Vacancy,
  | "id"
  | "databaseId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
  | "updatedBy"
  | "archivedAt"
  | "recordVersion"
  | "status"
  | "applicantCount"
> & { id?: string };

async function resolveVacancyRelations(
  organisationId: string,
  input: VacancyDraftInput,
  tx: Parameters<Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]>[0],
) {
  const resolveName = async (
    table:
      | typeof departments
      | typeof locations
      | typeof positions
      | typeof grades
      | typeof employmentTypes,
    name: string,
    label: string,
  ) => {
    const [record] = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.organisationId, organisationId),
          eq(table.name, name),
          eq(table.isActive, true),
          isNull(table.archivedAt),
        ),
      )
      .limit(1);
    if (!record) throw new Error(`Select an active ${label}.`);
    return record.id;
  };
  const [departmentId, locationId, positionId, gradeId, employmentTypeId] = await Promise.all([
    resolveName(departments, input.department, "department"),
    resolveName(locations, input.location, "location"),
    resolveName(positions, input.position, "position"),
    resolveName(grades, input.grade, "grade"),
    resolveName(employmentTypes, input.employmentType, "employment type"),
  ]);
  for (const [id, table, label] of [
    [input.hiringManagerId, employees, "hiring manager"],
    [input.assignedOwnerId, employees, "HR owner"],
    [input.projectId, projects, "project"],
  ] as const) {
    if (!id) continue;
    const [record] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.organisationId, organisationId), eq(table.id, id)))
      .limit(1);
    if (!record) throw new Error(`Select a valid ${label}.`);
  }
  return { departmentId, locationId, positionId, gradeId, employmentTypeId };
}

export async function saveVacancyDraftInDatabase(
  organisationId: string,
  input: VacancyDraftInput,
  actor: AuditActorContext,
): Promise<string> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage vacancies.");
  }
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const relations = await resolveVacancyRelations(organisationId, input, tx);
    const mandatoryCriteria = cleanMandatoryCriteria(input.mandatoryCriteria ?? []);
    const values = {
      title: input.title.trim(),
      ...relations,
      hiringManagerId: input.hiringManagerId,
      projectId: input.projectId,
      targetStartDate: input.targetStartDate,
      assignedOwnerId: input.assignedOwnerId,
      summary: input.summary,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      headcount: input.headcount,
      salaryRangeEncrypted: input.salaryRange
        ? encryptSensitiveJson({
            min: input.salaryRange.min,
            max: input.salaryRange.max,
            currency: input.salaryRange.currency,
          })
        : null,
      salaryVisibleToPublic: input.salaryRange?.visibleToPublic ?? false,
      hiringReason: input.hiringReason,
      education: input.education,
      minimumExperience: input.minimumExperience,
      skills: input.skills,
      certifications: input.certifications,
      languages: input.languages,
      mandatoryCriteria,
      notes: input.notes,
      screeningQuestions: input.screeningQuestions,
      updatedAt: new Date(),
      updatedBy: actor.userId!,
    };
    let vacancyId = input.id;
    let action = "update";
    if (vacancyId) {
      const [existing] = await tx
        .select({ status: vacancies.status, version: vacancies.recordVersion })
        .from(vacancies)
        .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, vacancyId)))
        .limit(1);
      if (!existing) throw new Error("Vacancy not found.");
      if (existing.status !== "Draft") throw new Error("Only draft vacancies can be edited.");
      await tx
        .update(vacancies)
        .set({ ...values, recordVersion: sql`${vacancies.recordVersion} + 1` })
        .where(eq(vacancies.id, vacancyId));
      await tx.insert(vacancyVersions).values({
        organisationId,
        vacancyId,
        versionNumber: existing.version + 1,
        responsibilities: input.responsibilities,
        requirements: input.requirements,
        mandatoryCriteria,
        createdBy: actor.userId!,
      });
    } else {
      action = "create";
      const [created] = await tx
        .insert(vacancies)
        .values({
          organisationId,
          ...values,
          status: "Draft",
          applicantCount: 0,
          createdBy: actor.userId!,
        })
        .returning({ id: vacancies.id });
      if (!created) throw new Error("The vacancy draft could not be saved.");
      vacancyId = created.id;
      await tx.insert(vacancyVersions).values({
        organisationId,
        vacancyId,
        versionNumber: 1,
        responsibilities: input.responsibilities,
        requirements: input.requirements,
        mandatoryCriteria,
        createdBy: actor.userId!,
      });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action,
      module: "recruitment",
      entityType: "vacancy",
      entityId: vacancyId,
      afterSummary: { title: input.title, status: "Draft" },
      reason: "Vacancy draft saved",
      riskLevel: "High",
    });
    return vacancyId;
  });
}

export async function transitionVacancyInDatabase(
  organisationId: string,
  vacancyId: string,
  newStatus: VacancyStatus,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage vacancies.");
  }
  const current = (await listVacanciesForOrganisation(organisationId, true)).find(
    (vacancy) => vacancy.id === vacancyId,
  );
  if (!current) throw new Error("Vacancy not found.");
  if (!TRANSITIONS[current.status].includes(newStatus)) {
    throw new Error(`Vacancy cannot move from ${current.status} to ${newStatus}.`);
  }
  if (newStatus === "Open") assertReadyToPublish(current);
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx
      .update(vacancies)
      .set({
        status: newStatus,
        archivedAt: newStatus === "Archived" ? new Date() : null,
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${vacancies.recordVersion} + 1`,
      })
      .where(and(eq(vacancies.organisationId, organisationId), eq(vacancies.id, vacancyId)));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [actor.activeRole],
      action: newStatus === "Archived" ? "archive" : "change-status",
      module: "recruitment",
      entityType: "vacancy",
      entityId: vacancyId,
      beforeSummary: { status: current.status },
      afterSummary: { status: newStatus },
      reason,
      riskLevel: "High",
    });
  });
}
