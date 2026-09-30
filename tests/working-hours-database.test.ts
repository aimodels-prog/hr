import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import {
  getAppSettings,
  saveAppSettings,
} from "../src/lib/db/repositories/settings.repository.server.ts";
import { saveAttendancePolicyInDatabase } from "../src/lib/db/repositories/attendance.repository.server.ts";
import { updateTimesheetSettingsInDatabase } from "../src/lib/db/repositories/timesheet.repository.server.ts";
import { flexibleOfficeSchedule } from "../src/lib/data/office-schedule.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import {
  getReminderRules,
  saveReminderRules,
} from "../src/lib/db/repositories/reminder-rules.repository.server.ts";
import { DEFAULT_REMINDER_RULES } from "../src/lib/data/reminder-rules.ts";
import {
  getCalendarOrganiserEmail,
  saveCalendarOrganiserEmail,
} from "../src/lib/db/repositories/calendar-settings.repository.server.ts";

const url = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (url) process.env["DATABASE_URL"] = url;

test(
  "working hours stay synchronised across all settings entry points in PostgreSQL",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /test|scratch/i);
    const sql = postgres(url!, { max: 1, prepare: false });
    const organisationId = randomUUID();
    const userId = randomUUID();
    const actor = {
      userId,
      displayName: "HR Test",
      activeRole: "HR" as const,
      roles: ["HR" as const],
    };
    try {
      await sql`INSERT INTO organisations (id,name,slug,created_by,updated_by) VALUES (${organisationId},'Working hours test',${organisationId},${userId},${userId})`;
      await sql`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by)
      VALUES (${organisationId},'Asia/Muscat','OMR','{0,1,2,3,4}',8,40,'01-01','12-31','{30,7}','EMP-{0000}','CAN-{0000}',${userId},${userId})`;
      const assertHours = async (expected: number) => {
        const rows =
          await sql`SELECT standard_daily_hours FROM app_settings WHERE organisation_id=${organisationId}
        UNION ALL SELECT standard_daily_hours FROM attendance_policies WHERE organisation_id=${organisationId}
        UNION ALL SELECT standard_daily_hours FROM timesheet_settings WHERE organisation_id=${organisationId}`;
        assert.equal(rows.length, 3);
        for (const row of rows) assert.equal(Number(row.standard_daily_hours), expected);
      };
      assert.equal(await getCalendarOrganiserEmail(organisationId), "hr@via-int.com");
      await saveCalendarOrganiserEmail(organisationId, "NEW-HR@example.test", actor);
      assert.equal(await getCalendarOrganiserEmail(organisationId), "new-hr@example.test");
      const customReminders = {
        ...DEFAULT_REMINDER_RULES,
        travelAfterHours: 72,
        trainingExpiryDays: [30, 3],
        carryDeadline: "05-31",
        missingClockoutStart: "08:30",
      };
      await saveReminderRules(organisationId, customReminders, actor);
      assert.deepEqual(await getReminderRules(organisationId), customReminders);
      assert.equal(await getCalendarOrganiserEmail(organisationId), "new-hr@example.test");
      await assert.rejects(
        () =>
          saveReminderRules(organisationId, customReminders, { ...actor, activeRole: "Employee" }),
        /Only HR/,
      );
      await assert.rejects(() =>
        saveReminderRules(organisationId, { ...customReminders, travelAfterHours: 0 }, actor),
      );
      await assert.rejects(
        () =>
          saveCalendarOrganiserEmail(organisationId, "staff@example.test", {
            ...actor,
            activeRole: "Employee",
          }),
        /Only HR/,
      );
      await assert.rejects(() => saveCalendarOrganiserEmail(organisationId, "invalid", actor));
      assert.equal(await getCalendarOrganiserEmail(organisationId), "new-hr@example.test");
      const attendance = {
        standardDailyHours: 7.5,
        expectedClockIn: "08:00",
        expectedClockOut: "16:00",
        breakStart: "12:00",
        defaultBreakMinutes: 30,
        lateGraceMinutes: 5,
        maximumLocationAccuracyMeters: 100,
        signOutReminderOffsetsMinutes: [0, 15, 30],
        punchDeduplicationMinutes: 2,
        approvedNetworkCidrs: ["10.0.0.0/8"],
      };
      await saveAttendancePolicyInDatabase(
        organisationId,
        attendance,
        "Set approved working hours",
        actor,
      );
      await assertHours(7.5);
      const [policy] =
        await sql`SELECT * FROM attendance_policies WHERE organisation_id=${organisationId}`;
      assert.equal(policy!.break_start, "12:00");
      assert.equal(
        flexibleOfficeSchedule("08:00", "16:00", Number(policy!.standard_daily_hours), {
          breakStart: policy!.break_start,
          defaultBreakMinutes: policy!.default_break_minutes,
        }).calculatedHours,
        7.5,
      );
      const timesheet = {
        standardDailyHours: 6.5,
        weeklyPeriodStartDay: 0,
        submissionDeadlineDays: 2,
        overtimeThresholdWeekly: 40,
        allowCopyPreviousWeek: true,
        payrollLockBehaviour: "Manual by HR" as const,
        requireHrOvertimeVerification: true,
        attendanceVarianceToleranceHours: 0.25,
      };
      await updateTimesheetSettingsInDatabase(organisationId, timesheet, actor);
      await assertHours(6.5);
      await saveAppSettings(
        organisationId,
        { ...(await getAppSettings(organisationId)), standardDailyHours: 8 },
        { ...actor, activeRole: "Super Admin", roles: ["Super Admin"] },
      );
      await assertHours(8);
      const [retained] =
        await sql`SELECT break_start,default_break_minutes,approved_network_cidrs FROM attendance_policies WHERE organisation_id=${organisationId}`;
      assert.equal(retained!.break_start, "12:00");
      assert.equal(retained!.default_break_minutes, 30);
      assert.deepEqual(retained!.approved_network_cidrs, ["10.0.0.0/8"]);
      await assert.rejects(
        saveAttendancePolicyInDatabase(
          organisationId,
          { ...attendance, breakStart: "23:45" },
          "Invalid break should fail",
          actor,
        ),
        /midnight/,
      );
      await assertHours(8);
      await assert.rejects(
        updateTimesheetSettingsInDatabase(organisationId, timesheet, {
          ...actor,
          activeRole: "Employee",
          roles: ["Employee"],
        }),
        /Only HR/,
      );
      await assertHours(8);
      await Promise.all([
        updateTimesheetSettingsInDatabase(
          organisationId,
          { ...timesheet, standardDailyHours: 7 },
          actor,
        ),
        saveAttendancePolicyInDatabase(
          organisationId,
          { ...attendance, standardDailyHours: 9 },
          "Concurrent approved update",
          actor,
        ),
      ]);
      const [final] =
        await sql`SELECT standard_daily_hours FROM app_settings WHERE organisation_id=${organisationId}`;
      await assertHours(Number(final!.standard_daily_hours));
    } finally {
      // Isolated uniquely named test fixtures retain their immutable audit history.
      await sql.end({ timeout: 1 });
      await closeDatabaseConnection();
    }
  },
);
