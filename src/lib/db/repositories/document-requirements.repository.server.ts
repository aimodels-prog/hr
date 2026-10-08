import "@tanstack/react-start/server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import { auditEvents } from "../schema/system.ts";
import { processDependantCompletionNotices } from "./dependant-reminder.repository.server.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  defaultDocumentRequirements,
  requirementApplies,
  type DocumentRequirement,
} from "../../data/document-requirements.ts";

export async function getDocumentRequirementSettings(organisationId: string) {
  const db = getDatabaseClient();
  await db.execute(
    sql`INSERT INTO document_requirement_settings (organisation_id,definitions) VALUES (${organisationId},${JSON.stringify(defaultDocumentRequirements())}::jsonb) ON CONFLICT DO NOTHING`,
  );
  const rows = await db.execute(
    sql`SELECT definitions,version FROM document_requirement_settings WHERE organisation_id=${organisationId}`,
  );
  const row = rows[0]!;
  return {
    definitions: row["definitions"] as DocumentRequirement[],
    version: Number(row["version"]),
  };
}
export async function getEmployeeRequirements(
  organisationId: string,
  employeeId: string,
  actor: AuditActorContext,
) {
  if (actor.employeeId !== employeeId && !["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("You cannot view this employee's document requirements.");
  const [employee] = await getDatabaseClient()
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, employeeId),
        isNull(employees.archivedAt),
      ),
    )
    .limit(1);
  if (!employee) throw new Error("Employee not found.");
  const settings = await getDocumentRequirementSettings(organisationId);
  return settings.definitions.filter((r) => requirementApplies(r, employee));
}
export async function saveDocumentRequirementSettings(
  organisationId: string,
  definitions: DocumentRequirement[],
  version: number,
  actor: AuditActorContext,
) {
  if (!["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR can manage document requirements.");
  if (new Set(definitions.map((r) => r.id)).size !== definitions.length)
    throw new Error("Document identifiers must be unique.");
  await getDatabaseClient().transaction(async (tx) => {
    const result = await tx.execute(
      sql`UPDATE document_requirement_settings SET definitions=${JSON.stringify(definitions)}::jsonb,version=version+1,updated_at=now(),updated_by=${actor.userId} WHERE organisation_id=${organisationId} AND version=${version} RETURNING version`,
    );
    if (!result.length) throw new Error("Requirements changed. Reload before saving.");
    await processDependantCompletionNotices(organisationId, { db: tx, definitions });
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles,
      action: "update",
      module: "core-hr",
      entityType: "document-requirements",
      entityId: organisationId,
      afterSummary: { names: definitions.map((r) => r.name), version: version + 1 },
      reason: "HR updated document requirements",
      riskLevel: "Medium",
    });
  });
  return getDocumentRequirementSettings(organisationId);
}
