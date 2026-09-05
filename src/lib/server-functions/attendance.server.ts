import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/start-server-core";
import * as z from "zod";
import {
  captureAttendancePunchInDatabase,
  cancelSiteVisitInDatabase,
  configureAttendanceOfficeInDatabase,
  deleteUnattachedAttendanceEvidenceInDatabase,
  decideSiteVisitInDatabase,
  decideAttendanceCorrectionInDatabase,
  exportAttendanceRecordsFromDatabase,
  importAttendanceRecordsInDatabase,
  listAttendanceForActor,
  readAttendanceCorrectionEvidenceInDatabase,
  requestSiteVisitInDatabase,
  requestAttendanceCorrectionInDatabase,
  resolveAttendanceExceptionInDatabase,
  saveAttendancePolicyInDatabase,
  saveAttendanceRecordInDatabase,
  updateAttendanceExceptionInvestigationInDatabase,
} from "../db/repositories/attendance.repository.server.ts";
import {
  createAttendanceConnectorPairingCode,
  listAttendanceDeviceAdministration,
  mapAttendanceDeviceUserInDatabase,
  saveAttendanceDeviceInDatabase,
} from "../db/repositories/zkteco.repository.server.ts";
import { saveObjectFile } from "../db/object-storage.server.ts";
import { resolveOrganisationIdForActor, verifyServerActorRole } from "../db/utils.server.ts";
import { ROLE_VALUES } from "../data/types.ts";

const Actor = z.object({
  actorId: z.string().min(1),
  actorEmail: z.string().email().optional(),
  activeRole: z.enum(ROLE_VALUES),
});
async function verify(actor: z.infer<typeof Actor>) {
  const organisationId = await resolveOrganisationIdForActor(actor.actorId, actor.actorEmail);
  const result = await verifyServerActorRole(
    organisationId,
    actor.actorId,
    undefined,
    actor.actorEmail,
  );
  if (!result.verified || !result.actor?.roles.includes(actor.activeRole))
    throw new Error("Your VIA access could not be verified.");
  return { organisationId, actor: { ...result.actor, activeRole: actor.activeRole } };
}

const Punch = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    direction: z.enum(["in", "out"]),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().max(10000),
    locationId: z.string().uuid().optional(),
  })
  .strict();
export const captureAttendancePunchFn = createServerFn({ method: "POST" })
  .validator((input) => Punch.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return captureAttendancePunchInDatabase(
      v.organisationId,
      {
        employeeId: data.employeeId,
        direction: data.direction,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracyMeters: data.accuracyMeters,
        clientIp:
          getRequestIP({
            xForwardedFor: process.env["VIA_HR_TRUST_PROXY"] === "true",
          }) ?? "unknown",
        ...(data.locationId ? { locationId: data.locationId } : {}),
      },
      v.actor,
    );
  });

export const listAttendanceDevicesFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listAttendanceDeviceAdministration(v.organisationId, v.actor);
  });

const AttendanceDevice = z
  .object({
    actor: Actor,
    id: z.string().uuid().optional(),
    recordVersion: z.number().int().positive().optional(),
    code: z.string().trim().min(2).max(64),
    name: z.string().trim().min(2).max(200),
    locationId: z.string().uuid(),
    serialNumber: z.string().trim().max(128).optional(),
    model: z.string().trim().max(128).optional(),
    isActive: z.boolean(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const saveAttendanceDeviceFn = createServerFn({ method: "POST" })
  .validator((input) => AttendanceDevice.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveAttendanceDeviceInDatabase(
      v.organisationId,
      {
        ...(data.id ? { id: data.id } : {}),
        ...(data.recordVersion ? { recordVersion: data.recordVersion } : {}),
        code: data.code,
        name: data.name,
        locationId: data.locationId,
        ...(data.serialNumber ? { serialNumber: data.serialNumber } : {}),
        ...(data.model ? { model: data.model } : {}),
        isActive: data.isActive,
      },
      data.reason,
      v.actor,
    );
  });

export const createAttendanceConnectorPairingCodeFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z.object({ actor: Actor, deviceId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return createAttendanceConnectorPairingCode(v.organisationId, data.deviceId, v.actor);
  });

const AttendanceDeviceMapping = z
  .object({
    actor: Actor,
    deviceId: z.string().uuid(),
    deviceUserId: z.string().trim().min(1).max(128),
    employeeId: z.string().uuid(),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const mapAttendanceDeviceUserFn = createServerFn({ method: "POST" })
  .validator((input) => AttendanceDeviceMapping.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return {
      appliedPunches: await mapAttendanceDeviceUserInDatabase(
        v.organisationId,
        {
          deviceId: data.deviceId,
          deviceUserId: data.deviceUserId,
          employeeId: data.employeeId,
        },
        data.reason,
        v.actor,
      ),
    };
  });

const ConfigureOffice = z
  .object({
    actor: Actor,
    locationId: z.string().uuid(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().max(10_000),
    radiusMeters: z.number().int().min(25).max(10_000),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const configureAttendanceOfficeFn = createServerFn({ method: "POST" })
  .validator((input) => ConfigureOffice.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return configureAttendanceOfficeInDatabase(
      v.organisationId,
      {
        locationId: data.locationId,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracyMeters: data.accuracyMeters,
        radiusMeters: data.radiusMeters,
      },
      data.reason,
      v.actor,
    );
  });

const Correction = z
  .object({
    actor: Actor,
    attendanceRecordId: z.string().uuid(),
    proposedClockIn: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    proposedClockOut: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    explanation: z.string().trim().min(5).max(2000),
    evidenceFileId: z.string().uuid().optional(),
  })
  .strict();
export const requestAttendanceCorrectionFn = createServerFn({ method: "POST" })
  .validator((input) => Correction.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return requestAttendanceCorrectionInDatabase(
      v.organisationId,
      {
        attendanceRecordId: data.attendanceRecordId,
        explanation: data.explanation,
        ...(data.proposedClockIn ? { proposedClockIn: data.proposedClockIn } : {}),
        ...(data.proposedClockOut ? { proposedClockOut: data.proposedClockOut } : {}),
        ...(data.evidenceFileId ? { evidenceFileId: data.evidenceFileId } : {}),
      },
      v.actor,
    );
  });

const CorrectionDecision = z
  .object({
    actor: Actor,
    correctionId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const decideAttendanceCorrectionFn = createServerFn({ method: "POST" })
  .validator((input) => CorrectionDecision.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await decideAttendanceCorrectionInDatabase(
      v.organisationId,
      data.correctionId,
      data.decision,
      data.notes,
      v.actor,
    );
    return { ok: true };
  });

const ResolveException = z
  .object({
    actor: Actor,
    exceptionId: z.string().uuid(),
    resolution: z.string().trim().min(5).max(4000),
  })
  .strict();
export const resolveAttendanceExceptionFn = createServerFn({ method: "POST" })
  .validator((input) => ResolveException.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await resolveAttendanceExceptionInDatabase(
      v.organisationId,
      data.exceptionId,
      data.resolution,
      v.actor,
    );
    return { ok: true };
  });

const InvestigateException = z
  .object({
    actor: Actor,
    exceptionId: z.string().uuid(),
    assignToActor: z.boolean().optional(),
    investigationNotes: z.string().trim().max(4000).optional(),
  })
  .strict();
export const updateAttendanceExceptionInvestigationFn = createServerFn({ method: "POST" })
  .validator((input) => InvestigateException.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await updateAttendanceExceptionInvestigationInDatabase(
      v.organisationId,
      data.exceptionId,
      {
        ...(data.assignToActor ? { assignToActor: true } : {}),
        ...(data.investigationNotes ? { investigationNotes: data.investigationNotes } : {}),
      },
      v.actor,
    );
    return { ok: true };
  });

const ReadEvidence = z
  .object({
    actor: Actor,
    correctionId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const readAttendanceCorrectionEvidenceFn = createServerFn({ method: "POST" })
  .validator((input) => ReadEvidence.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    const file = await readAttendanceCorrectionEvidenceInDatabase(
      v.organisationId,
      data.correctionId,
      v.actor,
      data.reason,
    );
    return {
      metadata: file.metadata,
      base64: Buffer.from(file.bytes).toString("base64"),
    };
  });

const EvidenceUpload = z
  .object({
    actor: Actor,
    name: z.string().trim().min(1).max(180),
    mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    base64: z.string().min(1),
  })
  .strict();
export const uploadAttendanceCorrectionEvidenceFn = createServerFn({ method: "POST" })
  .validator((input) => EvidenceUpload.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    if (!v.actor.employeeId) throw new Error("A verified employee is required.");
    const bytes = new Uint8Array(Buffer.from(data.base64, "base64"));
    if (bytes.byteLength < 4 || bytes.byteLength > 10 * 1024 * 1024)
      throw new Error("Attendance evidence must be between 4 bytes and 10 MB.");
    const signatureValid =
      (data.mimeType === "application/pdf" &&
        Buffer.from(bytes.subarray(0, 4)).toString() === "%PDF") ||
      (data.mimeType === "image/png" &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47) ||
      (data.mimeType === "image/jpeg" &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff);
    if (!signatureValid) throw new Error("The evidence content does not match its file type.");
    return saveObjectFile({
      organisationId: v.organisationId,
      bytes,
      name: data.name,
      mimeType: data.mimeType,
      owner: { entityType: "employee", entityId: v.actor.employeeId },
      actor: v.actor,
    });
  });

export const deleteUnattachedAttendanceEvidenceFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, fileId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await deleteUnattachedAttendanceEvidenceInDatabase(v.organisationId, data.fileId, v.actor);
    return { ok: true };
  });

const SiteVisit = z
  .object({
    actor: Actor,
    employeeId: z.string().uuid(),
    date: z.string().date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    origin: z.enum(["Office", "Home"]),
    destination: z.string().trim().min(3).max(300),
    purpose: z.string().trim().min(5).max(2000),
    projectId: z.string().uuid().optional(),
  })
  .strict();
export const requestSiteVisitFn = createServerFn({ method: "POST" })
  .validator((input) => SiteVisit.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return requestSiteVisitInDatabase(
      v.organisationId,
      {
        employeeId: data.employeeId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        origin: data.origin,
        destination: data.destination,
        purpose: data.purpose,
        ...(data.projectId ? { projectId: data.projectId } : {}),
      },
      v.actor,
    );
  });

const SiteVisitDecision = z
  .object({
    actor: Actor,
    visitId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();
export const decideSiteVisitFn = createServerFn({ method: "POST" })
  .validator((input) => SiteVisitDecision.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await decideSiteVisitInDatabase(
      v.organisationId,
      data.visitId,
      data.decision,
      data.notes,
      v.actor,
    );
    return { ok: true };
  });

export const cancelSiteVisitFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        visitId: z.string().uuid(),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await cancelSiteVisitInDatabase(v.organisationId, data.visitId, data.reason, v.actor);
    return { ok: true };
  });

const Policy = z
  .object({
    actor: Actor,
    standardDailyHours: z.number().positive().max(24),
    expectedClockIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    expectedClockOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    defaultBreakMinutes: z.number().int().min(0).max(1439),
    lateGraceMinutes: z.number().int().nonnegative(),
    maximumLocationAccuracyMeters: z.number().int().positive(),
    signOutReminderOffsetsMinutes: z.array(z.number().int().nonnegative()).length(3),
    punchDeduplicationMinutes: z.number().int().min(0).max(15),
    approvedNetworkCidrs: z.array(z.string().trim().min(1)).min(1),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const saveAttendancePolicyFn = createServerFn({ method: "POST" })
  .validator((input) => Policy.parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    await saveAttendancePolicyInDatabase(
      v.organisationId,
      {
        standardDailyHours: data.standardDailyHours,
        expectedClockIn: data.expectedClockIn,
        expectedClockOut: data.expectedClockOut,
        defaultBreakMinutes: data.defaultBreakMinutes,
        lateGraceMinutes: data.lateGraceMinutes,
        maximumLocationAccuracyMeters: data.maximumLocationAccuracyMeters,
        signOutReminderOffsetsMinutes: data.signOutReminderOffsetsMinutes,
        punchDeduplicationMinutes: data.punchDeduplicationMinutes,
        approvedNetworkCidrs: data.approvedNetworkCidrs,
      },
      data.reason,
      v.actor,
    );
    return { ok: true };
  });

const AttendanceAdminRow = z
  .object({
    employeeId: z.string().uuid(),
    date: z.string().date(),
    clockIn: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    clockOut: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    breakMinutes: z.number().int().min(0).max(360),
    location: z.string().trim().max(300).optional(),
    source: z.enum(["Manual Entry", "Import", "Hardware Terminal"]),
  })
  .strict();

export const saveAttendanceRecordFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        recordId: z.string().uuid().optional(),
        row: AttendanceAdminRow,
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return saveAttendanceRecordInDatabase(
      v.organisationId,
      { ...data.row, ...(data.recordId ? { recordId: data.recordId } : {}) },
      data.reason,
      v.actor,
    );
  });

export const importAttendanceRecordsFn = createServerFn({ method: "POST" })
  .validator((input) =>
    z
      .object({
        actor: Actor,
        rows: z.array(AttendanceAdminRow).min(1).max(1000),
        reason: z.string().trim().min(5).max(1000),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return importAttendanceRecordsInDatabase(v.organisationId, data.rows, data.reason, v.actor);
  });

export const exportAttendanceRecordsFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor, date: z.string().date() }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return exportAttendanceRecordsFromDatabase(v.organisationId, data.date, v.actor);
  });

export const listAttendanceFn = createServerFn({ method: "POST" })
  .validator((input) => z.object({ actor: Actor }).strict().parse(input))
  .handler(async ({ data }) => {
    const v = await verify(data.actor);
    return listAttendanceForActor(v.organisationId, v.actor);
  });
