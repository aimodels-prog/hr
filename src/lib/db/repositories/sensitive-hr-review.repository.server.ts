import "@tanstack/react-start/server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { hrIndependentReviewAssignments } from "../schema/hr-independent-review.ts";
import { departments, employmentTypes, locations, positions } from "../schema/master-data.ts";
import { trainingRecords } from "../schema/talent.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import { listEmployeeDocumentsForActor } from "./employee-document.repository.server.ts";
import type { EmployeeDocument } from "../../data/types.ts";

type SensitiveReview =
  | {
      module: "Document";
      requestId: string;
      employeeName: string;
      status: string;
      document: EmployeeDocument;
      assignedAt: string;
    }
  | {
      module: "Training Certificate";
      requestId: string;
      employeeName: string;
      status: string;
      title: string;
      provider: string;
      completionDate: string;
      certificateFileId: string | null;
      assignedAt: string;
    }
  | {
      module: "Employment Confirmation";
      requestId: string;
      employeeName: string;
      status: string;
      details: {
        legalName: string;
        preferredName: string;
        startDate: string;
        position: string;
        department: string;
        location: string;
        employmentType: string;
        supervisor: string;
        visaRequired: boolean | null;
      };
      reviewNote: string | null;
      assignedAt: string;
    };

/** Only exact records assigned to this independent employee are returned. */
export async function listSensitiveHrReviewsForActor(
  organisationId: string,
  actor: AuditActorContext,
): Promise<SensitiveReview[]> {
  if (actor.activeRole !== "Employee" || !actor.employeeId)
    throw new Error("Switch to your Employee role to review assigned HR records.");
  const db = getDatabaseClient();
  const assignments = await db
    .select({
      module: hrIndependentReviewAssignments.module,
      requestId: hrIndependentReviewAssignments.requestId,
      requesterId: hrIndependentReviewAssignments.requesterEmployeeId,
      createdAt: hrIndependentReviewAssignments.createdAt,
      requesterName: employees.preferredName,
      legalName: employees.legalName,
    })
    .from(hrIndependentReviewAssignments)
    .innerJoin(
      employees,
      and(
        eq(employees.organisationId, organisationId),
        eq(employees.id, hrIndependentReviewAssignments.requesterEmployeeId),
      ),
    )
    .where(
      and(
        eq(hrIndependentReviewAssignments.organisationId, organisationId),
        eq(hrIndependentReviewAssignments.reviewerEmployeeId, actor.employeeId),
        inArray(hrIndependentReviewAssignments.module, [
          "Document",
          "Training Certificate",
          "Employment Confirmation",
        ]),
        isNull(hrIndependentReviewAssignments.archivedAt),
      ),
    );
  const documentIds = assignments.filter((a) => a.module === "Document").map((a) => a.requestId);
  const certificateIds = assignments
    .filter((a) => a.module === "Training Certificate")
    .map((a) => a.requestId);
  const employmentIds = assignments
    .filter((a) => a.module === "Employment Confirmation")
    .map((a) => a.requestId);
  const [
    documents,
    certificates,
    employment,
    departmentRows,
    positionRows,
    locationRows,
    typeRows,
  ] = await Promise.all([
    documentIds.length ? listEmployeeDocumentsForActor(organisationId, actor) : [],
    certificateIds.length
      ? db
          .select()
          .from(trainingRecords)
          .where(
            and(
              eq(trainingRecords.organisationId, organisationId),
              inArray(trainingRecords.id, certificateIds),
              isNull(trainingRecords.archivedAt),
            ),
          )
      : [],
    employmentIds.length
      ? db
          .select()
          .from(employees)
          .where(
            and(
              eq(employees.organisationId, organisationId),
              inArray(employees.id, employmentIds),
              isNull(employees.archivedAt),
            ),
          )
      : [],
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.organisationId, organisationId)),
    db
      .select({ id: positions.id, name: positions.name })
      .from(positions)
      .where(eq(positions.organisationId, organisationId)),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.organisationId, organisationId)),
    db
      .select({ id: employmentTypes.id, name: employmentTypes.name })
      .from(employmentTypes)
      .where(eq(employmentTypes.organisationId, organisationId)),
  ]);
  const documentById = new Map(documents.map((item) => [item.id, item]));
  const certificateById = new Map(certificates.map((item) => [item.id, item]));
  const employmentById = new Map(employment.map((item) => [item.id, item]));
  const departmentsById = new Map(departmentRows.map((item) => [item.id, item.name]));
  const positionsById = new Map(positionRows.map((item) => [item.id, item.name]));
  const locationsById = new Map(locationRows.map((item) => [item.id, item.name]));
  const typesById = new Map(typeRows.map((item) => [item.id, item.name]));

  return assignments
    .flatMap<SensitiveReview>((assignment) => {
      const employeeName = assignment.requesterName || assignment.legalName;
      if (assignment.module === "Document") {
        const document = documentById.get(assignment.requestId);
        return document
          ? [
              {
                module: "Document" as const,
                requestId: document.id,
                employeeName,
                status: document.status,
                document,
                assignedAt: assignment.createdAt.toISOString(),
              },
            ]
          : [];
      }
      if (assignment.module === "Training Certificate") {
        const record = certificateById.get(assignment.requestId);
        return record
          ? [
              {
                module: "Training Certificate" as const,
                requestId: record.id,
                employeeName,
                status: record.hrVerified ? "Verified" : record.rejectedAt ? "Rejected" : "Pending",
                title: record.title,
                provider: record.provider,
                completionDate: record.completionDate,
                certificateFileId: record.certificateFileId,
                assignedAt: assignment.createdAt.toISOString(),
              },
            ]
          : [];
      }
      const person = employmentById.get(assignment.requestId);
      if (!person) return [];
      const proposed = person.proposedEmploymentDetails;
      return [
        {
          module: "Employment Confirmation" as const,
          requestId: person.id,
          employeeName,
          status: person.employmentConfirmationStatus,
          details: {
            legalName: proposed?.legalName ?? person.legalName,
            preferredName: proposed?.preferredName ?? person.preferredName,
            startDate: proposed?.startDate ?? person.startDate,
            position:
              positionsById.get(proposed?.positionId ?? person.positionId) ?? "Unknown position",
            department:
              departmentsById.get(proposed?.departmentId ?? person.departmentId) ??
              "Unknown department",
            location:
              locationsById.get(proposed?.locationId ?? person.locationId) ?? "Unknown location",
            employmentType:
              typesById.get(proposed?.employmentTypeId ?? person.employmentTypeId) ??
              "Unknown employment type",
            supervisor: proposed?.lineManagerEmail || "No supervisor",
            visaRequired: proposed?.visaRequired ?? person.visaRequired,
          },
          reviewNote: person.employmentReviewNote,
          assignedAt: assignment.createdAt.toISOString(),
        },
      ];
    })
    .sort((a, b) => {
      const aPending = ["Pending", "Pending Verification", "Pending HR Review"].includes(a.status);
      const bPending = ["Pending", "Pending Verification", "Pending HR Review"].includes(b.status);
      return Number(bPending) - Number(aPending) || b.assignedAt.localeCompare(a.assignedAt);
    });
}
