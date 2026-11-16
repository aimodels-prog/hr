import "@tanstack/react-start/server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { missingRequiredDocuments } from "../../data/dashboard-document-checklist.ts";
import { getDatabaseClient } from "../client.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { employees } from "../schema/employee.ts";
import { getDocumentRequirementSettings } from "./document-requirements.repository.server.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export type DashboardMissingDocument = {
  employeeId: string;
  employeeName: string;
  requirementId: string;
  requirementName: string;
  uploadBy: "Employee" | "HR";
};

export async function listDashboardMissingDocuments(
  organisationId: string,
  actor: AuditActorContext,
): Promise<DashboardMissingDocument[]> {
  if (!actor.userId || !actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  const isHr = actor.activeRole === "HR";
  const staff = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        isNull(employees.archivedAt),
        isHr
          ? inArray(employees.status, ["Onboarding", "Active", "Probation", "Notice"])
          : eq(employees.id, actor.employeeId),
      ),
    );
  if (staff.length === 0) return [];
  const documents = await db
    .select({
      employeeId: employeeDocuments.employeeId,
      type: employeeDocuments.type,
      requirementSnapshot: employeeDocuments.requirementSnapshot,
      status: employeeDocuments.status,
      expiryDate: employeeDocuments.expiryDate,
      dependantId: employeeDocuments.dependantId,
      waiverReason: employeeDocuments.waiverReason,
    })
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.organisationId, organisationId),
        inArray(
          employeeDocuments.employeeId,
          staff.map((employee) => employee.id),
        ),
        isNull(employeeDocuments.archivedAt),
      ),
    );
  const byEmployee = new Map<string, typeof documents>();
  for (const document of documents) {
    const list = byEmployee.get(document.employeeId) ?? [];
    list.push(document);
    byEmployee.set(document.employeeId, list);
  }
  const { definitions } = await getDocumentRequirementSettings(organisationId);
  const today = new Date().toISOString().slice(0, 10);
  return staff
    .flatMap((employee) =>
      missingRequiredDocuments(definitions, employee, byEmployee.get(employee.id) ?? [], today).map(
        (requirement) => ({
          employeeId: employee.id,
          employeeName: employee.preferredName || employee.legalName,
          requirementId: requirement.id,
          requirementName: requirement.name,
          uploadBy: requirement.uploadBy,
        }),
      ),
    )
    .sort(
      (a, b) =>
        Number(b.uploadBy === "HR") - Number(a.uploadBy === "HR") ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.requirementName.localeCompare(b.requirementName),
    );
}
