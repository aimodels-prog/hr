import { SYSTEM_CONTEXT } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { EmployeeService } from "./employee-service.ts";
import { LeaveService } from "./leave-service.ts";
import { getMasterDataRepository } from "./master-data.ts";
import { LocalRepository, type NewRecord } from "./repository.ts";
import { SettingsService } from "./settings-service.ts";
import type {
  AttendanceCorrection,
  AttendanceExceptionCase,
  AttendanceExceptionStatus,
  AttendanceImportPreview,
  AttendanceImportRow,
  AttendanceLocation,
  AttendancePolicy,
  AttendanceRecord,
  AttendanceStatus,
  GeoReading,
  GeofenceResult,
  SiteVisitRequest,
} from "./attendance-types.ts";
import type { ActorContext, Role, User } from "./types.ts";

const POLICY_ID = "attendance-policy-primary";
const ADMIN_ROLES: Role[] = ["HR", "Super Admin"];

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeKey(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function parseMinutes(time: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid time: ${time}`);
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function effectiveRole(context: ActorContext): Role | undefined {
  return context.actor.activeRole ?? context.actor.roles[0];
}

function roleIs(context: ActorContext, roles: readonly Role[]): boolean {
  const role = effectiveRole(context);
  return role !== undefined && roles.includes(role);
}

function escapeCsv(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

export function distanceInMeters(
  first: Pick<GeoReading, "latitude" | "longitude">,
  second: Pick<GeoReading, "latitude" | "longitude">,
): number {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export class AttendanceService {
  private readonly recordRepo: LocalRepository<AttendanceRecord>;
  private readonly correctionRepo: LocalRepository<AttendanceCorrection>;
  private readonly policyRepo: LocalRepository<AttendancePolicy>;
  private readonly siteVisitRepo: LocalRepository<SiteVisitRequest>;
  private readonly exceptionRepo: LocalRepository<AttendanceExceptionCase>;
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    const { storage, audit } = getApplicationDataServices();
    this.now = options.now ?? (() => new Date());
    const repositoryOptions = { now: () => this.now().toISOString() };
    this.recordRepo = new LocalRepository<AttendanceRecord>("attendanceRecords", storage, audit, {
      module: "attendance",
      entityType: "record",
      ...repositoryOptions,
    });
    this.correctionRepo = new LocalRepository<AttendanceCorrection>(
      "attendanceCorrections",
      storage,
      audit,
      { module: "attendance", entityType: "correction", ...repositoryOptions },
    );
    this.policyRepo = new LocalRepository<AttendancePolicy>("attendancePolicies", storage, audit, {
      module: "attendance",
      entityType: "policy",
      ...repositoryOptions,
    });
    this.siteVisitRepo = new LocalRepository<SiteVisitRequest>(
      "attendanceSiteVisits",
      storage,
      audit,
      {
        module: "attendance",
        entityType: "site-visit",
        ...repositoryOptions,
      },
    );
    this.exceptionRepo = new LocalRepository<AttendanceExceptionCase>(
      "attendanceExceptions",
      storage,
      audit,
      {
        module: "attendance",
        entityType: "exception-case",
        ...repositoryOptions,
      },
    );
  }

  getAllRecords(context: ActorContext): AttendanceRecord[] {
    this.requireAdmin(context, "view all attendance records");
    return this.recordRepo.list().map((record) => this.presentRecord(record));
  }

  getRecordsForEmployee(employeeId: string, context: ActorContext): AttendanceRecord[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's attendance records");
    return this.recordRepo
      .list()
      .filter((record) => record.employeeId === employeeId)
      .map((record) => this.presentRecord(record))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  getRecordsForContext(context: ActorContext): AttendanceRecord[] {
    if (roleIs(context, ADMIN_ROLES)) {
      return this.recordRepo.list().map((record) => this.presentRecord(record));
    }
    if (effectiveRole(context) === "Line Manager" && context.actor.employeeId) {
      const directReportIds = new EmployeeService()
        .getEmployees(SYSTEM_CONTEXT)
        .filter((employee) => employee.lineManagerId === context.actor.employeeId)
        .map((employee) => employee.id);
      return this.recordRepo
        .list()
        .filter(
          (record) =>
            record.employeeId === context.actor.employeeId ||
            directReportIds.includes(record.employeeId),
        )
        .map((record) => this.presentRecord(record));
    }
    return context.actor.employeeId
      ? this.getRecordsForEmployee(context.actor.employeeId, context)
      : [];
  }

  getAllCorrections(context: ActorContext): AttendanceCorrection[] {
    this.requireAdmin(context, "view all attendance corrections");
    return this.correctionRepo
      .list()
      .map((correction) => this.normaliseCorrection(correction))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getCorrectionsForEmployee(employeeId: string, context: ActorContext): AttendanceCorrection[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's attendance corrections");
    return this.correctionRepo
      .list()
      .map((correction) => this.normaliseCorrection(correction))
      .filter((correction) => correction.employeeId === employeeId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getCorrectionsForContext(context: ActorContext): AttendanceCorrection[] {
    if (roleIs(context, ADMIN_ROLES)) return this.getAllCorrections(context);
    if (effectiveRole(context) === "Line Manager") {
      return this.getCorrectionsForDirectReports(context);
    }
    return context.actor.employeeId
      ? this.getCorrectionsForEmployee(context.actor.employeeId, context)
      : [];
  }

  async getCorrectionEvidence(
    correctionId: string,
    context: ActorContext,
  ): Promise<{ blob: Blob; fileName: string }> {
    const correction = this.correctionRepo.getById(correctionId);
    if (!correction) throw new Error("Correction not found");
    if (!correction.evidenceFileId) throw new Error("This correction has no supporting evidence.");

    const visible = this.getCorrectionsForContext(context).some((item) => item.id === correctionId);
    if (!visible) {
      this.recordDenied("attendance_evidence_access_denied", correctionId, context);
      throw new Error("You are not authorised to view this correction's evidence.");
    }

    const { files } = getApplicationDataServices();
    const [metadata, blob] = await Promise.all([
      files.getMetadata(correction.evidenceFileId),
      files.getBlob(correction.evidenceFileId),
    ]);
    if (!metadata || !blob) throw new Error("The supporting file could not be found.");

    getApplicationDataServices().audit.record({
      context,
      action: "attendance_evidence_accessed",
      module: "attendance",
      entityType: "attendance_correction",
      entityId: correctionId,
      reason: `Viewed supporting evidence for attendance correction ${correctionId}.`,
      riskLevel: "Medium",
    });

    return { blob, fileName: metadata.name ?? "evidence" };
  }

  getCorrectionsForDirectReports(context: ActorContext): AttendanceCorrection[] {
    this.requireRole(context, ["Line Manager", "HR", "Super Admin"], "review corrections");
    if (roleIs(context, ADMIN_ROLES)) return this.getAllCorrections(context);
    if (!context.actor.employeeId) return [];
    const directReportIds = new EmployeeService()
      .getEmployees(SYSTEM_CONTEXT)
      .filter((employee) => employee.lineManagerId === context.actor.employeeId)
      .map((employee) => employee.id);
    return this.correctionRepo
      .list()
      .map((correction) => this.normaliseCorrection(correction))
      .filter((correction) => directReportIds.includes(correction.employeeId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getPolicy(): AttendancePolicy {
    const stored = this.policyRepo.getById(POLICY_ID);
    if (stored) return stored;
    let standardDailyHours = 8;
    try {
      standardDailyHours = new SettingsService().getAppSettingsSync().standardDailyHours;
    } catch {
      // Deterministic fallback for an uninitialised test store.
    }
    const timestamp = this.now().toISOString();
    return {
      id: POLICY_ID,
      createdAt: timestamp,
      createdBy: "system",
      updatedAt: timestamp,
      updatedBy: "system",
      recordVersion: 1,
      standardDailyHours,
      expectedClockIn: "09:00",
      expectedClockOut: "18:00",
      defaultBreakMinutes: 60,
      lateGraceMinutes: 5,
      maximumLocationAccuracyMeters: 100,
      signOutReminderOffsetsMinutes: [0, 15, 30],
    };
  }

  savePolicy(
    changes: Pick<
      AttendancePolicy,
      | "standardDailyHours"
      | "expectedClockIn"
      | "expectedClockOut"
      | "defaultBreakMinutes"
      | "lateGraceMinutes"
      | "maximumLocationAccuracyMeters"
      | "signOutReminderOffsetsMinutes"
    >,
    context: ActorContext,
  ): AttendancePolicy {
    this.requireAdmin(context, "change attendance policy");
    if (changes.standardDailyHours <= 0 || changes.standardDailyHours > 24) {
      throw new Error("Standard daily hours must be between 0 and 24.");
    }
    parseMinutes(changes.expectedClockIn);
    parseMinutes(changes.expectedClockOut);
    if (changes.defaultBreakMinutes < 0 || changes.defaultBreakMinutes > 360) {
      throw new Error("Default break must be between 0 and 360 minutes.");
    }
    if (changes.maximumLocationAccuracyMeters < 10) {
      throw new Error("Maximum location accuracy cannot be less than 10 metres.");
    }
    if (
      changes.signOutReminderOffsetsMinutes.some((offset) => offset < 0) ||
      changes.signOutReminderOffsetsMinutes.some(
        (offset, index, values) => index > 0 && offset <= values[index - 1]!,
      )
    ) {
      throw new Error("The three sign-out reminders must use increasing non-negative offsets.");
    }
    const existing = this.policyRepo.getById(POLICY_ID);
    return existing
      ? this.policyRepo.update(POLICY_ID, changes, context)
      : this.policyRepo.create({ id: POLICY_ID, ...changes }, context);
  }

  getLocations(includeArchived = false): AttendanceLocation[] {
    return getMasterDataRepository("locations").list({ includeArchived }) as AttendanceLocation[];
  }

  getClockInLocations(): AttendanceLocation[] {
    return this.getLocations().filter(
      (location) =>
        location.isActive &&
        location.isClockInSite === true &&
        Number.isFinite(location.latitude) &&
        Number.isFinite(location.longitude) &&
        Number.isFinite(location.radiusMeters) &&
        (location.radiusMeters ?? 0) > 0,
    );
  }

  configureOfficeLocation(
    locationId: string,
    reading: GeoReading,
    radiusMeters: number,
    context: ActorContext,
  ): AttendanceLocation {
    this.requireAdmin(context, "configure the office geofence");
    this.validateReading(reading);
    if (reading.accuracyMeters > this.getPolicy().maximumLocationAccuracyMeters) {
      throw new Error(
        `Office location accuracy must be ${this.getPolicy().maximumLocationAccuracyMeters} metres or better.`,
      );
    }
    if (radiusMeters < 20 || radiusMeters > 10_000) {
      throw new Error("Office radius must be between 20 and 10,000 metres.");
    }
    const repository = getMasterDataRepository("locations");
    if (!repository.getById(locationId)) throw new Error("Office location was not found.");
    return repository.update(
      locationId,
      {
        latitude: reading.latitude,
        longitude: reading.longitude,
        radiusMeters,
        isClockInSite: true,
      } as Partial<AttendanceLocation>,
      { ...context, reason: context.reason ?? "Office geofence captured from current location" },
    ) as AttendanceLocation;
  }

  evaluateGeofence(reading: GeoReading): GeofenceResult {
    const policy = this.getPolicy();
    if (reading.accuracyMeters > policy.maximumLocationAccuracyMeters) {
      return {
        allowed: false,
        message: `Location accuracy is ${Math.round(reading.accuracyMeters)}m. Move near a window or outdoors and retry with accuracy of ${policy.maximumLocationAccuracyMeters}m or better.`,
      };
    }
    const locations = this.getClockInLocations();
    if (locations.length === 0) {
      return {
        allowed: false,
        message:
          "The office geofence has not been configured. HR must capture the office location first.",
      };
    }
    const distances = locations
      .map((location) => ({
        location,
        distance: distanceInMeters(reading, {
          latitude: location.latitude!,
          longitude: location.longitude!,
        }),
      }))
      .sort((a, b) => a.distance - b.distance);
    const nearest = distances[0]!;
    const radius = nearest.location.radiusMeters!;
    const allowed = nearest.distance <= radius;
    return {
      allowed,
      nearestLocation: nearest.location,
      distanceMeters: Math.round(nearest.distance),
      shortfallMeters: Math.max(0, Math.round(nearest.distance - radius)),
      message: allowed
        ? `Location verified at ${nearest.location.name}.`
        : `You are ${Math.round(nearest.distance)}m from ${nearest.location.name}. Move ${Math.max(1, Math.round(nearest.distance - radius))}m closer to enter its ${radius}m attendance zone.`,
    };
  }

  clockIn(employeeId: string, reading: GeoReading, context: ActorContext): AttendanceRecord {
    this.requireSelf(employeeId, context, "clock in");
    this.validateReading(reading);
    const now = this.now();
    const date = dateKey(now);
    const existing = this.findRecord(employeeId, date);
    if (existing?.clockIn) throw new Error("You are already clocked in for today.");
    const approvedHomeVisit = this.getApprovedSiteVisit(employeeId, date, "Home");
    if (approvedHomeVisit) {
      throw new Error("Your approved home-origin site visit uses automatic attendance today.");
    }
    const reconciled = this.reconcileDailyStatus(employeeId, date, context);
    if (reconciled && ["On Leave", "Holiday", "Rest Day"].includes(reconciled.status ?? "")) {
      throw new Error(`Clock-in is unavailable because today is recorded as ${reconciled.status}.`);
    }
    const geofence = this.evaluateGeofence(reading);
    if (!geofence.allowed || !geofence.nearestLocation) {
      this.recordBlockedAttempt("clock_in_blocked", employeeId, reading, geofence, context);
      throw new Error(geofence.message);
    }
    const policy = this.getPolicy();
    return this.createRecord(
      {
        employeeId,
        date,
        expectedClockIn: policy.expectedClockIn,
        expectedClockOut: policy.expectedClockOut,
        clockIn: timeKey(now),
        clockInAt: now.toISOString(),
        breakMinutes: policy.defaultBreakMinutes,
        location: geofence.nearestLocation.name,
        locationId: geofence.nearestLocation.id,
        capturedLatitude: reading.latitude,
        capturedLongitude: reading.longitude,
        capturedAccuracyMeters: reading.accuracyMeters,
        source: "Web",
        workMode: "Office",
        status: "Present",
        calculatedHours: 0,
        isLate: false,
        isEarlyDeparture: false,
      },
      context,
    );
  }

  clockOut(employeeId: string, reading: GeoReading, context: ActorContext): AttendanceRecord {
    this.requireSelf(employeeId, context, "clock out");
    this.validateReading(reading);
    const now = this.now();
    const date = dateKey(now);
    const record = this.findOpenRecord(employeeId);
    if (!record) throw new Error("No open attendance record was found.");
    if (record.date !== date) {
      throw new Error(
        "This attendance record is from an earlier day. Submit a missed sign-out justification for manager and HR approval.",
      );
    }
    if (record.source === "Site Visit Auto") {
      throw new Error("Approved home-origin site visits are signed out automatically.");
    }
    const geofence = this.evaluateGeofence(reading);
    if (!geofence.allowed || !geofence.nearestLocation) {
      this.recordBlockedAttempt("clock_out_blocked", employeeId, reading, geofence, context);
      throw new Error(geofence.message);
    }
    return this.updateRecordInternal(
      record.id,
      {
        clockOut: timeKey(now),
        clockOutAt: now.toISOString(),
        clockOutLocationId: geofence.nearestLocation.id,
        clockOutCapturedLatitude: reading.latitude,
        clockOutCapturedLongitude: reading.longitude,
        clockOutCapturedAccuracyMeters: reading.accuracyMeters,
      },
      { ...context, reason: context.reason ?? "Employee office geofence clock-out" },
    );
  }

  getOpenRecord(employeeId: string, context: ActorContext): AttendanceRecord | null {
    this.requireEmployeeRead(employeeId, context, "view this employee's open attendance record");
    return this.findOpenRecord(employeeId) ?? null;
  }

  getMissedOpenRecord(employeeId: string, context: ActorContext): AttendanceRecord | null {
    this.requireEmployeeRead(employeeId, context, "view this employee's missed sign-out record");
    const today = dateKey(this.now());
    return (
      this.recordRepo
        .list()
        .filter(
          (record) =>
            record.employeeId === employeeId &&
            Boolean(record.clockIn) &&
            !record.clockOut &&
            record.date < today,
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
    );
  }

  calculateStatus(record: Partial<AttendanceRecord>, at = this.now()): AttendanceStatus {
    if (record.status === "Corrected" || record.status === "Correction Pending") {
      return record.status;
    }
    if (["On Leave", "Holiday", "Rest Day"].includes(record.status ?? "")) {
      return record.status!;
    }
    if (!record.clockIn && !record.clockOut) return "Absent";
    if (!record.clockIn && record.clockOut) return "Missing Punch";
    if (record.clockIn && !record.clockOut) {
      return record.date && record.date < dateKey(at) ? "Missing Punch" : "Present";
    }
    return record.isLate ? "Late" : "Present";
  }

  reconcileDailyStatus(
    employeeId: string,
    targetDate: string,
    context: ActorContext,
  ): Partial<AttendanceRecord> | null {
    this.requireEmployeeRead(employeeId, context, "reconcile this employee's attendance status");
    const existing = this.findRecord(employeeId, targetDate);
    if (existing) return null;
    const day = new Date(`${targetDate}T12:00:00`);
    if (Number.isNaN(day.getTime())) throw new Error("Invalid attendance date.");
    const settings = new SettingsService().getAppSettingsSync();
    if (!settings.workingDays.includes(day.getDay())) return { status: "Rest Day" };

    const holidays = getMasterDataRepository("publicHolidays")
      .list()
      .filter((holiday) => holiday.isActive);
    if (
      holidays.some((holiday) => {
        const structuredDate = (holiday as typeof holiday & { date?: string }).date;
        return (
          structuredDate === targetDate ||
          holiday.description === targetDate ||
          holiday.name.includes(targetDate)
        );
      })
    ) {
      return { status: "Holiday" };
    }

    const approvedLeave = new LeaveService()
      .getAllRequests(SYSTEM_CONTEXT)
      .some(
        (request) =>
          request.employeeId === employeeId &&
          (request.status === "Approved" || request.status === "Taken") &&
          targetDate >= request.startDate &&
          targetDate <= request.endDate,
      );
    return { status: approvedLeave ? "On Leave" : "Absent" };
  }

  ensureRecordForDate(
    employeeId: string,
    targetDate: string,
    context: ActorContext,
  ): AttendanceRecord {
    this.requireSelf(employeeId, context, "request an attendance correction");
    const existing = this.findRecord(employeeId, targetDate);
    if (existing) return existing;
    const status = this.reconcileDailyStatus(employeeId, targetDate, context)?.status ?? "Absent";
    if (["On Leave", "Holiday", "Rest Day"].includes(status)) {
      throw new Error(`${status} days cannot be changed through a punch correction.`);
    }
    const policy = this.getPolicy();
    return this.recordRepo.create(
      {
        employeeId,
        date: targetDate,
        expectedClockIn: policy.expectedClockIn,
        expectedClockOut: policy.expectedClockOut,
        breakMinutes: policy.defaultBreakMinutes,
        source: "Manual Entry",
        workMode: "Office",
        status: "Absent",
        calculatedHours: 0,
        isLate: false,
        isEarlyDeparture: false,
      },
      { ...context, reason: "Created missing daily record for correction request" },
    );
  }

  saveRecord(
    data: Omit<
      AttendanceRecord,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion"
    >,
    context: ActorContext,
  ): AttendanceRecord {
    if (data.source === "Web") {
      throw new Error("Web attendance must use the geofenced clock-in/out workflow.");
    }
    this.requireAdmin(context, "create attendance records");
    return this.createRecord(data, context);
  }

  updateRecord(
    id: string,
    data: Partial<AttendanceRecord>,
    context: ActorContext,
  ): AttendanceRecord {
    this.requireAdmin(context, "edit attendance records");
    const existing = this.recordRepo.getById(id);
    if (!existing) throw new Error("Attendance record was not found.");
    const employeeId = data.employeeId ?? existing.employeeId;
    const date = data.date ?? existing.date;
    const duplicate = this.recordRepo
      .list()
      .some(
        (record) => record.id !== id && record.employeeId === employeeId && record.date === date,
      );
    if (duplicate) {
      throw new Error("This employee already has an attendance record for the selected date.");
    }
    return this.updateRecordInternal(id, data, context);
  }

  async requestCorrection(
    recordId: string,
    proposedIn: string,
    proposedOut: string,
    explanation: string,
    context: ActorContext,
    evidenceFileId?: string,
  ): Promise<AttendanceCorrection> {
    const record = this.recordRepo.getById(recordId);
    if (!record) throw new Error("Attendance record was not found.");
    this.requireSelf(record.employeeId, context, "request this correction");
    if (explanation.trim().length < 5) throw new Error("A detailed explanation is required.");
    if (proposedIn) parseMinutes(proposedIn);
    if (proposedOut) parseMinutes(proposedOut);
    if (!proposedIn && !proposedOut) throw new Error("At least one proposed punch is required.");
    if (evidenceFileId) {
      const metadata = await getApplicationDataServices().files.getMetadata(evidenceFileId);
      if (
        !metadata ||
        metadata.owner.entityType !== "attendance-record" ||
        metadata.owner.entityId !== recordId
      ) {
        throw new Error("The uploaded evidence could not be verified. Please attach it again.");
      }
    }
    const openCorrection = this.correctionRepo
      .list()
      .find(
        (correction) =>
          correction.attendanceRecordId === recordId &&
          ["Pending Manager", "Pending HR"].includes(correction.status),
      );
    if (openCorrection) throw new Error("A correction is already pending for this record.");

    const employee = new EmployeeService().getById(record.employeeId, SYSTEM_CONTEXT);
    const correction = this.correctionRepo.create(
      {
        attendanceRecordId: recordId,
        employeeId: record.employeeId,
        correctionType:
          !record.clockOut && record.date < dateKey(this.now())
            ? "Missed Sign-out"
            : "Punch Correction",
        originalClockIn: record.clockIn,
        originalClockOut: record.clockOut,
        originalStatus: this.deriveStatus(record),
        proposedClockIn: proposedIn || undefined,
        proposedClockOut: proposedOut || undefined,
        explanation: explanation.trim(),
        evidenceFileId,
        status: employee?.lineManagerId ? "Pending Manager" : "Pending HR",
      },
      context,
    );
    this.recordRepo.update(
      record.id,
      { status: "Correction Pending" },
      { ...context, reason: "Attendance correction submitted" },
    );
    this.notifyCorrectionReviewer(correction, employee?.lineManagerId, context);
    return correction;
  }

  managerApproveCorrection(
    correctionId: string,
    context: ActorContext,
    notes = "Endorsed by line manager",
  ): AttendanceCorrection {
    return this.managerReviewCorrection(correctionId, true, notes, context);
  }

  managerRejectCorrection(
    correctionId: string,
    notes: string,
    context: ActorContext,
  ): AttendanceCorrection {
    return this.managerReviewCorrection(correctionId, false, notes, context);
  }

  hrFinaliseCorrection(
    correctionId: string,
    approve: boolean,
    notes: string,
    context: ActorContext,
  ): AttendanceCorrection {
    this.requireAdmin(context, "finalise attendance corrections");
    const storedCorrection = this.correctionRepo.getById(correctionId);
    const correction = storedCorrection ? this.normaliseCorrection(storedCorrection) : null;
    if (!correction) throw new Error("Correction was not found.");
    if (correction.status !== "Pending HR") throw new Error("Correction is not awaiting HR.");
    if (notes.trim().length < 3) throw new Error("HR decision notes are required.");
    const record = this.recordRepo.getById(correction.attendanceRecordId);
    if (!record) throw new Error("The underlying attendance record was not found.");

    if (approve) {
      this.updateRecordInternal(
        record.id,
        {
          clockIn: correction.proposedClockIn ?? record.clockIn,
          clockOut: correction.proposedClockOut ?? record.clockOut,
          status: "Corrected",
        },
        { ...context, reason: notes.trim() },
      );
    } else {
      this.recordRepo.update(
        record.id,
        { status: correction.originalStatus },
        { ...context, reason: notes.trim() },
      );
    }
    const updated = this.correctionRepo.update(
      correction.id,
      {
        status: approve ? "Approved" : "Rejected",
        hrNotes: notes.trim(),
        hrReviewedBy: context.actor.userId,
        hrReviewedAt: this.now().toISOString(),
      },
      { ...context, reason: notes.trim() },
    );
    this.notifyEmployee(
      correction.employeeId,
      approve ? "Attendance correction approved" : "Attendance correction rejected",
      approve
        ? "Your corrected attendance punches have been applied."
        : `Your attendance correction was rejected: ${notes.trim()}`,
      `attendance-correction-${correction.id}-${updated.status}`,
      "/staff/me/attendance",
      context,
    );
    return updated;
  }

  requestSiteVisit(
    input: Pick<
      SiteVisitRequest,
      "employeeId" | "date" | "startTime" | "endTime" | "origin" | "destination" | "purpose"
    > & { projectId?: string | undefined },
    context: ActorContext,
  ): SiteVisitRequest {
    this.requireSelf(input.employeeId, context, "request this site visit");
    if (input.destination.trim().length < 2 || input.purpose.trim().length < 5) {
      throw new Error("Destination and a detailed business purpose are required.");
    }
    const start = localDateTime(input.date, input.startTime);
    const end = localDateTime(input.date, input.endTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new Error("Site visit end time must be after its start time.");
    }
    if (input.date < dateKey(this.now()))
      throw new Error("A site visit cannot be requested in the past.");
    const overlapping = this.siteVisitRepo
      .list()
      .find(
        (visit) =>
          visit.employeeId === input.employeeId &&
          visit.date === input.date &&
          !["Rejected", "Cancelled"].includes(visit.status) &&
          localDateTime(visit.date, visit.startTime) < end &&
          localDateTime(visit.date, visit.endTime) > start,
      );
    if (overlapping) throw new Error("An active site visit already overlaps this time.");
    const visit = this.siteVisitRepo.create(
      {
        ...input,
        destination: input.destination.trim(),
        purpose: input.purpose.trim(),
        status: "Pending HR",
        requestedAt: this.now().toISOString(),
      },
      context,
    );
    this.notifyHr(
      "Site visit approval required",
      `${context.actor.displayName} requested a ${input.origin.toLowerCase()}-origin visit to ${input.destination}.`,
      `site-visit-hr-${visit.id}`,
      "/staff/attendance",
      context,
    );
    return visit;
  }

  getSiteVisitsForEmployee(employeeId: string, context: ActorContext): SiteVisitRequest[] {
    this.requireEmployeeRead(employeeId, context, "view this employee's site visits");
    return this.siteVisitRepo
      .list()
      .filter((visit) => visit.employeeId === employeeId)
      .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
  }

  getAllSiteVisits(context: ActorContext): SiteVisitRequest[] {
    this.requireAdmin(context, "view all site visits");
    return this.siteVisitRepo
      .list()
      .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
  }

  reviewSiteVisit(
    id: string,
    approve: boolean,
    notes: string,
    context: ActorContext,
  ): SiteVisitRequest {
    this.requireAdmin(context, "review site visits");
    const visit = this.siteVisitRepo.getById(id);
    if (!visit) throw new Error("Site visit request was not found.");
    if (visit.status !== "Pending HR") throw new Error("Site visit is not awaiting HR review.");
    if (notes.trim().length < 3) throw new Error("HR decision notes are required.");
    const updated = this.siteVisitRepo.update(
      id,
      {
        status: approve ? "Approved" : "Rejected",
        hrReviewedBy: context.actor.userId,
        hrReviewedAt: this.now().toISOString(),
        hrNotes: notes.trim(),
      },
      { ...context, reason: notes.trim() },
    );
    this.notifyEmployee(
      visit.employeeId,
      approve ? "Site visit approved" : "Site visit rejected",
      approve
        ? `${visit.destination} is approved. ${visit.origin === "Home" ? "Attendance will clock in and out automatically at the approved times." : "Clock in at the office before leaving; the approved visit will close attendance at the scheduled end."}`
        : `The request was rejected: ${notes.trim()}`,
      `site-visit-${visit.id}-${updated.status}`,
      "/staff/me/attendance",
      context,
    );
    return updated;
  }

  cancelSiteVisit(id: string, context: ActorContext): SiteVisitRequest {
    const visit = this.siteVisitRepo.getById(id);
    if (!visit) throw new Error("Site visit request was not found.");
    this.requireSelf(visit.employeeId, context, "cancel this site visit");
    if (!["Pending HR", "Approved"].includes(visit.status)) {
      throw new Error("This site visit can no longer be cancelled.");
    }
    if (localDateTime(visit.date, visit.startTime) <= this.now()) {
      throw new Error("A site visit cannot be cancelled after it starts. Contact HR.");
    }
    return this.siteVisitRepo.update(id, { status: "Cancelled" }, context);
  }

  reconcileSiteVisits(at = this.now()): { created: number; completed: number; exceptions: number } {
    let created = 0;
    let completed = 0;
    let exceptions = 0;
    const systemContext: ActorContext = {
      actor: {
        userId: "system",
        displayName: "VIA HR System",
        activeRole: "Super Admin",
        roles: ["Super Admin"],
      },
      reason: "Scheduled approved site-visit attendance reconciliation",
    };
    for (const visit of this.siteVisitRepo.list().filter((item) => item.status === "Approved")) {
      const start = localDateTime(visit.date, visit.startTime);
      const end = localDateTime(visit.date, visit.endTime);
      if (at < start) continue;
      let record = visit.attendanceRecordId
        ? this.recordRepo.getById(visit.attendanceRecordId)
        : this.findRecord(visit.employeeId, visit.date);

      if (visit.origin === "Home" && !record) {
        const policy = this.getPolicy();
        record = this.createRecord(
          {
            employeeId: visit.employeeId,
            date: visit.date,
            expectedClockIn: visit.startTime,
            expectedClockOut: visit.endTime,
            clockIn: visit.startTime,
            clockInAt: start.toISOString(),
            breakMinutes: policy.defaultBreakMinutes,
            location: visit.destination,
            source: "Site Visit Auto",
            workMode: "Approved Site Visit",
            siteVisitId: visit.id,
            status: "Present",
            calculatedHours: 0,
            isLate: false,
            isEarlyDeparture: false,
          },
          systemContext,
        );
        this.siteVisitRepo.update(visit.id, { attendanceRecordId: record.id }, systemContext);
        created += 1;
      }

      if (visit.origin === "Office" && record && !record.siteVisitId) {
        record = this.updateRecordInternal(
          record.id,
          { siteVisitId: visit.id, workMode: "Approved Site Visit" },
          systemContext,
        );
        this.siteVisitRepo.update(visit.id, { attendanceRecordId: record.id }, systemContext);
      }

      if (at >= end) {
        if (record?.clockIn) {
          if (!record.clockOut) {
            record = this.updateRecordInternal(
              record.id,
              { clockOut: visit.endTime, clockOutAt: end.toISOString() },
              systemContext,
            );
          }
          this.siteVisitRepo.update(
            visit.id,
            { status: "Completed", attendanceRecordId: record.id },
            systemContext,
          );
          completed += 1;
        } else {
          exceptions += 1;
          const alreadyCased = this.exceptionRepo
            .list()
            .some((item) => item.siteVisitId === visit.id);
          if (!alreadyCased) {
            this.exceptionRepo.create(
              {
                employeeId: visit.employeeId,
                type: "Site Visit No Clock-In",
                siteVisitId: visit.id,
                date: visit.date,
                destination: visit.destination,
                status: "Open",
              },
              systemContext,
            );
          }
          this.notifyHr(
            "Site visit attendance exception",
            `An office-origin site visit to ${visit.destination} ended without an office clock-in.`,
            `site-visit-exception-${visit.id}`,
            "/staff/attendance",
            systemContext,
          );
        }
      }
    }
    return { created, completed, exceptions };
  }

  getExceptionCases(context: ActorContext): AttendanceExceptionCase[] {
    this.requireAdmin(context, "view attendance exception cases");
    return this.exceptionRepo.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  assignExceptionCase(id: string, ownerId: string, context: ActorContext): AttendanceExceptionCase {
    this.requireAdmin(context, "assign attendance exception cases");
    const item = this.exceptionRepo.getById(id);
    if (!item) throw new Error("Exception case was not found.");
    if (item.status === "Resolved") throw new Error("This case is already resolved.");
    return this.exceptionRepo.update(
      id,
      { ownerId, status: item.status === "Open" ? "Investigating" : item.status },
      context,
    );
  }

  updateExceptionCaseNotes(
    id: string,
    investigationNotes: string,
    context: ActorContext,
  ): AttendanceExceptionCase {
    this.requireAdmin(context, "update attendance exception cases");
    const item = this.exceptionRepo.getById(id);
    if (!item) throw new Error("Exception case was not found.");
    if (item.status === "Resolved") throw new Error("This case is already resolved.");
    return this.exceptionRepo.update(
      id,
      { investigationNotes, status: item.status === "Open" ? "Investigating" : item.status },
      context,
    );
  }

  resolveExceptionCase(
    id: string,
    resolutionNotes: string,
    context: ActorContext,
  ): AttendanceExceptionCase {
    this.requireAdmin(context, "resolve attendance exception cases");
    const item = this.exceptionRepo.getById(id);
    if (!item) throw new Error("Exception case was not found.");
    if (item.status === "Resolved") throw new Error("This case is already resolved.");
    if (!resolutionNotes || resolutionNotes.trim().length < 5) {
      throw new Error("Resolution notes are required to close an exception case.");
    }
    const resolved = this.exceptionRepo.update(
      id,
      {
        status: "Resolved" as AttendanceExceptionStatus,
        resolutionNotes: resolutionNotes.trim(),
        resolvedBy: context.actor.userId,
        resolvedAt: this.now().toISOString(),
      },
      context,
    );
    // resolutionNotes is HR's internal investigation record (see AttendanceExceptionCase's own
    // doc comment) and must never be echoed verbatim to the employee it concerns - it can
    // legitimately contain things like suspected falsification or comparisons to other staff.
    // The employee gets a plain closure notice, not the notes themselves.
    this.notifyEmployee(
      item.employeeId,
      "Attendance exception resolved",
      `Your site visit to ${item.destination} on ${item.date} has been reviewed by HR and the case is now closed.`,
      `attendance-exception-resolved-${item.id}`,
      "/staff/me/attendance",
      context,
    );
    return resolved;
  }

  reconcileSignOutReminders(at = this.now()): number {
    const { storage, notifications } = getApplicationDataServices();
    const users = storage.readCollection<User>("users");
    const existingKeys = new Set(
      notifications
        .list()
        .map((notification) => notification.deduplicationKey)
        .filter(Boolean),
    );
    const policy = this.getPolicy();
    let created = 0;
    for (const record of this.recordRepo
      .list()
      .filter((item) => item.clockInAt && !item.clockOut && item.date === dateKey(at))) {
      if (record.source === "Site Visit Auto") continue;
      const user = users.find((item) => item.employeeId === record.employeeId);
      if (!user) continue;
      const completionTime =
        new Date(record.clockInAt!).getTime() +
        (policy.standardDailyHours * 60 + record.breakMinutes) * 60_000;
      policy.signOutReminderOffsetsMinutes.forEach((offset, index) => {
        const due = completionTime + offset * 60_000;
        const key = `attendance-sign-out-${record.id}-${index + 1}`;
        if (at.getTime() >= due && !existingKeys.has(key)) {
          notifications.create(
            {
              recipientUserId: user.id,
              type: "attendance.sign_out_reminder",
              title: `Sign-out reminder ${index + 1} of 3`,
              message:
                index === 0
                  ? `You have completed ${policy.standardDailyHours} working hours. Remember to sign out before leaving the office.`
                  : `Your attendance is still open. Please sign out from the office geofence to avoid a missing punch.`,
              priority: index === 2 ? "High" : "Normal",
              status: "Unread",
              dueAt: new Date(due).toISOString(),
              deduplicationKey: key,
              link: { entityType: "attendance", entityId: record.id, path: "/staff/me/attendance" },
            },
            {
              actor: {
                userId: "system",
                displayName: "VIA HR System",
                activeRole: "Super Admin",
                roles: ["Super Admin"],
              },
            },
          );
          existingKeys.add(key);
          created += 1;
        }
      });
    }
    return created;
  }

  previewCsv(text: string): AttendanceImportPreview {
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim());
    if (lines.length < 2)
      return { validRows: [], errors: [{ row: 1, message: "CSV has no data rows." }] };
    const headers = parseCsvLine(lines[0]!).map((header) =>
      header.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    const find = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
    const indexes = {
      employee: find("employeeid", "employeenumber", "workemail", "email"),
      date: find("date", "attendancedate"),
      clockIn: find("clockin", "intime", "checkin"),
      clockOut: find("clockout", "outtime", "checkout"),
      breakMinutes: find("breakminutes", "break"),
      location: find("location", "site"),
    };
    if (indexes.employee < 0 || indexes.date < 0) {
      return {
        validRows: [],
        errors: [{ row: 1, message: "CSV requires Employee ID/Number/Email and Date columns." }],
      };
    }
    const employees = new EmployeeService().getEmployees(SYSTEM_CONTEXT);
    const validRows: AttendanceImportRow[] = [];
    const errors: AttendanceImportPreview["errors"] = [];
    lines.slice(1).forEach((line, offset) => {
      const rowNumber = offset + 2;
      const values = parseCsvLine(line);
      const identifier = values[indexes.employee]?.trim().toLowerCase();
      const employee = employees.find(
        (item) =>
          item.id.toLowerCase() === identifier ||
          item.employeeNumber.toLowerCase() === identifier ||
          item.workEmail.toLowerCase() === identifier,
      );
      const date = values[indexes.date]?.trim() ?? "";
      const clockIn = indexes.clockIn >= 0 ? values[indexes.clockIn]?.trim() : undefined;
      const clockOut = indexes.clockOut >= 0 ? values[indexes.clockOut]?.trim() : undefined;
      try {
        if (!employee) throw new Error(`Unknown employee: ${identifier || "blank"}.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must use YYYY-MM-DD.");
        if (clockIn) parseMinutes(clockIn);
        if (clockOut) parseMinutes(clockOut);
        const breakMinutes =
          indexes.breakMinutes >= 0
            ? Number(values[indexes.breakMinutes] || 0)
            : this.getPolicy().defaultBreakMinutes;
        if (!Number.isFinite(breakMinutes) || breakMinutes < 0 || breakMinutes > 360) {
          throw new Error("Break Minutes must be between 0 and 360.");
        }
        validRows.push({
          employeeId: employee.id,
          date,
          clockIn: clockIn || undefined,
          clockOut: clockOut || undefined,
          breakMinutes,
          location:
            indexes.location >= 0 ? values[indexes.location]?.trim() || undefined : undefined,
          source: "Import",
        });
      } catch (error) {
        errors.push({
          row: rowNumber,
          message: error instanceof Error ? error.message : "Invalid row.",
        });
      }
    });
    return { validRows, errors };
  }

  importRows(rows: AttendanceImportRow[], context: ActorContext): AttendanceRecord[] {
    this.requireAdmin(context, "import attendance");
    const duplicates = new Set<string>();
    rows.forEach((row) => {
      const key = `${row.employeeId}:${row.date}`;
      if (duplicates.has(key) || this.findRecord(row.employeeId, row.date)) {
        throw new Error(`Duplicate attendance row for ${row.employeeId} on ${row.date}.`);
      }
      if (!Number.isFinite(row.breakMinutes) || row.breakMinutes < 0 || row.breakMinutes > 360) {
        throw new Error(`Invalid break minutes for ${row.employeeId} on ${row.date}.`);
      }
      if (row.clockIn) parseMinutes(row.clockIn);
      if (row.clockOut) parseMinutes(row.clockOut);
      duplicates.add(key);
    });
    const policy = this.getPolicy();
    const preparedRows: NewRecord<AttendanceRecord>[] = rows.map((row) => ({
      ...row,
      expectedClockIn: row.expectedClockIn ?? policy.expectedClockIn,
      expectedClockOut: row.expectedClockOut ?? policy.expectedClockOut,
      workMode: "Office",
      status: "Present",
      calculatedHours: 0,
      isLate: false,
      isEarlyDeparture: false,
    }));
    preparedRows.forEach((row) => this.calculateMetrics(row));
    return preparedRows.map((row) =>
      this.createRecord(row, {
        ...context,
        reason: context.reason ?? "Validated attendance CSV import",
      }),
    );
  }

  exportCsv(date: string, context: ActorContext): string {
    this.requireAdmin(context, "export attendance records");
    const records = this.recordRepo.list().filter((record) => record.date === date);

    getApplicationDataServices().audit.record({
      context,
      action: "attendance_data_export",
      module: "attendance",
      entityType: "attendance_record",
      entityId: date,
      reason: `Exported ${records.length} attendance record(s) for ${date}.`,
      riskLevel: "Medium",
    });

    const headers = [
      "Employee ID",
      "Date",
      "Status",
      "Clock In",
      "Clock Out",
      "Break Minutes",
      "Worked Hours",
      "Location",
      "Source",
      "Work Mode",
    ];
    return [
      headers.join(","),
      ...records.map((record) =>
        [
          record.employeeId,
          record.date,
          record.status,
          record.clockIn,
          record.clockOut,
          record.breakMinutes,
          record.calculatedHours,
          record.location,
          record.source,
          record.workMode,
        ]
          .map(escapeCsv)
          .join(","),
      ),
    ].join("\n");
  }

  getMonthlySummary(employeeId: string, month: string, context: ActorContext) {
    const records = this.getRecordsForEmployee(employeeId, context).filter((record) =>
      record.date.startsWith(month),
    );
    return {
      present: records.filter((record) => ["Present", "Corrected"].includes(record.status)).length,
      late: records.filter((record) => record.status === "Late" || record.isLate).length,
      absent: records.filter((record) => record.status === "Absent").length,
      missingPunch: records.filter((record) => record.status === "Missing Punch").length,
      hours: Number(records.reduce((sum, record) => sum + record.calculatedHours, 0).toFixed(2)),
    };
  }

  private createRecord(data: NewRecord<AttendanceRecord>, context: ActorContext): AttendanceRecord {
    if (!new EmployeeService().getById(data.employeeId, SYSTEM_CONTEXT)) {
      throw new Error("Attendance employee was not found.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      throw new Error("Attendance date must use YYYY-MM-DD.");
    }
    if (!Number.isFinite(data.breakMinutes) || data.breakMinutes < 0 || data.breakMinutes > 360) {
      throw new Error("Break minutes must be between 0 and 360.");
    }
    if (this.findRecord(data.employeeId, data.date)) {
      throw new Error(`Attendance already exists for this employee on ${data.date}.`);
    }
    const metrics = this.calculateMetrics(data);
    const prepared = {
      ...data,
      ...metrics,
    } as NewRecord<AttendanceRecord>;
    prepared.status = this.calculateStatus(prepared);
    return this.recordRepo.create(prepared, context);
  }

  private updateRecordInternal(
    id: string,
    changes: Partial<AttendanceRecord>,
    context: ActorContext,
  ): AttendanceRecord {
    const existing = this.recordRepo.getById(id);
    if (!existing) throw new Error("Attendance record was not found.");
    const merged = { ...existing, ...changes };
    const metrics = this.calculateMetrics(merged);
    const next = { ...changes, ...metrics };
    next.status = changes.status ?? this.deriveStatus({ ...merged, ...metrics });
    return this.recordRepo.update(id, next, context);
  }

  private calculateMetrics(record: Partial<AttendanceRecord>) {
    const policy = this.getPolicy();
    let calculatedHours = 0;
    if (record.clockIn && record.clockOut) {
      const clockIn = parseMinutes(record.clockIn);
      let clockOut = parseMinutes(record.clockOut);
      if (clockOut <= clockIn) clockOut += 24 * 60;
      const workedMinutes = clockOut - clockIn - Math.max(0, record.breakMinutes ?? 0);
      if (workedMinutes < 0 || workedMinutes > 24 * 60) {
        throw new Error("Clock times and break produce an invalid worked duration.");
      }
      calculatedHours = Number((workedMinutes / 60).toFixed(2));
    }
    const expectedIn = record.expectedClockIn ?? policy.expectedClockIn;
    const expectedOut = record.expectedClockOut ?? policy.expectedClockOut;
    const isLate = Boolean(
      record.clockIn &&
      parseMinutes(record.clockIn) > parseMinutes(expectedIn) + policy.lateGraceMinutes,
    );
    const isEarlyDeparture = Boolean(
      record.clockOut && parseMinutes(record.clockOut) < parseMinutes(expectedOut),
    );
    return { calculatedHours, isLate, isEarlyDeparture };
  }

  private deriveStatus(record: Partial<AttendanceRecord>): AttendanceStatus {
    if (record.status === "Correction Pending" || record.status === "Corrected") {
      const { status: _workflowStatus, ...withoutWorkflowStatus } = record;
      return this.calculateStatus(withoutWorkflowStatus);
    }
    return this.calculateStatus(record);
  }

  private presentRecord(record: AttendanceRecord): AttendanceRecord {
    return { ...record, status: this.deriveStatus(record) };
  }

  private managerReviewCorrection(
    correctionId: string,
    approve: boolean,
    notes: string,
    context: ActorContext,
  ): AttendanceCorrection {
    this.requireRole(context, ["Line Manager", "HR", "Super Admin"], "review this correction");
    if (notes.trim().length < 3) throw new Error("Manager decision notes are required.");
    const storedCorrection = this.correctionRepo.getById(correctionId);
    const correction = storedCorrection ? this.normaliseCorrection(storedCorrection) : null;
    if (!correction) throw new Error("Correction was not found.");
    if (correction.status !== "Pending Manager")
      throw new Error("Correction is not awaiting a manager.");
    const employee = new EmployeeService().getById(correction.employeeId, SYSTEM_CONTEXT);
    if (
      !["HR", "Super Admin"].includes(effectiveRole(context) ?? "") &&
      (!context.actor.employeeId || employee?.lineManagerId !== context.actor.employeeId)
    ) {
      this.recordDenied("correction_review_denied", correction.id, context);
      throw new Error("Only the employee's assigned line manager can review this correction.");
    }
    if (!approve) {
      const record = this.recordRepo.getById(correction.attendanceRecordId);
      if (record) {
        this.recordRepo.update(
          record.id,
          { status: correction.originalStatus },
          { ...context, reason: notes.trim() },
        );
      }
    }
    const updated = this.correctionRepo.update(
      correction.id,
      {
        status: approve ? "Pending HR" : "Rejected",
        managerNotes: notes.trim(),
        managerReviewedBy: context.actor.userId,
        managerReviewedAt: this.now().toISOString(),
      },
      { ...context, reason: notes.trim() },
    );
    if (approve) {
      this.notifyHr(
        "Attendance correction awaiting HR",
        `${context.actor.displayName} endorsed an attendance correction.`,
        `attendance-correction-hr-${correction.id}`,
        "/staff/attendance/corrections",
        context,
      );
    } else {
      this.notifyEmployee(
        correction.employeeId,
        "Attendance correction rejected by manager",
        notes.trim(),
        `attendance-correction-manager-rejected-${correction.id}`,
        "/staff/me/attendance",
        context,
      );
    }
    return updated;
  }

  private findRecord(employeeId: string, targetDate: string): AttendanceRecord | undefined {
    return this.recordRepo
      .list()
      .find((record) => record.employeeId === employeeId && record.date === targetDate);
  }

  private normaliseCorrection(correction: AttendanceCorrection): AttendanceCorrection {
    const record = this.recordRepo.getById(correction.attendanceRecordId);
    return {
      ...correction,
      employeeId: correction.employeeId ?? record?.employeeId ?? "unknown-employee",
      correctionType:
        correction.correctionType ??
        (!correction.originalClockOut && record?.date && record.date < dateKey(this.now())
          ? "Missed Sign-out"
          : "Punch Correction"),
      originalStatus: correction.originalStatus ?? (record ? this.deriveStatus(record) : "Absent"),
    };
  }

  private findOpenRecord(employeeId: string): AttendanceRecord | undefined {
    return this.recordRepo
      .list()
      .filter((record) => record.employeeId === employeeId && record.clockIn && !record.clockOut)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }

  private getApprovedSiteVisit(employeeId: string, date: string, origin: "Office" | "Home") {
    return this.siteVisitRepo
      .list()
      .find(
        (visit) =>
          visit.employeeId === employeeId &&
          visit.date === date &&
          visit.origin === origin &&
          visit.status === "Approved",
      );
  }

  private validateReading(reading: GeoReading): void {
    if (
      !Number.isFinite(reading.latitude) ||
      reading.latitude < -90 ||
      reading.latitude > 90 ||
      !Number.isFinite(reading.longitude) ||
      reading.longitude < -180 ||
      reading.longitude > 180 ||
      !Number.isFinite(reading.accuracyMeters) ||
      reading.accuracyMeters < 0
    ) {
      throw new Error("The browser returned an invalid location reading.");
    }
  }

  private requireSelf(employeeId: string, context: ActorContext, action: string): void {
    if (context.actor.employeeId === employeeId) return;
    this.recordDenied("self_scope_denied", employeeId, context);
    throw new Error(`You are not authorised to ${action} for another employee.`);
  }

  private requireEmployeeRead(employeeId: string, context: ActorContext, action: string): void {
    if (context.actor.employeeId === employeeId || roleIs(context, ADMIN_ROLES)) return;
    if (effectiveRole(context) === "Line Manager" && context.actor.employeeId) {
      const employee = new EmployeeService().getById(employeeId, SYSTEM_CONTEXT);
      if (employee?.lineManagerId === context.actor.employeeId) return;
    }
    this.recordDenied("attendance_read_denied", employeeId, context);
    throw new Error(`You are not authorised to ${action}.`);
  }

  private requireAdmin(context: ActorContext, action: string): void {
    this.requireRole(context, ADMIN_ROLES, action);
  }

  private requireRole(context: ActorContext, roles: readonly Role[], action: string): void {
    if (roleIs(context, roles)) return;
    this.recordDenied("attendance_access_denied", action, context);
    throw new Error(`Your active role is not authorised to ${action}.`);
  }

  private recordDenied(action: string, entityId: string, context: ActorContext): void {
    getApplicationDataServices().audit.record({
      context,
      action,
      module: "attendance",
      entityType: "access-control",
      entityId,
      riskLevel: "High",
    });
  }

  private recordBlockedAttempt(
    action: string,
    employeeId: string,
    reading: GeoReading,
    result: GeofenceResult,
    context: ActorContext,
  ): void {
    getApplicationDataServices().audit.record({
      context,
      action,
      module: "attendance",
      entityType: "geofence-attempt",
      entityId: employeeId,
      after: {
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracyMeters: reading.accuracyMeters,
        nearestLocationId: result.nearestLocation?.id,
        distanceMeters: result.distanceMeters,
        shortfallMeters: result.shortfallMeters,
      },
      reason: result.message,
      riskLevel: "Medium",
    });
  }

  private notifyCorrectionReviewer(
    correction: AttendanceCorrection,
    managerEmployeeId: string | undefined,
    context: ActorContext,
  ): void {
    if (!managerEmployeeId) {
      this.notifyHr(
        "Attendance correction awaiting HR",
        `${context.actor.displayName} submitted an attendance correction without an assigned manager.`,
        `attendance-correction-hr-${correction.id}`,
        "/staff/attendance/corrections",
        context,
      );
      return;
    }
    const { storage, notifications } = getApplicationDataServices();
    const managerUser = storage
      .readCollection<User>("users")
      .find((user) => user.employeeId === managerEmployeeId);
    if (!managerUser) return;
    notifications.create(
      {
        recipientUserId: managerUser.id,
        type: "attendance.correction",
        title: "Attendance correction requires review",
        message: `${context.actor.displayName} submitted a correction request.`,
        priority: "Normal",
        status: "Unread",
        deduplicationKey: `attendance-correction-manager-${correction.id}`,
        link: {
          entityType: "attendance-correction",
          entityId: correction.id,
          path: "/staff/attendance/corrections",
        },
      },
      context,
    );
  }

  private notifyHr(
    title: string,
    message: string,
    deduplicationKey: string,
    path: string,
    context: ActorContext,
  ): void {
    const { storage, notifications } = getApplicationDataServices();
    storage
      .readCollection<User>("users")
      .filter((user) => user.roles.includes("HR") || user.roles.includes("Super Admin"))
      .forEach((user) =>
        notifications.create(
          {
            recipientUserId: user.id,
            type: "attendance.approval",
            title,
            message,
            priority: "Normal",
            status: "Unread",
            deduplicationKey: `${deduplicationKey}-${user.id}`,
            link: { entityType: "attendance", entityId: deduplicationKey, path },
          },
          context,
        ),
      );
  }

  private notifyEmployee(
    employeeId: string,
    title: string,
    message: string,
    deduplicationKey: string,
    path: string,
    context: ActorContext,
  ): void {
    const { storage, notifications } = getApplicationDataServices();
    const user = storage
      .readCollection<User>("users")
      .find((item) => item.employeeId === employeeId);
    if (!user) return;
    notifications.create(
      {
        recipientUserId: user.id,
        type: "attendance.decision",
        title,
        message,
        priority: "Normal",
        status: "Unread",
        deduplicationKey,
        link: { entityType: "attendance", entityId: deduplicationKey, path },
      },
      context,
    );
  }
}
