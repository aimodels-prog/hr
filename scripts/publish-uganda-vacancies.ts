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

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const ORGANISATION_NAME = "VIA International";
const OWNER_EMAIL = "hr@via-int.com";
const APPLICATION_EMAIL = "recruitment@via-int.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASON = "Owner-provided Uganda Resident Engineer and Electromechanical Engineer adverts.";

export type PublicationOptions = { organisationId: string; apply: boolean };
export type UgandaVacancySpec = {
  title: string;
  position: string;
  employmentType: "Project Assignment" | "Freelance";
  summary: string;
  responsibilities: string[];
  requirements: string[];
  education: string;
  minimumExperience: string;
  skills: { required: string[]; preferred: string[] };
};

export function parsePublicationOptions(args: string[]): PublicationOptions {
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
      "Usage: node --experimental-transform-types scripts/publish-uganda-vacancies.ts " +
        "--organisation-id=UUID --dry-run|--apply",
    );
  }
  return { organisationId, apply };
}

export function buildUgandaVacancySpecs(): UgandaVacancySpec[] {
  const applyText = `Send your CV to ${APPLICATION_EMAIL} or apply directly using the form on this page.`;
  const assignment =
    "VIA International Engineering Consultancy seeks an engineer for a water supply and sanitation construction supervision assignment in Uganda.";
  const residentRequirements = [
    "Degree in Civil, Environmental or Hydraulic Engineering.",
    "10+ years of professional experience.",
    "7+ years supervising water supply works and pipe networks.",
    "Resident Engineer on 3 similar projects, including 1 in Sub-Saharan Africa.",
    "Sanitation infrastructure experience and engineering registration.",
  ];
  const electromechanicalRequirements = [
    "Degree in Electrical or Mechanical Engineering.",
    "8+ years of professional experience.",
    "Piped water electromechanical systems and solar packages.",
    "Supervision of 3 similar projects, including 1 in Sub-Saharan Africa.",
    "Available for site assignments in Uganda.",
  ];
  return [
    {
      title: "Resident Engineer — Uganda",
      position: "Resident Engineer",
      employmentType: "Project Assignment",
      summary:
        `${assignment}\n\nSite based in Uganda. Expected start: January 2027. ` +
        `Planned input: 14 person-months per regional position.\n\n${applyText}`,
      responsibilities: [
        "Supervise water supply works, pipe networks and sanitation construction on site in Uganda.",
        "Act as Resident Engineer on the construction supervision assignment.",
      ],
      requirements: residentRequirements,
      education: residentRequirements[0]!,
      minimumExperience: residentRequirements[1]!,
      skills: {
        required: residentRequirements.slice(2),
        preferred: [],
      },
    },
    {
      title: "Electromechanical Engineer — Uganda",
      position: "Electromechanical Engineer",
      employmentType: "Freelance",
      summary:
        `${assignment}\n\nFreelance contract. On site and at home, with site assignments in Uganda. ` +
        `Expected start: January 2027. Planned input: 7 person-months over 14 months.\n\n${applyText}`,
      responsibilities: [
        "Supervise piped-water electromechanical systems and solar packages for the Uganda assignment.",
        "Attend site assignments in Uganda as required by the project.",
      ],
      requirements: electromechanicalRequirements,
      education: electromechanicalRequirements[0]!,
      minimumExperience: electromechanicalRequirements[1]!,
      skills: {
        required: electromechanicalRequirements.slice(2),
        preferred: [],
      },
    },
  ];
}

export async function publishUgandaVacancies(options: PublicationOptions): Promise<void> {
  const db = getDatabaseClient();
  const specs = buildUgandaVacancySpecs();
  const published: { title: string; slug: string }[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`via-uganda-vacancies:${options.organisationId}`}, 0))`,
    );
    const [organisation] = await tx
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(
        and(
          eq(organisations.id, options.organisationId),
          eq(organisations.isActive, true),
          isNull(organisations.archivedAt),
        ),
      );
    if (organisation?.name !== ORGANISATION_NAME)
      throw new Error("The expected active VIA International organisation was not found.");

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
    const [hrRole] = await tx
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
    if (!hrRole) throw new Error("The vacancy owner does not have HR access.");

    async function existingMaster(
      table:
        | typeof departments
        | typeof grades
        | typeof employmentTypes
        | typeof positions
        | typeof locations,
      name: string,
    ): Promise<{ id: string; isActive: boolean; archivedAt: Date | null } | undefined> {
      const [record] = await tx
        .select({ id: table.id, isActive: table.isActive, archivedAt: table.archivedAt })
        .from(table)
        .where(
          and(
            eq(table.organisationId, options.organisationId),
            sql`lower(${table.name}) = ${name.toLowerCase()}`,
          ),
        );
      return record;
    }

    const department = await existingMaster(departments, "Engineering");
    const grade = await existingMaster(grades, "Engineers");
    if (!department?.isActive || department.archivedAt || !grade?.isActive || grade.archivedAt)
      throw new Error("Active Engineering department and Engineers grade are required.");

    const masterCreates: { kind: string; name: string }[] = [];
    const location = await existingMaster(locations, "Uganda");
    if (location && (!location.isActive || location.archivedAt))
      throw new Error("Uganda location exists but is inactive. HR must review it.");
    if (!location) masterCreates.push({ kind: "location", name: "Uganda" });
    for (const spec of specs) {
      for (const [kind, table, name] of [
        ["position", positions, spec.position],
        ["employment type", employmentTypes, spec.employmentType],
      ] as const) {
        const existing = await existingMaster(table, name);
        if (existing && (!existing.isActive || existing.archivedAt))
          throw new Error(`${name} exists but is inactive. HR must review it.`);
        if (!existing && !masterCreates.some((item) => item.kind === kind && item.name === name))
          masterCreates.push({ kind, name });
      }
      const [duplicate] = await tx
        .select({ id: vacancies.id, status: vacancies.status })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.organisationId, options.organisationId),
            sql`lower(${vacancies.title}) = ${spec.title.toLowerCase()}`,
            isNull(vacancies.archivedAt),
          ),
        )
        .limit(1);
      if (duplicate)
        throw new Error(
          `${spec.title} already exists (${duplicate.status}); no duplicate created.`,
        );
    }
    console.log(
      JSON.stringify(
        {
          organisation: organisation.name,
          owner: OWNER_EMAIL,
          applicationEmail: APPLICATION_EMAIL,
          masterCreates,
          vacancies: specs.map((spec) => ({
            title: spec.title,
            location: "Uganda",
            employmentType: spec.employmentType,
            status: "Open",
          })),
        },
        null,
        2,
      ),
    );
    if (!options.apply) {
      console.log("Dry run only. No records were created.");
      return;
    }

    async function recordMaster(kind: string, id: string, name: string): Promise<void> {
      await tx.insert(auditEvents).values({
        organisationId: options.organisationId,
        actorUserId: SYSTEM_ACTOR,
        actorDisplayName: "VIA deployment configuration",
        activeRole: "System",
        actorRoles: ["System"],
        action: "create",
        module: "settings",
        entityType: kind,
        entityId: id,
        afterSummary: { name },
        reason: REASON,
        riskLevel: "Medium",
      });
    }

    let locationId = location?.id;
    if (!locationId) {
      const [created] = await tx
        .insert(locations)
        .values({
          organisationId: options.organisationId,
          name: "Uganda",
          country: "Uganda",
          timezone: "Africa/Kampala",
          isClockInSite: false,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        })
        .returning({ id: locations.id });
      locationId = created!.id;
      await recordMaster("location", locationId, "Uganda");
    }
    const positionIds = new Map<string, string>();
    const employmentTypeIds = new Map<string, string>();
    for (const spec of specs) {
      if (!positionIds.has(spec.position)) {
        let id = (await existingMaster(positions, spec.position))?.id;
        if (!id) {
          const [created] = await tx
            .insert(positions)
            .values({
              organisationId: options.organisationId,
              name: spec.position,
              departmentId: department.id,
              createdBy: SYSTEM_ACTOR,
              updatedBy: SYSTEM_ACTOR,
            })
            .returning({ id: positions.id });
          id = created!.id;
          await recordMaster("position", id, spec.position);
        }
        positionIds.set(spec.position, id);
      }
      if (!employmentTypeIds.has(spec.employmentType)) {
        let id = (await existingMaster(employmentTypes, spec.employmentType))?.id;
        if (!id) {
          const [created] = await tx
            .insert(employmentTypes)
            .values({
              organisationId: options.organisationId,
              name: spec.employmentType,
              description: "Recruitment classification for a project-based assignment.",
              createdBy: SYSTEM_ACTOR,
              updatedBy: SYSTEM_ACTOR,
            })
            .returning({ id: employmentTypes.id });
          id = created!.id;
          await recordMaster("employment-type", id, spec.employmentType);
        }
        employmentTypeIds.set(spec.employmentType, id);
      }
    }
    for (const spec of specs) {
      const [created] = await tx
        .insert(vacancies)
        .values({
          organisationId: options.organisationId,
          title: spec.title,
          departmentId: department.id,
          locationId,
          positionId: positionIds.get(spec.position)!,
          gradeId: grade.id,
          employmentTypeId: employmentTypeIds.get(spec.employmentType)!,
          assignedOwnerId: owners[0]!.employeeId,
          status: "Open",
          summary: spec.summary,
          responsibilities: spec.responsibilities,
          requirements: spec.requirements,
          applicantCount: 0,
          headcount: 1,
          salaryVisibleToPublic: false,
          hiringReason: "Uganda water supply and sanitation construction supervision assignment.",
          education: spec.education,
          minimumExperience: spec.minimumExperience,
          skills: spec.skills,
          certifications: [],
          languages: [],
          mandatoryCriteria: spec.requirements,
          notes: "Published from the owner-provided Uganda recruitment advert.",
          screeningQuestions: [],
          acceptsInternalApplications: true,
          acceptsEmployeeReferrals: true,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
        })
        .returning({ id: vacancies.id, publicSlug: vacancies.publicSlug });
      if (!created) throw new Error(`Could not create ${spec.title}.`);
      await tx.insert(vacancyVersions).values({
        organisationId: options.organisationId,
        vacancyId: created.id,
        versionNumber: 1,
        responsibilities: spec.responsibilities,
        requirements: spec.requirements,
        mandatoryCriteria: spec.requirements,
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
          location: "Uganda",
          status: "Open",
          owner: OWNER_EMAIL,
          publicSlug: created.publicSlug,
        },
        reason: REASON,
        riskLevel: "High",
      });
      published.push({ title: spec.title, slug: created.publicSlug });
    }
  });
  for (const vacancy of published) console.log(`Published ${vacancy.title}: /jobs/${vacancy.slug}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await publishUgandaVacancies(parsePublicationOptions(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  } finally {
    await closeDatabaseConnection();
  }
}
