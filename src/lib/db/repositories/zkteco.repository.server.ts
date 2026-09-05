import "@tanstack/react-start/server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

import { getDatabaseClient, type ViaHrDatabase } from "../client.ts";
import { decryptSensitiveJson, encryptSensitiveJson } from "../encryption.server.ts";
import { employees, roles, userRoles, users } from "../schema/employee.ts";
import { locations } from "../schema/master-data.ts";
import { appSettings } from "../schema/organisation.ts";
import { auditEvents, notifications } from "../schema/system.ts";
import {
  attendanceDeviceEmployeeMappings,
  attendanceDevicePunches,
  attendanceDevices,
  attendancePolicies,
  attendancePunchEvents,
  attendanceRecords,
} from "../schema/time.ts";
import type { AuditActorContext } from "./master-data.repository.server.ts";

type Transaction = Parameters<Parameters<ViaHrDatabase["transaction"]>[0]>[0];

export interface ZktecoPunchInput {
  externalEventId: string;
  deviceUserId: string;
  deviceUserName?: string | undefined;
  occurredAt: string;
  status?: number | null | undefined;
  punchMethod?: number | null | undefined;
}

export interface ZktecoBatchInput {
  serialNumber?: string | undefined;
  model?: string | undefined;
  punches: ZktecoPunchInput[];
}

export interface ZktecoBatchResult {
  accepted: number;
  duplicates: number;
  unmatched: number;
  rejected: number;
}

export interface AttendanceConnectorPairingResult {
  deviceCode: string;
  deviceName: string;
  ingestUrl: string;
  credential: string;
}

function normalizePairingCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function pairingCodeHash(value: string): string {
  return createHash("sha256").update(normalizePairingCode(value), "utf8").digest("hex");
}

function formatPairingCode(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function requireAttendanceAdministrator(actor: AuditActorContext): void {
  if (actor.activeRole !== "HR" && actor.activeRole !== "Super Admin") {
    throw new Error("Only HR or a Super Admin can manage attendance devices.");
  }
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

function deduplicatePunchTimes(events: Date[], windowMs: number): Date[] {
  const effective: Date[] = [];
  for (const event of events) {
    const previous = effective[effective.length - 1];
    if (!previous || event.getTime() - previous.getTime() > windowMs) effective.push(event);
  }
  return effective;
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

async function organisationTimeZone(tx: Transaction, organisationId: string): Promise<string> {
  const [settings] = await tx
    .select({ timezone: appSettings.timezone })
    .from(appSettings)
    .where(eq(appSettings.organisationId, organisationId))
    .limit(1);
  return settings?.timezone ?? "UTC";
}

async function findMappedEmployee(
  tx: Transaction,
  organisationId: string,
  deviceId: string,
  deviceUserId: string,
): Promise<string | undefined> {
  const [mapping] = await tx
    .select({ employeeId: attendanceDeviceEmployeeMappings.employeeId })
    .from(attendanceDeviceEmployeeMappings)
    .innerJoin(employees, eq(employees.id, attendanceDeviceEmployeeMappings.employeeId))
    .where(
      and(
        eq(attendanceDeviceEmployeeMappings.organisationId, organisationId),
        eq(attendanceDeviceEmployeeMappings.deviceId, deviceId),
        eq(attendanceDeviceEmployeeMappings.deviceUserId, deviceUserId),
        sql`${attendanceDeviceEmployeeMappings.archivedAt} IS NULL`,
        sql`${employees.status} NOT IN ('Inactive', 'Archived')`,
      ),
    )
    .limit(1);
  if (mapping) return mapping.employeeId;

  // An exact VIA email or employee-number match is safe to establish automatically.
  // Fuzzy name matching is deliberately forbidden for attendance identity.
  const normalized = deviceUserId.trim().toLowerCase();
  const matches = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.organisationId, organisationId),
        sql`${employees.status} NOT IN ('Inactive', 'Archived')`,
        or(
          sql`lower(${employees.employeeNumber}) = ${normalized}`,
          sql`lower(${employees.workEmail}) = ${normalized}`,
          sql`lower(coalesce(${employees.workspaceEmail}, '')) = ${normalized}`,
        ),
      ),
    )
    .limit(2);
  if (matches.length !== 1) return undefined;
  const [inserted] = await tx
    .insert(attendanceDeviceEmployeeMappings)
    .values({
      organisationId,
      deviceId,
      deviceUserId: deviceUserId.trim(),
      employeeId: matches[0]!.id,
      createdBy: deviceId,
      updatedBy: deviceId,
    })
    .onConflictDoNothing()
    .returning({ id: attendanceDeviceEmployeeMappings.id });
  if (!inserted) {
    const [concurrentMapping] = await tx
      .select({ employeeId: attendanceDeviceEmployeeMappings.employeeId })
      .from(attendanceDeviceEmployeeMappings)
      .where(
        and(
          eq(attendanceDeviceEmployeeMappings.deviceId, deviceId),
          eq(attendanceDeviceEmployeeMappings.deviceUserId, deviceUserId.trim()),
        ),
      )
      .limit(1);
    return concurrentMapping?.employeeId;
  }
  await tx.insert(auditEvents).values({
    organisationId,
    actorDisplayName: "ZKTeco attendance bridge",
    activeRole: "System",
    actorRoles: [],
    action: "auto-map-device-user",
    module: "attendance",
    entityType: "attendance-device-mapping",
    entityId: deviceId,
    afterSummary: { deviceId, deviceUserId, employeeId: matches[0]!.id },
    reason: "Exact VIA email or employee number matched the terminal identity.",
    riskLevel: "Medium",
  } as typeof auditEvents.$inferInsert);
  return matches[0]!.id;
}

async function projectDailyAttendance(
  tx: Transaction,
  input: {
    organisationId: string;
    deviceId: string;
    deviceUserId: string;
    externalEventId: string;
    occurredAt: string;
    status?: number | null | undefined;
    punchMethod?: number | null | undefined;
    employeeId: string;
    locationId: string;
    locationName: string;
    rawPunchId: string;
  },
): Promise<string> {
  const timezone = await organisationTimeZone(tx, input.organisationId);
  const eventDate = new Date(input.occurredAt);
  const date = zonedParts(eventDate, timezone).date;
  const start = zonedDateTimeToUtc(date, "00:00", timezone);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organisationId}:${input.employeeId}:${date}`}, 0))`,
  );
  const [policy] = await tx
    .select()
    .from(attendancePolicies)
    .where(eq(attendancePolicies.organisationId, input.organisationId))
    .limit(1);
  const priorEvents = await tx
    .select({ occurredAt: attendancePunchEvents.occurredAt })
    .from(attendancePunchEvents)
    .where(
      and(
        eq(attendancePunchEvents.organisationId, input.organisationId),
        eq(attendancePunchEvents.employeeId, input.employeeId),
        gte(attendancePunchEvents.occurredAt, start.toISOString()),
        lt(attendancePunchEvents.occurredAt, end.toISOString()),
      ),
    )
    .orderBy(asc(attendancePunchEvents.occurredAt));
  const deduplicationMs = (policy?.punchDeduplicationMinutes ?? 2) * 60_000;
  const eventDateMarker = eventDate;
  const allEvents = [...priorEvents.map((item) => new Date(item.occurredAt)), eventDateMarker].sort(
    (a, b) => a.getTime() - b.getTime(),
  );
  const effectiveEvents = deduplicatePunchTimes(allEvents, deduplicationMs);
  const effectiveIndex = effectiveEvents.indexOf(eventDateMarker);
  const direction =
    effectiveIndex >= 0
      ? effectiveIndex % 2 === 0
        ? "in"
        : "out"
      : effectiveEvents.filter((item) => item.getTime() <= eventDate.getTime()).length % 2 === 1
        ? "in"
        : "out";

  const [existing] = await tx
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.organisationId, input.organisationId),
        eq(attendanceRecords.employeeId, input.employeeId),
        eq(attendanceRecords.date, date),
      ),
    )
    .for("update")
    .limit(1);
  const recordId = existing?.id ?? randomUUID();
  if (!existing) {
    await tx.insert(attendanceRecords).values({
      id: recordId,
      organisationId: input.organisationId,
      employeeId: input.employeeId,
      date,
      expectedClockIn: policy?.expectedClockIn ?? "09:00",
      expectedClockOut: policy?.expectedClockOut ?? "18:00",
      clockInAt: input.occurredAt,
      breakMinutes: policy?.defaultBreakMinutes ?? 0,
      location: input.locationName,
      locationId: input.locationId,
      source: "Hardware Terminal",
      workMode: "Office",
      status: "Present",
      calculatedHours: "0",
      createdBy: input.deviceId,
      updatedBy: input.deviceId,
    } as typeof attendanceRecords.$inferInsert);
  }
  const [event] = await tx
    .insert(attendancePunchEvents)
    .values({
      organisationId: input.organisationId,
      attendanceRecordId: recordId,
      employeeId: input.employeeId,
      direction,
      occurredAt: input.occurredAt,
      source: "Hardware Terminal",
      deviceId: input.deviceId,
      externalEventId: input.externalEventId,
      deviceUserId: input.deviceUserId,
      deviceStatus: input.status ?? null,
      punchMethod: input.punchMethod ?? null,
      locationId: input.locationId,
      networkVerified: true,
      createdBy: null,
    })
    .returning({ id: attendancePunchEvents.id });
  if (!event) throw new Error("The terminal punch could not be recorded.");

  const clockInAt = effectiveEvents[0]!.toISOString();
  const clockOutAt =
    effectiveEvents.length > 1 ? effectiveEvents[effectiveEvents.length - 1]!.toISOString() : null;
  const breakMinutes = existing?.breakMinutes ?? policy?.defaultBreakMinutes ?? 0;
  const hours = clockOutAt
    ? Math.max(
        0,
        (new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 3_600_000 -
          breakMinutes / 60,
      )
    : 0;
  const localClockIn = zonedParts(new Date(clockInAt), timezone).time;
  const localClockOut = clockOutAt ? zonedParts(new Date(clockOutAt), timezone).time : undefined;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const expectedIn = existing?.expectedClockIn ?? policy?.expectedClockIn ?? "09:00";
  const expectedOut = existing?.expectedClockOut ?? policy?.expectedClockOut ?? "18:00";
  const isLate = minutes(localClockIn) > minutes(expectedIn) + (policy?.lateGraceMinutes ?? 0);
  const isEarlyDeparture = Boolean(localClockOut && minutes(localClockOut) < minutes(expectedOut));
  const automaticProjection =
    !existing || ["Web", "Hardware Terminal", "Multiple Sources"].includes(existing.source);

  if (
    automaticProjection &&
    !["Correction Pending", "Corrected"].includes(existing?.status ?? "")
  ) {
    const source =
      !existing || existing.source === "Hardware Terminal"
        ? "Hardware Terminal"
        : "Multiple Sources";
    await tx
      .update(attendanceRecords)
      .set({
        clockInAt,
        clockOutAt,
        clockOutLocationId: clockOutAt ? input.locationId : (existing?.clockOutLocationId ?? null),
        source,
        status: isLate ? "Late" : "Present",
        calculatedHours: String(Math.min(24, hours)),
        isLate,
        isEarlyDeparture,
        updatedAt: new Date(),
        updatedBy: input.deviceId,
        recordVersion: sql`${attendanceRecords.recordVersion} + 1`,
      })
      .where(eq(attendanceRecords.id, recordId));
  }
  await tx
    .update(attendanceDevicePunches)
    .set({
      employeeId: input.employeeId,
      attendanceRecordId: recordId,
      punchEventId: event.id,
      status: "Applied",
      failureReason: automaticProjection
        ? null
        : "Punch retained as evidence; an HR-entered or automated record was not overwritten.",
    })
    .where(eq(attendanceDevicePunches.id, input.rawPunchId));
  return recordId;
}

async function notifyUnmatchedDeviceUser(
  tx: Transaction,
  organisationId: string,
  deviceId: string,
  deviceName: string,
  deviceUserId: string,
  deviceUserName?: string,
): Promise<void> {
  const reviewers = await tx
    .select({ userId: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organisationId, organisationId),
        eq(users.status, "Active"),
        inArray(roles.code, ["HR", "Super Admin"]),
      ),
    );
  for (const reviewer of reviewers) {
    await tx
      .insert(notifications)
      .values({
        organisationId,
        recipientUserId: reviewer.userId,
        type: "attendance.device-user-unmatched",
        title: "Door terminal user needs matching",
        message: `${deviceName} received a punch for ${deviceUserName ? `${deviceUserName} (${deviceUserId})` : `user ${deviceUserId}`}. Match this terminal user to the correct employee.`,
        priority: "High",
        status: "Unread",
        deduplicationKey: `zkteco-unmatched-${deviceId}-${deviceUserId}`,
        link: { entityType: "attendance-device", entityId: deviceId, path: "/staff/attendance" },
        createdBy: deviceId,
        updatedBy: deviceId,
      } as typeof notifications.$inferInsert)
      .onConflictDoNothing();
  }
}

export async function createAttendanceConnectorPairingCode(
  organisationId: string,
  deviceId: string,
  actor: AuditActorContext,
): Promise<{ code: string; expiresAt: string; deviceCode: string; deviceName: string }> {
  requireAttendanceAdministrator(actor);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = randomBytes(12);
  const unformatted = [...random].map((byte) => alphabet[byte % alphabet.length]).join("");
  const code = formatPairingCode(unformatted);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [device] = await tx
      .select()
      .from(attendanceDevices)
      .where(
        and(
          eq(attendanceDevices.organisationId, organisationId),
          eq(attendanceDevices.id, deviceId),
          eq(attendanceDevices.isActive, true),
          sql`${attendanceDevices.archivedAt} IS NULL`,
        ),
      )
      .for("update")
      .limit(1);
    if (!device) throw new Error("Select an active door terminal.");
    await tx
      .update(attendanceDevices)
      .set({
        pairingCodeHash: pairingCodeHash(code),
        pairingExpiresAt: expiresAt,
        updatedAt: new Date(),
        updatedBy: actor.userId!,
        recordVersion: sql`${attendanceDevices.recordVersion} + 1`,
      })
      .where(eq(attendanceDevices.id, device.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: "create-connector-pairing-code",
      module: "attendance",
      entityType: "attendance-device",
      entityId: device.id,
      afterSummary: { deviceCode: device.code, expiresAt },
      reason: "A one-time office connector pairing code was requested.",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return { code, expiresAt, deviceCode: device.code, deviceName: device.name };
  });
}

export async function redeemAttendanceConnectorPairingCode(
  code: string,
  input: {
    connectorVersion?: string;
    connectorPlatform?: string;
    serialNumber?: string;
    model?: string;
  },
): Promise<AttendanceConnectorPairingResult> {
  const normalized = normalizePairingCode(code);
  if (normalized.length !== 12) throw new Error("The pairing code is invalid or expired.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [device] = await tx
      .select()
      .from(attendanceDevices)
      .where(
        and(
          eq(attendanceDevices.pairingCodeHash, pairingCodeHash(normalized)),
          eq(attendanceDevices.isActive, true),
          sql`${attendanceDevices.archivedAt} IS NULL`,
        ),
      )
      .for("update")
      .limit(1);
    if (!device?.pairingExpiresAt || new Date(device.pairingExpiresAt).getTime() <= Date.now()) {
      throw new Error("The pairing code is invalid or expired.");
    }
    if (
      device.serialNumber &&
      input.serialNumber?.trim() &&
      device.serialNumber !== input.serialNumber.trim()
    ) {
      throw new Error("The terminal serial number does not match the registered device.");
    }
    const credential = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    await tx
      .update(attendanceDevices)
      .set({
        pairingCodeHash: null,
        pairingExpiresAt: null,
        credentialEncrypted: encryptSensitiveJson({ credential }),
        pairedAt: now,
        connectorVersion: input.connectorVersion?.trim().slice(0, 80) || null,
        connectorPlatform: input.connectorPlatform?.trim().slice(0, 160) || null,
        serialNumber: device.serialNumber ?? input.serialNumber?.trim() ?? null,
        model: input.model?.trim() || device.model,
        lastSeenAt: now,
        lastError: null,
        updatedAt: new Date(),
        updatedBy: device.id,
        recordVersion: sql`${attendanceDevices.recordVersion} + 1`,
      })
      .where(eq(attendanceDevices.id, device.id));
    await tx.insert(auditEvents).values({
      organisationId: device.organisationId,
      actorDisplayName: `VIA attendance connector: ${device.name}`,
      activeRole: "System",
      actorRoles: [],
      action: "pair-attendance-connector",
      module: "attendance",
      entityType: "attendance-device",
      entityId: device.id,
      afterSummary: {
        deviceCode: device.code,
        connectorVersion: input.connectorVersion?.trim() || undefined,
        connectorPlatform: input.connectorPlatform?.trim() || undefined,
      },
      reason: "The one-time pairing code was redeemed by an office connector.",
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return {
      deviceCode: device.code,
      deviceName: device.name,
      ingestUrl: "/api/integrations/zkteco/punches",
      credential,
    };
  });
}

export async function resolveAttendanceDeviceCredential(
  organisationId: string,
  deviceCode: string,
): Promise<string | undefined> {
  const db = getDatabaseClient();
  const [device] = await db
    .select({ credentialEncrypted: attendanceDevices.credentialEncrypted })
    .from(attendanceDevices)
    .where(
      and(
        eq(attendanceDevices.organisationId, organisationId),
        eq(attendanceDevices.code, deviceCode),
        eq(attendanceDevices.isActive, true),
        sql`${attendanceDevices.archivedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!device?.credentialEncrypted) return undefined;
  return decryptSensitiveJson<{ credential: string }>(device.credentialEncrypted).credential;
}

export async function ingestZktecoPunchBatch(
  organisationId: string,
  deviceCode: string,
  batch: ZktecoBatchInput,
): Promise<ZktecoBatchResult> {
  const sorted = [...batch.punches].sort(
    (first, second) => Date.parse(first.occurredAt) - Date.parse(second.occurredAt),
  );
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [device] = await tx
      .select({ device: attendanceDevices, locationName: locations.name })
      .from(attendanceDevices)
      .innerJoin(locations, eq(locations.id, attendanceDevices.locationId))
      .where(
        and(
          eq(attendanceDevices.organisationId, organisationId),
          eq(attendanceDevices.code, deviceCode),
          eq(attendanceDevices.isActive, true),
          sql`${attendanceDevices.archivedAt} IS NULL`,
        ),
      )
      .for("update")
      .limit(1);
    if (!device) throw new Error("The attendance device is not registered or is inactive.");
    if (
      device.device.serialNumber &&
      batch.serialNumber &&
      device.device.serialNumber !== batch.serialNumber.trim()
    ) {
      throw new Error("The terminal serial number does not match the registered device.");
    }
    const result: ZktecoBatchResult = { accepted: 0, duplicates: 0, unmatched: 0, rejected: 0 };
    const now = new Date();
    for (const punch of sorted) {
      const occurredAt = new Date(punch.occurredAt);
      if (
        Number.isNaN(occurredAt.getTime()) ||
        occurredAt.getTime() > now.getTime() + 10 * 60_000 ||
        occurredAt.getTime() < now.getTime() - 400 * 86_400_000
      ) {
        result.rejected += 1;
        continue;
      }
      const employeeId = await findMappedEmployee(
        tx,
        organisationId,
        device.device.id,
        punch.deviceUserId.trim(),
      );
      const rawId = randomUUID();
      const [raw] = await tx
        .insert(attendanceDevicePunches)
        .values({
          id: rawId,
          organisationId,
          deviceId: device.device.id,
          externalEventId: punch.externalEventId.trim(),
          deviceUserId: punch.deviceUserId.trim(),
          deviceUserName: punch.deviceUserName?.trim() || null,
          occurredAt: occurredAt.toISOString(),
          deviceStatus: punch.status ?? null,
          punchMethod: punch.punchMethod ?? null,
          employeeId: employeeId ?? null,
          status: employeeId ? "Applied" : "Unmatched Employee",
          failureReason: employeeId ? null : "No exact employee mapping exists.",
        })
        .onConflictDoNothing()
        .returning({ id: attendanceDevicePunches.id });
      if (!raw) {
        result.duplicates += 1;
        continue;
      }
      if (!employeeId) {
        result.unmatched += 1;
        await notifyUnmatchedDeviceUser(
          tx,
          organisationId,
          device.device.id,
          device.device.name,
          punch.deviceUserId.trim(),
          punch.deviceUserName?.trim() || undefined,
        );
        continue;
      }
      await projectDailyAttendance(tx, {
        organisationId,
        deviceId: device.device.id,
        deviceUserId: punch.deviceUserId.trim(),
        externalEventId: punch.externalEventId.trim(),
        occurredAt: occurredAt.toISOString(),
        status: punch.status,
        punchMethod: punch.punchMethod,
        employeeId,
        locationId: device.device.locationId,
        locationName: device.locationName,
        rawPunchId: rawId,
      });
      result.accepted += 1;
    }
    await tx
      .update(attendanceDevices)
      .set({
        serialNumber: device.device.serialNumber ?? batch.serialNumber?.trim() ?? null,
        model: batch.model?.trim() || device.device.model,
        lastSeenAt: now.toISOString(),
        lastSuccessfulSyncAt: now.toISOString(),
        lastError: null,
        updatedAt: now,
        updatedBy: device.device.id,
      })
      .where(eq(attendanceDevices.id, device.device.id));
    await tx.insert(auditEvents).values({
      organisationId,
      actorDisplayName: `ZKTeco bridge: ${device.device.name}`,
      activeRole: "System",
      actorRoles: [],
      action: "ingest-device-punches",
      module: "attendance",
      entityType: "attendance-device",
      entityId: device.device.id,
      afterSummary: result,
      reason: "Signed office attendance batch received.",
      riskLevel: result.unmatched || result.rejected ? "High" : "Low",
    } as typeof auditEvents.$inferInsert);
    return result;
  });
}

export async function saveAttendanceDeviceInDatabase(
  organisationId: string,
  input: {
    id?: string;
    recordVersion?: number;
    code: string;
    name: string;
    locationId: string;
    serialNumber?: string;
    model?: string;
    isActive: boolean;
  },
  reason: string,
  actor: AuditActorContext,
): Promise<string> {
  requireAttendanceAdministrator(actor);
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(code)) {
    throw new Error("Device code must contain 2-64 lowercase letters, numbers or hyphens.");
  }
  if (input.name.trim().length < 2) throw new Error("Enter the terminal name.");
  if (reason.trim().length < 5) throw new Error("Explain the device change.");
  const db = getDatabaseClient();
  return db.transaction(async (tx) => {
    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.organisationId, organisationId),
          eq(locations.id, input.locationId),
          eq(locations.isActive, true),
        ),
      )
      .limit(1);
    if (!location) throw new Error("Select an active VIA office location.");
    const [before] = input.id
      ? await tx
          .select()
          .from(attendanceDevices)
          .where(
            and(
              eq(attendanceDevices.organisationId, organisationId),
              eq(attendanceDevices.id, input.id),
            ),
          )
          .for("update")
          .limit(1)
      : [];
    if (input.id && !before) throw new Error("Attendance device not found.");
    if (before && input.recordVersion !== before.recordVersion) {
      throw new Error("This terminal was changed by someone else. Refresh and try again.");
    }
    const id = before?.id ?? randomUUID();
    const values = {
      code,
      name: input.name.trim(),
      locationId: input.locationId,
      serialNumber: input.serialNumber?.trim() || null,
      model: input.model?.trim() || null,
      isActive: input.isActive,
      updatedAt: new Date(),
      updatedBy: actor.userId!,
    };
    if (before) {
      const [updated] = await tx
        .update(attendanceDevices)
        .set({ ...values, recordVersion: sql`${attendanceDevices.recordVersion} + 1` })
        .where(
          and(
            eq(attendanceDevices.id, id),
            eq(attendanceDevices.recordVersion, input.recordVersion!),
          ),
        )
        .returning({ id: attendanceDevices.id });
      if (!updated)
        throw new Error("This terminal was changed by someone else. Refresh and try again.");
    } else {
      await tx.insert(attendanceDevices).values({
        id,
        organisationId,
        ...values,
        createdBy: actor.userId!,
      } as typeof attendanceDevices.$inferInsert);
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: before ? "update-device" : "register-device",
      module: "attendance",
      entityType: "attendance-device",
      entityId: id,
      beforeSummary: before
        ? {
            code: before.code,
            name: before.name,
            locationId: before.locationId,
            active: before.isActive,
          }
        : undefined,
      afterSummary: {
        code,
        name: values.name,
        locationId: values.locationId,
        active: values.isActive,
      },
      reason: reason.trim(),
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return id;
  });
}

export async function mapAttendanceDeviceUserInDatabase(
  organisationId: string,
  input: { deviceId: string; deviceUserId: string; employeeId: string },
  reason: string,
  actor: AuditActorContext,
): Promise<number> {
  requireAttendanceAdministrator(actor);
  if (!input.deviceUserId.trim()) throw new Error("Enter the terminal user ID.");
  if (reason.trim().length < 5) throw new Error("Explain the employee mapping.");
  const db = getDatabaseClient();
  await db.transaction(async (tx) => {
    const [[device], [employee]] = await Promise.all([
      tx
        .select({ id: attendanceDevices.id })
        .from(attendanceDevices)
        .where(
          and(
            eq(attendanceDevices.organisationId, organisationId),
            eq(attendanceDevices.id, input.deviceId),
            eq(attendanceDevices.isActive, true),
          ),
        )
        .limit(1),
      tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.organisationId, organisationId),
            eq(employees.id, input.employeeId),
            sql`${employees.status} NOT IN ('Inactive', 'Archived')`,
          ),
        )
        .limit(1),
    ]);
    if (!device || !employee) throw new Error("Select an active terminal and employee.");
    const [existing] = await tx
      .select()
      .from(attendanceDeviceEmployeeMappings)
      .where(
        and(
          eq(attendanceDeviceEmployeeMappings.deviceId, input.deviceId),
          eq(attendanceDeviceEmployeeMappings.deviceUserId, input.deviceUserId.trim()),
        ),
      )
      .for("update")
      .limit(1);
    const id = existing?.id ?? randomUUID();
    if (existing) {
      await tx
        .update(attendanceDeviceEmployeeMappings)
        .set({
          employeeId: input.employeeId,
          archivedAt: null,
          updatedAt: new Date(),
          updatedBy: actor.userId!,
          recordVersion: sql`${attendanceDeviceEmployeeMappings.recordVersion} + 1`,
        })
        .where(eq(attendanceDeviceEmployeeMappings.id, id));
    } else {
      await tx.insert(attendanceDeviceEmployeeMappings).values({
        id,
        organisationId,
        deviceId: input.deviceId,
        deviceUserId: input.deviceUserId.trim(),
        employeeId: input.employeeId,
        createdBy: actor.userId!,
        updatedBy: actor.userId!,
      });
    }
    await tx.insert(auditEvents).values({
      organisationId,
      actorUserId: actor.userId,
      actorEmployeeId: actor.employeeId,
      actorDisplayName: actor.displayName,
      activeRole: actor.activeRole,
      actorRoles: actor.roles ?? [],
      action: existing ? "reassign-device-user" : "map-device-user",
      module: "attendance",
      entityType: "attendance-device-mapping",
      entityId: id,
      beforeSummary: existing ? { employeeId: existing.employeeId } : undefined,
      afterSummary: input,
      reason: reason.trim(),
      riskLevel: "High",
    } as typeof auditEvents.$inferInsert);
    return id;
  });

  const pending = await db
    .select()
    .from(attendanceDevicePunches)
    .where(
      and(
        eq(attendanceDevicePunches.organisationId, organisationId),
        eq(attendanceDevicePunches.deviceId, input.deviceId),
        eq(attendanceDevicePunches.deviceUserId, input.deviceUserId.trim()),
        eq(attendanceDevicePunches.status, "Unmatched Employee"),
      ),
    )
    .orderBy(asc(attendanceDevicePunches.occurredAt));
  let applied = 0;
  for (const raw of pending) {
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: attendanceDevicePunches.id })
        .from(attendanceDevicePunches)
        .where(
          and(
            eq(attendanceDevicePunches.id, raw.id),
            eq(attendanceDevicePunches.status, "Unmatched Employee"),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) return;
      const [device] = await tx
        .select({ device: attendanceDevices, locationName: locations.name })
        .from(attendanceDevices)
        .innerJoin(locations, eq(locations.id, attendanceDevices.locationId))
        .where(eq(attendanceDevices.id, input.deviceId))
        .limit(1);
      if (!device) return;
      await projectDailyAttendance(tx, {
        organisationId,
        deviceId: input.deviceId,
        deviceUserId: input.deviceUserId.trim(),
        externalEventId: raw.externalEventId,
        occurredAt: raw.occurredAt,
        status: raw.deviceStatus,
        punchMethod: raw.punchMethod,
        employeeId: input.employeeId,
        locationId: device.device.locationId,
        locationName: device.locationName,
        rawPunchId: raw.id,
      });
      applied += 1;
    });
  }
  return applied;
}

export async function listAttendanceDeviceAdministration(
  organisationId: string,
  actor: AuditActorContext,
) {
  requireAttendanceAdministrator(actor);
  const db = getDatabaseClient();
  const [devices, mappings, unmatched] = await Promise.all([
    db
      .select({ device: attendanceDevices, locationName: locations.name })
      .from(attendanceDevices)
      .innerJoin(locations, eq(locations.id, attendanceDevices.locationId))
      .where(
        and(
          eq(attendanceDevices.organisationId, organisationId),
          sql`${attendanceDevices.archivedAt} IS NULL`,
        ),
      )
      .orderBy(attendanceDevices.name),
    db
      .select({ mapping: attendanceDeviceEmployeeMappings, employeeName: employees.preferredName })
      .from(attendanceDeviceEmployeeMappings)
      .innerJoin(employees, eq(employees.id, attendanceDeviceEmployeeMappings.employeeId))
      .where(
        and(
          eq(attendanceDeviceEmployeeMappings.organisationId, organisationId),
          sql`${attendanceDeviceEmployeeMappings.archivedAt} IS NULL`,
        ),
      )
      .orderBy(attendanceDeviceEmployeeMappings.deviceUserId),
    db
      .select({ punch: attendanceDevicePunches, deviceName: attendanceDevices.name })
      .from(attendanceDevicePunches)
      .innerJoin(attendanceDevices, eq(attendanceDevices.id, attendanceDevicePunches.deviceId))
      .where(
        and(
          eq(attendanceDevicePunches.organisationId, organisationId),
          eq(attendanceDevicePunches.status, "Unmatched Employee"),
        ),
      )
      .orderBy(asc(attendanceDevicePunches.occurredAt))
      .limit(500),
  ]);
  return {
    devices: devices.map(({ device, locationName }) => ({
      device: {
        id: device.id,
        recordVersion: device.recordVersion,
        code: device.code,
        name: device.name,
        locationId: device.locationId,
        serialNumber: device.serialNumber,
        model: device.model,
        isActive: device.isActive,
        lastSeenAt: device.lastSeenAt,
        lastSuccessfulSyncAt: device.lastSuccessfulSyncAt,
        lastError: device.lastError,
        pairingExpiresAt: device.pairingExpiresAt,
        pairedAt: device.pairedAt,
        connectorVersion: device.connectorVersion,
        connectorPlatform: device.connectorPlatform,
      },
      locationName,
    })),
    mappings,
    unmatched,
  };
}
