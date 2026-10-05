import "@tanstack/react-start/server-only";
import { and, eq, isNull, or, sql, desc, inArray } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { timeAway } from "../schema/time-away.ts";
import { employees, users, userRoles, roles } from "../schema/employee.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  canRecordTimeAway,
  timeAwayDate,
  timeAwayInput,
  TIME_AWAY_TREATMENTS,
} from "../../data/time-away.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

const hr = (actor: AuditActorContext) => ["HR", "Super Admin"].includes(actor.activeRole);
function employeeScope(actor: AuditActorContext) {
  if (hr(actor)) return undefined;
  return or(
    eq(employees.id, actor.employeeId ?? "00000000-0000-0000-0000-000000000000"),
    actor.activeRole === "Line Manager" && actor.employeeId
      ? eq(employees.lineManagerId, actor.employeeId)
      : sql`false`,
  );
}
export async function listTimeAway(org: string, date: string, actor: AuditActorContext) {
  timeAwayDate.parse(date);
  const db = getDatabaseClient();
  const people = await db
    .select({ id: employees.id, name: employees.legalName, email: employees.workEmail })
    .from(employees)
    .where(
      and(eq(employees.organisationId, org), isNull(employees.archivedAt), employeeScope(actor)),
    )
    .orderBy(employees.legalName);
  const rows = await db
    .select({ record: timeAway, name: employees.legalName })
    .from(timeAway)
    .innerJoin(
      employees,
      and(eq(employees.id, timeAway.employeeId), eq(employees.organisationId, org)),
    )
    .where(and(eq(timeAway.organisationId, org), eq(timeAway.date, date), employeeScope(actor)))
    .orderBy(desc(timeAway.createdAt));
  return {
    people,
    rows: rows.map(({ record, name }) => ({ ...record, name })),
    selfId: actor.employeeId ?? null,
    canReview: hr(actor),
  };
}
export async function recordTimeAway(org: string, raw: unknown, actor: AuditActorContext) {
  const input = timeAwayInput.parse(raw);
  if (!actor.userId) throw new Error("Sign in before recording time away.");
  return getDatabaseClient().transaction(async (tx) => {
    // Serialises creation for a person/day, including concurrent duplicate submissions.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${org + input.employeeId + input.date + ":time-away"},0))`,
    );
    const [person] = await tx
      .select()
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, org),
          eq(employees.id, input.employeeId),
          isNull(employees.archivedAt),
        ),
      );
    if (
      !person ||
      !canRecordTimeAway(actor.activeRole, actor.employeeId, person.id, person.lineManagerId)
    )
      throw new Error("You can record time away only for yourself or your authorised team.");
    const [overlap] = await tx
      .select({ id: timeAway.id })
      .from(timeAway)
      .where(
        and(
          eq(timeAway.organisationId, org),
          eq(timeAway.employeeId, input.employeeId),
          eq(timeAway.date, input.date),
          inArray(timeAway.status, ["Pending HR", "Approved"]),
          sql`${timeAway.startTime} < ${input.endTime} AND ${timeAway.endTime} > ${input.startTime}`,
        ),
      );
    if (overlap) throw new Error("Time away is already recorded for part of this period.");
    const [record] = await tx
      .insert(timeAway)
      .values({ ...input, organisationId: org, createdBy: actor.userId!, updatedBy: actor.userId! })
      .returning();
    if (!record) throw new Error("Time away could not be saved.");
    const reviewers = await tx
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.organisationId, org)))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.status, "Active"),
          inArray(roles.code, ["HR", "Super Admin"]),
          sql`${users.id} <> ${actor.userId}::uuid`,
          sql`${users.employeeId} IS DISTINCT FROM ${input.employeeId}::uuid`,
        ),
      );
    for (const reviewer of reviewers)
      await tx
        .insert(notifications)
        .values({
          organisationId: org,
          recipientUserId: reviewer.id,
          type: "time_away.submitted",
          title: "Time away needs HR review",
          message: `${person.legalName}: ${input.date}, ${input.startTime}–${input.endTime}. Review the record and choose how this time should be treated.`,
          link: {
            entityType: "time-away",
            entityId: record.id,
            path: `/staff/time-away?date=${input.date}`,
          },
          deduplicationKey: `time-away:${record.id}:review`,
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        })
        .onConflictDoNothing();
    const owners = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.employeeId, input.employeeId),
          eq(users.status, "Active"),
        ),
      );
    for (const owner of owners)
      await tx
        .insert(notifications)
        .values({
          organisationId: org,
          recipientUserId: owner.id,
          type: "time_away.request_recorded",
          title: "Your time away is awaiting HR review",
          message: `${input.date}, ${input.startTime}–${input.endTime} was recorded for you. Check the times in VIA HR. No pay or leave deduction has been made.`,
          link: {
            entityType: "time-away",
            entityId: record.id,
            path: `/staff/time-away?date=${input.date}`,
          },
          deduplicationKey: `time-away:${record.id}:receipt`,
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        })
        .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "time-away-recorded",
      module: "attendance",
      entityType: "time-away",
      entityId: record.id,
      reason: "Recorded time away for HR review",
      riskLevel: "Low",
    });
    return record.id;
  });
}
export async function decideTimeAway(
  org: string,
  input: {
    id: string;
    version: number;
    action: "Approve" | "Reject" | "Cancel";
    treatment?: (typeof TIME_AWAY_TREATMENTS)[number] | undefined;
    note: string;
  },
  actor: AuditActorContext,
) {
  if (!actor.userId) throw new Error("Sign in to continue.");
  return getDatabaseClient().transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(timeAway)
      .where(and(eq(timeAway.organisationId, org), eq(timeAway.id, input.id)))
      .for("update");
    if (!record) throw new Error("Time-away record not found.");
    if (record.recordVersion !== input.version || record.status !== "Pending HR")
      throw new Error("This record has already changed. Refresh before continuing.");
    if (input.action === "Cancel") {
      if (!hr(actor) && record.employeeId !== actor.employeeId) {
        const [person] = await tx
          .select({ manager: employees.lineManagerId })
          .from(employees)
          .where(and(eq(employees.organisationId, org), eq(employees.id, record.employeeId)));
        if (
          record.createdBy !== actor.userId ||
          actor.activeRole !== "Line Manager" ||
          person?.manager !== actor.employeeId
        )
          throw new Error("You cannot cancel this record.");
      }
    } else {
      if (!hr(actor)) throw new Error("Only HR can review time away.");
      if (record.employeeId === actor.employeeId || record.createdBy === actor.userId)
        throw new Error("Another HR reviewer must review your own record.");
      if (
        input.action === "Approve" &&
        (!input.treatment || !TIME_AWAY_TREATMENTS.includes(input.treatment))
      )
        throw new Error("Choose paid time, unpaid time or leave.");
      if (input.action === "Reject" && !input.note.trim())
        throw new Error("Tell the employee what needs correcting.");
    }
    const status =
      input.action === "Approve"
        ? "Approved"
        : input.action === "Reject"
          ? "Rejected"
          : "Cancelled";
    await tx
      .update(timeAway)
      .set({
        status,
        treatment: input.action === "Approve" ? input.treatment! : null,
        reviewNote: input.note,
        reviewedBy: actor.userId!,
        updatedBy: actor.userId!,
        updatedAt: new Date(),
        recordVersion: record.recordVersion + 1,
      })
      .where(eq(timeAway.id, record.id));
    await tx
      .update(notifications)
      .set({ status: "Dismissed", dismissedAt: new Date().toISOString(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.organisationId, org),
          eq(notifications.deduplicationKey, `time-away:${record.id}:review`),
        ),
      );
    const recipients = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, org),
          eq(users.status, "Active"),
          or(eq(users.employeeId, record.employeeId), eq(users.id, record.createdBy)),
        ),
      );
    for (const person of recipients)
      await tx
        .insert(notifications)
        .values({
          organisationId: org,
          recipientUserId: person.id,
          type: "time_away.decision",
          title: `Time away ${status.toLowerCase()}`,
          message: `${record.date}, ${record.startTime}–${record.endTime}: ${status}${input.action === "Approve" ? ` as ${input.treatment}` : ""}. Open the record for details. No pay or leave deduction has been made automatically.`,
          link: {
            entityType: "time-away",
            entityId: record.id,
            path: `/staff/time-away?date=${record.date}`,
          },
          deduplicationKey: `time-away:${record.id}:${status}`,
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        })
        .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId: org,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: `time-away-${status.toLowerCase()}`,
      module: "attendance",
      entityType: "time-away",
      entityId: record.id,
      reason: "HR time-away workflow updated",
      riskLevel: "Low",
    });
  });
}
