import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  decideTimesheetInDatabase,
  generateTimesheetPeriodsInDatabase,
  getOrCreateTimesheetInDatabase,
  listTimesheetSnapshotForActor,
  lockTimesheetForPayrollInDatabase,
  processTimesheetWorker,
  reopenTimesheetInDatabase,
  saveTimesheetDraftInDatabase,
  submitTimesheetInDatabase,
  updateTimesheetSettingsInDatabase,
} from "../src/lib/db/repositories/timesheet.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "timesheets use PostgreSQL for scoped drafts, approvals, locks and corrections",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 5, prepare: false });
    const organisationId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const employmentTypeId = randomUUID();
    const locationId = randomUUID();
    const projectId = randomUUID();
    const costCentreId = randomUUID();
    const activityCodeId = randomUUID();
    const managerEmployeeId = randomUUID();
    const managerUserId = randomUUID();
    const otherManagerEmployeeId = randomUUID();
    const otherManagerUserId = randomUUID();
    const hrEmployeeId = randomUUID();
    const hrUserId = randomUUID();
    const accountsEmployeeId = randomUUID();
    const accountsUserId = randomUUID();
    const employeeId = randomUUID();
    const employeeUserId = randomUUID();
    const createdAt = new Date();
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7));
    const startDate = monday.toISOString().slice(0, 10);
    const end = new Date(monday);
    end.setUTCDate(end.getUTCDate() + 6);
    const endDate = end.toISOString().slice(0, 10);
    const actor = (
      userId: string,
      personId: string,
      activeRole: "Employee" | "Line Manager" | "HR" | "Accounts",
    ) => ({
      userId,
      employeeId: personId,
      displayName: `${activeRole} test actor`,
      activeRole,
      roles: ["Employee", activeRole] as const,
    });

    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by,created_at,updated_at) VALUES (${organisationId},'Timesheet Test',${`timesheet-${organisationId}`},true,${hrUserId},${hrUserId},${createdAt},${createdAt})`;
      for (const [table, id, name, code] of [
        ["departments", departmentId, "Operations", "OPS"],
        ["positions", positionId, "Coordinator", "COORD"],
        ["employment_types", employmentTypeId, "Full-time", "FT"],
        ["cost_centres", costCentreId, "Operations", "CC-OPS"],
        ["activity_codes", activityCodeId, "Client delivery", "DELIVERY"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by,created_at,updated_at) VALUES ($1,$2,$3,$4,true,1,$5,$5,$6,$6)`,
          [id, organisationId, name, code, hrUserId, createdAt],
        );
      }
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by,created_at,updated_at) VALUES (${locationId},${organisationId},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${hrUserId},${hrUserId},${createdAt},${createdAt})`;
      await sql`INSERT INTO projects (id,organisation_id,name,code,is_active,order_index,cost_centre_id,created_by,updated_by,created_at,updated_at) VALUES (${projectId},${organisationId},'Trade Operations','TRADE',true,1,${costCentreId},${hrUserId},${hrUserId},${createdAt},${createdAt})`;
      for (const [personId, userId, name, managerId] of [
        [managerEmployeeId, managerUserId, "Manager", null],
        [otherManagerEmployeeId, otherManagerUserId, "Other Manager", null],
        [hrEmployeeId, hrUserId, "HR", null],
        [accountsEmployeeId, accountsUserId, "Accounts", null],
        [employeeId, employeeUserId, "Employee", managerEmployeeId],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,created_by,updated_by,created_at,updated_at) VALUES (${personId},${organisationId},${`TS-${personId.slice(0, 6)}`},${name},${name},${`${personId}@viahr.test`},${departmentId},${positionId},${locationId},${employmentTypeId},${managerId},'Active','2020-01-01',${hrUserId},${hrUserId},${createdAt},${createdAt})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by,created_at,updated_at) VALUES (${userId},${organisationId},${personId},${name},${`${personId}@viahr.test`},'Active',${hrUserId},${hrUserId},${createdAt},${createdAt})`;
      }
      await sql`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by) VALUES (${organisationId},'Asia/Dubai','AED',${[1, 2, 3, 4, 5]},8,40,'01-01','12-31',${[60, 30, 14, 7]},'VIA-{SEQ}','CAN-{SEQ}',${hrUserId},${hrUserId})`;

      const employeeActor = actor(employeeUserId, employeeId, "Employee");
      const managerActor = actor(managerUserId, managerEmployeeId, "Line Manager");
      const otherManagerActor = actor(otherManagerUserId, otherManagerEmployeeId, "Line Manager");
      const hrActor = actor(hrUserId, hrEmployeeId, "HR");
      const accountsActor = actor(accountsUserId, accountsEmployeeId, "Accounts");
      await updateTimesheetSettingsInDatabase(
        organisationId,
        {
          weeklyPeriodStartDay: 1,
          standardDailyHours: 8,
          submissionDeadlineDays: 2,
          overtimeThresholdWeekly: 40,
          allowCopyPreviousWeek: true,
          payrollLockBehaviour: "Manual by HR",
          requireHrOvertimeVerification: false,
          attendanceVarianceToleranceHours: 0.25,
        },
        hrActor,
      );
      assert.equal(
        await generateTimesheetPeriodsInDatabase(organisationId, startDate, endDate, hrActor),
        1,
      );
      const snapshot = await listTimesheetSnapshotForActor(organisationId, employeeActor);
      const periodId = snapshot.periods[0]!.id;
      const timesheetId = await getOrCreateTimesheetInDatabase(
        organisationId,
        employeeId,
        periodId,
        employeeActor,
      );
      const hours: Record<string, number> = {};
      for (let offset = 0; offset < 5; offset += 1) {
        const date = new Date(monday);
        date.setUTCDate(date.getUTCDate() + offset);
        const workDate = date.toISOString().slice(0, 10);
        hours[workDate] = 8;
        await sql`INSERT INTO attendance_records (id,organisation_id,employee_id,date,clock_in_at,clock_out_at,break_minutes,source,status,calculated_hours,created_by,updated_by) VALUES (${randomUUID()},${organisationId},${employeeId},${workDate},${`${workDate}T08:00:00.000Z`},${`${workDate}T16:00:00.000Z`},0,'Web','Present',8,${employeeUserId},${employeeUserId})`;
      }
      await saveTimesheetDraftInDatabase(
        organisationId,
        timesheetId,
        [
          {
            id: randomUUID(),
            projectId,
            costCentreId,
            activityCodeId,
            locationId,
            hours,
            notes: "Client delivery and operational coordination",
          },
        ],
        {},
        employeeActor,
      );
      await submitTimesheetInDatabase(organisationId, timesheetId, employeeActor);
      await assert.rejects(
        decideTimesheetInDatabase(
          organisationId,
          timesheetId,
          "approve",
          undefined,
          otherManagerActor,
        ),
        /assigned timesheet approver/,
      );
      const managerRace = await Promise.allSettled([
        decideTimesheetInDatabase(organisationId, timesheetId, "approve", undefined, managerActor),
        decideTimesheetInDatabase(organisationId, timesheetId, "approve", undefined, managerActor),
      ]);
      assert.equal(managerRace.filter((result) => result.status === "fulfilled").length, 1);
      const [routineApproval] = await sql`
        SELECT status, approved_by FROM timesheets WHERE id = ${timesheetId}
      `;
      assert.equal(routineApproval?.status, "Approved");
      assert.equal(routineApproval?.approved_by, managerUserId);
      await lockTimesheetForPayrollInDatabase(organisationId, timesheetId, hrActor);
      const correctionId = await reopenTimesheetInDatabase(
        organisationId,
        timesheetId,
        "Correct the approved client allocation",
        accountsActor,
      );
      const [correction] =
        await sql`SELECT period_id, original_timesheet_id, status FROM timesheets WHERE id = ${correctionId}`;
      assert.equal(correction?.period_id, periodId);
      assert.equal(correction?.original_timesheet_id, timesheetId);
      assert.equal(correction?.status, "Returned");
      const [copied] =
        await sql`SELECT min(work_date) AS first_date, max(work_date) AS last_date, count(*)::int AS count FROM timesheet_entries WHERE timesheet_id = ${correctionId}`;
      assert.equal(
        new Date(copied?.first_date as string | Date).toISOString().slice(0, 10),
        startDate,
      );
      assert.equal(copied?.count, 5);
      const employeeView = await listTimesheetSnapshotForActor(organisationId, employeeActor);
      assert.equal(employeeView.timesheets.length, 1);
      assert.equal(employeeView.timesheets[0]?.id, correctionId);
      const workerAt = new Date(`${endDate}T12:00:00.000Z`);
      workerAt.setUTCDate(workerAt.getUTCDate() + 3);
      const firstWorkerRun = await processTimesheetWorker(workerAt);
      const secondWorkerRun = await processTimesheetWorker(workerAt);
      assert.ok(firstWorkerRun.reminders > 0);
      assert.equal(secondWorkerRun.reminders, 0, "worker reminders must be idempotent");
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
