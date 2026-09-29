import "@tanstack/react-start/server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { employees } from "../schema/employee.ts";
import { locations } from "../schema/master-data.ts";
import { appSettings } from "../schema/organisation.ts";
import { auditEvents } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";
import {
  employmentCalendarDate,
  validateEmploymentEffectiveDate,
} from "../../data/employment-change-policy.ts";
import {
  readAttendanceTracking,
  setTrackingAssignment,
  trackingAssignment,
} from "../../data/attendance-tracking.ts";
import type { AttendanceTrackingMode } from "../../data/attendance-tracking.ts";

export async function getAttendanceTrackingPolicy(organisationId: string) {
  const [row] = await getDatabaseClient()
    .select({ additional: appSettings.additionalSettings })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  return readAttendanceTracking(row?.additional);
}
type TrackingTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabaseClient>["transaction"]>[0]
>[0];
export async function syncEmployeeAttendanceTracking(
  tx: TrackingTransaction,
  organisationId: string,
  employeeId: string,
  locationId: string,
  effectiveFrom: string,
) {
  const [settings] = await tx
    .select()
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .for("update")
    .limit(1);
  const policy = readAttendanceTracking(settings?.additionalSettings);
  if (!settings || !policy) return;
  const date = effectiveFrom < policy.effectiveFrom ? policy.effectiveFrom : effectiveFrom;
  if (trackingAssignment(policy, employeeId, date)?.source === "override") return;
  const next = setTrackingAssignment(policy, {
    employeeId,
    effectiveFrom: date,
    mode: locationId === policy.headOfficeLocationId ? "Head Office biometric" : "Not required",
    source: "location",
  });
  await tx
    .update(appSettings)
    .set({
      additionalSettings: { ...settings.additionalSettings, attendanceTracking: next },
      updatedAt: new Date(),
      recordVersion: sql`${appSettings.recordVersion} + 1`,
    })
    .where(eq(appSettings.id, settings.id));
}
export async function saveAttendanceTrackingPolicy(
  organisationId: string,
  input: {
    headOfficeLocationId?: string | undefined;
    employeeId?: string | undefined;
    mode?: AttendanceTrackingMode | undefined;
    effectiveFrom: string;
    revision: number;
  },
  actor: AuditActorContext,
) {
  if (!["HR", "Super Admin"].includes(actor.activeRole ?? ""))
    throw new Error("Only HR can change attendance eligibility.");
  validateEmploymentEffectiveDate(input.effectiveFrom);
  return getDatabaseClient().transaction(async (tx) => {
    // Same lock as employment transfers, before taking the settings row lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`employment:${organisationId}`}, 0))`,
    );
    const [settings] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .for("update")
      .limit(1);
    if (!settings) throw new Error("Organisation settings are not configured.");
    const current = readAttendanceTracking(settings.additionalSettings);
    if ((current?.revision ?? 0) !== input.revision)
      throw new Error("Attendance settings changed. Refresh and try again.");
    const today = employmentCalendarDate(settings.timezone);
    if (input.effectiveFrom < today)
      throw new Error("Use today or a future date. Historical attendance will be preserved.");
    let next = current;
    if (input.headOfficeLocationId) {
      if (current && current.headOfficeLocationId !== input.headOfficeLocationId)
        throw new Error(
          "Head Office is already configured. Change individual eligibility when employees transfer.",
        );
      const [office] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            eq(locations.id, input.headOfficeLocationId),
            eq(locations.organisationId, organisationId),
            eq(locations.isActive, true),
            isNull(locations.archivedAt),
          ),
        )
        .limit(1);
      if (!office) throw new Error("Choose an active location.");
      if (current) return current;
      const people = await tx
        .select({ id: employees.id, locationId: employees.locationId })
        .from(employees)
        .where(and(eq(employees.organisationId, organisationId), isNull(employees.archivedAt)));
      next = {
        headOfficeLocationId: office.id,
        effectiveFrom: input.effectiveFrom,
        revision: 1,
        assignments: people.map((person) => ({
          employeeId: person.id,
          effectiveFrom: input.effectiveFrom,
          mode:
            person.locationId === office.id
              ? ("Head Office biometric" as const)
              : ("Not required" as const),
          source: "location" as const,
        })),
      };
    } else {
      if (!current || !input.employeeId || !input.mode)
        throw new Error("Configure Head Office first.");
      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.id, input.employeeId),
            eq(employees.organisationId, organisationId),
            isNull(employees.archivedAt),
          ),
        )
        .limit(1);
      if (!employee) throw new Error("Employee not found.");
      if (input.effectiveFrom < current.effectiveFrom)
        throw new Error("The exception cannot start before attendance tracking.");
      next = setTrackingAssignment(current, {
        employeeId: employee.id,
        effectiveFrom: input.effectiveFrom,
        mode: input.mode,
        source: "override",
      });
    }
    await tx
      .update(appSettings)
      .set({
        additionalSettings: { ...settings.additionalSettings, attendanceTracking: next },
        updatedAt: new Date(),
        updatedBy: actor.userId ?? settings.updatedBy,
        recordVersion: sql`${appSettings.recordVersion} + 1`,
      })
      .where(eq(appSettings.id, settings.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      actorRoles: actor.roles,
      activeRole: actor.activeRole,
      action: "update",
      module: "attendance",
      entityType: "app_settings",
      entityId: settings.id,
      beforeSummary: {
        revision: current?.revision ?? 0,
        ...(input.employeeId
          ? { assignment: trackingAssignment(current, input.employeeId, input.effectiveFrom) }
          : {}),
      },
      afterSummary: { ...input, revision: next?.revision },
      reason: "HR updated attendance eligibility; leave and timesheet access unchanged.",
      riskLevel: "Low",
    });
    return next;
  });
}
