import "@tanstack/react-start/server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { getDatabaseClient, type ViaHrDatabase } from "../client.ts";
import { auditEvents } from "../schema/system.ts";

/** First recorded public opening, unaffected by later edits, pauses or reopening. */
export async function listVacancyPublicationDatesForOrganisation(
  organisationId: string,
  db: Pick<ViaHrDatabase, "select"> = getDatabaseClient(),
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      vacancyId: auditEvents.entityId,
      firstOpenAt: sql<string>`to_char(min(${auditEvents.occurredAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.module, "recruitment"),
        eq(auditEvents.entityType, "vacancy"),
        inArray(auditEvents.action, ["change-status", "publish"]),
        sql`${auditEvents.afterSummary}->>'status' = 'Open'`,
      ),
    )
    .groupBy(auditEvents.entityId);

  return new Map(rows.map((row) => [row.vacancyId, row.firstOpenAt]));
}
