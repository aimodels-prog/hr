import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";

import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import { employees, roles, userRoles, users } from "../src/lib/db/schema/employee.ts";
import {
  departments,
  employmentTypes,
  grades,
  locations,
  positions,
} from "../src/lib/db/schema/master-data.ts";
import { organisations } from "../src/lib/db/schema/organisation.ts";
import { vacancies, vacancyVersions } from "../src/lib/db/schema/recruitment.ts";
import { auditEvents } from "../src/lib/db/schema/system.ts";
import {
  existingSalalahQuantitySurveyorHeadcount,
  salalahBuildingAdverts,
} from "../src/lib/recruitment/salalah-building-adverts.ts";

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const ORGANISATION_NAME = "VIA International";
const OWNER_EMAIL = "hr@via-int.com";
const REASON = "Owner-requested Salalah building project vacancies and headcounts.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOptions(args: string[]): { organisationId: string; apply: boolean } {
  const organisationId = args
    .find((arg) => arg.startsWith("--organisation-id="))
    ?.slice("--organisation-id=".length);
  const apply = args.includes("--apply");
  if (
    args.length !== 2 ||
    !organisationId ||
    !UUID.test(organisationId) ||
    (apply && args.includes("--dry-run")) ||
    (!apply && !args.includes("--dry-run"))
  ) {
    throw new Error(
      "Usage: node --experimental-transform-types scripts/publish-salalah-building-vacancies.ts " +
        "--organisation-id=UUID --dry-run|--apply",
    );
  }
  return { organisationId, apply };
}

export async function publishSalalahBuildingVacancies(options: {
  organisationId: string;
  apply: boolean;
}): Promise<void> {
  const db = getDatabaseClient();
  const published: { title: string; slug: string }[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`via-salalah-building:${options.organisationId}`}, 0))`,
    );
    const [organisation] = await tx
      .select({ name: organisations.name })
      .from(organisations)
      .where(
        and(
          eq(organisations.id, options.organisationId),
          eq(organisations.isActive, true),
          isNull(organisations.archivedAt),
        ),
      );
    if (organisation?.name !== ORGANISATION_NAME)
      throw new Error("The active VIA International organisation was not found.");

    const owners = await tx
      .select({ employeeId: employees.id, userId: users.id })
      .from(employees)
      .innerJoin(
        users,
        and(eq(users.employeeId, employees.id), eq(users.organisationId, employees.organisationId)),
      )
      .where(
        and(
          eq(employees.organisationId, options.organisationId),
          eq(employees.workEmail, OWNER_EMAIL),
          eq(users.workspaceEmail, OWNER_EMAIL),
          eq(employees.status, "Active"),
          eq(users.status, "Active"),
          isNull(employees.archivedAt),
          isNull(users.archivedAt),
        ),
      );
    if (owners.length !== 1) throw new Error("The active HR vacancy owner was not found.");
    const [hrAssignment] = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.organisationId, options.organisationId),
          eq(userRoles.userId, owners[0]!.userId),
          eq(roles.code, "HR"),
          isNull(roles.archivedAt),
        ),
      );
    if (!hrAssignment) throw new Error("The vacancy owner does not have HR access.");

    const activeMaster = and(
      eq(departments.organisationId, options.organisationId),
      eq(departments.isActive, true),
      isNull(departments.archivedAt),
    );
    const departmentRows = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(activeMaster);
    const departmentIds = new Map(departmentRows.map((row) => [row.name, row.id]));
    const gradeRows = await tx
      .select({ id: grades.id, name: grades.name })
      .from(grades)
      .where(
        and(
          eq(grades.organisationId, options.organisationId),
          eq(grades.isActive, true),
          isNull(grades.archivedAt),
        ),
      );
    const gradeIds = new Map(gradeRows.map((row) => [row.name, row.id]));
    if (
      !departmentIds.get("Engineering") ||
      !departmentIds.get("Administration") ||
      !gradeIds.get("Engineers") ||
      !gradeIds.get("Administration")
    ) {
      throw new Error("Required Engineering and Administration departments or grades are missing.");
    }
    const [employmentType] = await tx
      .select({ id: employmentTypes.id })
      .from(employmentTypes)
      .where(
        and(
          eq(employmentTypes.organisationId, options.organisationId),
          eq(employmentTypes.name, "Full Time"),
          eq(employmentTypes.isActive, true),
          isNull(employmentTypes.archivedAt),
        ),
      );
    const [salalah] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.organisationId, options.organisationId),
          eq(locations.name, "Salalah"),
          eq(locations.isActive, true),
          isNull(locations.archivedAt),
        ),
      );
    if (!employmentType || !salalah)
      throw new Error("Active Full Time employment type or Salalah location is missing.");

    const positionIds = new Map<string, string>();
    const createPositions: string[] = [];
    for (const spec of salalahBuildingAdverts) {
      const [position] = await tx
        .select({
          id: positions.id,
          isActive: positions.isActive,
          archivedAt: positions.archivedAt,
        })
        .from(positions)
        .where(
          and(
            eq(positions.organisationId, options.organisationId),
            sql`lower(${positions.name}) = ${spec.position.toLowerCase()}`,
          ),
        );
      if (position && (!position.isActive || position.archivedAt))
        throw new Error(`${spec.position} exists but is inactive; HR must review it.`);
      if (position) positionIds.set(spec.position, position.id);
      else createPositions.push(spec.position);

      const [duplicate] = await tx
        .select({ title: vacancies.title, status: vacancies.status })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.organisationId, options.organisationId),
            eq(vacancies.locationId, salalah.id),
            isNull(vacancies.archivedAt),
            sql`lower(${vacancies.title}) = ${spec.title.toLowerCase()}`,
          ),
        );
      if (duplicate)
        throw new Error(
          `${duplicate.title} already exists (${duplicate.status}); no duplicate created.`,
        );
      if (position) {
        const [samePosition] = await tx
          .select({ title: vacancies.title, status: vacancies.status })
          .from(vacancies)
          .where(
            and(
              eq(vacancies.organisationId, options.organisationId),
              eq(vacancies.locationId, salalah.id),
              eq(vacancies.positionId, position.id),
              isNull(vacancies.archivedAt),
            ),
          );
        if (samePosition)
          throw new Error(
            `${spec.position} already has a Salalah vacancy (${samePosition.title}, ${samePosition.status}).`,
          );
      }
    }

    const [quantitySurveyor] = await tx
      .select({
        id: vacancies.id,
        title: vacancies.title,
        status: vacancies.status,
        headcount: vacancies.headcount,
        locationId: vacancies.locationId,
      })
      .from(vacancies)
      .where(
        and(
          eq(vacancies.organisationId, options.organisationId),
          eq(vacancies.publicSlug, "quantity-surveyor-salalah"),
          isNull(vacancies.archivedAt),
        ),
      )
      .for("update");
    if (
      !quantitySurveyor ||
      quantitySurveyor.status !== "Open" ||
      quantitySurveyor.locationId !== salalah.id
    ) {
      throw new Error("The existing open Salalah Quantity Surveyor advert was not found.");
    }
    console.log(
      JSON.stringify(
        {
          organisation: organisation.name,
          owner: OWNER_EMAIL,
          location: "Salalah",
          createPositions,
          publish: salalahBuildingAdverts.map((spec) => ({
            title: spec.title,
            position: spec.position,
            department: spec.position === "Document Controller" ? "Administration" : "Engineering",
            headcount: spec.headcount,
          })),
          updateExisting: {
            title: quantitySurveyor.title,
            headcountFrom: quantitySurveyor.headcount,
            headcountTo: existingSalalahQuantitySurveyorHeadcount,
          },
        },
        null,
        2,
      ),
    );
    if (!options.apply) {
      console.log("Dry run only. No records were changed.");
      return;
    }

    for (const spec of salalahBuildingAdverts) {
      if (positionIds.has(spec.position)) continue;
      const departmentName =
        spec.position === "Document Controller" ? "Administration" : "Engineering";
      const [created] = await tx
        .insert(positions)
        .values({
          organisationId: options.organisationId,
          name: spec.position,
          departmentId: departmentIds.get(departmentName)!,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        })
        .returning({ id: positions.id });
      if (!created) throw new Error(`Could not create position ${spec.position}.`);
      positionIds.set(spec.position, created.id);
      await tx.insert(auditEvents).values({
        organisationId: options.organisationId,
        actorUserId: SYSTEM_ACTOR,
        actorDisplayName: "VIA deployment configuration",
        activeRole: "System",
        actorRoles: ["System"],
        action: "create",
        module: "settings",
        entityType: "position",
        entityId: created.id,
        afterSummary: { name: spec.position, department: departmentName },
        reason: REASON,
        riskLevel: "Medium",
      });
    }

    for (const spec of salalahBuildingAdverts) {
      const departmentName =
        spec.position === "Document Controller" ? "Administration" : "Engineering";
      const gradeName = spec.position === "Document Controller" ? "Administration" : "Engineers";
      const mandatoryCriteria = [spec.education];
      const [created] = await tx
        .insert(vacancies)
        .values({
          organisationId: options.organisationId,
          title: spec.title,
          departmentId: departmentIds.get(departmentName)!,
          locationId: salalah.id,
          positionId: positionIds.get(spec.position)!,
          gradeId: gradeIds.get(gradeName)!,
          employmentTypeId: employmentType.id,
          assignedOwnerId: owners[0]!.employeeId,
          status: "Open",
          summary: spec.summary,
          responsibilities: spec.responsibilities,
          requirements: spec.requirements,
          applicantCount: 0,
          headcount: spec.headcount,
          salaryVisibleToPublic: false,
          hiringReason: "Salalah building project recruitment.",
          education: spec.education,
          minimumExperience: spec.minimumExperience,
          skills: { required: spec.requirements, preferred: [] },
          certifications: [],
          languages: [],
          mandatoryCriteria,
          notes: "",
          screeningQuestions: [],
          acceptsInternalApplications: true,
          acceptsEmployeeReferrals: true,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        })
        .returning({ id: vacancies.id, publicSlug: vacancies.publicSlug });
      if (!created) throw new Error(`Could not publish ${spec.title}.`);
      await tx.insert(vacancyVersions).values({
        organisationId: options.organisationId,
        vacancyId: created.id,
        versionNumber: 1,
        responsibilities: spec.responsibilities,
        requirements: spec.requirements,
        mandatoryCriteria,
        createdBy: SYSTEM_ACTOR,
      });
      await tx.insert(auditEvents).values({
        organisationId: options.organisationId,
        actorUserId: SYSTEM_ACTOR,
        actorDisplayName: "VIA deployment configuration",
        activeRole: "System",
        actorRoles: ["System"],
        action: "publish",
        module: "recruitment",
        entityType: "vacancy",
        entityId: created.id,
        afterSummary: {
          title: spec.title,
          location: "Salalah",
          headcount: spec.headcount,
          status: "Open",
          publicSlug: created.publicSlug,
        },
        reason: REASON,
        riskLevel: "High",
      });
      published.push({ title: spec.title, slug: created.publicSlug });
    }

    if (quantitySurveyor.headcount !== existingSalalahQuantitySurveyorHeadcount) {
      await tx
        .update(vacancies)
        .set({
          headcount: existingSalalahQuantitySurveyorHeadcount,
          updatedAt: new Date(),
          updatedBy: SYSTEM_ACTOR,
          recordVersion: sql`${vacancies.recordVersion} + 1`,
        })
        .where(eq(vacancies.id, quantitySurveyor.id));
      await tx.insert(auditEvents).values({
        organisationId: options.organisationId,
        actorUserId: SYSTEM_ACTOR,
        actorDisplayName: "VIA deployment configuration",
        activeRole: "System",
        actorRoles: ["System"],
        action: "update",
        module: "recruitment",
        entityType: "vacancy",
        entityId: quantitySurveyor.id,
        beforeSummary: { headcount: quantitySurveyor.headcount },
        afterSummary: { headcount: existingSalalahQuantitySurveyorHeadcount },
        reason: REASON,
        riskLevel: "High",
      });
    }
  });
  for (const item of published) console.log(`Published ${item.title}: /jobs/${item.slug}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await publishSalalahBuildingVacancies(parseOptions(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  } finally {
    await closeDatabaseConnection();
  }
}
