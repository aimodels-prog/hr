import "@tanstack/react-start/server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employeePayslips } from "../schema/travel-payroll.ts";
import { employees, users } from "../schema/employee.ts";
import { fileMetadata } from "../schema/documents.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import { deleteObjectFile, readObjectFile } from "../object-storage.server.ts";
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
      revision: employeePayslips.revision,
      recordVersion: employeePayslips.recordVersion,
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
      file.archivedAt !== null ||
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
const changedPayslip = "This payslip has already changed. Refresh the list and try again.";

/** Preflight before storing a replacement; the transaction repeats this under a row lock. */
export async function payslipForReplacement(
  org: string,
  id: string,
  expectedVersion: number,
  actor: AuditActorContext,
) {
  requirePayslipFinance(actor);
  const [slip] = await getDatabaseClient()
    .select()
    .from(employeePayslips)
    .where(and(eq(employeePayslips.organisationId, org), eq(employeePayslips.id, id)))
    .limit(1);
  if (!slip) throw new Error("Payslip was not found in your organisation.");
  if (slip.archivedAt || slip.recordVersion !== expectedVersion) throw new Error(changedPayslip);
  return slip;
}

export async function replacePayslip(
  org: string,
  input: { id: string; expectedVersion: number; fileId: string; reason: string },
  actor: AuditActorContext,
) {
  requirePayslipFinance(actor);
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 1000)
    throw new Error("Enter a replacement reason between 5 and 1,000 characters.");
  return getDatabaseClient().transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(employeePayslips)
      .where(and(eq(employeePayslips.organisationId, org), eq(employeePayslips.id, input.id)))
      .for("update");
    if (!previous) throw new Error("Payslip was not found in your organisation.");
    if (previous.archivedAt || previous.recordVersion !== input.expectedVersion)
      throw new Error(changedPayslip);
    const [file] = await tx
      .select()
      .from(fileMetadata)
      .where(and(eq(fileMetadata.organisationId, org), eq(fileMetadata.id, input.fileId)))
      .for("update");
    if (
      !file ||
      file.archivedAt ||
      file.storageStatus !== "Available" ||
      file.ownerEntityType !== "employee-payslip" ||
      file.ownerEntityId !== previous.employeeId ||
      file.mimeType !== "application/pdf"
    )
      throw new Error("This payslip file is unavailable or belongs to someone else.");
    const [used] = await tx
      .select({ id: employeePayslips.id })
      .from(employeePayslips)
      .where(eq(employeePayslips.fileId, input.fileId))
      .limit(1);
    if (used) throw new Error("Upload a new PDF for the replacement. The original must be kept.");

    // The current-month unique index and row lock make the switch atomic. Neither PDF is overwritten.
    await tx
      .update(employeePayslips)
      .set({
        archivedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${employeePayslips.recordVersion} + 1`,
      })
      .where(eq(employeePayslips.id, previous.id));
    const [replacement] = await tx
      .insert(employeePayslips)
      .values({
        organisationId: org,
        employeeId: previous.employeeId,
        payMonth: previous.payMonth,
        fileId: input.fileId,
        revision: previous.revision + 1,
        replacesPayslipId: previous.id,
        replacementReason: reason,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "payslip-replaced",
      module: "payroll",
      entityType: "employee-payslip",
      entityId: replacement!.id,
      beforeSummary: { id: previous.id, fileId: previous.fileId, revision: previous.revision },
      afterSummary: {
        id: replacement!.id,
        fileId: input.fileId,
        revision: replacement!.revision,
        employeeId: previous.employeeId,
        payMonth: previous.payMonth,
      },
      reason,
      riskLevel: "Medium",
    });
    const recipients = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.employeeId, previous.employeeId),
          eq(users.status, "Active"),
          isNull(users.archivedAt),
        ),
      );
    for (const recipient of recipients)
      await tx.insert(notifications).values({
        organisationId: org,
        recipientUserId: recipient.id,
        type: "payslip_replaced",
        title: "Your payslip has been updated",
        message: `Finance has replaced your payslip for ${previous.payMonth}. Download the latest version from My Payslips.`,
        priority: "Normal",
        status: "Unread",
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
        deduplicationKey: `payslip-${replacement!.id}-${recipient.id}`,
        link: {
          entityType: "employee-payslip",
          entityId: replacement!.id,
          path: "/staff/payslips",
        },
      });
    return replacement!.id;
  });
}

export async function listPayslipHistory(org: string, id: string, actor: AuditActorContext) {
  requirePayslipFinance(actor);
  const db = getDatabaseClient();
  const [slip] = await db
    .select()
    .from(employeePayslips)
    .where(and(eq(employeePayslips.organisationId, org), eq(employeePayslips.id, id)))
    .limit(1);
  if (!slip) throw new Error("Payslip was not found in your organisation.");
  const versions = await db
    .select({
      id: employeePayslips.id,
      revision: employeePayslips.revision,
      uploadedAt: employeePayslips.createdAt,
      archivedAt: employeePayslips.archivedAt,
      reason: employeePayslips.replacementReason,
      fileName: fileMetadata.name,
    })
    .from(employeePayslips)
    .innerJoin(
      fileMetadata,
      and(eq(fileMetadata.id, employeePayslips.fileId), eq(fileMetadata.organisationId, org)),
    )
    .where(
      and(
        eq(employeePayslips.organisationId, org),
        eq(employeePayslips.employeeId, slip.employeeId),
        eq(employeePayslips.payMonth, slip.payMonth),
      ),
    )
    .orderBy(desc(employeePayslips.revision), desc(employeePayslips.createdAt));
  return versions.map(({ archivedAt, uploadedAt, ...version }) => ({
    ...version,
    current: !archivedAt,
    uploadedAt: uploadedAt.toISOString(),
  }));
}

/** Only clean up a newly uploaded, unassigned file, including after an ambiguous commit response. */
export async function removeUnassignedPayslipFile(
  org: string,
  fileId: string,
  actor: AuditActorContext,
) {
  requirePayslipFinance(actor);
  const db = getDatabaseClient();
  const [file] = await db
    .select()
    .from(fileMetadata)
    .where(and(eq(fileMetadata.organisationId, org), eq(fileMetadata.id, fileId)))
    .limit(1);
  if (!file || file.ownerEntityType !== "employee-payslip" || file.createdBy !== actor.userId)
    return;
  const [used] = await db
    .select({ id: employeePayslips.id })
    .from(employeePayslips)
    .where(eq(employeePayslips.fileId, fileId))
    .limit(1);
  if (!used)
    await deleteObjectFile(
      org,
      fileId,
      actor,
      "Removed unassigned payslip after publication failed",
    );
}

export async function readPayslip(org: string, id: string, actor: AuditActorContext) {
  const [slip] = await getDatabaseClient()
    .select()
    .from(employeePayslips)
    .where(and(eq(employeePayslips.organisationId, org), eq(employeePayslips.id, id)))
    .limit(1);
  if (
    !actor.userId ||
    !slip ||
    (actor.activeRole !== "Accounts" && (slip.employeeId !== actor.employeeId || !!slip.archivedAt))
  )
    throw new Error("You cannot access this payslip.");
  return readObjectFile(
    org,
    slip.fileId,
    actor,
    `Downloaded payslip for ${slip.payMonth}, version ${slip.revision}`,
  );
}
