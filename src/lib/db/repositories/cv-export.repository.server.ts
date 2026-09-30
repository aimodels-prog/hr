import "@tanstack/react-start/server-only";
import { and, eq, inArray, isNull, asc } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { candidates, candidateCvRecords } from "../schema/recruitment.ts";
import { fileMetadata } from "../schema/documents.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import type { CvZipManifest } from "../../recruitment/cv-zip.ts";

export async function prepareCandidateCvExport(
  organisationId: string,
  candidateIds: string[],
  actor: AuditActorContext,
): Promise<CvZipManifest> {
  if (!actor.userId || !["HR", "Super Admin"].includes(actor.activeRole))
    throw new Error("Only HR or a Super Admin can download candidate CVs.");
  const ids = [...new Set(candidateIds)];
  if (!ids.length || ids.length > 5000) throw new Error("Choose between 1 and 5,000 candidates.");
  const db = getDatabaseClient();
  const people = await db
    .select({ id: candidates.id, firstName: candidates.firstName, lastName: candidates.lastName })
    .from(candidates)
    .where(and(eq(candidates.organisationId, organisationId), inArray(candidates.id, ids)));
  if (people.length !== ids.length)
    throw new Error("Some candidates are no longer available. Refresh the list and try again.");
  const records = await db
    .select({
      cvRecordId: candidateCvRecords.id,
      candidateId: candidateCvRecords.candidateId,
      name: candidateCvRecords.originalFileName,
      size: fileMetadata.size,
      checksum: fileMetadata.checksum,
      status: fileMetadata.storageStatus,
    })
    .from(candidateCvRecords)
    .leftJoin(
      fileMetadata,
      and(
        eq(fileMetadata.id, candidateCvRecords.fileId),
        eq(fileMetadata.organisationId, organisationId),
      ),
    )
    .where(
      and(
        eq(candidateCvRecords.organisationId, organisationId),
        inArray(candidateCvRecords.candidateId, ids),
        isNull(candidateCvRecords.archivedAt),
      ),
    )
    .orderBy(
      asc(candidateCvRecords.candidateId),
      asc(candidateCvRecords.receivedAt),
      asc(candidateCvRecords.id),
    );
  const names = new Map(
    people.map((person) => [person.id, `${person.firstName} ${person.lastName}`.trim()]),
  );
  const entries = records.map((record) => {
    if (
      !record.candidateId ||
      record.status !== "Available" ||
      !record.checksum ||
      record.size === null
    )
      throw new Error(
        "An uploaded CV is not ready or is unavailable. Resolve it before exporting; no files have been skipped.",
      );
    return {
      cvRecordId: record.cvRecordId,
      candidateId: record.candidateId,
      candidateName: names.get(record.candidateId)!,
      name: record.name,
      size: record.size,
      checksum: record.checksum,
    };
  });
  const withCv = new Set(entries.map((entry) => entry.candidateId));
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [actor.activeRole],
    action: "candidate_cv_zip_requested",
    module: "recruitment",
    entityType: "candidate",
    entityId: actor.userId,
    afterSummary: { candidateIds: ids, cvRecordIds: entries.map((entry) => entry.cvRecordId) },
    riskLevel: "High",
  });
  return {
    entries,
    candidateCount: people.length,
    withoutCv: people
      .filter((person) => !withCv.has(person.id))
      .map((person) => ({ id: person.id, name: names.get(person.id)! })),
  };
}
