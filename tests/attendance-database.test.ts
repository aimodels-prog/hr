import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  captureAttendancePunchInDatabase,
  configureAttendanceOfficeInDatabase,
  decideSiteVisitInDatabase,
  decideAttendanceCorrectionInDatabase,
  exportAttendanceRecordsFromDatabase,
  importAttendanceRecordsInDatabase,
  listAttendanceForActor,
  processAttendanceScheduledWork,
  requestSiteVisitInDatabase,
  requestAttendanceCorrectionInDatabase,
  resolveAttendanceExceptionInDatabase,
  saveAttendancePolicyInDatabase,
  saveAttendanceRecordInDatabase,
} from "../src/lib/db/repositories/attendance.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "attendance punches, staged corrections and scheduled site-visit work persist in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const organisationId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const employmentTypeId = randomUUID();
    const locationId = randomUUID();
    const managerEmployeeId = randomUUID();
    const managerUserId = randomUUID();
    const hrEmployeeId = randomUUID();
    const hrUserId = randomUUID();
    const employeeId = randomUUID();
    const employeeUserId = randomUUID();
    const reminderEmployeeId = randomUUID();
    const reminderUserId = randomUUID();
    const homeEmployeeId = randomUUID();
    const homeUserId = randomUUID();
    const officeEmployeeId = randomUUID();
    const officeUserId = randomUUID();
    const createdAt = new Date("2026-09-01T00:00:00.000Z");
    const scheduledDay = new Date();
    scheduledDay.setUTCDate(scheduledDay.getUTCDate() + 1);
    const scheduledDate = scheduledDay.toISOString().slice(0, 10);
    const workerAt = new Date(`${scheduledDate}T12:00:00.000Z`);
    const actor = (
      userId: string,
      employeeId: string,
      displayName: string,
      activeRole: "Employee" | "Line Manager" | "HR",
    ) => ({
      userId,
      employeeId,
      displayName,
      activeRole,
      roles: ["Employee", activeRole] as const,
    });

    try {
      await sql`
        INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by, created_at, updated_at)
        VALUES (${organisationId}, 'Attendance Database Test', ${`attendance-${organisationId}`}, true,
          ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt})
      `;
      for (const [table, id, name] of [
        ["departments", departmentId, "Operations"],
        ["positions", positionId, "Coordinator"],
        ["employment_types", employmentTypeId, "Full-time"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, 1, $5, $5, $6, $6)`,
          [id, organisationId, name, name.slice(0, 3).toUpperCase(), hrUserId, createdAt],
        );
      }
      await sql`
        INSERT INTO locations (
          id, organisation_id, name, code, is_active, order_index, latitude, longitude,
          radius_meters, is_clock_in_site, created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${locationId}, ${organisationId}, 'Test Office', 'OFF', true, 1, 25.2048, 55.2708,
          150, true, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
        )
      `;
      const people = [
        [managerEmployeeId, managerUserId, "Manager", null],
        [hrEmployeeId, hrUserId, "HR Reviewer", null],
        [employeeId, employeeUserId, "Employee", managerEmployeeId],
        [reminderEmployeeId, reminderUserId, "Reminder Employee", managerEmployeeId],
        [homeEmployeeId, homeUserId, "Home Visit Employee", managerEmployeeId],
        [officeEmployeeId, officeUserId, "Office Visit Employee", managerEmployeeId],
      ] as const;
      for (const [personEmployeeId, personUserId, name, lineManagerId] of people) {
        await sql`
          INSERT INTO employees (
            id, organisation_id, employee_number, legal_name, preferred_name, work_email,
            department_id, position_id, location_id, employment_type_id, line_manager_id,
            status, start_date, created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${personEmployeeId}, ${organisationId}, ${`AT-${personEmployeeId.slice(0, 6)}`}, ${name}, ${name},
            ${`${personEmployeeId}@viahr.test`}, ${departmentId}, ${positionId}, ${locationId},
            ${employmentTypeId}, ${lineManagerId}, 'Active', '2026-01-01', ${hrUserId}, ${hrUserId},
            ${createdAt}, ${createdAt}
          )
        `;
        await sql`
          INSERT INTO users (
            id, organisation_id, employee_id, display_name, workspace_email, status,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${personUserId}, ${organisationId}, ${personEmployeeId}, ${name},
            ${`${personEmployeeId}@viahr.test`}, 'Active', ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
          )
        `;
      }
      await saveAttendancePolicyInDatabase(
        organisationId,
        {
          standardDailyHours: 8,
          expectedClockIn: "08:00",
          expectedClockOut: "16:00",
          defaultBreakMinutes: 0,
          lateGraceMinutes: 5,
          maximumLocationAccuracyMeters: 100,
          signOutReminderOffsetsMinutes: [0, 15, 30],
          punchDeduplicationMinutes: 2,
          approvedNetworkCidrs: ["10.20.0.0/16"],
        },
        "Approved office attendance controls",
        actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR"),
      );
      await assert.rejects(
        saveAttendancePolicyInDatabase(
          organisationId,
          {
            standardDailyHours: 8,
            expectedClockIn: "08:00",
            expectedClockOut: "16:00",
            defaultBreakMinutes: 0,
            lateGraceMinutes: 5,
            maximumLocationAccuracyMeters: 100,
            signOutReminderOffsetsMinutes: [0, 15, 30],
            punchDeduplicationMinutes: 2,
            approvedNetworkCidrs: ["999.20.0.0/16"],
          },
          "Invalid network must be refused",
          actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR"),
        ),
        /valid approved office IPv4 network/,
      );

      const hrActor = actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR");
      await configureAttendanceOfficeInDatabase(
        organisationId,
        {
          locationId,
          latitude: 25.2048,
          longitude: 55.2708,
          accuracyMeters: 5,
          radiusMeters: 150,
        },
        "HR confirmed the office attendance point",
        hrActor,
      );
      await assert.rejects(
        configureAttendanceOfficeInDatabase(
          organisationId,
          {
            locationId,
            latitude: 25.2048,
            longitude: 55.2708,
            accuracyMeters: 5,
            radiusMeters: 150,
          },
          "Employee must not change the office point",
          actor(employeeUserId, employeeId, "Employee", "Employee"),
        ),
        /Only HR or a Super Admin/,
      );
      const manualId = await saveAttendanceRecordInDatabase(
        organisationId,
        {
          employeeId: reminderEmployeeId,
          date: "2026-02-02",
          clockIn: "08:00",
          clockOut: "16:00",
          breakMinutes: 30,
          location: "Test Office",
          source: "Manual Entry",
        },
        "HR confirmed a terminal outage",
        hrActor,
      );
      await saveAttendanceRecordInDatabase(
        organisationId,
        {
          recordId: manualId,
          employeeId: reminderEmployeeId,
          date: "2026-02-02",
          clockIn: "08:05",
          clockOut: "16:05",
          breakMinutes: 30,
          location: "Test Office",
          source: "Manual Entry",
        },
        "HR corrected the confirmed punch times",
        hrActor,
      );
      const importedIds = await importAttendanceRecordsInDatabase(
        organisationId,
        [
          {
            employeeId: homeEmployeeId,
            date: "2026-02-02",
            clockIn: "08:00",
            clockOut: "16:00",
            breakMinutes: 30,
            location: "Test Office",
            source: "Import",
          },
        ],
        "Validated terminal attendance import",
        hrActor,
      );
      assert.equal(importedIds.length, 1);
      await assert.rejects(
        importAttendanceRecordsInDatabase(
          organisationId,
          [
            {
              employeeId: homeEmployeeId,
              date: "2026-02-02",
              breakMinutes: 0,
              source: "Import",
            },
          ],
          "Duplicate import must be rejected",
          hrActor,
        ),
        /already exists/,
      );
      const exported = await exportAttendanceRecordsFromDatabase(
        organisationId,
        "2026-02-02",
        hrActor,
      );
      assert.equal(exported.length, 2);
      const [adminAudit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId}
          AND module = 'attendance'
          AND entity_type = 'attendance-record'
          AND action IN ('create', 'update', 'import', 'export')
      `;
      assert.equal(adminAudit.count, 4);

      const employeeActor = actor(employeeUserId, employeeId, "Employee", "Employee");
      process.env["VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT"] = "true";
      await assert.rejects(
        captureAttendancePunchInDatabase(
          organisationId,
          {
            employeeId,
            direction: "in",
            latitude: 26,
            longitude: 56,
            accuracyMeters: 10,
            clientIp: "10.20.1.5",
          },
          employeeActor,
        ),
        /configured office location/,
      );
      await assert.rejects(
        captureAttendancePunchInDatabase(
          organisationId,
          {
            employeeId,
            direction: "in",
            latitude: 25.2048,
            longitude: 55.2708,
            accuracyMeters: 5,
            clientIp: "192.168.1.10",
          },
          employeeActor,
        ),
        /approved VIA office network/,
      );
      const recordId = await captureAttendancePunchInDatabase(
        organisationId,
        {
          employeeId,
          direction: "in",
          latitude: 25.2048,
          longitude: 55.2708,
          accuracyMeters: 5,
          clientIp: "10.20.1.5",
        },
        employeeActor,
      );
      await captureAttendancePunchInDatabase(
        organisationId,
        {
          employeeId,
          direction: "out",
          latitude: 25.2048,
          longitude: 55.2708,
          accuracyMeters: 5,
          clientIp: "10.20.1.5",
        },
        employeeActor,
      );
      const [punchEvidence] = await sql`
        SELECT count(*)::int AS count, bool_and(network_verified) AS verified
        FROM attendance_punch_events WHERE attendance_record_id = ${recordId}
      `;
      assert.deepEqual([punchEvidence.count, punchEvidence.verified], [2, true]);

      const correctionDay = new Date();
      correctionDay.setUTCDate(correctionDay.getUTCDate() - 1);
      const correctionDate = correctionDay.toISOString().slice(0, 10);
      await sql`UPDATE attendance_records SET date = ${correctionDate} WHERE id = ${recordId}`;

      const correctionId = await requestAttendanceCorrectionInDatabase(
        organisationId,
        {
          attendanceRecordId: recordId,
          proposedClockIn: `${correctionDate}T08:00:00.000Z`,
          proposedClockOut: `${correctionDate}T16:00:00.000Z`,
          explanation: "The employee used the wrong punch time.",
        },
        employeeActor,
      );
      await decideAttendanceCorrectionInDatabase(
        organisationId,
        correctionId,
        "approve",
        "Confirmed against the team attendance sheet.",
        actor(managerUserId, managerEmployeeId, "Manager", "Line Manager"),
      );
      await decideAttendanceCorrectionInDatabase(
        organisationId,
        correctionId,
        "approve",
        "HR completed the attendance verification.",
        actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR"),
      );
      const [corrected] = await sql`
        SELECT c.status, r.status AS record_status, r.calculated_hours, r.is_late, r.is_early_departure
        FROM attendance_corrections c JOIN attendance_records r ON r.id = c.attendance_record_id
        WHERE c.id = ${correctionId}
      `;
      assert.deepEqual(
        [
          corrected.status,
          corrected.record_status,
          Number(corrected.calculated_hours),
          corrected.is_late,
          corrected.is_early_departure,
        ],
        ["Approved", "Corrected", 8, false, false],
      );
      const employeeView = await listAttendanceForActor(organisationId, employeeActor);
      assert.equal(employeeView.records.length, 1);
      assert.ok(employeeView.records.every((record) => record.employeeId === employeeId));

      await sql`
        INSERT INTO attendance_records (
          organisation_id, employee_id, date, clock_in_at, source, status,
          created_by, updated_by
        ) VALUES (
          ${organisationId}, ${reminderEmployeeId}, ${scheduledDate}, ${`${scheduledDate}T02:00:00.000Z`},
          'Manual Entry', 'Present', ${hrUserId}, ${hrUserId}
        )
      `;
      const homeVisitId = await requestSiteVisitInDatabase(
        organisationId,
        {
          employeeId: homeEmployeeId,
          date: scheduledDate,
          startTime: "08:00",
          endTime: "10:00",
          origin: "Home",
          destination: "Jebel Ali Port",
          purpose: "Approved client operations visit",
        },
        actor(homeUserId, homeEmployeeId, "Home Visit Employee", "Employee"),
      );
      const officeVisitId = await requestSiteVisitInDatabase(
        organisationId,
        {
          employeeId: officeEmployeeId,
          date: scheduledDate,
          startTime: "08:00",
          endTime: "10:00",
          origin: "Office",
          destination: "Dubai Customs",
          purpose: "Approved client operations visit",
        },
        actor(officeUserId, officeEmployeeId, "Office Visit Employee", "Employee"),
      );
      for (const visitId of [homeVisitId, officeVisitId]) {
        await decideSiteVisitInDatabase(
          organisationId,
          visitId,
          "approve",
          "Operational visit approved by HR.",
          actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR"),
        );
      }
      const workerResult = await processAttendanceScheduledWork(workerAt);
      assert.ok(workerResult.reminders >= 3);
      assert.ok(workerResult.siteVisits >= 1);
      assert.ok(workerResult.exceptions >= 1);
      const [workerState] = await sql`
        SELECT
          (SELECT count(*)::int FROM notifications WHERE recipient_user_id = ${reminderUserId} AND type = 'attendance.sign_out') AS reminders,
          (SELECT count(*)::int FROM attendance_records WHERE site_visit_id = ${homeVisitId} AND clock_out_at IS NOT NULL) AS home_attendance,
          (SELECT id FROM attendance_exception_cases WHERE site_visit_id = ${officeVisitId}) AS exception_id
      `;
      assert.deepEqual([workerState.reminders, workerState.home_attendance], [3, 1]);
      assert.ok(workerState.exception_id);
      await resolveAttendanceExceptionInDatabase(
        organisationId,
        String(workerState.exception_id),
        "HR confirmed the employee travelled directly from home.",
        actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR"),
      );
      const [resolved] = await sql`
        SELECT status FROM attendance_exception_cases WHERE id = ${String(workerState.exception_id)}
      `;
      assert.equal(resolved.status, "Resolved");
    } finally {
      delete process.env["VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT"];
      await sql.end();
    }
  },
);
