import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

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

const DEPLOYMENT_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const ORGANISATION_NAME = "VIA International";
const OWNER_EMAIL = "hr@via-int.com";
const OWNER_NAME = "Roshana Ahmed";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPLICATION_EMAIL = /^[a-z0-9._%+-]+@via-int\.com$/i;
const REASON = "Owner-requested publication of the Salalah and Ibri recruitment advert.";

export type Options = {
  organisationId: string;
  applicationEmail?: string;
  apply: boolean;
};

export type VacancySpec = {
  title: string;
  position: string;
  location: "Salalah" | "Ibri";
  summary: string;
  responsibilities: string[];
  requirements: string[];
  mandatoryCriteria: string[];
  education: string;
  minimumExperience: string;
  skills: { required: string[]; preferred: string[] };
  languages: string[];
};

const DEGREE = "Relevant degree in Civil Engineering, Quantity Surveying, or a related discipline.";
const EXPERIENCE = "Proven experience relevant to the position applied for.";
const TECHNICAL = "Strong technical, coordination, reporting, and communication skills.";
const ENGLISH = "Excellent English communication skills.";
const BUILDINGS =
  "Resident Engineer applicants must have strong building construction and site supervision experience.";

function normalise(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function parseOptions(args: string[]): Options {
  const names = ["--organisation-id=", "--application-email="];
  const allowed = args.every(
    (arg) =>
      arg === "--dry-run" || arg === "--apply" || names.some((prefix) => arg.startsWith(prefix)),
  );
  const unique = names.every((prefix) => args.filter((arg) => arg.startsWith(prefix)).length <= 1);
  const organisationId = args
    .find((arg) => arg.startsWith("--organisation-id="))
    ?.slice("--organisation-id=".length)
    .trim();
  const applicationEmail = args
    .find((arg) => arg.startsWith("--application-email="))
    ?.slice("--application-email=".length)
    .trim()
    .toLowerCase();
  const apply = args.includes("--apply");
  if (
    !allowed ||
    !unique ||
    args.includes("--dry-run") === apply ||
    !organisationId ||
    !UUID.test(organisationId) ||
    (applicationEmail !== undefined && !APPLICATION_EMAIL.test(applicationEmail))
  ) {
    throw new Error(
      "Usage: node --experimental-transform-types scripts/publish-salalah-ibri-vacancies.ts " +
        "--organisation-id=UUID [--application-email=jobs@via-int.com] --dry-run|--apply",
    );
  }
  return { organisationId, ...(applicationEmail ? { applicationEmail } : {}), apply };
}

export function buildVacancySpecs(applicationEmail?: string): VacancySpec[] {
  const applyText = applicationEmail
    ? `Send your CV to ${applicationEmail} or apply directly using the form on this page. Please mention the position and location applied for.`
    : "Apply directly using the form on this page. Please mention the position and location applied for.";
  const sharedSummary =
    "VIA International Engineering Consultancy is expanding our team and is looking for experienced professionals to join our projects in Salalah and Ibri, Oman.";
  const preferred = [
    "Consultancy or construction supervision experience preferred.",
    "Oman or GCC experience is an advantage.",
    "Arabic is an advantage.",
  ];
  const baseRequirements = [DEGREE, EXPERIENCE, TECHNICAL, ENGLISH];
  const baseMandatory = [DEGREE, EXPERIENCE, ENGLISH];
  const role = (
    title: string,
    position: string,
    location: "Salalah" | "Ibri",
    responsibilities: string[],
    extraRequirements: string[] = [],
  ): VacancySpec => {
    const requirements = [...baseRequirements, ...extraRequirements];
    const mandatoryCriteria = [...baseMandatory, ...extraRequirements];
    return {
      title,
      position,
      location,
      summary: `${sharedSummary}\n\nThis opening is for ${position} in ${location}, Oman.\n\n${applyText}`,
      responsibilities,
      requirements,
      mandatoryCriteria,
      education: DEGREE,
      minimumExperience: EXPERIENCE,
      skills: {
        required: [TECHNICAL, ...extraRequirements],
        preferred,
      },
      languages: [ENGLISH, "Arabic is an advantage."],
    };
  };
  const specs = [
    role(
      "Resident Engineer – Buildings — Salalah",
      "Resident Engineer",
      "Salalah",
      [
        "Supervise building construction and site activities in Salalah.",
        "Coordinate technical matters with contractors and the project team.",
        "Prepare site reports and communicate project progress.",
      ],
      [BUILDINGS],
    ),
    role("Quantity Surveyor — Salalah", "Quantity Surveyor", "Salalah", [
      "Measure and report project quantities for the Salalah assignment.",
      "Support estimates, payment quantities, and variation reviews.",
      "Coordinate quantity information with the project team.",
    ]),
    role("Quantity Surveyor — Ibri", "Quantity Surveyor", "Ibri", [
      "Measure and report project quantities for the Ibri assignment.",
      "Support estimates, payment quantities, and variation reviews.",
      "Coordinate quantity information with the project team.",
    ]),
    role("Civil Engineer — Ibri", "Civil Engineer", "Ibri", [
      "Support civil engineering work and site supervision for the Ibri assignment.",
      "Coordinate technical matters with contractors and the project team.",
      "Prepare technical reports and communicate project progress.",
    ]),
  ];
  for (const spec of specs) {
    if (
      !spec.summary.trim() ||
      spec.responsibilities.length === 0 ||
      spec.requirements.length === 0 ||
      spec.mandatoryCriteria.length === 0 ||
      spec.mandatoryCriteria.some(
        (criterion) => !spec.requirements.some((item) => normalise(item) === normalise(criterion)),
      )
    ) {
      throw new Error(`Vacancy ${spec.title} does not meet the publication requirements.`);
    }
  }
  return specs;
}

export async function run(options: Options): Promise<void> {
  const specs = buildVacancySpecs(options.applicationEmail);
  const db = getDatabaseClient();
  const published: { title: string; publicSlug: string }[] = [];
  await db.transaction(async (tx) => {
    // Serialise this one-time publication. The trigger separately serialises slug allocation.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`via-salalah-ibri-vacancies:${options.organisationId}`}, 0))`,
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
      )
      .for("share");
    if (!organisation || normalise(organisation.name) !== normalise(ORGANISATION_NAME)) {
      throw new Error("The expected active VIA International organisation was not found.");
    }

    const owners = await tx
      .select({
        employeeId: employees.id,
        legalName: employees.legalName,
        userId: users.id,
      })
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
      )
      .for("share");
    if (owners.length !== 1 || normalise(owners[0]!.legalName) !== normalise(OWNER_NAME)) {
      throw new Error("Roshana's active HR employee and sign-in account could not be verified.");
    }
    const ownerEmployeeId = owners[0]!.employeeId;
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
    if (!hrAssignment) {
      throw new Error("The assigned vacancy owner does not currently have HR access.");
    }

    const [department] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.organisationId, options.organisationId),
          eq(departments.name, "Engineering"),
          eq(departments.isActive, true),
          isNull(departments.archivedAt),
        ),
      )
      .for("share");
    const [grade] = await tx
      .select({ id: grades.id })
      .from(grades)
      .where(
        and(
          eq(grades.organisationId, options.organisationId),
          eq(grades.name, "Engineers"),
          eq(grades.isActive, true),
          isNull(grades.archivedAt),
        ),
      )
      .for("share");
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
      )
      .for("share");
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
      )
      .for("share");
    if (!department || !grade || !employmentType || !salalah) {
      throw new Error(
        "Required active Engineering, Engineers, Full Time, or Salalah master data is missing.",
      );
    }
    const positionIds = new Map<string, string>();
    for (const positionName of new Set(specs.map((spec) => spec.position))) {
      const [position] = await tx
        .select({ id: positions.id })
        .from(positions)
        .where(
          and(
            eq(positions.organisationId, options.organisationId),
            eq(positions.name, positionName),
            eq(positions.isActive, true),
            isNull(positions.archivedAt),
          ),
        )
        .for("share");
      if (!position) throw new Error(`Required active position ${positionName} is missing.`);
      positionIds.set(positionName, position.id);
    }
    const [existingIbri] = await tx
      .select({ id: locations.id, isActive: locations.isActive, archivedAt: locations.archivedAt })
      .from(locations)
      .where(
        and(
          eq(locations.organisationId, options.organisationId),
          sql`lower(${locations.name}) = 'ibri'`,
        ),
      )
      .for("update");
    if (existingIbri && (!existingIbri.isActive || existingIbri.archivedAt)) {
      throw new Error("Ibri already exists but is inactive. HR must review it before publication.");
    }

    for (const spec of specs) {
      const [existing] = await tx
        .select({ id: vacancies.id, status: vacancies.status })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.organisationId, options.organisationId),
            sql`lower(${vacancies.title}) = ${spec.title.toLowerCase()}`,
          ),
        )
        .limit(1);
      if (existing) {
        throw new Error(
          `${spec.title} already exists (${existing.status}); no duplicate was created.`,
        );
      }
      const locationId = spec.location === "Salalah" ? salalah.id : existingIbri?.id;
      if (locationId) {
        const [sameRoleAtLocation] = await tx
          .select({ title: vacancies.title, status: vacancies.status })
          .from(vacancies)
          .where(
            and(
              eq(vacancies.organisationId, options.organisationId),
              eq(vacancies.positionId, positionIds.get(spec.position)!),
              eq(vacancies.locationId, locationId),
              inArray(vacancies.status, ["Draft", "Pending Approval", "Open", "Paused"]),
              isNull(vacancies.archivedAt),
            ),
          )
          .limit(1);
        if (sameRoleAtLocation) {
          throw new Error(
            `${spec.position} in ${spec.location} already has an active ${sameRoleAtLocation.status} vacancy (${sameRoleAtLocation.title}).`,
          );
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          organisation: organisation.name,
          owner: `${OWNER_NAME} <${OWNER_EMAIL}>`,
          applicationEmail: options.applicationEmail ?? null,
          createIbriLocation: !existingIbri,
          grade: "Engineers",
          vacancies: specs.map(({ title, position, location }) => ({
            title,
            position,
            location,
            headcount: 1,
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

    let ibriId = existingIbri?.id;
    if (!ibriId) {
      const [created] = await tx
        .insert(locations)
        .values({
          organisationId: options.organisationId,
          name: "Ibri",
          description: "Project location for recruitment in Ibri, Oman.",
          city: "Ibri",
          country: "Oman",
          timezone: "Asia/Muscat",
          isClockInSite: false,
          createdBy: DEPLOYMENT_ACTOR_ID,
          updatedBy: DEPLOYMENT_ACTOR_ID,
        })
        .returning({ id: locations.id });
      if (!created) throw new Error("Ibri location could not be created.");
      ibriId = created.id;
      await tx.insert(auditEvents).values({
        organisationId: options.organisationId,
        actorUserId: DEPLOYMENT_ACTOR_ID,
        actorDisplayName: "VIA deployment configuration",
        activeRole: "System",
        actorRoles: ["System"],
        action: "create",
        module: "settings",
        entityType: "location",
        entityId: ibriId,
        afterSummary: { name: "Ibri", city: "Ibri", country: "Oman", isClockInSite: false },
        reason: REASON,
        riskLevel: "Medium",
      });
    }

    for (const spec of specs) {
      const [created] = await tx
        .insert(vacancies)
        .values({
          organisationId: options.organisationId,
          title: spec.title,
          departmentId: department.id,
          locationId: spec.location === "Salalah" ? salalah.id : ibriId,
          positionId: positionIds.get(spec.position)!,
          gradeId: grade.id,
          employmentTypeId: employmentType.id,
          assignedOwnerId: ownerEmployeeId,
          status: "Open",
          summary: spec.summary,
          responsibilities: spec.responsibilities,
          requirements: spec.requirements,
          applicantCount: 0,
          headcount: 1,
          salaryVisibleToPublic: false,
          hiringReason: "Expansion of VIA projects in Salalah and Ibri, Oman.",
          education: spec.education,
          minimumExperience: spec.minimumExperience,
          skills: spec.skills,
          certifications: [],
          languages: spec.languages,
          mandatoryCriteria: spec.mandatoryCriteria,
          notes: "Published from the owner-provided Salalah and Ibri recruitment advert.",
          screeningQuestions: [],
          acceptsInternalApplications: true,
          acceptsEmployeeReferrals: true,
          createdBy: DEPLOYMENT_ACTOR_ID,
          updatedBy: DEPLOYMENT_ACTOR_ID,
        })
        .returning({ id: vacancies.id, publicSlug: vacancies.publicSlug });
      if (!created) throw new Error(`Could not create ${spec.title}.`);
      await tx.insert(vacancyVersions).values({
        organisationId: options.organisationId,
        vacancyId: created.id,
        versionNumber: 1,
        responsibilities: spec.responsibilities,
        requirements: spec.requirements,
        mandatoryCriteria: spec.mandatoryCriteria,
        createdBy: DEPLOYMENT_ACTOR_ID,
      });
      await tx.insert(auditEvents).values({
        organisationId: options.organisationId,
        actorUserId: DEPLOYMENT_ACTOR_ID,
        actorDisplayName: "VIA deployment configuration",
        activeRole: "System",
        actorRoles: ["System"],
        action: "publish",
        module: "recruitment",
        entityType: "vacancy",
        entityId: created.id,
        afterSummary: {
          title: spec.title,
          location: spec.location,
          status: "Open",
          owner: OWNER_EMAIL,
          publicSlug: created.publicSlug,
        },
        reason: REASON,
        riskLevel: "High",
      });
      published.push({ title: spec.title, publicSlug: created.publicSlug });
    }
  });
  for (const item of published) {
    console.log(`Published ${item.title}: /jobs/${item.publicSlug}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(parseOptions(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  } finally {
    await closeDatabaseConnection();
  }
}
