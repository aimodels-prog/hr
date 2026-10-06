import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees, users } from "../schema/employee.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { notifications } from "../schema/system.ts";
import { missingDependantInformation } from "../../data/dependants.ts";
import { getDocumentRequirementSettings } from "./document-requirements.repository.server.ts";
import { requirementApplies, type DocumentRequirement } from "../../data/document-requirements.ts";

function missingEmployeeDocuments(
  definitions: DocumentRequirement[],
  employee: typeof employees.$inferSelect,
  documents: Array<typeof employeeDocuments.$inferSelect>,
) {
  const today = new Date().toISOString().slice(0, 10);
  return definitions
    .filter(
      (r) =>
        r.required &&
        r.uploadBy === "Employee" &&
        requirementApplies(r, employee) &&
        !documents.some(
          (d) =>
            !d.dependantId &&
            (d.requirementSnapshot?.id === r.id ||
              (!d.requirementSnapshot && r.id === r.type && d.type === r.type)) &&
            (d.status === "Pending Verification" ||
              (d.status === "Valid" && (!d.expiryDate || d.expiryDate >= today))),
        ),
    )
    .map((r) => r.name);
}

export async function dependantCompletionStillMissing(
  organisationId: string,
  userId: string,
): Promise<boolean> {
  const db = getDatabaseClient();
  const [row] = await db
    .select({ employee: employees })
    .from(users)
    .innerJoin(employees, eq(employees.id, users.employeeId))
    .where(
      and(
        eq(users.id, userId),
        eq(users.organisationId, organisationId),
        eq(employees.organisationId, organisationId),
        isNull(employees.archivedAt),
      ),
    );
  if (!row) return false;
  const documents = await db
    .select()
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.employeeId, row.employee.id),
        eq(employeeDocuments.organisationId, organisationId),
        isNull(employeeDocuments.archivedAt),
      ),
    );
  const settings = await getDocumentRequirementSettings(organisationId);
  return (
    missingEmployeeDocuments(settings.definitions, row.employee, documents).length > 0 ||
    (row.employee.dependants ?? []).some(
      (d) => missingDependantInformation(d, documents).length > 0,
    )
  );
}

export async function processDependantCompletionNotices() {
  const db = getDatabaseClient();
  const rows = await db
    .select({ employee: employees, userId: users.id })
    .from(employees)
    .innerJoin(
      users,
      and(eq(users.employeeId, employees.id), eq(users.organisationId, employees.organisationId)),
    )
    .where(
      and(
        eq(users.status, "Active"),
        isNull(users.archivedAt),
        isNull(employees.archivedAt),
        sql`${employees.status} IN ('Active','Onboarding','Probation')`,
      ),
    );
  let created = 0;
  for (const { employee, userId } of rows) {
    const documents = await db
      .select()
      .from(employeeDocuments)
      .where(
        and(
          eq(employeeDocuments.employeeId, employee.id),
          eq(employeeDocuments.organisationId, employee.organisationId),
          isNull(employeeDocuments.archivedAt),
        ),
      );
    const settings = await getDocumentRequirementSettings(employee.organisationId);
    const missing = (employee.dependants ?? [])
      .map((d) => ({ name: d.name, missing: missingDependantInformation(d, documents) }))
      .filter((d) => d.missing.length);
    const missingDocuments = missingEmployeeDocuments(settings.definitions, employee, documents);
    if (missingDocuments.length)
      missing.push({ name: "Your documents", missing: missingDocuments });
    const key = missing.length
      ? `dependants-completion:${employee.id}:${createHash("sha256").update(JSON.stringify(missing)).digest("hex").slice(0, 24)}`
      : "";
    // Superseded checklists must not send outdated emails or remain as outstanding tasks.
    await db
      .update(notifications)
      .set({ status: "Dismissed", dismissedAt: new Date().toISOString(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.organisationId, employee.organisationId),
          eq(notifications.recipientUserId, userId),
          eq(notifications.type, "dependants.missing_information_reminder"),
          sql`${notifications.deduplicationKey} <> ${key}`,
          sql`${notifications.status} <> 'Dismissed'`,
        ),
      );
    if (!missing.length) continue;
    const result = await db
      .insert(notifications)
      .values({
        organisationId: employee.organisationId,
        recipientUserId: userId,
        type: "dependants.missing_information_reminder",
        title: "Please complete your profile and documents",
        message: `Please complete: ${missing.map((d) => `${d.name}: ${d.missing.join(", ")}`).join("; ")}. Your existing information is kept. Open My Profile to update details and upload missing documents.`,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: key,
        link: { entityType: "employee-profile", entityId: employee.id, path: "/staff/me/profile" },
        createdBy: userId,
        updatedBy: userId,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    created += result.length;
  }
  return { created };
}
