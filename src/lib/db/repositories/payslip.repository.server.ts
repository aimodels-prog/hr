import "@tanstack/react-start/server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employeePayslips } from "../schema/travel-payroll.ts";
import { employees, users } from "../schema/employee.ts";
import { fileMetadata } from "../schema/documents.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { readObjectFile } from "../object-storage.server.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

export function requirePayslipFinance(actor: AuditActorContext) {
  if (actor.activeRole !== "Accounts")
    throw new Error("Switch to your Finance role to upload or manage payslips.");
  if (!actor.userId) throw new Error("Sign in first.");
}
export async function payslipEmployee(org: string, employeeId: string, actor: AuditActorContext) {
  requirePayslipFinance(actor);
  const [employee] = await getDatabaseClient()
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, org),
        eq(employees.id, employeeId),
        isNull(employees.archivedAt),
      ),
    )
    .limit(1);
  if (!employee) throw new Error("Employee was not found in your organisation.");
}
export async function listPayslips(
  org: string,
  actor: AuditActorContext,
  scope: "self" | "finance",
) {
  if (scope === "finance") requirePayslipFinance(actor);
  else if (!actor.employeeId) throw new Error("Your employee profile is required.");
  const db = getDatabaseClient();
  const slips = await db
    .select({
      id: employeePayslips.id,
      employeeId: employeePayslips.employeeId,
      employeeName: employees.legalName,
      payMonth: employeePayslips.payMonth,
      uploadedAt: employeePayslips.createdAt,
    })
    .from(employeePayslips)
    .innerJoin(
      employees,
      and(eq(employees.id, employeePayslips.employeeId), eq(employees.organisationId, org)),
    )
    .where(
      and(
        eq(employeePayslips.organisationId, org),
        isNull(employeePayslips.archivedAt),
        ...(scope === "self" ? [eq(employeePayslips.employeeId, actor.employeeId!)] : []),
      ),
    )
    .orderBy(desc(employeePayslips.payMonth), desc(employeePayslips.createdAt));
  const people =
    scope === "finance"
      ? await db
          .select({ id: employees.id, name: employees.legalName, email: employees.workEmail })
          .from(employees)
          .where(and(eq(employees.organisationId, org), isNull(employees.archivedAt)))
      : [];
  return {
    slips: slips.map((slip) => ({ ...slip, uploadedAt: slip.uploadedAt.toISOString() })),
    employees: people,
  };
}
export async function publishPayslip(
  org: string,
  input: { employeeId: string; payMonth: string; fileId: string },
  actor: AuditActorContext,
) {
  await payslipEmployee(org, input.employeeId, actor);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.payMonth)) throw new Error("Choose a valid pay month.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(fileMetadata)
      .where(and(eq(fileMetadata.id, input.fileId), eq(fileMetadata.organisationId, org)))
      .limit(1);
    if (
      !file ||
      file.ownerEntityType !== "employee-payslip" ||
      file.ownerEntityId !== input.employeeId ||
      file.storageStatus !== "Available" ||
      file.mimeType !== "application/pdf"
    )
      throw new Error("This payslip file is unavailable or belongs to someone else.");
    const [slip] = await tx
      .insert(employeePayslips)
      .values({ organisationId: org, ...input, createdBy: actor.userId!, updatedBy: actor.userId! })
      .onConflictDoNothing()
      .returning({ id: employeePayslips.id });
    if (!slip)
      throw new Error(
        "A payslip already exists for this employee and month. It has not been overwritten.",
      );
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "payslip-published",
      module: "payroll",
      entityType: "employee-payslip",
      entityId: slip.id,
      afterSummary: { employeeId: input.employeeId, payMonth: input.payMonth },
      reason: "Finance uploaded and shared an individual payslip",
      riskLevel: "Medium",
    });
    const recipients = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.employeeId, input.employeeId),
          eq(users.status, "Active"),
        ),
      );
    for (const recipient of recipients)
      await tx.insert(notifications).values({
        organisationId: org,
        recipientUserId: recipient.id,
        type: "payslip_available",
        title: "Your payslip is available",
        message: `Your payslip for ${input.payMonth} is ready to download.`,
        priority: "Normal",
        status: "Unread",
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
        deduplicationKey: `payslip-${slip.id}-${recipient.id}`,
        link: { entityType: "employee-payslip", entityId: slip.id, path: "/staff/payslips" },
      });
    return slip.id;
  });
}
export async function readPayslip(org: string, id: string, actor: AuditActorContext) {
  const [slip] = await getDatabaseClient()
    .select()
    .from(employeePayslips)
    .where(
      and(
        eq(employeePayslips.organisationId, org),
        eq(employeePayslips.id, id),
        isNull(employeePayslips.archivedAt),
      ),
    )
    .limit(1);
  if (!slip || (actor.activeRole !== "Accounts" && slip.employeeId !== actor.employeeId))
    throw new Error("You cannot access this payslip.");
  return readObjectFile(org, slip.fileId, actor, `Downloaded payslip for ${slip.payMonth}`);
}
