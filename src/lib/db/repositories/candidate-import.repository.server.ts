import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, eq, or, sql } from "drizzle-orm";

import type { CandidateStage, MaritalStatus, VisaStatus } from "../../data/types.ts";
import { getDatabaseClient } from "../client.ts";
import { encryptSensitiveJson } from "../encryption.server.ts";
import { candidates } from "../schema/recruitment.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export interface CandidateImportRow {
  sourceSheet: string;
  sourceRowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality?: string;
  location: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsOfExperience: number;
  stage: CandidateStage;
  shortlistStatus?: string;
  trackerStatus?: string;
  projectName?: string;
  projectType?: string;
  visaStatus?: VisaStatus;
  maritalStatus?: MaritalStatus;
  noticePeriod?: string;
  lastContactAt?: string;
  interviewDate?: string;
  currentSalary?: string;
  expectedSalary?: string;
  acceptedSalary?: string;
  remarks?: string;
  source?: string;
  originalImportValues?: Record<string, string>;
  resolution: "create" | "merge" | "skip" | "create_separate";
  existingCandidateId?: string;
}

function recruiter(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can import candidates.");
  if (!actor.userId) throw new Error("A verified VIA user is required.");
}

function cleanRow(row: CandidateImportRow): CandidateImportRow {
  if (!row.firstName.trim() && !row.email.trim() && !row.phone.trim())
    throw new Error(`Row ${row.sourceRowIndex} has no candidate identity information.`);
  if (
    !Number.isFinite(row.yearsOfExperience) ||
    row.yearsOfExperience < 0 ||
    row.yearsOfExperience > 80
  )
    throw new Error(`Row ${row.sourceRowIndex} has invalid years of experience.`);
  return {
    ...row,
    firstName: row.firstName.trim() || "Unknown",
    lastName: row.lastName.trim() || "Candidate",
    email: row.email.trim().toLowerCase(),
    phone: row.phone.trim(),
    location: row.location.trim() || "Unknown",
  };
}

export async function importCandidatesInDatabase(
  organisationId: string,
  rows: CandidateImportRow[],
  actor: AuditActorContext,
  importReason: string,
): Promise<{ batchId: string; inserted: number; updated: number; skipped: number }> {
  recruiter(actor);
  if (!rows.length || rows.length > 5_000)
    throw new Error("Import between 1 and 5,000 reviewed rows at a time.");
  if (importReason.trim().length < 5)
    throw new Error("Record why this candidate file is being imported.");
  const reviewed = rows.map(cleanRow);
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`candidate-import:${organisationId}`}))`,
    );
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of reviewed) {
      const matches = await tx
        .select()
        .from(candidates)
        .where(
          and(
            eq(candidates.organisationId, organisationId),
            sql`${candidates.archivedAt} IS NULL`,
            or(
              row.email ? eq(candidates.email, row.email) : sql`false`,
              row.phone ? eq(candidates.phone, row.phone) : sql`false`,
            ),
          ),
        );
      const exact = row.existingCandidateId
        ? matches.find((candidate) => candidate.id === row.existingCandidateId)
        : matches.length === 1
          ? matches[0]
          : undefined;
      if (row.resolution === "skip") {
        skipped++;
        continue;
      }
      if (row.resolution === "merge") {
        if (!exact)
          throw new Error(
            `Row ${row.sourceRowIndex} no longer matches the candidate chosen for merging.`,
          );
        await tx
          .update(candidates)
          .set({
            ...(row.phone && !exact.phone ? { phone: row.phone } : {}),
            ...(row.email && !exact.email ? { email: row.email } : {}),
            ...(row.currentTitle ? { currentTitle: row.currentTitle.trim() } : {}),
            ...(row.currentCompany ? { currentCompany: row.currentCompany.trim() } : {}),
            location: row.location,
            yearsOfExperience: row.yearsOfExperience,
            ...(row.visaStatus ? { visaStatus: row.visaStatus } : {}),
            ...(row.maritalStatus ? { maritalStatus: row.maritalStatus } : {}),
            ...(row.shortlistStatus ? { shortlistStatus: row.shortlistStatus.trim() } : {}),
            ...(row.trackerStatus ? { trackerStatus: row.trackerStatus.trim() } : {}),
            ...(row.projectName ? { projectName: row.projectName.trim() } : {}),
            ...(row.projectType ? { projectType: row.projectType.trim() } : {}),
            ...(row.noticePeriod ? { noticePeriod: row.noticePeriod.trim() } : {}),
            ...(row.lastContactAt ? { lastContactAt: row.lastContactAt } : {}),
            ...(row.interviewDate ? { interviewDate: row.interviewDate } : {}),
            ...(row.currentSalary
              ? { currentSalaryEncrypted: encryptSensitiveJson(row.currentSalary) }
              : {}),
            ...(row.expectedSalary
              ? { expectedSalaryEncrypted: encryptSensitiveJson(row.expectedSalary) }
              : {}),
            ...(row.acceptedSalary
              ? { acceptedSalaryEncrypted: encryptSensitiveJson(row.acceptedSalary) }
              : {}),
            ...(row.remarks
              ? { remarks: [exact.remarks, row.remarks].filter(Boolean).join("\n") }
              : {}),
            importProvenance: [
              exact.importProvenance,
              `${row.sourceSheet} - Row ${row.sourceRowIndex}`,
            ]
              .filter(Boolean)
              .join(", "),
            originalImportValues: {
              ...(exact.originalImportValues ?? {}),
              ...(row.originalImportValues ?? {}),
            },
            updatedAt: new Date(),
            updatedBy: actor.userId,
            recordVersion: sql`${candidates.recordVersion} + 1`,
          })
          .where(eq(candidates.id, exact.id));
        updated++;
        continue;
      }
      if (matches.length && row.resolution !== "create_separate")
        throw new Error(
          `Row ${row.sourceRowIndex} now matches an existing candidate. Review the duplicate decision again.`,
        );
      const id = randomUUID();
      await tx.insert(candidates).values({
        id,
        organisationId,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone,
        nationality: row.nationality?.trim() || null,
        location: row.location,
        currentCompany: row.currentCompany?.trim() || null,
        currentTitle: row.currentTitle?.trim() || null,
        yearsOfExperience: row.yearsOfExperience,
        stage: row.stage,
        doNotContact: false,
        visaStatus: row.visaStatus,
        maritalStatus: row.maritalStatus,
        shortlistStatus: row.shortlistStatus?.trim() || null,
        trackerStatus: row.trackerStatus?.trim() || null,
        projectName: row.projectName?.trim() || null,
        projectType: row.projectType?.trim() || null,
        noticePeriod: row.noticePeriod?.trim() || null,
        lastContactAt: row.lastContactAt || null,
        interviewDate: row.interviewDate || null,
        currentSalaryEncrypted: row.currentSalary ? encryptSensitiveJson(row.currentSalary) : null,
        expectedSalaryEncrypted: row.expectedSalary
          ? encryptSensitiveJson(row.expectedSalary)
          : null,
        acceptedSalaryEncrypted: row.acceptedSalary
          ? encryptSensitiveJson(row.acceptedSalary)
          : null,
        remarks: row.remarks?.trim() || null,
        source: row.source?.trim() || "Spreadsheet Import",
        importProvenance: `${row.sourceSheet} - Row ${row.sourceRowIndex}`,
        originalImportValues: row.originalImportValues ?? {},
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
      inserted++;
    }
    const batchId = randomUUID();
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "import",
      module: "recruitment",
      entityType: "candidate-import-batch",
      entityId: batchId,
      afterSummary: { inserted, updated, skipped, reviewedRows: rows.length },
      reason: importReason.trim(),
      riskLevel: "Critical",
    });
    return { batchId, inserted, updated, skipped };
  });
}
