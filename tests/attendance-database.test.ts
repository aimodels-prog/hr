import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";
import {
  saveOfficeException,
  cancelOfficeException,
  officeCredits,
} from "../src/lib/db/repositories/office-exception.repository.server.ts";
import { recordedAttendanceHours } from "../src/lib/data/recorded-hours.ts";
import {
  enqueueMissingClockoutReminders,
  missingClockoutCandidates,
} from "../src/lib/db/repositories/missing-clockout.repository.server.ts";
import { getWorkforceAnalytics } from "../src/lib/db/repositories/workforce-analytics.repository.server.ts";

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
  updateSiteVisitProgressInDatabase,
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
      await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason)
        SELECT ${organisationId},${managerUserId},id,${hrUserId},'Assigned test supervisor'
        FROM roles WHERE code='Line Manager' ON CONFLICT DO NOTHING`;
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
      await sql`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,
        standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,
        document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by)
        VALUES (${organisationId},'UTC','OMR',ARRAY[1,2,3,4,5],8,40,'01-01','12-31',
          ARRAY[30,7],'TEST-{####}','CAN-{####}',${hrUserId},${hrUserId})`;
      // Historical fixture eligibility; the production setup deliberately cannot be backdated.
      const tracking = {
        headOfficeLocationId: locationId,
        effectiveFrom: "2026-01-01",
        revision: 1,
        assignments: people.map(([id]) => ({
          employeeId: id,
          effectiveFrom: "2026-01-01",
          mode: "Head Office biometric",
          source: "location",
        })),
      };
      await sql`UPDATE app_settings SET additional_settings = additional_settings ||
        ${sql.json({ attendanceTracking: tracking })}::jsonb WHERE organisation_id = ${organisationId}`;
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
        1,
      );
      await decideAttendanceCorrectionInDatabase(
        organisationId,
        correctionId,
        "approve",
        "HR completed the attendance verification.",
        actor(hrUserId, hrEmployeeId, "HR Reviewer", "HR"),
        2,
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
        // This organisation explicitly configured zero break minutes.
        ["Approved", "Corrected", 8, false, false],
      );

      const missingDay = new Date();
      do missingDay.setUTCDate(missingDay.getUTCDate() - 1);
      while (
        ![1, 2, 3, 4, 5].includes(missingDay.getUTCDay()) ||
        missingDay.toISOString().slice(0, 10) === correctionDate
      );
      const missingDate = missingDay.toISOString().slice(0, 10);
      const missingCorrectionId = await requestAttendanceCorrectionInDatabase(
        organisationId,
        {
          employeeId,
          date: missingDate,
          proposedClockIn: "08:00",
          proposedClockOut: "16:00",
          explanation: "No daily attendance record was created for this working day.",
        },
        employeeActor,
      );
      const [missingRecord] = await sql`
        SELECT r.source, r.status, c.status AS correction_status
        FROM attendance_records r
        JOIN attendance_corrections c ON c.attendance_record_id = r.id
        WHERE c.id = ${missingCorrectionId}
      `;
      assert.deepEqual(
        [missingRecord.source, missingRecord.status, missingRecord.correction_status],
        ["Manual Entry", "Absent", "Pending Manager"],
      );
      const employeeView = await listAttendanceForActor(organisationId, employeeActor);
      assert.equal(employeeView.records.length, 2);
      assert.ok(employeeView.records.every((record) => record.employeeId === employeeId));
      for (const activeRole of ["Accounts", "IT"] as const) {
        const selfView = await listAttendanceForActor(organisationId, {
          ...employeeActor,
          activeRole,
          roles: ["Employee", activeRole],
        });
        assert.deepEqual(selfView.employeeIds, [employeeId]);
        assert.equal(selfView.records.length, employeeView.records.length);
        assert.ok(selfView.records.every((record) => record.employeeId === employeeId));
      }

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
      assert.equal(workerResult.reminders, 0);
      assert.ok(workerResult.siteVisits >= 1);
      assert.ok(workerResult.exceptions >= 1);
      const [workerState] = await sql`
        SELECT
          (SELECT count(*)::int FROM notifications WHERE recipient_user_id = ${reminderUserId} AND type = 'attendance.sign_out') AS reminders,
          (SELECT count(*)::int FROM attendance_records WHERE site_visit_id = ${homeVisitId} AND clock_out_at IS NOT NULL) AS home_attendance,
          (SELECT id FROM attendance_exception_cases WHERE site_visit_id = ${officeVisitId}) AS exception_id
      `;
      assert.deepEqual([workerState.reminders, workerState.home_attendance], [0, 1]);
      const nextMorning = new Date(`${scheduledDate}T09:00:00Z`);
      nextMorning.setUTCDate(nextMorning.getUTCDate() + 1);
      assert.equal(
        await enqueueMissingClockoutReminders(new Date(nextMorning.getTime() - 60_000)),
        0,
      );
      await Promise.all([
        enqueueMissingClockoutReminders(nextMorning),
        enqueueMissingClockoutReminders(nextMorning),
      ]);
      const [morningNotice] =
        await sql`SELECT count(*)::int AS total FROM notifications WHERE recipient_user_id=${reminderUserId} AND type='attendance.missing_clockout_reminder'`;
      assert.equal(morningNotice.total, 1);
      // Late sync is checked again: an existing notification must not imply the record is still open.
      await sql`UPDATE attendance_records SET clock_out_at=${`${scheduledDate}T11:00:00Z`} WHERE employee_id=${reminderEmployeeId}`;
      const { getDatabaseClient } = await import("../src/lib/db/client.ts");
      const eligible = await getDatabaseClient().execute(missingClockoutCandidates(nextMorning));
      assert.ok(!eligible.some((item) => item["employee_id"] === reminderEmployeeId));
      await sql`UPDATE attendance_records SET clock_out_at=NULL, expected_clock_in='22:00',expected_clock_out='10:00',
        clock_in_at=${`${scheduledDate}T22:00:00Z`} WHERE employee_id=${reminderEmployeeId} AND date=${scheduledDate}`;
      const overnight = await getDatabaseClient().execute(missingClockoutCandidates(nextMorning));
      assert.ok(!overnight.some((item) => item["employee_id"] === reminderEmployeeId));
      await sql`UPDATE attendance_records SET expected_clock_in=NULL,expected_clock_out=NULL,
        clock_in_at=${`${scheduledDate}T02:00:00Z`} WHERE employee_id=${reminderEmployeeId} AND date=${scheduledDate}`;
      await sql`UPDATE app_settings SET timezone='Asia/Muscat' WHERE organisation_id=${organisationId}`;
      const muscatMorning = new Date(nextMorning.getTime() - 4 * 60 * 60 * 1000);
      const localMorning = await getDatabaseClient().execute(
        missingClockoutCandidates(muscatMorning),
      );
      assert.ok(localMorning.some((item) => item["employee_id"] === reminderEmployeeId));
      const reminderException = await saveOfficeException(
        organisationId,
        {
          title: "Flooding - excused closure",
          kind: "Excused closure",
          startDate: scheduledDate,
          endDate: scheduledDate,
          scope: "Employees",
          employeeIds: [reminderEmployeeId],
          countAsWorked: false,
        },
        hrActor,
      );
      const suppressed = await getDatabaseClient().execute(
        missingClockoutCandidates(muscatMorning),
      );
      assert.ok(!suppressed.some((item) => item["employee_id"] === reminderEmployeeId));
      await cancelOfficeException(organisationId, reminderException, hrActor);
      const tooEarly = await getDatabaseClient().execute(
        missingClockoutCandidates(new Date(muscatMorning.getTime() - 60_000)),
      );
      assert.ok(!tooEarly.some((item) => item["employee_id"] === reminderEmployeeId));
      await sql`UPDATE app_settings SET timezone='UTC' WHERE organisation_id=${organisationId}`;
      await sql`UPDATE attendance_records SET source='Hardware Terminal' WHERE employee_id=${reminderEmployeeId} AND date=${scheduledDate}`;
      const unsynced = await getDatabaseClient().execute(missingClockoutCandidates(nextMorning));
      assert.ok(!unsynced.some((item) => item["employee_id"] === reminderEmployeeId));
      await sql`UPDATE attendance_records SET source='Manual Entry' WHERE employee_id=${reminderEmployeeId} AND date=${scheduledDate}`;
      // A missing clock-out goes straight to HR, keeps original clock-in seconds,
      // and does not require an assigned supervisor or biometric eligibility.
      {
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 10);
        const missedDate = yesterday.toISOString().slice(0, 10);
        const [missed] = await sql`UPDATE attendance_records SET date=${missedDate},
        clock_in_at=${`${missedDate}T08:24:27Z`},clock_out_at=NULL
        WHERE employee_id=${reminderEmployeeId} AND date=${scheduledDate} RETURNING id`;
        await sql`UPDATE employees SET line_manager_id=NULL WHERE id=${reminderEmployeeId}`;
        const submit = () =>
          requestAttendanceCorrectionInDatabase(
            organisationId,
            {
              attendanceRecordId: String(missed.id),
              proposedClockIn: "08:24",
              proposedClockOut: "17:00",
              explanation: "Employee supplied a missing clock-out time for HR confirmation.",
            },
            actor(reminderUserId, reminderEmployeeId, "Reminder Employee", "Employee"),
          );
        const submissions = await Promise.allSettled([submit(), submit()]);
        assert.equal(
          submissions.filter((item) => item.status === "fulfilled").length,
          1,
          submissions
            .map((item) => (item.status === "rejected" ? String(item.reason) : "ok"))
            .join("; "),
        );
        const result = submissions.find((item) => item.status === "fulfilled");
        assert.ok(result?.status === "fulfilled");
        const correctionId = result.value;
        const [simpleCorrection] =
          await sql`SELECT status,proposed_clock_in FROM attendance_corrections WHERE id=${correctionId}`;
        assert.equal(simpleCorrection.status, "Pending HR");
        assert.equal(
          new Date(simpleCorrection.proposed_clock_in).toISOString(),
          `${missedDate}T08:24:27.000Z`,
        );
        await assert.rejects(
          () =>
            decideAttendanceCorrectionInDatabase(
              organisationId,
              correctionId,
              "approve",
              undefined,
              actor(managerUserId, managerEmployeeId, "Manager", "Line Manager"),
              1,
            ),
          /assigned correction approver/,
        );
        await decideAttendanceCorrectionInDatabase(
          organisationId,
          correctionId,
          "approve",
          undefined,
          actor(hrUserId, hrEmployeeId, "HR", "HR"),
          1,
        );
        const [confirmed] =
          await sql`SELECT clock_out_at FROM attendance_records WHERE id=${String(missed.id)}`;
        assert.equal(new Date(confirmed.clock_out_at).toISOString(), `${missedDate}T17:00:00.000Z`);
      }
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

      const [homeAttendance] = await sql`
        SELECT clock_in_at, clock_out_at FROM attendance_records WHERE site_visit_id = ${homeVisitId}
      `;
      assert.equal(
        new Date(homeAttendance.clock_in_at).toISOString(),
        `${scheduledDate}T08:00:00.000Z`,
      );
      assert.equal(
        new Date(homeAttendance.clock_out_at).toISOString(),
        `${scheduledDate}T10:00:00.000Z`,
      );

      // Office-local 17:00 is 13:00 UTC, independently of the organisation's UTC schedule.
      await sql`UPDATE locations SET timezone = 'Asia/Muscat' WHERE id = ${locationId}`;
      for (const [index, scenario] of [
        "no-return",
        "returned",
        "manual-out",
        "worker-catchup",
        "pending",
        "after-hours",
      ].entries()) {
        const visitDay = new Date(scheduledDay);
        visitDay.setUTCDate(visitDay.getUTCDate() + index + 1);
        const visitDate = visitDay.toISOString().slice(0, 10);
        const visitId = await requestSiteVisitInDatabase(
          organisationId,
          {
            employeeId: officeEmployeeId,
            date: visitDate,
            startTime: scenario === "after-hours" ? "18:00" : "08:00",
            endTime: scenario === "after-hours" ? "20:00" : "10:00",
            origin: "Office",
            destination: "Client office",
            purpose: `Regression: ${scenario}`,
          },
          actor(officeUserId, officeEmployeeId, "Office Visit Employee", "Employee"),
        );
        if (scenario !== "pending")
          await decideSiteVisitInDatabase(
            organisationId,
            visitId,
            "approve",
            "Approved operational duty",
            hrActor,
          );
        const attendanceId = randomUUID();
        const manualOut = scenario === "manual-out" ? `${visitDate}T11:00:00.000Z` : null;
        await sql`
          INSERT INTO attendance_records (id, organisation_id, employee_id, date, clock_in_at,
            clock_out_at, break_minutes, source, status, created_by, updated_by)
          VALUES (${attendanceId}, ${organisationId}, ${officeEmployeeId}, ${visitDate},
            ${`${visitDate}T04:00:00.000Z`}, ${manualOut}, 30, 'Web', 'Present', ${officeUserId}, ${officeUserId})
        `;
        if (scenario === "returned")
          await sql`
          INSERT INTO attendance_punch_events (organisation_id, attendance_record_id, employee_id,
            direction, occurred_at, source, location_id, latitude, longitude, accuracy_meters,
            client_ip, network_verified, created_by)
          VALUES (${organisationId}, ${attendanceId}, ${officeEmployeeId}, 'in',
            ${`${visitDate}T12:00:00.000Z`}, 'Web', ${locationId}, 25.2048, 55.2708, 5,
            '10.20.1.5', true, ${officeUserId})
        `;
        await processAttendanceScheduledWork(new Date(`${visitDate}T12:59:00.000Z`));
        const [beforeFive] =
          await sql`SELECT clock_out_at FROM attendance_records WHERE id = ${attendanceId}`;
        assert.equal(
          beforeFive.clock_out_at ? new Date(beforeFive.clock_out_at).toISOString() : null,
          manualOut,
          `${scenario}: no clock-out before 5 PM`,
        );
        if (scenario === "no-return" || scenario === "worker-catchup") {
          const [waiting] = await sql`SELECT status FROM site_visit_requests WHERE id = ${visitId}`;
          assert.equal(
            waiting.status,
            "Approved",
            "Keep the visit eligible until automatic closure",
          );
        }
        const closureRun = new Date(`${visitDate}T13:00:00.000Z`);
        if (scenario === "worker-catchup") closureRun.setUTCDate(closureRun.getUTCDate() + 1);
        await Promise.all([
          processAttendanceScheduledWork(closureRun),
          processAttendanceScheduledWork(closureRun),
        ]);
        await processAttendanceScheduledWork(closureRun);
        const [afterFive] = await sql`
          SELECT clock_out_at, calculated_hours FROM attendance_records WHERE id = ${attendanceId}
        `;
        const automatic = scenario === "no-return" || scenario === "worker-catchup";
        assert.equal(
          afterFive.clock_out_at ? new Date(afterFive.clock_out_at).toISOString() : null,
          automatic ? `${visitDate}T13:00:00.000Z` : manualOut,
          scenario,
        );
        if (automatic)
          assert.equal(Number(afterFive.calculated_hours), 8.5, "Deduct the recorded break");
        const [audit] = await sql`
          SELECT count(*)::int AS count FROM audit_events
          WHERE entity_id = ${attendanceId} AND action = 'site-visit-auto-clock-out'
        `;
        assert.equal(
          audit.count,
          automatic ? 1 : 0,
          `${scenario}: repeated worker runs are idempotent`,
        );
      }

      // The return action uses the same server-side office/network checks as normal punching.
      const today = new Date().toISOString().slice(0, 10);
      const returnRecordId = randomUUID();
      await sql`
        INSERT INTO attendance_records (id, organisation_id, employee_id, date, clock_in_at,
          source, status, created_by, updated_by)
        VALUES (${returnRecordId}, ${organisationId}, ${officeEmployeeId}, ${today},
          ${`${today}T00:00:00.000Z`}, 'Web', 'Present', ${officeUserId}, ${officeUserId})
      `;
      await sql`
        INSERT INTO site_visit_requests (organisation_id, employee_id, date, start_time, end_time,
          origin, destination, purpose, status, requested_at, created_by, updated_by)
        VALUES (${organisationId}, ${officeEmployeeId}, ${today}, '00:00', '23:59', 'Office',
          'Client office', 'Return action test', 'Approved', now(), ${hrUserId}, ${hrUserId})
      `;
      const returnInput = {
        employeeId: officeEmployeeId,
        direction: "in" as const,
        returnFromSiteVisit: true,
        latitude: 25.2048,
        longitude: 55.2708,
        accuracyMeters: 5,
        clientIp: "10.20.1.5",
      };
      const officeActor = actor(
        officeUserId,
        officeEmployeeId,
        "Office Visit Employee",
        "Employee",
      );
      await assert.rejects(
        captureAttendancePunchInDatabase(
          organisationId,
          { ...returnInput, latitude: 26, longitude: 56 },
          officeActor,
        ),
        /configured office location/,
      );
      await assert.rejects(
        captureAttendancePunchInDatabase(
          organisationId,
          { ...returnInput, employeeId: homeEmployeeId },
          officeActor,
        ),
        /only record your own attendance/,
      );
      assert.equal(
        await captureAttendancePunchInDatabase(organisationId, returnInput, officeActor),
        returnRecordId,
      );
      const [returned] =
        await sql`SELECT clock_in_at, clock_out_at FROM attendance_records WHERE id = ${returnRecordId}`;
      assert.equal(new Date(returned.clock_in_at).toISOString(), `${today}T00:00:00.000Z`);
      assert.equal(returned.clock_out_at, null);
      const [returnEvidence] = await sql`
        SELECT count(*)::int AS count FROM attendance_punch_events
        WHERE attendance_record_id = ${returnRecordId} AND direction = 'in' AND network_verified = true
      `;
      assert.equal(returnEvidence.count, 1);

      const [hrRole] = await sql`SELECT id FROM roles WHERE code='HR' LIMIT 1`;
      if (hrRole)
        await sql`INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by)
        VALUES (${organisationId}, ${hrUserId}, ${hrRole.id}, ${hrUserId}) ON CONFLICT DO NOTHING`;
      const homeActor = actor(homeUserId, homeEmployeeId, "Home Visit Employee", "Employee");
      for (const [offset, scenario] of [
        "estimate",
        "finish-before-approval",
        "extension",
        "home-return",
        "pending",
      ].entries()) {
        const day = new Date();
        day.setUTCDate(day.getUTCDate() + 90 + offset);
        const date = day.toISOString().slice(0, 10);
        const visitId = await requestSiteVisitInDatabase(
          organisationId,
          {
            employeeId: homeEmployeeId,
            date,
            startTime: "08:00",
            endTime: "10:00",
            origin: "Home",
            destination: `Flexible ${scenario}`,
            purpose: "Last minute client site assignment",
            returnPlan: scenario === "estimate" ? "Time" : "Unknown",
            ...(scenario === "estimate" ? { expectedReturnTime: "10:00" } : {}),
          },
          homeActor,
        );
        const [visit] =
          await sql`SELECT end_time, details FROM site_visit_requests WHERE id=${visitId}`;
        assert.equal(visit.end_time, "17:00", "Expected return must not become the clock-out time");
        const recipients =
          await sql`SELECT recipient_user_id FROM notifications WHERE organisation_id=${organisationId} AND link->>'entityId'=${visitId}`;
        assert.ok(recipients.some((row) => row.recipient_user_id === managerUserId));
        if (hrRole) assert.ok(recipients.some((row) => row.recipient_user_id === hrUserId));
        await processAttendanceScheduledWork(new Date(`${date}T05:00:00Z`));
        const [provisional] =
          await sql`SELECT count(*)::int AS count FROM attendance_records WHERE employee_id=${homeEmployeeId} AND date=${date}`;
        assert.equal(
          provisional.count,
          0,
          "Unconfirmed site duty must not grant approved attendance",
        );
        await assert.rejects(
          updateSiteVisitProgressInDatabase(
            organisationId,
            visitId,
            { action: "finish" },
            employeeActor,
            new Date(`${date}T06:00:00Z`),
          ),
          /cannot be updated/,
        );
        if (scenario === "pending") continue;
        if (scenario === "finish-before-approval") {
          await updateSiteVisitProgressInDatabase(
            organisationId,
            visitId,
            { action: "finish" },
            homeActor,
            new Date(`${date}T07:30:00Z`),
          );
          await assert.rejects(
            updateSiteVisitProgressInDatabase(
              organisationId,
              visitId,
              { action: "finish" },
              homeActor,
              new Date(`${date}T07:31:00Z`),
            ),
            /already ended/,
          );
        }
        await decideSiteVisitInDatabase(
          organisationId,
          visitId,
          "approve",
          "Duty confirmed",
          hrActor,
        );
        await processAttendanceScheduledWork(new Date(`${date}T08:00:00Z`));
        const [midday] =
          await sql`SELECT id, clock_in_at, clock_out_at FROM attendance_records WHERE employee_id=${homeEmployeeId} AND date=${date}`;
        assert.equal(new Date(midday.clock_in_at).toISOString(), `${date}T04:00:00.000Z`);
        assert.equal(
          midday.clock_out_at ? new Date(midday.clock_out_at).toISOString() : null,
          scenario === "finish-before-approval" ? `${date}T07:30:00.000Z` : null,
        );
        if (scenario === "extension") {
          await updateSiteVisitProgressInDatabase(
            organisationId,
            visitId,
            {
              action: "extend",
              endTime: "19:00",
              reason: "Client requested extra site inspection",
            },
            homeActor,
            new Date(`${date}T12:00:00Z`),
          );
          await assert.rejects(
            updateSiteVisitProgressInDatabase(
              organisationId,
              visitId,
              { action: "extend", endTime: "20:00", reason: "Duplicate request" },
              homeActor,
              new Date(`${date}T12:01:00Z`),
            ),
            /already awaiting/,
          );
          await assert.rejects(
            decideSiteVisitInDatabase(organisationId, visitId, "approve", "Self approval", {
              ...homeActor,
              activeRole: "HR",
              roles: ["Employee", "HR"],
            }),
            /own site visit/,
          );
        }
        if (scenario === "home-return") {
          await sql`INSERT INTO attendance_punch_events (organisation_id, employee_id, attendance_record_id, occurred_at, direction, source, network_verified, location_id, latitude, longitude, client_ip, created_by)
            VALUES (${organisationId}, ${homeEmployeeId}, ${midday.id}, ${`${date}T09:00:00Z`}, 'in', 'Web', true, ${locationId}, 25.2048, 55.2708, '10.20.1.5', ${homeUserId})`;
        }
        await processAttendanceScheduledWork(new Date(`${date}T13:00:00Z`));
        if (scenario === "extension") {
          const [beforeApproval] =
            await sql`SELECT clock_out_at FROM attendance_records WHERE id=${midday.id}`;
          assert.equal(
            new Date(beforeApproval.clock_out_at).toISOString(),
            `${date}T13:00:00.000Z`,
            "An unapproved extension does not grant extra hours",
          );
          await decideSiteVisitInDatabase(
            organisationId,
            visitId,
            "approve",
            "Later finish confirmed; overtime remains separate",
            hrActor,
          );
          await processAttendanceScheduledWork(new Date(`${date}T15:00:00Z`));
        }
        await processAttendanceScheduledWork(new Date(`${date}T16:00:00Z`));
        const [final] =
          await sql`SELECT clock_out_at FROM attendance_records WHERE id=${midday.id}`;
        const expected =
          scenario === "home-return"
            ? null
            : scenario === "finish-before-approval"
              ? `${date}T07:30:00.000Z`
              : scenario === "extension"
                ? `${date}T15:00:00.000Z`
                : `${date}T13:00:00.000Z`;
        assert.equal(
          final.clock_out_at ? new Date(final.clock_out_at).toISOString() : null,
          expected,
          scenario,
        );
      }
      const analyticsAt = new Date(`${scheduledDate}T23:59:59Z`);
      for (const activeRole of ["Employee", "Accounts", "IT"] as const) {
        const personal = await getWorkforceAnalytics(
          organisationId,
          { ...employeeActor, activeRole },
          "self",
          7,
          analyticsAt,
        );
        assert.equal(personal.days.length, 7);
        assert.deepEqual(personal.departments, []);
        assert.deepEqual(personal.recruitment, []);
        assert.deepEqual(personal.offices, []);
        assert.deepEqual(personal.employmentStatuses, []);
        assert.deepEqual(personal.leaveQueue, []);
        assert.deepEqual(personal.visits, []);
        assert.deepEqual(personal.priorities.approvals, []);
        assert.deepEqual(personal.priorities.expiries, []);
        assert.ok(personal.days.every((day) => day.recorded + day.review + day.missing <= 1));
        await assert.rejects(
          getWorkforceAnalytics(organisationId, { ...employeeActor, activeRole }, "hr", 7),
          /Only HR/,
        );
      }
      const overview = await getWorkforceAnalytics(organisationId, hrActor, "hr", 30, analyticsAt);
      assert.equal(overview.days.length, 30);
      assert.equal(overview.priorities.expiries.length, 4);
      const [pendingVisits] =
        await sql`SELECT count(*)::int as count FROM site_visit_requests WHERE organisation_id = ${organisationId} AND archived_at IS NULL AND status = 'Pending HR'`;
      assert.equal(
        overview.priorities.approvals.find((row) => row.name === "Visits · HR")?.count ?? 0,
        pendingVisits!.count,
      );
      assert.equal(
        overview.offices.reduce((sum, row) => sum + row.count, 0),
        people.length,
      );
      assert.equal(
        overview.employmentStatuses.reduce((sum, row) => sum + row.count, 0),
        people.length,
      );
      const [visitCount] = await sql`SELECT count(*)::int AS count FROM site_visit_requests
        WHERE organisation_id = ${organisationId} AND archived_at IS NULL
        AND date >= ${overview.startDate} AND date <= ${overview.endDate}`;
      assert.equal(
        overview.visits.reduce((sum, row) => sum + row.count, 0),
        visitCount!.count,
      );
      const [leaveCount] = await sql`SELECT count(*)::int AS count FROM leave_requests
        WHERE organisation_id = ${organisationId} AND archived_at IS NULL
        AND status IN ('Pending Line Manager', 'Pending HR', 'Cancellation Pending',
          'Amendment Pending Line Manager', 'Amendment Pending HR')`;
      assert.equal(
        overview.leaveQueue.reduce((sum, row) => sum + row.count, 0),
        leaveCount!.count,
      );
      assert.equal(
        overview.departments.reduce((sum, row) => sum + row.count, 0),
        people.length,
      );
      await assert.rejects(
        getWorkforceAnalytics(
          organisationId,
          { ...employeeActor, employeeId: randomUUID() },
          "self",
          7,
        ),
        /profile was not found/,
      );
      const annualPolicyId = randomUUID();
      await sql`INSERT INTO leave_policies (id, organisation_id, code, name, type, category, description, is_paid, scope, accrual_mode, created_by, updated_by)
        VALUES (${annualPolicyId}, ${organisationId}, 'CHART-ANNUAL', 'Chart Annual Leave', 'Annual', 'Annual', 'Chart test', true, 'Annual', 'Upfront', ${hrUserId}, ${hrUserId})`;
      for (const [person, balance] of [
        [employeeId, 30],
        [hrEmployeeId, 50],
      ] as const) {
        await sql`INSERT INTO leave_balances (organisation_id, employee_id, policy_id, leave_year, balance_days, created_by, updated_by)
          VALUES (${organisationId}, ${person}, ${annualPolicyId}, 2026, ${balance}, ${hrUserId}, ${hrUserId})`;
      }
      for (const [kind, days] of [
        ["Carry-Forward", 10],
        ["Approved Leave", -4],
      ] as const) {
        await sql`INSERT INTO leave_transactions (organisation_id, employee_id, policy_id, date, transaction_type, days, reason, actor_user_id, created_by, updated_by)
          VALUES (${organisationId}, ${employeeId}, ${annualPolicyId}, '2026-01-01', ${kind}, ${days}, 'Chart test', ${hrUserId}, ${hrUserId}, ${hrUserId})`;
      }
      for (const [date, status] of [
        ["2026-09-14", "Approved"],
        ["2026-09-17", "Approved"],
        ["2026-09-18", "Pending HR"],
      ] as const) {
        await sql`INSERT INTO leave_requests (organisation_id, employee_id, policy_id, start_date, end_date, working_days_requested, reason, status, policy_snapshot, created_by, updated_by)
          VALUES (${organisationId}, ${employeeId}, ${annualPolicyId}, ${date}, ${date}, 1, 'Chart test', ${status}, '{}', ${hrUserId}, ${hrUserId})`;
      }
      const chartAt = new Date("2026-09-16T12:00:00Z");
      const ownLeave = await getWorkforceAnalytics(
        organisationId,
        employeeActor,
        "self",
        7,
        chartAt,
      );
      assert.deepEqual(ownLeave.priorities.annualLeave, [
        { name: "Chart Annual Leave", used: 1, booked: 1, remaining: 30, carry: 6 },
      ]);
      const hrLeave = await getWorkforceAnalytics(organisationId, hrActor, "hr", 7, chartAt);
      assert.equal(hrLeave.priorities.annualLeave[0]!.remaining, 80);
      const selected = await getWorkforceAnalytics(
        organisationId,
        hrActor,
        "hr",
        7,
        chartAt,
        employeeId,
      );
      assert.deepEqual(selected.priorities.annualLeave, ownLeave.priorities.annualLeave);
      assert.deepEqual(selected.days, ownLeave.days);
      assert.deepEqual(selected.departments, []);
      assert.deepEqual(selected.offices, []);
      assert.deepEqual(selected.employmentStatuses, []);
      assert.deepEqual(selected.recruitment, []);
      assert.equal(
        selected.priorities.approvals.find((row) => row.name === "Leave · HR")?.count,
        1,
      );
      const otherSelected = await getWorkforceAnalytics(
        organisationId,
        hrActor,
        "hr",
        7,
        chartAt,
        hrEmployeeId,
      );
      assert.equal(otherSelected.priorities.annualLeave[0]!.remaining, 50);
      const { exportLeaveRequestsCsvInDatabase } =
        await import("../src/lib/db/repositories/leave.repository.server.ts");
      const otherExport = await exportLeaveRequestsCsvInDatabase(
        organisationId,
        { employeeId: hrEmployeeId },
        hrActor,
      );
      assert.equal(
        otherExport.rowCount,
        0,
        "An employee-filtered export must not include another employee's leave",
      );
      assert.equal(
        otherSelected.priorities.approvals.some((row) => row.name === "Leave · HR"),
        false,
      );
      await assert.rejects(
        getWorkforceAnalytics(organisationId, employeeActor, "self", 7, chartAt, hrEmployeeId),
        /Only HR/,
      );
      await assert.rejects(
        getWorkforceAnalytics(organisationId, employeeActor, "hr", 7, chartAt, employeeId),
        /Only HR/,
      );
      await assert.rejects(
        getWorkforceAnalytics(organisationId, hrActor, "hr", 7, chartAt, randomUUID()),
        /profile was not found/,
      );
      assert.equal(hrLeave.priorities.approvals.find((row) => row.name === "Leave · HR")?.count, 1);
      // Production regression: a missing tracking setup must not hide actual
      // attendance evidence. No absence is inferred for unconfigured staff.
      await sql`UPDATE app_settings SET additional_settings = additional_settings - 'attendanceTracking'
        WHERE organisation_id = ${organisationId}`;
      for (const [date, closed] of [
        ["2026-09-14", true],
        ["2026-09-15", false],
      ] as const) {
        await sql`INSERT INTO attendance_records
          (organisation_id, employee_id, date, clock_in_at, clock_out_at, calculated_hours, source, status, created_by, updated_by)
          VALUES (${organisationId}, ${employeeId}, ${date}, ${`${date}T04:30:00Z`},
            ${closed ? `${date}T13:30:00Z` : null}, ${closed ? 8 : 0}, 'Manual Entry', 'Present', ${hrUserId}, ${hrUserId})
          ON CONFLICT (employee_id, date) DO UPDATE SET clock_in_at = EXCLUDED.clock_in_at,
            clock_out_at = EXCLUDED.clock_out_at, calculated_hours = EXCLUDED.calculated_hours,
            status = 'Present', archived_at = NULL`;
      }
      const untracked = await getWorkforceAnalytics(
        organisationId,
        employeeActor,
        "self",
        7,
        chartAt,
      );
      const hrUntracked = await getWorkforceAnalytics(
        organisationId,
        hrActor,
        "hr",
        7,
        chartAt,
        employeeId,
      );
      assert.deepEqual(untracked.days, hrUntracked.days);
      assert.equal(untracked.days.find((day) => day.date === "2026-09-14")!.recorded, 1);
      assert.equal(untracked.days.find((day) => day.date === "2026-09-15")!.review, 1);
      assert.equal(untracked.totals.expected, 0);
      assert.equal(untracked.totals.missing, 0);
      await sql`UPDATE app_settings SET working_days=ARRAY[0,1,2,3,4] WHERE organisation_id=${organisationId}`;
      const officeInput = {
        title: "Company training",
        kind: "Training" as const,
        startDate: "2026-09-14",
        endDate: "2026-09-15",
        scope: "Employees" as const,
        employeeIds: [employeeId],
        countAsWorked: true,
      };
      await assert.rejects(
        saveOfficeException(organisationId, officeInput, employeeActor),
        /Only HR/,
      );
      const exceptionId = await saveOfficeException(organisationId, officeInput, hrActor);
      await assert.rejects(
        saveOfficeException(organisationId, officeInput, hrActor),
        /already covers/,
      );
      const credits = await officeCredits(organisationId, [employeeId], "2026-09-14", "2026-09-15");
      assert.equal(credits.length, 1, "Approved leave is not replaced by the office exception");
      const effective = await listAttendanceForActor(organisationId, employeeActor);
      const credited = effective.records.find((r) => r.date === "2026-09-15");
      assert.equal(credited?.officeExceptionLabel, "Training");
      assert.equal(recordedAttendanceHours(credited), credits[0]!.hours);
      assert.equal(credited?.clockOutAt, null, "No fake clock-out is created");
      const chart = await getWorkforceAnalytics(organisationId, employeeActor, "self", 7, chartAt);
      assert.equal(chart.days.find((d) => d.date === "2026-09-15")?.review, 0);
      assert.equal(chart.days.find((d) => d.date === "2026-09-15")?.recorded, 1);
      const other = await officeCredits(organisationId, [hrEmployeeId], "2026-09-14", "2026-09-15");
      assert.equal(other.length, 0);
      const exceptionExport = await exportAttendanceRecordsFromDatabase(
        organisationId,
        "2026-09-15",
        hrActor,
        [employeeId],
      );
      assert.equal(exceptionExport[0]?.officeExceptionLabel, "Training");
      assert.equal(recordedAttendanceHours(exceptionExport[0]), credits[0]!.hours);
      await sql`UPDATE leave_requests SET is_half_day=true WHERE organisation_id=${organisationId} AND employee_id=${employeeId} AND start_date='2026-09-14' AND status='Approved'`;
      const halfDay = await officeCredits(organisationId, [employeeId], "2026-09-14", "2026-09-14");
      assert.equal(halfDay[0]?.hours, credits[0]!.hours / 2);
      await cancelOfficeException(organisationId, exceptionId, hrActor);
      assert.equal(
        (await officeCredits(organisationId, [employeeId], "2026-09-14", "2026-09-15")).length,
        0,
      );
      const original =
        await sql`SELECT clock_out_at FROM attendance_records WHERE organisation_id=${organisationId} AND employee_id=${employeeId} AND date='2026-09-15'`;
      assert.equal(original[0]?.clock_out_at, null);
    } finally {
      delete process.env["VIA_HR_ATTENDANCE_NETWORK_ENFORCEMENT"];
      await sql.end();
    }
  },
);
