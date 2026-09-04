import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { mutableRecordColumns } from "./common.ts";
import { fileMetadata } from "./documents.ts";
import { employees, users } from "./employee.ts";
import { activityCodes, costCentres, locations, projects } from "./master-data.ts";
import { organisations } from "./organisation.ts";
import { payrollPeriods } from "./travel-payroll.ts";

export const timesheetSettings = pgTable(
  "timesheet_settings",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    weeklyPeriodStartDay: integer("weekly_period_start_day").notNull(),
    standardDailyHours: numeric("standard_daily_hours", { precision: 5, scale: 2 }).notNull(),
    submissionDeadlineDays: integer("submission_deadline_days").notNull(),
    overtimeThresholdWeekly: numeric("overtime_threshold_weekly", {
      precision: 6,
      scale: 2,
    }).notNull(),
    allowCopyPreviousWeek: boolean("allow_copy_previous_week").notNull().default(true),
    payrollLockBehaviour: text("payroll_lock_behaviour").notNull(),
    requireHrOvertimeVerification: boolean("require_hr_overtime_verification")
      .notNull()
      .default(true),
    overtimePreauthorisationRequired: boolean("overtime_preauthorisation_required")
      .notNull()
      .default(true),
    overtimeMaxDailyHours: numeric("overtime_max_daily_hours", { precision: 5, scale: 2 })
      .notNull()
      .default("4"),
    overtimeMaxWeeklyHours: numeric("overtime_max_weekly_hours", { precision: 6, scale: 2 })
      .notNull()
      .default("12"),
    overtimeMaxMonthlyHours: numeric("overtime_max_monthly_hours", { precision: 7, scale: 2 })
      .notNull()
      .default("40"),
    attendanceVarianceToleranceHours: numeric("attendance_variance_tolerance_hours", {
      precision: 5,
      scale: 2,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("timesheet_settings_org_unique").on(table.organisationId),
    check("timesheet_settings_start_day_range", sql`${table.weeklyPeriodStartDay} BETWEEN 0 AND 6`),
    check(
      "timesheet_settings_daily_hours_range",
      sql`${table.standardDailyHours} > 0 AND ${table.standardDailyHours} <= 24`,
    ),
    check("timesheet_settings_deadline_non_negative", sql`${table.submissionDeadlineDays} >= 0`),
    check(
      "timesheet_settings_overtime_range",
      sql`${table.overtimeThresholdWeekly} > 0 AND ${table.overtimeThresholdWeekly} <= 168`,
    ),
    check(
      "timesheet_settings_lock_behaviour",
      sql`${table.payrollLockBehaviour} IN ('Manual by HR', 'Automatic on Approval')`,
    ),
    check(
      "timesheet_settings_tolerance_non_negative",
      sql`${table.attendanceVarianceToleranceHours} >= 0`,
    ),
    check(
      "timesheet_settings_overtime_limits_positive",
      sql`${table.overtimeMaxDailyHours} > 0 AND ${table.overtimeMaxWeeklyHours} > 0 AND ${table.overtimeMaxMonthlyHours} > 0`,
    ),
  ],
);

export const timesheetPeriodStatus = pgEnum("timesheet_period_status", ["Open", "Closed"]);
export const timesheetPeriods = pgTable(
  "timesheet_periods",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: timesheetPeriodStatus("status").notNull().default("Open"),
  },
  (table) => [
    uniqueIndex("timesheet_periods_org_dates_unique").on(
      table.organisationId,
      table.startDate,
      table.endDate,
    ),
    index("timesheet_periods_org_status_idx").on(table.organisationId, table.status),
    check("timesheet_periods_date_order", sql`${table.endDate} >= ${table.startDate}`),
  ],
);

export const timesheetStatus = pgEnum("timesheet_status", [
  "Draft",
  "Pending Manager",
  "Pending HR",
  "Returned",
  "Approved",
  "Payroll Locked",
  "Corrected",
]);

export const timesheets = pgTable(
  "timesheets",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    periodId: uuid("period_id")
      .notNull()
      .references(() => timesheetPeriods.id, { onDelete: "restrict" }),
    status: timesheetStatus("status").notNull().default("Draft"),
    expectedHours: numeric("expected_hours", { precision: 8, scale: 2 }).notNull(),
    totalHours: numeric("total_hours", { precision: 8, scale: 2 }).notNull().default("0"),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    supervisorReviewedAt: timestamp("supervisor_reviewed_at", {
      withTimezone: true,
      mode: "string",
    }),
    supervisorReviewedBy: uuid("supervisor_reviewed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    managerNotes: text("manager_notes"),
    draftPayload: jsonb("draft_payload"),
    attendanceDiscrepancyExplanations: jsonb("attendance_discrepancy_explanations"),
    attendanceReconciliationSnapshot: jsonb("attendance_reconciliation_snapshot"),
    payrollPeriodId: uuid("payroll_period_id").references(() => payrollPeriods.id, {
      onDelete: "restrict",
    }),
    originalTimesheetId: uuid("original_timesheet_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => timesheets.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    uniqueIndex("timesheets_employee_period_unique")
      .on(table.employeeId, table.periodId)
      .where(sql`${table.archivedAt} IS NULL`),
    index("timesheets_org_status_idx").on(table.organisationId, table.status),
    index("timesheets_org_employee_idx").on(table.organisationId, table.employeeId),
    check("timesheets_expected_non_negative", sql`${table.expectedHours} >= 0`),
    check("timesheets_total_non_negative", sql`${table.totalHours} >= 0`),
    check(
      "timesheets_approval_consistency",
      sql`${table.approvedAt} IS NULL OR ${table.approvedBy} IS NOT NULL`,
    ),
  ],
);

/** One row per project/date allocation, replacing the unreportable embedded hours map. */
export const timesheetEntries = pgTable(
  "timesheet_entries",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    timesheetId: uuid("timesheet_id")
      .notNull()
      .references(() => timesheets.id, { onDelete: "cascade" }),
    workDate: date("work_date", { mode: "string" }).notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    costCentreId: uuid("cost_centre_id")
      .notNull()
      .references(() => costCentres.id, { onDelete: "restrict" }),
    activityCodeId: uuid("activity_code_id")
      .notNull()
      .references(() => activityCodes.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    notes: text("notes"),
    isLeave: boolean("is_leave").notNull().default(false),
    isHoliday: boolean("is_holiday").notNull().default(false),
  },
  (table) => [
    index("timesheet_entries_org_date_idx").on(table.organisationId, table.workDate),
    index("timesheet_entries_project_cost_idx").on(table.projectId, table.costCentreId),
    index("timesheet_entries_timesheet_idx").on(table.timesheetId),
    check("timesheet_entries_hours_range", sql`${table.hours} > 0 AND ${table.hours} <= 24`),
    check(
      "timesheet_entries_leave_holiday_exclusive",
      sql`NOT (${table.isLeave} AND ${table.isHoliday})`,
    ),
  ],
);

export const attendancePolicies = pgTable(
  "attendance_policies",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    standardDailyHours: numeric("standard_daily_hours", { precision: 5, scale: 2 }).notNull(),
    expectedClockIn: text("expected_clock_in").notNull(),
    expectedClockOut: text("expected_clock_out").notNull(),
    defaultBreakMinutes: integer("default_break_minutes").notNull(),
    lateGraceMinutes: integer("late_grace_minutes").notNull(),
    maximumLocationAccuracyMeters: integer("maximum_location_accuracy_meters").notNull(),
    signOutReminderOffsetsMinutes: integer("sign_out_reminder_offsets_minutes").array().notNull(),
    punchDeduplicationMinutes: integer("punch_deduplication_minutes").notNull().default(2),
    antiSpoofingMode: text("anti_spoofing_mode").notNull().default("Approved Network"),
    approvedNetworkCidrs: text("approved_network_cidrs").array().notNull().default([]),
  },
  (table) => [
    uniqueIndex("attendance_policies_org_unique").on(table.organisationId),
    check(
      "attendance_policies_daily_hours_range",
      sql`${table.standardDailyHours} > 0 AND ${table.standardDailyHours} <= 24`,
    ),
    check("attendance_policies_break_range", sql`${table.defaultBreakMinutes} BETWEEN 0 AND 1439`),
    check("attendance_policies_grace_non_negative", sql`${table.lateGraceMinutes} >= 0`),
    check("attendance_policies_accuracy_positive", sql`${table.maximumLocationAccuracyMeters} > 0`),
    check(
      "attendance_policies_three_reminders",
      sql`cardinality(${table.signOutReminderOffsetsMinutes}) = 3`,
    ),
    check(
      "attendance_policies_punch_deduplication_range",
      sql`${table.punchDeduplicationMinutes} BETWEEN 0 AND 15`,
    ),
    check("attendance_policies_anti_spoofing", sql`${table.antiSpoofingMode} = 'Approved Network'`),
  ],
);

export const attendanceStatus = pgEnum("attendance_status", [
  "Present",
  "Absent",
  "On Leave",
  "Holiday",
  "Rest Day",
  "Late",
  "Missing Punch",
  "Correction Pending",
  "Corrected",
]);
export const attendanceSource = pgEnum("attendance_source", [
  "Hardware Terminal",
  "Manual Entry",
  "Web",
  "Import",
  "Site Visit Auto",
  "Multiple Sources",
]);

/**
 * Door terminals remain on the office network. This registry contains only the
 * public identity and operational state needed by VIA HR; the terminal COMKey
 * and biometric templates must never be copied into the cloud application.
 */
export const attendanceDevices = pgTable(
  "attendance_devices",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    serialNumber: text("serial_number"),
    model: text("model"),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastError: text("last_error"),
  },
  (table) => [
    uniqueIndex("attendance_devices_org_code_unique").on(table.organisationId, table.code),
    index("attendance_devices_org_active_idx").on(table.organisationId, table.isActive),
    check("attendance_devices_code_not_blank", sql`btrim(${table.code}) <> ''`),
    check("attendance_devices_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

/** One explicit terminal identity per employee and device. */
export const attendanceDeviceEmployeeMappings = pgTable(
  "attendance_device_employee_mappings",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevices.id, { onDelete: "restrict" }),
    deviceUserId: text("device_user_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("attendance_device_user_unique").on(table.deviceId, table.deviceUserId),
    uniqueIndex("attendance_device_employee_unique").on(table.deviceId, table.employeeId),
    index("attendance_device_mapping_org_employee_idx").on(table.organisationId, table.employeeId),
    check("attendance_device_mapping_user_not_blank", sql`btrim(${table.deviceUserId}) <> ''`),
  ],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    shiftId: uuid("shift_id"),
    expectedClockIn: text("expected_clock_in"),
    expectedClockOut: text("expected_clock_out"),
    clockInAt: timestamp("clock_in_at", { withTimezone: true, mode: "string" }),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true, mode: "string" }),
    breakMinutes: integer("break_minutes").notNull().default(0),
    location: text("location"),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "restrict" }),
    capturedLatitude: doublePrecision("captured_latitude"),
    capturedLongitude: doublePrecision("captured_longitude"),
    capturedAccuracyMeters: doublePrecision("captured_accuracy_meters"),
    clockOutLocationId: uuid("clock_out_location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    clockOutCapturedLatitude: doublePrecision("clock_out_captured_latitude"),
    clockOutCapturedLongitude: doublePrecision("clock_out_captured_longitude"),
    clockOutCapturedAccuracyMeters: doublePrecision("clock_out_captured_accuracy_meters"),
    source: attendanceSource("source").notNull(),
    workMode: text("work_mode"),
    siteVisitId: uuid("site_visit_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => siteVisitRequests.id,
      { onDelete: "restrict" },
    ),
    status: attendanceStatus("status").notNull(),
    calculatedHours: numeric("calculated_hours", { precision: 6, scale: 2 }).notNull().default("0"),
    isLate: boolean("is_late").notNull().default(false),
    isEarlyDeparture: boolean("is_early_departure").notNull().default(false),
  },
  (table) => [
    uniqueIndex("attendance_records_employee_date_unique").on(table.employeeId, table.date),
    index("attendance_records_org_date_status_idx").on(
      table.organisationId,
      table.date,
      table.status,
    ),
    check("attendance_records_break_range", sql`${table.breakMinutes} BETWEEN 0 AND 1439`),
    check("attendance_records_hours_range", sql`${table.calculatedHours} BETWEEN 0 AND 24`),
    check(
      "attendance_records_punch_order",
      sql`${table.clockInAt} IS NULL OR ${table.clockOutAt} IS NULL OR ${table.clockOutAt} >= ${table.clockInAt}`,
    ),
    check(
      "attendance_records_latitude_range",
      sql`${table.capturedLatitude} IS NULL OR ${table.capturedLatitude} BETWEEN -90 AND 90`,
    ),
    check(
      "attendance_records_longitude_range",
      sql`${table.capturedLongitude} IS NULL OR ${table.capturedLongitude} BETWEEN -180 AND 180`,
    ),
  ],
);

/** Immutable punch evidence; attendance_records is the calculated daily projection. */
export const attendancePunchEvents = pgTable(
  "attendance_punch_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    attendanceRecordId: uuid("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    direction: text("direction").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    source: text("source").notNull().default("Web"),
    deviceId: uuid("device_id").references(() => attendanceDevices.id, {
      onDelete: "restrict",
    }),
    externalEventId: text("external_event_id"),
    deviceUserId: text("device_user_id"),
    deviceStatus: integer("device_status"),
    punchMethod: integer("punch_method"),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "restrict" }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracyMeters: doublePrecision("accuracy_meters"),
    clientIp: text("client_ip"),
    networkVerified: boolean("network_verified").notNull(),
    createdBy: uuid("created_by"),
  },
  (table) => [
    index("attendance_punch_events_record_idx").on(table.attendanceRecordId, table.occurredAt),
    index("attendance_punch_events_employee_idx").on(
      table.organisationId,
      table.employeeId,
      table.occurredAt,
    ),
    uniqueIndex("attendance_punch_events_device_external_unique")
      .on(table.deviceId, table.externalEventId)
      .where(sql`${table.deviceId} IS NOT NULL AND ${table.externalEventId} IS NOT NULL`),
    check("attendance_punch_events_direction", sql`${table.direction} IN ('in', 'out')`),
    check(
      "attendance_punch_events_source",
      sql`${table.source} IN ('Web', 'Hardware Terminal', 'Site Visit Auto')`,
    ),
    check(
      "attendance_punch_events_accuracy",
      sql`${table.accuracyMeters} IS NULL OR ${table.accuracyMeters} >= 0`,
    ),
    check(
      "attendance_punch_events_evidence",
      sql`(${table.source} = 'Hardware Terminal' AND ${table.deviceId} IS NOT NULL AND ${table.externalEventId} IS NOT NULL AND ${table.deviceUserId} IS NOT NULL)
          OR (${table.source} <> 'Hardware Terminal' AND ${table.locationId} IS NOT NULL AND ${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL AND ${table.clientIp} IS NOT NULL AND ${table.networkVerified})`,
    ),
  ],
);

export const attendanceDevicePunchStatus = pgEnum("attendance_device_punch_status", [
  "Applied",
  "Unmatched Employee",
  "Rejected",
]);

/** Immutable raw evidence received from the office collector. */
export const attendanceDevicePunches = pgTable(
  "attendance_device_punches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevices.id, { onDelete: "restrict" }),
    externalEventId: text("external_event_id").notNull(),
    deviceUserId: text("device_user_id").notNull(),
    deviceUserName: text("device_user_name"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    deviceStatus: integer("device_status"),
    punchMethod: integer("punch_method"),
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "restrict" }),
    attendanceRecordId: uuid("attendance_record_id").references(() => attendanceRecords.id, {
      onDelete: "restrict",
    }),
    punchEventId: uuid("punch_event_id").references(() => attendancePunchEvents.id, {
      onDelete: "restrict",
    }),
    status: attendanceDevicePunchStatus("status").notNull(),
    failureReason: text("failure_reason"),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("attendance_device_punch_external_unique").on(
      table.deviceId,
      table.externalEventId,
    ),
    index("attendance_device_punch_org_status_idx").on(
      table.organisationId,
      table.status,
      table.receivedAt,
    ),
    index("attendance_device_punch_user_idx").on(table.deviceId, table.deviceUserId),
    check("attendance_device_punch_external_not_blank", sql`btrim(${table.externalEventId}) <> ''`),
    check("attendance_device_punch_user_not_blank", sql`btrim(${table.deviceUserId}) <> ''`),
  ],
);

export const attendanceCorrectionStatus = pgEnum("attendance_correction_status", [
  "Pending Manager",
  "Pending HR",
  "Approved",
  "Rejected",
]);
export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    attendanceRecordId: uuid("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    correctionType: text("correction_type").notNull(),
    originalClockIn: timestamp("original_clock_in", { withTimezone: true, mode: "string" }),
    originalClockOut: timestamp("original_clock_out", { withTimezone: true, mode: "string" }),
    originalStatus: attendanceStatus("original_status").notNull(),
    proposedClockIn: timestamp("proposed_clock_in", { withTimezone: true, mode: "string" }),
    proposedClockOut: timestamp("proposed_clock_out", { withTimezone: true, mode: "string" }),
    explanation: text("explanation").notNull(),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    status: attendanceCorrectionStatus("status").notNull().default("Pending Manager"),
    managerNotes: text("manager_notes"),
    managerReviewedBy: uuid("manager_reviewed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    managerReviewedAt: timestamp("manager_reviewed_at", { withTimezone: true, mode: "string" }),
    hrNotes: text("hr_notes"),
    hrReviewedBy: uuid("hr_reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    hrReviewedAt: timestamp("hr_reviewed_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("attendance_corrections_org_status_idx").on(table.organisationId, table.status),
    index("attendance_corrections_employee_idx").on(table.employeeId),
    check(
      "attendance_corrections_type",
      sql`${table.correctionType} IN ('Punch Correction', 'Missed Sign-out')`,
    ),
    check("attendance_corrections_explanation_not_blank", sql`btrim(${table.explanation}) <> ''`),
    check(
      "attendance_corrections_proposed_order",
      sql`${table.proposedClockIn} IS NULL OR ${table.proposedClockOut} IS NULL OR ${table.proposedClockOut} >= ${table.proposedClockIn}`,
    ),
  ],
);

export const siteVisitRequests = pgTable(
  "site_visit_requests",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    purpose: text("purpose").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "string" }).notNull(),
    hrReviewedBy: uuid("hr_reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    hrReviewedAt: timestamp("hr_reviewed_at", { withTimezone: true, mode: "string" }),
    hrNotes: text("hr_notes"),
    attendanceRecordId: uuid("attendance_record_id").references(() => attendanceRecords.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    index("site_visit_requests_org_date_status_idx").on(
      table.organisationId,
      table.date,
      table.status,
    ),
    check("site_visit_requests_origin", sql`${table.origin} IN ('Office', 'Home')`),
    check(
      "site_visit_requests_status",
      sql`${table.status} IN ('Pending HR', 'Approved', 'Rejected', 'Cancelled', 'Completed')`,
    ),
    check("site_visit_requests_time_order", sql`${table.startTime} < ${table.endTime}`),
  ],
);

export const attendanceExceptionCases = pgTable(
  "attendance_exception_cases",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    siteVisitId: uuid("site_visit_id")
      .notNull()
      .references(() => siteVisitRequests.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    destination: text("destination").notNull(),
    status: text("status").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
    investigationNotes: text("investigation_notes"),
    resolutionNotes: text("resolution_notes"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("attendance_exception_site_visit_unique").on(table.siteVisitId),
    index("attendance_exception_org_status_idx").on(table.organisationId, table.status),
    check("attendance_exception_type", sql`${table.type} = 'Site Visit No Clock-In'`),
    check(
      "attendance_exception_status",
      sql`${table.status} IN ('Open', 'Investigating', 'Resolved')`,
    ),
    check(
      "attendance_exception_resolution_consistency",
      sql`${table.status} <> 'Resolved' OR (${table.resolvedBy} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL AND btrim(coalesce(${table.resolutionNotes}, '')) <> '')`,
    ),
  ],
);

export const overtimeClaimStatus = pgEnum("overtime_claim_status", [
  "Pending Pre-authorisation",
  "Pre-authorised",
  "Pending Manager",
  "Pending HR",
  "Approved",
  "Rejected",
  "Corrected",
]);
export const overtimeClaims = pgTable(
  "overtime_claims",
  {
    ...mutableRecordColumns,
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date", { mode: "string" }).notNull(),
    hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "restrict" }),
    costCentreId: uuid("cost_centre_id")
      .notNull()
      .references(() => costCentres.id, { onDelete: "restrict" }),
    activityCodeId: uuid("activity_code_id")
      .notNull()
      .references(() => activityCodes.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    requestKind: text("request_kind").notNull().default("Emergency Retrospective"),
    emergencyReason: text("emergency_reason"),
    authorisedHours: numeric("authorised_hours", { precision: 5, scale: 2 }),
    preAuthorisedAt: timestamp("pre_authorised_at", { withTimezone: true, mode: "string" }),
    preAuthorisedBy: uuid("pre_authorised_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    actualConfirmedAt: timestamp("actual_confirmed_at", { withTimezone: true, mode: "string" }),
    evidenceFileId: uuid("evidence_file_id").references(() => fileMetadata.id, {
      onDelete: "restrict",
    }),
    compensationType: text("compensation_type").notNull(),
    toilCreditedAt: timestamp("toil_credited_at", { withTimezone: true, mode: "string" }),
    toilReversedAt: timestamp("toil_reversed_at", { withTimezone: true, mode: "string" }),
    payrollPeriodId: uuid("payroll_period_id").references(() => payrollPeriods.id, {
      onDelete: "restrict",
    }),
    crossCheckWarnings: jsonb("cross_check_warnings").$type<string[]>().notNull().default([]),
    status: overtimeClaimStatus("status").notNull().default("Pending Manager"),
    managerNotes: text("manager_notes"),
    hrNotes: text("hr_notes"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    originalClaimId: uuid("original_claim_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => overtimeClaims.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    index("overtime_claims_org_employee_status_idx").on(
      table.organisationId,
      table.employeeId,
      table.status,
    ),
    index("overtime_claims_org_date_idx").on(table.organisationId, table.date),
    uniqueIndex("overtime_claims_employee_date_active_unique")
      .on(table.employeeId, table.date)
      .where(sql`${table.archivedAt} IS NULL AND ${table.status} NOT IN ('Rejected', 'Corrected')`),
    check("overtime_claims_hours_range", sql`${table.hours} > 0 AND ${table.hours} <= 24`),
    check("overtime_claims_reason_not_blank", sql`btrim(${table.reason}) <> ''`),
    check(
      "overtime_claims_request_kind",
      sql`${table.requestKind} IN ('Planned', 'Emergency Retrospective')`,
    ),
    check(
      "overtime_claims_emergency_reason",
      sql`${table.requestKind} <> 'Emergency Retrospective' OR btrim(coalesce(${table.emergencyReason}, '')) <> ''`,
    ),
    check("overtime_claims_compensation", sql`${table.compensationType} IN ('Payment', 'TOIL')`),
    check(
      "overtime_claims_approval_consistency",
      sql`${table.status} <> 'Approved' OR (${table.approvedAt} IS NOT NULL AND ${table.approvedBy} IS NOT NULL)`,
    ),
    check(
      "overtime_claims_toil_consistency",
      sql`${table.toilCreditedAt} IS NULL OR ${table.compensationType} = 'TOIL'`,
    ),
  ],
);
