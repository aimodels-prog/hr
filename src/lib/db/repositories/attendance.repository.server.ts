import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { getDatabaseClient } from "../client.ts";
import { deleteObjectFile, readObjectFile } from "../object-storage.server.ts";
import { employees, users } from "../schema/employee.ts";
import { fileMetadata } from "../schema/documents.ts";
import { locations } from "../schema/master-data.ts";
import { appSettings } from "../schema/organisation.ts";
import { auditEvents } from "../schema/system.ts";
import {
  attendanceCorrections,
  attendancePolicies,
  attendancePunchEvents,
  attendanceRecords,
  attendanceExceptionCases,
  siteVisitRequests,
} from "../schema/time.ts";
import { notifications } from "../schema/system.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = 6371000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const normalizedIp = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const [network, bitsText = "32"] = cidr.split("/");
  const bits = Number(bitsText);
  const asNumber = (value: string) =>
    value.split(".").reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
  if (
    !network ||
    bits < 0 ||
    bits > 32 ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(normalizedIp) ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(network)
  )
    return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (asNumber(normalizedIp) & mask) === (asNumber(network) & mask);
}

function validIpv4Cidr(value: string): boolean {
  const [network, bitsText = "32"] = value.trim().split("/");
  if (!network || !/^\d+\.\d+\.\d+\.\d+$/.test(network)) return false;
  const octets = network.split(".").map(Number);
  const bits = Number(bitsText);
  return (
    octets.length === 4 &&
    octets.every((part) => part >= 0 && part <= 255) &&
    bits >= 0 &&
    bits <= 32
  );
}

function zonedParts(at: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let candidate = new Date(desired);
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = zonedParts(candidate, timeZone);
    const [actualYear, actualMonth, actualDay] = actual.date.split("-").map(Number);
    const [actualHour, actualMinute] = actual.time.split(":").map(Number);
    const represented = Date.UTC(
      actualYear!,
      actualMonth! - 1,
      actualDay!,
      actualHour!,
      actualMinute!,
    );
    candidate = new Date(candidate.getTime() + desired - represented);
  }
  return candidate;
}

type AttendanceAdminRow = {
  employeeId: string;
  date: string;
  clockIn?: string | undefined;
  clockOut?: string | undefined;
  breakMinutes: number;
  location?: string | undefined;
  source: "Manual Entry" | "Import" | "Hardware Terminal";
};

function requireAttendanceAdmin(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can manage attendance records.");
}

function validateAttendanceAdminRow(input: AttendanceAdminRow): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00Z`)))
    throw new Error("Attendance date must use YYYY-MM-DD.");
  const validTime = (value: string | undefined) =>
    value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validTime(input.clockIn) || !validTime(input.clockOut))
    throw new Error("Attendance times must use HH:MM.");
  if (input.clockOut && !input.clockIn) throw new Error("Clock-in is required before clock-out.");
  if (!Number.isInteger(input.breakMinutes) || input.breakMinutes < 0 || input.breakMinutes > 360)
    throw new Error("Break minutes must be a whole number between 0 and 360.");
  if (input.location && input.location.trim().length > 300)
    throw new Error("Attendance location is too long.");
}

function attendanceMetrics(
  input: AttendanceAdminRow,
  policy: typeof attendancePolicies.$inferSelect | undefined,
  timezone: string,
) {
  const clockInAt = input.clockIn
    ? zonedDateTimeToUtc(input.date, input.clockIn, timezone).toISOString()
    : null;
  let clockOutAt = input.clockOut
    ? zonedDateTimeToUtc(input.date, input.clockOut, timezone).toISOString()
    : null;
  if (clockInAt && clockOutAt && clockOutAt < clockInAt) {
    const overnight = new Date(clockOutAt);
    overnight.setUTCDate(overnight.getUTCDate() + 1);
    clockOutAt = overnight.toISOString();
  }
  const hours =
    clockInAt && clockOutAt
      ? Math.max(
          0,
          (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 3_600_000 -
            input.breakMinutes / 60,
        )
      : 0;
  const expectedIn = policy?.expectedClockIn ?? "09:00";
  const expectedOut = policy?.expectedClockOut ?? "18:00";
  const grace = policy?.lateGraceMinutes ?? 0;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return {
    clockInAt,
    clockOutAt,
    calculatedHours: String(Math.min(24, hours)),
    isLate: Boolean(input.clockIn && minutes(input.clockIn) > minutes(expectedIn) + grace),
    isEarlyDeparture: Boolean(input.clockOut && minutes(input.clockOut) < minutes(expectedOut)),
    status: (input.clockIn
      ? minutes(input.clockIn) > minutes(expectedIn) + grace
        ? "Late"
        : "Present"
      : "Absent") as "Late" | "Present" | "Absent",
    expectedIn,
    expectedOut,
  };
}

export async function saveAttendanceRecordInDatabase(
  organisationId: string,
  input: AttendanceAdminRow & { recordId?: string },
  reason: string,
  actor: AuditActorContext,
): Promise<string> {
  requireAttendanceAdmin(actor);
  validateAttendanceAdminRow(input);
  if (reason.trim().length < 5) throw new Error("Explain why this attendance record is changing.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id, status: employees.status })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)))
      .limit(1);
    if (!employee || ["Inactive", "Archived"].includes(employee.status))
      throw new Error("Select an active employee.");
    const [settings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    const [policy] = await tx
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .limit(1);
    const metrics = attendanceMetrics(input, policy, settings?.timezone ?? "UTC");
    const existingRows = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          input.recordId
            ? eq(attendanceRecords.id, input.recordId)
            : and(
                eq(attendanceRecords.employeeId, input.employeeId),
                eq(attendanceRecords.date, input.date),
              ),
        ),
      )
      .for("update");
    const existing = existingRows[0];
    if (input.recordId && !existing) throw new Error("Attendance record was not found.");
    if (existing && !input.recordId)
      throw new Error("This employee already has an attendance record for the selected date.");
    if (input.recordId) {
      const [duplicate] = await tx
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.organisationId, organisationId),
            eq(attendanceRecords.employeeId, input.employeeId),
            eq(attendanceRecords.date, input.date),
            sql`${attendanceRecords.id} <> ${input.recordId}`,
          ),
        )
        .limit(1);
      if (duplicate)
        throw new Error("This employee already has an attendance record for the selected date.");
    }
    const id = input.recordId ?? randomUUID();
    const values = {
      employeeId: input.employeeId,
      date: input.date,
      expectedClockIn: metrics.expectedIn,
      expectedClockOut: metrics.expectedOut,
      clockInAt: metrics.clockInAt,
      clockOutAt: metrics.clockOutAt,
      breakMinutes: input.breakMinutes,
      location: input.location?.trim() || null,
      source: input.source,
      workMode: "Office",
      status: metrics.status,
      calculatedHours: metrics.calculatedHours,
      isLate: metrics.isLate,
      isEarlyDeparture: metrics.isEarlyDeparture,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    };
    if (existing)
      await tx
        .update(attendanceRecords)
        .set({ ...values, recordVersion: sql`${attendanceRecords.recordVersion} + 1` })
        .where(eq(attendanceRecords.id, id));
    else
      await tx.insert(attendanceRecords).values({
        id,
        organisationId,
        ...values,
        createdBy: actor.userId!,
      } as typeof attendanceRecords.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: existing ? "update" : "create",
      module: "attendance",
      entityType: "attendance-record",
      entityId: id,
      beforeSummary: existing
        ? { employeeId: existing.employeeId, date: existing.date, status: existing.status }
        : undefined,
      afterSummary: { employeeId: input.employeeId, date: input.date, status: metrics.status },
      reason: reason.trim(),
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return id;
  });
}

export async function importAttendanceRecordsInDatabase(
  organisationId: string,
  rows: AttendanceAdminRow[],
  reason: string,
  actor: AuditActorContext,
): Promise<string[]> {
  requireAttendanceAdmin(actor);
  if (!rows.length || rows.length > 1000)
    throw new Error("Import between 1 and 1,000 attendance rows.");
  rows.forEach(validateAttendanceAdminRow);
  const keys = rows.map((row) => `${row.employeeId}:${row.date}`);
  if (new Set(keys).size !== keys.length)
    throw new Error("The import contains duplicate employee dates.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
    const validEmployees = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), inArray(employees.id, employeeIds)));
    if (validEmployees.length !== employeeIds.length)
      throw new Error("The import contains an invalid employee.");
    const conflicts = await tx
      .select({ employeeId: attendanceRecords.employeeId, date: attendanceRecords.date })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          or(
            ...rows.map((row) =>
              and(
                eq(attendanceRecords.employeeId, row.employeeId),
                eq(attendanceRecords.date, row.date),
              ),
            ),
          ),
        ),
      )
      .for("update");
    if (conflicts.length) throw new Error(`Attendance already exists for ${conflicts[0]!.date}.`);
    const [settings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    const [policy] = await tx
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .limit(1);
    const ids = rows.map(() => randomUUID());
    await tx.insert(attendanceRecords).values(
      rows.map((row, index) => {
        const metrics = attendanceMetrics(row, policy, settings?.timezone ?? "UTC");
        return {
          id: ids[index]!,
          organisationId,
          employeeId: row.employeeId,
          date: row.date,
          expectedClockIn: metrics.expectedIn,
          expectedClockOut: metrics.expectedOut,
          clockInAt: metrics.clockInAt,
          clockOutAt: metrics.clockOutAt,
          breakMinutes: row.breakMinutes,
          location: row.location?.trim() || null,
          source: "Import" as const,
          workMode: "Office",
          status: metrics.status,
          calculatedHours: metrics.calculatedHours,
          isLate: metrics.isLate,
          isEarlyDeparture: metrics.isEarlyDeparture,
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        };
      }),
    );
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "import",
      module: "attendance",
      entityType: "attendance-record",
      entityId: randomUUID(),
      afterSummary: { count: rows.length, recordIds: ids },
      reason: reason.trim() || "Validated attendance CSV import",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return ids;
  });
}

export async function exportAttendanceRecordsFromDatabase(
  organisationId: string,
  date: string,
  actor: AuditActorContext,
) {
  requireAttendanceAdmin(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Select a valid attendance date.");
  const db = getDatabaseClient();
  const rows = await db
    .select({
      employeeNumber: employees.employeeNumber,
      employeeName: employees.preferredName,
      date: attendanceRecords.date,
      status: attendanceRecords.status,
      clockInAt: attendanceRecords.clockInAt,
      clockOutAt: attendanceRecords.clockOutAt,
      breakMinutes: attendanceRecords.breakMinutes,
      calculatedHours: attendanceRecords.calculatedHours,
      location: attendanceRecords.location,
      source: attendanceRecords.source,
      workMode: attendanceRecords.workMode,
    })
    .from(attendanceRecords)
    .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
    .where(
      and(eq(attendanceRecords.organisationId, organisationId), eq(attendanceRecords.date, date)),
    )
    .orderBy(employees.preferredName);
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [],
    action: "export",
    module: "attendance",
    entityType: "attendance-record",
    entityId: randomUUID(),
    afterSummary: { date, recordCount: rows.length },
    reason: `Exported attendance records for ${date}`,
    riskLevel: "Medium",
  } as typeof auditEvents.$inferInsert);
  return rows;
}

export async function configureAttendanceOfficeInDatabase(
  organisationId: string,
  input: {
    locationId: string;
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    radiusMeters: number;
  },
  reason: string,
  actor: AuditActorContext,
) {
  requireAttendanceAdmin(actor);
  if (
    !Number.isFinite(input.latitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    !Number.isFinite(input.longitude) ||
    input.longitude < -180 ||
    input.longitude > 180 ||
    !Number.isFinite(input.accuracyMeters) ||
    input.accuracyMeters < 0
  )
    throw new Error("A valid current office location is required.");
  if (
    !Number.isInteger(input.radiusMeters) ||
    input.radiusMeters < 25 ||
    input.radiusMeters > 10_000
  )
    throw new Error("Office radius must be between 25 and 10,000 metres.");
  if (reason.trim().length < 5) throw new Error("Explain why the office location is changing.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [policy] = await tx
      .select({ maximumAccuracy: attendancePolicies.maximumLocationAccuracyMeters })
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .limit(1);
    if (policy && input.accuracyMeters > policy.maximumAccuracy)
      throw new Error(
        `Office location accuracy must be ${policy.maximumAccuracy} metres or better.`,
      );
    const [existing] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.organisationId, organisationId), eq(locations.id, input.locationId)))
      .for("update")
      .limit(1);
    if (!existing || !existing.isActive) throw new Error("Select an active VIA office location.");
    const [updated] = await tx
      .update(locations)
      .set({
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        isClockInSite: true,
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${locations.recordVersion} + 1`,
      })
      .where(and(eq(locations.organisationId, organisationId), eq(locations.id, input.locationId)))
      .returning();
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "configure-office-geofence",
      module: "attendance",
      entityType: "location",
      entityId: input.locationId,
      beforeSummary: {
        latitude: existing.latitude,
        longitude: existing.longitude,
        radiusMeters: existing.radiusMeters,
        isClockInSite: existing.isClockInSite,
      },
      afterSummary: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        radiusMeters: input.radiusMeters,
        isClockInSite: true,
      },
      reason: reason.trim(),
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return updated!;
  });
}

export async function captureAttendancePunchInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    direction: "in" | "out";
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    locationId?: string;
    clientIp: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId || actor.employeeId !== input.employeeId)
    throw new Error("You can only record your own attendance.");
  if (
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.accuracyMeters < 0
  )
    throw new Error("A valid current location is required.");
  const db = getDatabaseClient();
  const at = new Date();
  const now = at.toISOString();
  return db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organisationId, organisationId), eq(employees.id, input.employeeId)))
      .limit(1);
    if (!employee) throw new Error("Employee not found.");
    const [policy] = await tx
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .limit(1);
    const [settings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    const date = zonedParts(at, settings?.timezone ?? "UTC").date;
    if (policy && input.accuracyMeters > policy.maximumLocationAccuracyMeters)
      throw new Error(
        `Location accuracy must be within ${policy.maximumLocationAccuracyMeters} metres.`,
      );
    const enforceNetwork = process.env["VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT"] === "true";
    const approvedNetwork = Boolean(
      policy?.approvedNetworkCidrs.some((cidr) => ipv4InCidr(input.clientIp, cidr)),
    );
    if (enforceNetwork && (!policy?.approvedNetworkCidrs.length || !approvedNetwork))
      throw new Error("Attendance must be recorded from an approved VIA office network.");
    const sites = await tx
      .select({
        id: locations.id,
        latitude: locations.latitude,
        longitude: locations.longitude,
        radiusMeters: locations.radiusMeters,
      })
      .from(locations)
      .where(
        and(
          eq(locations.organisationId, organisationId),
          eq(locations.isClockInSite, true),
          eq(locations.isActive, true),
        ),
      );
    const site = input.locationId
      ? sites.find((item) => item.id === input.locationId)
      : sites.find(
          (item) =>
            item.latitude !== null &&
            item.longitude !== null &&
            item.radiusMeters !== null &&
            distanceMeters(input.latitude, input.longitude, item.latitude, item.longitude) <=
              item.radiusMeters + input.accuracyMeters,
        );
    if (
      !site ||
      site.latitude === null ||
      site.longitude === null ||
      site.radiusMeters === null ||
      distanceMeters(input.latitude, input.longitude, site.latitude, site.longitude) >
        site.radiusMeters + input.accuracyMeters
    )
      throw new Error("Attendance can only be recorded inside a configured office location.");
    const [existing] = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          eq(attendanceRecords.employeeId, input.employeeId),
          eq(attendanceRecords.date, date),
        ),
      )
      .limit(1);
    const id = existing?.id ?? randomUUID();
    if (input.direction === "in") {
      if (existing?.clockInAt) throw new Error("You are already clocked in today.");
      if (existing)
        await tx
          .update(attendanceRecords)
          .set({
            clockInAt: now,
            locationId: site.id,
            capturedLatitude: input.latitude,
            capturedLongitude: input.longitude,
            capturedAccuracyMeters: input.accuracyMeters,
            status: "Present",
            updatedAt: new Date(),
            updatedBy: actor.userId,
          })
          .where(eq(attendanceRecords.id, id));
      else
        await tx.insert(attendanceRecords).values({
          id,
          organisationId,
          employeeId: input.employeeId,
          date,
          locationId: site.id,
          capturedLatitude: input.latitude,
          capturedLongitude: input.longitude,
          capturedAccuracyMeters: input.accuracyMeters,
          clockInAt: now,
          source: "Web",
          status: "Present",
          createdBy: actor.userId,
          updatedBy: actor.userId,
        } as typeof attendanceRecords.$inferInsert);
    } else {
      if (!existing?.clockInAt) throw new Error("Clock in before clocking out.");
      if (existing.clockOutAt) throw new Error("You are already clocked out today.");
      const hours = Math.max(
        0,
        (new Date(now).getTime() - new Date(existing.clockInAt).getTime()) / 3_600_000 -
          (existing.breakMinutes ?? 0) / 60,
      );
      await tx
        .update(attendanceRecords)
        .set({
          clockOutAt: now,
          clockOutLocationId: site.id,
          clockOutCapturedLatitude: input.latitude,
          clockOutCapturedLongitude: input.longitude,
          clockOutCapturedAccuracyMeters: input.accuracyMeters,
          calculatedHours: String(Math.min(24, hours)),
          updatedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(attendanceRecords.id, id));
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: `clock-${input.direction}`,
      module: "attendance",
      entityType: "attendance-record",
      entityId: id,
      afterSummary: {
        date,
        locationId: site.id,
        latitude: input.latitude,
        longitude: input.longitude,
      },
      reason: `Recorded office clock ${input.direction}`,
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
    await tx.insert(attendancePunchEvents).values({
      id: randomUUID(),
      organisationId,
      attendanceRecordId: id,
      employeeId: input.employeeId,
      direction: input.direction,
      occurredAt: now,
      locationId: site.id,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.accuracyMeters,
      clientIp: input.clientIp,
      networkVerified: enforceNetwork ? approvedNetwork : true,
      createdBy: actor.userId!,
    });
    return id;
  });
}

export async function requestAttendanceCorrectionInDatabase(
  organisationId: string,
  input: {
    attendanceRecordId: string;
    proposedClockIn?: string;
    proposedClockOut?: string;
    explanation: string;
    evidenceFileId?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  if (input.explanation.trim().length < 5) throw new Error("Explain the attendance correction.");
  const db = getDatabaseClient();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          eq(attendanceRecords.id, input.attendanceRecordId),
          eq(attendanceRecords.employeeId, actor.employeeId!),
        ),
      )
      .limit(1);
    if (!record) throw new Error("Attendance record not found.");
    if (!input.proposedClockIn && !input.proposedClockOut)
      throw new Error("Enter at least one corrected attendance time.");
    if (!record.clockOutAt && !input.proposedClockOut)
      throw new Error("Enter the missed clock-out time.");
    const [settings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    const timezone = settings?.timezone ?? "UTC";
    const localTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    const proposedClockIn = input.proposedClockIn
      ? localTimePattern.test(input.proposedClockIn)
        ? zonedDateTimeToUtc(record.date, input.proposedClockIn, timezone).toISOString()
        : input.proposedClockIn
      : undefined;
    let proposedClockOut = input.proposedClockOut
      ? localTimePattern.test(input.proposedClockOut)
        ? zonedDateTimeToUtc(record.date, input.proposedClockOut, timezone).toISOString()
        : input.proposedClockOut
      : undefined;
    if (proposedClockIn && proposedClockOut && proposedClockOut < proposedClockIn) {
      if (!localTimePattern.test(input.proposedClockOut ?? ""))
        throw new Error("Clock-out cannot be before clock-in.");
      const overnight = new Date(proposedClockOut);
      overnight.setUTCDate(overnight.getUTCDate() + 1);
      proposedClockOut = overnight.toISOString();
    }
    const followingDate = new Date(`${record.date}T12:00:00.000Z`);
    followingDate.setUTCDate(followingDate.getUTCDate() + 1);
    const allowedClockOutDates = [record.date, followingDate.toISOString().slice(0, 10)];
    for (const [kind, proposed] of [
      ["in", proposedClockIn],
      ["out", proposedClockOut],
    ].filter((item): item is [string, string] => Boolean(item[1]))) {
      const proposedAt = new Date(proposed);
      if (Number.isNaN(proposedAt.getTime()) || proposedAt.getTime() > Date.now())
        throw new Error("Corrected attendance times must be valid and cannot be in the future.");
      const proposedDate = zonedParts(proposedAt, timezone).date;
      if (
        (kind === "in" && proposedDate !== record.date) ||
        (kind === "out" && !allowedClockOutDates.includes(proposedDate))
      )
        throw new Error("Corrected times must fall on the attendance record date.");
    }
    if (input.evidenceFileId) {
      const [evidence] = await tx
        .select({ ownerEntityId: fileMetadata.ownerEntityId })
        .from(fileMetadata)
        .where(
          and(
            eq(fileMetadata.organisationId, organisationId),
            eq(fileMetadata.id, input.evidenceFileId),
          ),
        )
        .limit(1);
      if (!evidence || evidence.ownerEntityId !== actor.employeeId)
        throw new Error("The correction evidence does not belong to you.");
    }
    await tx.insert(attendanceCorrections).values({
      id,
      organisationId,
      attendanceRecordId: record.id,
      employeeId: actor.employeeId!,
      correctionType: record.clockOutAt ? "Punch Correction" : "Missed Sign-out",
      originalClockIn: record.clockInAt,
      originalClockOut: record.clockOutAt,
      originalStatus: record.status,
      proposedClockIn,
      proposedClockOut,
      explanation: input.explanation.trim(),
      evidenceFileId: input.evidenceFileId,
      status: "Pending Manager",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    } as typeof attendanceCorrections.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: "request-correction",
      module: "attendance",
      entityType: "attendance-correction",
      entityId: id,
      afterSummary: { attendanceRecordId: record.id },
      reason: input.explanation.trim(),
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function decideAttendanceCorrectionInDatabase(
  organisationId: string,
  correctionId: string,
  decision: "approve" | "reject",
  notes: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [correction] = await tx
      .select()
      .from(attendanceCorrections)
      .where(
        and(
          eq(attendanceCorrections.organisationId, organisationId),
          eq(attendanceCorrections.id, correctionId),
        ),
      )
      .limit(1);
    if (!correction) throw new Error("Attendance correction not found.");
    const [employee] = await tx
      .select({ lineManagerId: employees.lineManagerId })
      .from(employees)
      .where(eq(employees.id, correction.employeeId))
      .limit(1);
    const managerStage = correction.status === "Pending Manager";
    const hrStage = correction.status === "Pending HR";
    if (
      (managerStage &&
        (actor.activeRole !== "Line Manager" || actor.employeeId !== employee?.lineManagerId)) ||
      (hrStage && actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") ||
      (!managerStage && !hrStage)
    )
      throw new Error("You are not the assigned correction approver.");
    if (actor.employeeId === correction.employeeId)
      throw new Error("You cannot approve your own attendance correction.");
    if (decision === "reject" && !notes?.trim())
      throw new Error("Explain why the correction is rejected.");
    if (decision === "reject") {
      await tx
        .update(attendanceCorrections)
        .set({
          status: "Rejected",
          ...(managerStage
            ? {
                managerNotes: notes?.trim(),
                managerReviewedBy: actor.userId,
                managerReviewedAt: new Date().toISOString(),
              }
            : {
                hrNotes: notes?.trim(),
                hrReviewedBy: actor.userId,
                hrReviewedAt: new Date().toISOString(),
              }),
          updatedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(attendanceCorrections.id, correctionId));
    } else if (managerStage) {
      await tx
        .update(attendanceCorrections)
        .set({
          status: "Pending HR",
          managerNotes: notes?.trim(),
          managerReviewedBy: actor.userId,
          managerReviewedAt: new Date().toISOString(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(attendanceCorrections.id, correctionId));
    } else {
      const [record] = await tx
        .select()
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.organisationId, organisationId),
            eq(attendanceRecords.id, correction.attendanceRecordId),
          ),
        )
        .for("update")
        .limit(1);
      if (!record)
        throw new Error("The attendance record linked to this correction was not found.");
      const clockInAt = correction.proposedClockIn ?? correction.originalClockIn;
      const clockOutAt = correction.proposedClockOut ?? correction.originalClockOut;
      const [[settings], [policy]] = await Promise.all([
        tx
          .select({ timezone: appSettings.timezone })
          .from(appSettings)
          .where(eq(appSettings.organisationId, organisationId))
          .limit(1),
        tx
          .select({
            expectedClockIn: attendancePolicies.expectedClockIn,
            expectedClockOut: attendancePolicies.expectedClockOut,
            lateGraceMinutes: attendancePolicies.lateGraceMinutes,
          })
          .from(attendancePolicies)
          .where(eq(attendancePolicies.organisationId, organisationId))
          .limit(1),
      ]);
      const hours =
        clockInAt && clockOutAt
          ? Math.max(
              0,
              Math.min(
                24,
                (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 3_600_000 -
                  record.breakMinutes / 60,
              ),
            )
          : 0;
      const timezone = settings?.timezone ?? "UTC";
      const localClockIn = clockInAt ? zonedParts(new Date(clockInAt), timezone).time : null;
      const localClockOut = clockOutAt ? zonedParts(new Date(clockOutAt), timezone).time : null;
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      const expectedClockIn = record.expectedClockIn ?? policy?.expectedClockIn ?? "09:00";
      const expectedClockOut = record.expectedClockOut ?? policy?.expectedClockOut ?? "18:00";
      const isLate = Boolean(
        localClockIn &&
        minutes(localClockIn) > minutes(expectedClockIn) + (policy?.lateGraceMinutes ?? 0),
      );
      const isEarlyDeparture = Boolean(
        localClockOut && minutes(localClockOut) < minutes(expectedClockOut),
      );
      await tx
        .update(attendanceRecords)
        .set({
          clockInAt,
          clockOutAt,
          calculatedHours: String(hours),
          isLate,
          isEarlyDeparture,
          status: "Corrected",
          updatedAt: new Date(),
          updatedBy: actor.userId,
          recordVersion: sql`${attendanceRecords.recordVersion} + 1`,
        })
        .where(eq(attendanceRecords.id, correction.attendanceRecordId));
      await tx
        .update(attendanceCorrections)
        .set({
          status: "Approved",
          hrNotes: notes?.trim(),
          hrReviewedBy: actor.userId,
          hrReviewedAt: new Date().toISOString(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
        })
        .where(eq(attendanceCorrections.id, correctionId));
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole ?? null,
      actorRoles: actor.roles ?? [],
      action: decision,
      module: "attendance",
      entityType: "attendance-correction",
      entityId: correctionId,
      afterSummary: { stage: correction.status, decision },
      reason: notes?.trim() ?? "Attendance correction decision",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    const [employeeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.organisationId, organisationId), eq(users.employeeId, correction.employeeId)),
      )
      .limit(1);
    if (employeeUser)
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: employeeUser.id,
          type: "attendance.correction",
          title:
            decision === "reject"
              ? "Attendance correction declined"
              : managerStage
                ? "Attendance correction sent to HR"
                : "Attendance correction approved",
          message:
            notes?.trim() ||
            (managerStage
              ? "Your supervisor approved the request. HR will complete the review."
              : `Your attendance correction was ${decision === "approve" ? "approved" : "declined"}.`),
          priority: decision === "reject" ? "High" : "Normal",
          deduplicationKey: `attendance-correction-${correctionId}-${correction.status}-${decision}`,
          link: {
            entityType: "attendance-correction",
            entityId: correctionId,
            path: "/staff/me/attendance",
          },
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
  });
}

export async function readAttendanceCorrectionEvidenceInDatabase(
  organisationId: string,
  correctionId: string,
  actor: AuditActorContext,
  reason: string,
) {
  const db = getDatabaseClient();
  const [row] = await db
    .select({
      evidenceFileId: attendanceCorrections.evidenceFileId,
      employeeId: attendanceCorrections.employeeId,
      lineManagerId: employees.lineManagerId,
    })
    .from(attendanceCorrections)
    .innerJoin(employees, eq(employees.id, attendanceCorrections.employeeId))
    .where(
      and(
        eq(attendanceCorrections.organisationId, organisationId),
        eq(attendanceCorrections.id, correctionId),
      ),
    )
    .limit(1);
  if (!row?.evidenceFileId) throw new Error("No evidence is attached to this correction.");
  const permitted =
    actor.employeeId === row.employeeId ||
    actor.employeeId === row.lineManagerId ||
    actor.activeRole === "HR" ||
    actor.activeRole === "Super Admin";
  if (!permitted) throw new Error("You do not have permission to open this attendance evidence.");
  return readObjectFile(organisationId, row.evidenceFileId, actor, reason);
}

export async function deleteUnattachedAttendanceEvidenceInDatabase(
  organisationId: string,
  fileId: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  const [settings] = await db
    .select({ timezone: appSettings.timezone })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  const timezone = settings?.timezone ?? "UTC";
  const [file] = await db
    .select({ ownerEntityId: fileMetadata.ownerEntityId })
    .from(fileMetadata)
    .where(and(eq(fileMetadata.organisationId, organisationId), eq(fileMetadata.id, fileId)))
    .limit(1);
  if (!file || file.ownerEntityId !== actor.employeeId)
    throw new Error("The evidence file does not belong to you.");
  const [attached] = await db
    .select({ id: attendanceCorrections.id })
    .from(attendanceCorrections)
    .where(
      and(
        eq(attendanceCorrections.organisationId, organisationId),
        eq(attendanceCorrections.evidenceFileId, fileId),
      ),
    )
    .limit(1);
  if (attached) throw new Error("Evidence attached to a correction cannot be removed here.");
  await deleteObjectFile(
    organisationId,
    fileId,
    actor,
    "Attendance correction submission did not complete",
  );
}

export async function requestSiteVisitInDatabase(
  organisationId: string,
  input: {
    employeeId: string;
    date: string;
    startTime: string;
    endTime: string;
    origin: "Office" | "Home";
    destination: string;
    purpose: string;
    projectId?: string;
  },
  actor: AuditActorContext,
): Promise<string> {
  if (!actor.employeeId || actor.employeeId !== input.employeeId)
    throw new Error("You can only request your own site visit.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < new Date().toISOString().slice(0, 10))
    throw new Error("Site visits cannot be requested for a past date.");
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime) ||
    input.startTime >= input.endTime
  )
    throw new Error("Enter a valid site-visit start and end time.");
  if (input.destination.trim().length < 3 || input.purpose.trim().length < 5)
    throw new Error("Enter the visit destination and business purpose.");
  const db = getDatabaseClient();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.organisationId, organisationId),
          eq(employees.id, input.employeeId),
          inArray(employees.status, ["Active", "Probation", "Notice"]),
        ),
      )
      .limit(1);
    if (!employee) throw new Error("The employee is not active.");
    const [overlap] = await tx
      .select({ id: siteVisitRequests.id })
      .from(siteVisitRequests)
      .where(
        and(
          eq(siteVisitRequests.organisationId, organisationId),
          eq(siteVisitRequests.employeeId, input.employeeId),
          eq(siteVisitRequests.date, input.date),
          inArray(siteVisitRequests.status, ["Pending HR", "Approved"]),
          sql`${siteVisitRequests.startTime} < ${input.endTime} AND ${siteVisitRequests.endTime} > ${input.startTime}`,
        ),
      )
      .limit(1);
    if (overlap) throw new Error("This site visit overlaps another pending or approved visit.");
    await tx.insert(siteVisitRequests).values({
      id,
      organisationId,
      employeeId: input.employeeId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      origin: input.origin,
      destination: input.destination.trim(),
      purpose: input.purpose.trim(),
      projectId: input.projectId,
      status: "Pending HR",
      requestedAt: new Date().toISOString(),
      createdBy: actor.userId!,
      updatedBy: actor.userId!,
    } as typeof siteVisitRequests.$inferInsert);
    const hrUsers = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organisationId, organisationId),
          eq(users.status, "Active"),
          sql`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${users.id} AND r.code IN ('HR','Super Admin'))`,
        ),
      );
    for (const hr of hrUsers)
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: hr.id,
          type: "attendance.site_visit",
          title: "Site visit awaiting review",
          message: `${actor.displayName} requested a ${input.origin.toLowerCase()}-origin site visit to ${input.destination.trim()}.`,
          priority: "Normal",
          deduplicationKey: `site-visit-review-${id}`,
          link: { entityType: "site-visit", entityId: id, path: "/staff/attendance" },
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "submit",
      module: "attendance",
      entityType: "site-visit",
      entityId: id,
      afterSummary: {
        date: input.date,
        origin: input.origin,
        destination: input.destination.trim(),
      },
      reason: input.purpose.trim(),
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
  return id;
}

export async function decideSiteVisitInDatabase(
  organisationId: string,
  visitId: string,
  decision: "approve" | "reject",
  notes: string | undefined,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can review site visits.");
  if (decision === "reject" && !notes?.trim())
    throw new Error("Explain why the site visit is rejected.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [visit] = await tx
      .select()
      .from(siteVisitRequests)
      .where(
        and(
          eq(siteVisitRequests.organisationId, organisationId),
          eq(siteVisitRequests.id, visitId),
        ),
      )
      .for("update")
      .limit(1);
    if (!visit || visit.status !== "Pending HR")
      throw new Error("This site visit is no longer awaiting review.");
    if (visit.employeeId === actor.employeeId)
      throw new Error("You cannot approve your own site visit.");
    await tx
      .update(siteVisitRequests)
      .set({
        status: decision === "approve" ? "Approved" : "Rejected",
        hrReviewedBy: actor.userId,
        hrReviewedAt: new Date().toISOString(),
        hrNotes: notes?.trim(),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${siteVisitRequests.recordVersion} + 1`,
      })
      .where(and(eq(siteVisitRequests.id, visitId), eq(siteVisitRequests.status, "Pending HR")));
    const [employeeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organisationId, organisationId), eq(users.employeeId, visit.employeeId)))
      .limit(1);
    if (employeeUser)
      await tx
        .insert(notifications)
        .values({
          organisationId,
          recipientUserId: employeeUser.id,
          type: "attendance.site_visit",
          title: `Site visit ${decision === "approve" ? "approved" : "declined"}`,
          message:
            notes?.trim() ||
            `Your site visit to ${visit.destination} was ${decision === "approve" ? "approved" : "declined"}.`,
          priority: decision === "reject" ? "High" : "Normal",
          deduplicationKey: `site-visit-${visitId}-${decision}`,
          link: { entityType: "site-visit", entityId: visitId, path: "/staff/me/attendance" },
          createdBy: actor.userId!,
          updatedBy: actor.userId!,
        } as typeof notifications.$inferInsert)
        .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: decision,
      module: "attendance",
      entityType: "site-visit",
      entityId: visitId,
      beforeSummary: { status: visit.status },
      afterSummary: { status: decision === "approve" ? "Approved" : "Rejected" },
      reason: notes?.trim() ?? "Site visit approved",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function cancelSiteVisitInDatabase(
  organisationId: string,
  visitId: string,
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  if (reason.trim().length < 5) throw new Error("Explain why the site visit is cancelled.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [visit] = await tx
      .select()
      .from(siteVisitRequests)
      .where(
        and(
          eq(siteVisitRequests.organisationId, organisationId),
          eq(siteVisitRequests.id, visitId),
          eq(siteVisitRequests.employeeId, actor.employeeId!),
        ),
      )
      .for("update")
      .limit(1);
    if (!visit) throw new Error("Site visit request was not found.");
    if (visit.status !== "Pending HR" && visit.status !== "Approved")
      throw new Error("This site visit can no longer be cancelled.");
    const [settings] = await tx
      .select({ timezone: appSettings.timezone })
      .from(appSettings)
      .where(eq(appSettings.organisationId, organisationId))
      .limit(1);
    if (zonedDateTimeToUtc(visit.date, visit.startTime, settings?.timezone ?? "UTC") <= new Date())
      throw new Error("A site visit cannot be cancelled after it starts. Contact HR.");
    await tx
      .update(siteVisitRequests)
      .set({
        status: "Cancelled",
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${siteVisitRequests.recordVersion} + 1`,
      })
      .where(eq(siteVisitRequests.id, visitId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "cancel",
      module: "attendance",
      entityType: "site-visit",
      entityId: visitId,
      beforeSummary: { status: visit.status },
      afterSummary: { status: "Cancelled" },
      reason: reason.trim(),
      riskLevel: "Medium",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function saveAttendancePolicyInDatabase(
  organisationId: string,
  input: {
    standardDailyHours: number;
    expectedClockIn: string;
    expectedClockOut: string;
    defaultBreakMinutes: number;
    lateGraceMinutes: number;
    maximumLocationAccuracyMeters: number;
    signOutReminderOffsetsMinutes: number[];
    approvedNetworkCidrs: string[];
  },
  reason: string,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can change attendance policy.");
  if (reason.trim().length < 5) throw new Error("Explain why the attendance policy is changing.");
  if (
    input.standardDailyHours <= 0 ||
    input.standardDailyHours > 24 ||
    input.defaultBreakMinutes < 0 ||
    input.defaultBreakMinutes > 1439 ||
    input.lateGraceMinutes < 0 ||
    input.maximumLocationAccuracyMeters < 1
  )
    throw new Error("Attendance policy values are outside the permitted range.");
  const reminders = [...new Set(input.signOutReminderOffsetsMinutes)].sort((a, b) => a - b);
  if (reminders.length !== 3 || reminders.some((offset) => !Number.isInteger(offset) || offset < 0))
    throw new Error("Configure exactly three non-negative sign-out reminders.");
  const cidrs = [
    ...new Set(input.approvedNetworkCidrs.map((value) => value.trim()).filter(Boolean)),
  ];
  if (!cidrs.length || cidrs.some((value) => !validIpv4Cidr(value)))
    throw new Error("Configure at least one valid approved office IPv4 network.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .for("update")
      .limit(1);
    const values = {
      standardDailyHours: String(input.standardDailyHours),
      expectedClockIn: input.expectedClockIn,
      expectedClockOut: input.expectedClockOut,
      defaultBreakMinutes: input.defaultBreakMinutes,
      lateGraceMinutes: input.lateGraceMinutes,
      maximumLocationAccuracyMeters: input.maximumLocationAccuracyMeters,
      signOutReminderOffsetsMinutes: reminders,
      antiSpoofingMode: "Approved Network",
      approvedNetworkCidrs: cidrs,
      updatedAt: new Date(),
      updatedBy: actor.userId!,
      recordVersion: before ? sql`${attendancePolicies.recordVersion} + 1` : 1,
    } as const;
    if (before)
      await tx.update(attendancePolicies).set(values).where(eq(attendancePolicies.id, before.id));
    else
      await tx.insert(attendancePolicies).values({
        organisationId,
        ...values,
        createdBy: actor.userId!,
      } as typeof attendancePolicies.$inferInsert);
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: before ? "update" : "create",
      module: "attendance",
      entityType: "attendance-policy",
      entityId: before?.id ?? organisationId,
      beforeSummary: before
        ? {
            ...before,
            approvedNetworkCidrs: before.approvedNetworkCidrs.length ? ["Configured"] : [],
          }
        : undefined,
      afterSummary: { ...input, approvedNetworkCidrs: ["Configured"] },
      reason: reason.trim(),
      riskLevel: "Critical",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function listAttendanceForActor(organisationId: string, actor: AuditActorContext) {
  if (!actor.employeeId) throw new Error("A verified employee is required.");
  const db = getDatabaseClient();
  const [attendanceSettings] = await db
    .select({ timezone: appSettings.timezone })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  const timezone = attendanceSettings?.timezone ?? "UTC";
  let employeeIds = [actor.employeeId];
  if (actor.activeRole === "HR" || actor.activeRole === "Super Admin") {
    employeeIds = (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.organisationId, organisationId))
    ).map((row) => row.id);
  } else if (actor.activeRole === "Line Manager") {
    employeeIds = (
      await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            or(eq(employees.id, actor.employeeId), eq(employees.lineManagerId, actor.employeeId)),
          ),
        )
    ).map((row) => row.id);
  } else if (actor.activeRole !== "Employee") throw new Error("You do not have attendance access.");
  if (!employeeIds.length)
    return {
      timezone,
      employeeIds: [],
      records: [],
      corrections: [],
      siteVisits: [],
      exceptions: [],
      policy: null,
    };
  const [records, corrections, visits, exceptions, policy] = await Promise.all([
    db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.organisationId, organisationId),
          inArray(attendanceRecords.employeeId, employeeIds),
        ),
      )
      .orderBy(desc(attendanceRecords.date)),
    db
      .select()
      .from(attendanceCorrections)
      .where(
        and(
          eq(attendanceCorrections.organisationId, organisationId),
          inArray(attendanceCorrections.employeeId, employeeIds),
        ),
      )
      .orderBy(desc(attendanceCorrections.createdAt)),
    db
      .select()
      .from(siteVisitRequests)
      .where(
        and(
          eq(siteVisitRequests.organisationId, organisationId),
          inArray(siteVisitRequests.employeeId, employeeIds),
        ),
      )
      .orderBy(desc(siteVisitRequests.date)),
    db
      .select()
      .from(attendanceExceptionCases)
      .where(
        and(
          eq(attendanceExceptionCases.organisationId, organisationId),
          inArray(attendanceExceptionCases.employeeId, employeeIds),
        ),
      )
      .orderBy(desc(attendanceExceptionCases.date)),
    db
      .select()
      .from(attendancePolicies)
      .where(eq(attendancePolicies.organisationId, organisationId))
      .limit(1),
  ]);
  return {
    timezone,
    employeeIds,
    records,
    corrections,
    siteVisits: visits,
    exceptions,
    policy: policy[0] ?? null,
  };
}

export async function resolveAttendanceExceptionInDatabase(
  organisationId: string,
  exceptionId: string,
  resolution: string,
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can resolve attendance exceptions.");
  if (resolution.trim().length < 5) throw new Error("Record the exception resolution.");
  const db = getDatabaseClient();
  const [updated] = await db
    .update(attendanceExceptionCases)
    .set({
      status: "Resolved",
      resolutionNotes: resolution.trim(),
      resolvedBy: actor.userId,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(
      and(
        eq(attendanceExceptionCases.organisationId, organisationId),
        eq(attendanceExceptionCases.id, exceptionId),
        sql`${attendanceExceptionCases.status} <> 'Resolved'`,
      ),
    )
    .returning({ id: attendanceExceptionCases.id });
  if (!updated) throw new Error("The exception was not found or is already resolved.");
  await db.insert(auditEvents).values({
    organisationId,
    actorUserId: actor.userId,
    actorEmployeeId: actor.employeeId,
    actorDisplayName: actor.displayName,
    activeRole: actor.activeRole,
    actorRoles: actor.roles ?? [],
    action: "resolve",
    module: "attendance",
    entityType: "attendance-exception",
    entityId: exceptionId,
    afterSummary: { status: "Resolved" },
    reason: resolution.trim(),
    riskLevel: "High",
  } as typeof auditEvents.$inferInsert);
}

export async function updateAttendanceExceptionInvestigationInDatabase(
  organisationId: string,
  exceptionId: string,
  input: { assignToActor?: boolean; investigationNotes?: string },
  actor: AuditActorContext,
): Promise<void> {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin")
    throw new Error("Only HR or a Super Admin can investigate attendance exceptions.");
  if (!input.assignToActor && !input.investigationNotes?.trim())
    throw new Error("Assign the case or enter investigation notes.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(attendanceExceptionCases)
      .where(
        and(
          eq(attendanceExceptionCases.organisationId, organisationId),
          eq(attendanceExceptionCases.id, exceptionId),
        ),
      )
      .for("update")
      .limit(1);
    if (!before || before.status === "Resolved")
      throw new Error("The exception was not found or is already resolved.");
    await tx
      .update(attendanceExceptionCases)
      .set({
        status: "Investigating",
        ...(input.assignToActor ? { ownerId: actor.userId } : {}),
        ...(input.investigationNotes?.trim()
          ? { investigationNotes: input.investigationNotes.trim() }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.userId,
        recordVersion: sql`${attendanceExceptionCases.recordVersion} + 1`,
      })
      .where(eq(attendanceExceptionCases.id, exceptionId));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: input.assignToActor ? "assign" : "update-investigation",
      module: "attendance",
      entityType: "attendance-exception",
      entityId: exceptionId,
      beforeSummary: { status: before.status, ownerId: before.ownerId },
      afterSummary: {
        status: "Investigating",
        assignedToActor: Boolean(input.assignToActor),
        notesUpdated: Boolean(input.investigationNotes?.trim()),
      },
      reason: input.investigationNotes?.trim() ?? "Attendance exception assigned for investigation",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
  });
}

export async function processAttendanceScheduledWork(
  at = new Date(),
): Promise<{ reminders: number; siteVisits: number; exceptions: number; reconciled: number }> {
  const db = getDatabaseClient();
  const now = at.toISOString();
  let reminders = 0;
  let siteVisits = 0;
  let exceptions = 0;
  const reconciled = 0;
  const organisations = await db
    .selectDistinct({ organisationId: attendancePolicies.organisationId })
    .from(attendancePolicies);
  for (const organisation of organisations)
    await db.transaction(async (tx) => {
      const [policy] = await tx
        .select()
        .from(attendancePolicies)
        .where(eq(attendancePolicies.organisationId, organisation.organisationId))
        .limit(1);
      if (!policy) return;
      const [settings] = await tx
        .select({ timezone: appSettings.timezone })
        .from(appSettings)
        .where(eq(appSettings.organisationId, organisation.organisationId))
        .limit(1);
      const timezone = settings?.timezone ?? "UTC";
      const date = zonedParts(at, timezone).date;
      const openRecords = await tx
        .select({ record: attendanceRecords, userId: users.id })
        .from(attendanceRecords)
        .innerJoin(users, eq(users.employeeId, attendanceRecords.employeeId))
        .where(
          and(
            eq(attendanceRecords.organisationId, organisation.organisationId),
            eq(attendanceRecords.date, date),
            sql`${attendanceRecords.clockInAt} IS NOT NULL AND ${attendanceRecords.clockOutAt} IS NULL`,
          ),
        );
      for (const row of openRecords)
        for (const [index, offset] of policy.signOutReminderOffsetsMinutes.entries()) {
          const due =
            new Date(row.record.clockInAt!).getTime() +
            (Number(policy.standardDailyHours) * 60 + offset) * 60_000;
          if (at.getTime() < due) continue;
          const key = `attendance-signout-${row.record.id}-${index + 1}`;
          const created = await tx
            .insert(notifications)
            .values({
              organisationId: organisation.organisationId,
              recipientUserId: row.userId,
              type: "attendance.sign_out",
              title: "Remember to clock out",
              message:
                index === 0
                  ? "You have completed your standard working hours."
                  : `Reminder ${index + 1} of 3: please clock out before leaving.`,
              priority: index === 2 ? "High" : "Normal",
              deduplicationKey: key,
              link: {
                entityType: "attendance-record",
                entityId: row.record.id,
                path: "/staff/me/attendance",
              },
              createdBy: row.userId,
              updatedBy: row.userId,
            } as typeof notifications.$inferInsert)
            .onConflictDoNothing()
            .returning({ id: notifications.id });
          reminders += created.length;
        }
      const visits = await tx
        .select()
        .from(siteVisitRequests)
        .where(
          and(
            eq(siteVisitRequests.organisationId, organisation.organisationId),
            eq(siteVisitRequests.status, "Approved"),
            eq(siteVisitRequests.date, date),
          ),
        );
      for (const visit of visits) {
        const start = zonedDateTimeToUtc(visit.date, visit.startTime, timezone);
        const end = zonedDateTimeToUtc(visit.date, visit.endTime, timezone);
        let [record] = await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.employeeId, visit.employeeId),
              eq(attendanceRecords.date, visit.date),
            ),
          )
          .limit(1);
        if (visit.origin === "Home" && at >= start && !record) {
          const id = randomUUID();
          const hours = at >= end ? Math.max(0, (end.getTime() - start.getTime()) / 3_600_000) : 0;
          await tx.insert(attendanceRecords).values({
            id,
            organisationId: organisation.organisationId,
            employeeId: visit.employeeId,
            date: visit.date,
            clockInAt: start.toISOString(),
            clockOutAt: at >= end ? end.toISOString() : null,
            source: "Site Visit Auto",
            workMode: "Approved Site Visit",
            siteVisitId: visit.id,
            status: "Present",
            calculatedHours: String(hours),
            createdBy: visit.createdBy,
            updatedBy: visit.updatedBy,
          } as typeof attendanceRecords.$inferInsert);
          record = (
            await tx.select().from(attendanceRecords).where(eq(attendanceRecords.id, id)).limit(1)
          )[0];
          siteVisits += 1;
          await tx.insert(auditEvents).values({
            organisationId: organisation.organisationId,
            actorDisplayName: "VIA background worker",
            activeRole: "Super Admin",
            actorRoles: ["Super Admin"],
            action: "auto-create",
            module: "attendance",
            entityType: "attendance-record",
            entityId: id,
            afterSummary: { siteVisitId: visit.id, source: "Site Visit Auto" },
            reason: "Approved home-origin site visit schedule",
            riskLevel: "Medium",
          } as typeof auditEvents.$inferInsert);
        }
        if (record && at >= end && !record.clockOutAt) {
          const hours = Math.max(
            0,
            Math.min(
              24,
              (end.getTime() - new Date(record.clockInAt ?? start).getTime()) / 3_600_000,
            ),
          );
          await tx
            .update(attendanceRecords)
            .set({
              clockOutAt: end.toISOString(),
              calculatedHours: String(hours),
              updatedAt: new Date(),
              updatedBy: visit.updatedBy,
            })
            .where(eq(attendanceRecords.id, record.id));
          siteVisits += 1;
        }
        if (visit.origin === "Office" && at >= end && !record) {
          const id = randomUUID();
          const created = await tx
            .insert(attendanceExceptionCases)
            .values({
              id,
              organisationId: organisation.organisationId,
              employeeId: visit.employeeId,
              type: "Site Visit No Clock-In",
              siteVisitId: visit.id,
              date: visit.date,
              destination: visit.destination,
              status: "Open",
              createdBy: visit.createdBy,
              updatedBy: visit.updatedBy,
            } as typeof attendanceExceptionCases.$inferInsert)
            .onConflictDoNothing()
            .returning({ id: attendanceExceptionCases.id });
          exceptions += created.length;
          if (created.length)
            await tx.insert(auditEvents).values({
              organisationId: organisation.organisationId,
              actorDisplayName: "VIA background worker",
              activeRole: "Super Admin",
              actorRoles: ["Super Admin"],
              action: "open-exception",
              module: "attendance",
              entityType: "attendance-exception",
              entityId: id,
              afterSummary: { siteVisitId: visit.id, status: "Open" },
              reason: "Office-origin site visit ended without an office clock-in",
              riskLevel: "High",
            } as typeof auditEvents.$inferInsert);
        }
        if (at >= end)
          await tx
            .update(siteVisitRequests)
            .set({
              status: "Completed",
              ...(record ? { attendanceRecordId: record.id } : {}),
              updatedAt: new Date(),
              updatedBy: visit.updatedBy,
            })
            .where(eq(siteVisitRequests.id, visit.id));
      }
    });
  return { reminders, siteVisits, exceptions, reconciled };
}
