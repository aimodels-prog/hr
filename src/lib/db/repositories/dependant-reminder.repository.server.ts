import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees, users } from "../schema/employee.ts";
import { employeeDocuments } from "../schema/documents.ts";
import { notifications } from "../schema/system.ts";
import { missingDependantInformation } from "../../data/dependants.ts";

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
  return (row.employee.dependants ?? []).some(
    (d) => missingDependantInformation(d, documents).length > 0,
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
        eq(employees.status, "Active"),
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
    const missing = (employee.dependants ?? [])
      .map((d) => ({ name: d.name, missing: missingDependantInformation(d, documents) }))
      .filter((d) => d.missing.length);
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
        title: "Please complete your dependant information",
        message: `Your existing family details have been kept. Please complete: ${missing.map((d) => `${d.name}: ${d.missing.join(", ")}`).join("; ")}. Edit Personal details and upload family documents under Documents.`,
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
