import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";

import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import { vacancies } from "../src/lib/db/schema/recruitment.ts";
import { auditEvents } from "../src/lib/db/schema/system.ts";

const ORGANISATION_ID = "aa98aa96-b498-5ca8-8d0d-da19cd34c176";
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const REASON =
  "Owner correction: the Salalah building table states assignment months, not numbers of hires.";

const assignments = [
  { slug: "junior-architect-salalah", previousHeadcount: 12, months: 12 },
  { slug: "electrical-engineer-salalah", previousHeadcount: 12, months: 12 },
  { slug: "mechanical-engineer-salalah", previousHeadcount: 12, months: 12 },
  { slug: "civil-inspector-salalah", previousHeadcount: 12, months: 12 },
  { slug: "land-surveyor-salalah", previousHeadcount: 3, months: 3 },
  { slug: "document-controller-salalah", previousHeadcount: 12, months: 12 },
  { slug: "quantity-surveyor-salalah", previousHeadcount: 12, months: 12 },
] as const;

export async function correctSalalahBuildingDuration(apply: boolean): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`via-salalah-building:${ORGANISATION_ID}`}, 0))`,
    );
    const changes = [];
    for (const assignment of assignments) {
      const matches = await tx
        .select({
          id: vacancies.id,
          title: vacancies.title,
          status: vacancies.status,
          headcount: vacancies.headcount,
          summary: vacancies.summary,
        })
        .from(vacancies)
        .where(
          and(
            eq(vacancies.organisationId, ORGANISATION_ID),
            eq(vacancies.publicSlug, assignment.slug),
            isNull(vacancies.archivedAt),
          ),
        )
        .for("update");
      if (matches.length !== 1) throw new Error(`Expected one vacancy for ${assignment.slug}.`);
      const vacancy = matches[0]!;
      if (vacancy.status !== "Open" || vacancy.headcount !== assignment.previousHeadcount)
        throw new Error(`${assignment.slug} has changed; review it before correction.`);
      if (/assignment duration:/i.test(vacancy.summary))
        throw new Error(`${assignment.slug} already has a duration; review it before correction.`);
      changes.push({
        id: vacancy.id,
        title: vacancy.title,
        oldHeadcount: vacancy.headcount,
        oldSummary: vacancy.summary,
        headcount: 1,
        months: assignment.months,
        summary: `${vacancy.summary.trimEnd()} Assignment duration: ${assignment.months} months.`,
      });
    }
    console.log(
      JSON.stringify(
        changes.map(({ title, oldHeadcount, headcount, months }) => ({
          title,
          headcountFrom: oldHeadcount,
          headcountTo: headcount,
          assignmentMonths: months,
        })),
        null,
        2,
      ),
    );
    if (!apply) {
      console.log("Dry run only. No records were changed.");
      return;
    }
    for (const change of changes) {
      await tx
        .update(vacancies)
        .set({
          headcount: change.headcount,
          summary: change.summary,
          updatedAt: new Date(),
          updatedBy: SYSTEM_ACTOR,
          recordVersion: sql`${vacancies.recordVersion} + 1`,
        })
        .where(eq(vacancies.id, change.id));
      await tx.insert(auditEvents).values({
        organisationId: ORGANISATION_ID,
        actorUserId: SYSTEM_ACTOR,
        actorDisplayName: "VIA deployment correction",
        activeRole: "System",
        actorRoles: ["System"],
        action: "correct",
        module: "recruitment",
        entityType: "vacancy",
        entityId: change.id,
        beforeSummary: { headcount: change.oldHeadcount, summary: change.oldSummary },
        afterSummary: {
          headcount: change.headcount,
          assignmentMonths: change.months,
          summary: change.summary,
        },
        reason: REASON,
        riskLevel: "High",
      });
    }
  });
  if (apply) console.log("Corrected all seven Salalah vacancy records.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || !["--dry-run", "--apply"].includes(process.argv[2]!))
      throw new Error("Usage: correct-salalah-building-duration.ts --dry-run|--apply");
    await correctSalalahBuildingDuration(process.argv[2] === "--apply");
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  } finally {
    await closeDatabaseConnection();
  }
}
