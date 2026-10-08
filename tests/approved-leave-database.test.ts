import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  decideTimesheetInDatabase,
  listTimesheetSnapshotForActor,
  processTimesheetWorker,
  generateTimesheetPeriodsInDatabase,
  getOrCreateTimesheetInDatabase,
  submitTimesheetInDatabase,
  saveTimesheetDraftInDatabase,
} from "../src/lib/db/repositories/timesheet.repository.server.ts";
import { getMyLiveAttendance } from "../src/lib/db/repositories/attendance.repository.server.ts";
import { missingClockoutCandidates } from "../src/lib/db/repositories/missing-clockout.repository.server.ts";
import { getDatabaseClient } from "../src/lib/db/client.ts";

const url = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (url) process.env["DATABASE_URL"] = url;

test(
  "approved leave automates timesheets without employee login, fake punches, duplicate submissions or balance deductions",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /(test|scratch)/i);
    const sql = postgres(url!, { prepare: false, max: 4 });
    const org = randomUUID(),
      manager = randomUUID(),
      managerUser = randomUUID(),
      hr = randomUUID(),
      hrUser = randomUUID(),
      employee = randomUUID(),
      employeeUser = randomUUID(),
      half = randomUUID(),
      halfUser = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employmentType = randomUUID(),
      policy = randomUUID();
    const actor = (person: string, user: string, role: "HR" | "Line Manager" | "Employee") => ({
      employeeId: person,
      userId: user,
      activeRole: role,
      roles: [role],
      displayName: role,
    });
    const employeeActor = actor(employee, employeeUser, "Employee"),
      hrActor = actor(hr, hrUser, "HR"),
      managerActor = actor(manager, managerUser, "Line Manager");
    try {
      await sql`INSERT INTO organisations (id,name,slug,created_by,updated_by) VALUES (${org},'Leave Automation Test',${org},${hrUser},${hrUser})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["locations", location],
        ["employment_types", employmentType],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,'Test','TEST',true,1,$3,$3)`,
          [id, org, hrUser],
        );
      for (const [person, user, supervisor, name] of [
        [manager, managerUser, null, "Manager"],
        [hr, hrUser, null, "HR"],
        [employee, employeeUser, manager, "Full leave employee"],
        [half, halfUser, manager, "Half leave employee"],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,employment_confirmation_status,created_by,updated_by) VALUES (${person},${org},${person},${name},${name},${`${person}@test.invalid`},${department},${position},${location},${employmentType},${supervisor},'Active','2020-01-01','Confirmed',${hrUser},${hrUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${user},${org},${person},${name},${`${person}@test.invalid`},'Active',${hrUser},${hrUser})`;
      }
      for (const [user, role] of [
        [hrUser, "HR"],
        [managerUser, "Line Manager"],
      ] as const)
        await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason) SELECT ${org},${user},id,${hrUser},'Test' FROM roles WHERE code=${role}`;
      await sql`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by) VALUES (${org},'Asia/Muscat','OMR',${[1, 2, 3, 4, 5]},8,40,'01-01','12-31',${[30]},'VIA-{SEQ}','CAN-{SEQ}',${hrUser},${hrUser})`;
      await sql`INSERT INTO timesheet_settings (organisation_id,weekly_period_start_day,standard_daily_hours,submission_deadline_days,overtime_threshold_weekly,payroll_lock_behaviour,attendance_variance_tolerance_hours,created_by,updated_by) VALUES (${org},1,8,2,40,'Manual by HR',0.25,${hrUser},${hrUser})`;
      await sql`INSERT INTO attendance_policies (organisation_id,standard_daily_hours,expected_clock_in,expected_clock_out,default_break_minutes,late_grace_minutes,maximum_location_accuracy_meters,sign_out_reminder_offsets_minutes,punch_deduplication_minutes,created_by,updated_by) VALUES (${org},8,'08:30','17:30',60,5,100,${[0, 15, 30]},2,${hrUser},${hrUser})`;
      await sql`INSERT INTO leave_policies (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,eligibility,approval_chain,created_by,updated_by) VALUES (${policy},${org},'AL','Annual Leave','Annual','Annual','Annual',true,'Annual','Upfront','{}','[]',${hrUser},${hrUser})`;
      await sql`INSERT INTO leave_balances (organisation_id,employee_id,policy_id,leave_year,balance_days,created_by,updated_by) VALUES (${org},${employee},${policy},2026,12.25,${hrUser},${hrUser})`;
      const addLeave = async (person: string, start: string, end: string, isHalf = false) => {
        const id = randomUUID();
        await sql`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) VALUES (${id},${org},${person},${policy},${start},${end},${isHalf},${isHalf ? 0.5 : 7},'Approved absence','Approved',${sql.json({ name: "Annual Leave — imported history" })},${hrUser},${hrUser})`;
        return id;
      };
      await addLeave(employee, "2026-09-01", "2026-09-30");
      await addLeave(employee, "2026-10-01", "2026-10-31");
      const halfLeave = await addLeave(half, "2026-10-08", "2026-10-08", true);
      // Old weekly periods stay available as history, but must not trigger weekly reminders.
      const legacyPeriod = randomUUID();
      await sql`INSERT INTO timesheet_periods (id,organisation_id,start_date,end_date,status,created_by,updated_by) VALUES (${legacyPeriod},${org},'2026-09-28','2026-10-04','Open',${hrUser},${hrUser})`;
      const at = new Date("2026-10-08T07:00:00Z");
      await Promise.all([processTimesheetWorker(at), processTimesheetWorker(at)]);
      let snapshot = await listTimesheetSnapshotForActor(org, employeeActor);
      assert.equal(snapshot.settings.periodFrequency, "Monthly");
      const pastPeriod = snapshot.periods.find((period) => period.startDate === "2026-09-01")!;
      assert.equal(pastPeriod.endDate, "2026-09-30");
      assert.equal(
        snapshot.periods.find((period) => period.startDate === "2026-10-01")!.endDate,
        "2026-10-31",
      );
      const sheet = snapshot.timesheets.find((item) => item.periodId === pastPeriod.id)!;
      assert.equal(sheet.status, "Pending Manager");
      assert.equal(sheet.totalHours, 0);
      assert.equal(sheet.expectedHours, 0);
      assert.equal(
        sheet.entries.filter((entry) => entry.isLeave).reduce((sum, entry) => sum + entry.total, 0),
        198,
      );
      assert.equal(sheet.entries[0]!.notes, "Annual Leave");
      assert.equal(
        snapshot.timesheets.find(
          (item) =>
            snapshot.periods.find((period) => period.id === item.periodId)?.startDate ===
            "2026-10-01",
        )!.status,
        "Draft",
        "unfinished months never submit early",
      );
      const halfSnapshot = await listTimesheetSnapshotForActor(
        org,
        actor(half, halfUser, "Employee"),
      );
      const halfSheet = halfSnapshot.timesheets.find(
        (item) =>
          halfSnapshot.periods.find((period) => period.id === item.periodId)?.startDate ===
          "2026-10-01",
      )!;
      assert.equal(halfSheet.expectedHours, 193.5);
      assert.equal(halfSheet.entries[0]!.total, 4.5);
      await sql`UPDATE leave_requests SET status='Cancellation Pending' WHERE id=${halfLeave}`;
      assert.equal(
        (
          await listTimesheetSnapshotForActor(org, actor(half, halfUser, "Employee"))
        ).timesheets.find((item) => item.id === halfSheet.id)!.expectedHours,
        193.5,
      );
      await sql`UPDATE leave_requests SET status='Cancellation Approved' WHERE id=${halfLeave}`;
      assert.equal(
        (
          await listTimesheetSnapshotForActor(org, actor(half, halfUser, "Employee"))
        ).timesheets.find((item) => item.id === halfSheet.id)!.expectedHours,
        198,
      );
      await assert.rejects(
        decideTimesheetInDatabase(org, sheet.id, "approve", undefined, employeeActor),
        /assigned timesheet approver/,
      );
      await decideTimesheetInDatabase(org, sheet.id, "approve", undefined, managerActor);
      assert.equal(
        (await listTimesheetSnapshotForActor(org, employeeActor)).timesheets.find(
          (item) => item.id === sheet.id,
        )!.status,
        "Pending HR",
      );
      await decideTimesheetInDatabase(org, sheet.id, "approve", undefined, hrActor);
      snapshot = await listTimesheetSnapshotForActor(org, employeeActor);
      const approved = snapshot.timesheets.find((item) => item.id === sheet.id)!;
      assert.equal(approved.status, "Approved");
      await sql`UPDATE leave_requests SET status='Cancelled' WHERE organisation_id=${org} AND start_date='2026-09-01'`;
      const frozen = (await listTimesheetSnapshotForActor(org, employeeActor)).timesheets.find(
        (item) => item.id === sheet.id,
      )!;
      assert.deepEqual(
        frozen.entries,
        approved.entries,
        "approved timesheets retain the reviewed absence snapshot",
      );
      assert.equal(frozen.expectedHours, 0);
      await processTimesheetWorker(at);
      const [duplicates] =
        await sql`SELECT count(*)::int AS count FROM timesheets WHERE organisation_id=${org} AND employee_id=${employee} AND period_id=${pastPeriod.id}`;
      assert.equal(duplicates!.count, 1);
      const [reminders] =
        await sql`SELECT count(*)::int AS count FROM notifications WHERE organisation_id=${org} AND recipient_user_id=${employeeUser} AND title IN ('Timesheet due soon','Timesheet due today','Timesheet overdue')`;
      assert.equal(reminders!.count, 0);
      const [punches] =
        await sql`SELECT count(*)::int AS count FROM attendance_records WHERE organisation_id=${org}`;
      assert.equal(punches!.count, 0, "leave never manufactures attendance punches");
      const [balance] =
        await sql`SELECT balance_days,record_version FROM leave_balances WHERE organisation_id=${org}`;
      assert.equal(Number(balance!.balance_days), 12.25);
      assert.equal(balance!.record_version, 1);
      const [ledger] =
        await sql`SELECT count(*)::int AS count FROM leave_transactions WHERE organisation_id=${org}`;
      assert.equal(ledger!.count, 0, "timesheet automation never re-deducts approved leave");
      const [weeklyReminders] =
        await sql`SELECT count(*)::int AS count FROM notifications WHERE organisation_id=${org} AND deduplication_key LIKE ${`timesheet-${legacyPeriod}-%`}`;
      assert.equal(
        weeklyReminders!.count,
        0,
        "the monthly cutover must not continue weekly reminders",
      );
      // PostgreSQL creates a whole month even when HR selects dates within it, idempotently.
      assert.equal(
        await generateTimesheetPeriodsInDatabase(org, "2090-04-12", "2090-04-20", hrActor),
        1,
      );
      assert.equal(
        await generateTimesheetPeriodsInDatabase(org, "2090-04-01", "2090-04-30", hrActor),
        0,
      );
      const future = (await listTimesheetSnapshotForActor(org, employeeActor)).periods.find(
        (period) => period.startDate === "2090-04-01",
      )!;
      assert.equal(future.endDate, "2090-04-30");
      const halfActor = actor(half, halfUser, "Employee");
      const concurrent = await Promise.all([
        getOrCreateTimesheetInDatabase(org, half, future.id, halfActor),
        getOrCreateTimesheetInDatabase(org, half, future.id, halfActor),
      ]);
      assert.equal(concurrent[0], concurrent[1], "concurrent starts create one monthly timesheet");
      await assert.rejects(
        submitTimesheetInDatabase(org, concurrent[0]!, halfActor),
        /after the month ends/,
      );
      // Creating a monthly sheet must not double-count an employee's reviewed weekly history.
      const legacySheet = randomUUID();
      await sql`INSERT INTO timesheets (id,organisation_id,employee_id,period_id,status,expected_hours,total_hours,created_by,updated_by) VALUES (${legacySheet},${org},${manager},${legacyPeriod},'Approved',45,45,${hrUser},${hrUser})`;
      const october = snapshot.periods.find((period) => period.startDate === "2026-10-01")!;
      await assert.rejects(
        getOrCreateTimesheetInDatabase(org, manager, october.id, managerActor),
        /not counted twice/,
      );
      const [history] =
        await sql`SELECT status,total_hours,record_version FROM timesheets WHERE id=${legacySheet}`;
      assert.equal(history!.status, "Approved");
      assert.equal(Number(history!.total_hours), 45);
      assert.equal(history!.record_version, 1);

      // Ordinary daily work also remains one monthly database record through both reviews.
      const project = randomUUID(),
        costCentre = randomUUID(),
        activity = randomUUID();
      for (const [table, id] of [
        ["cost_centres", costCentre],
        ["activity_codes", activity],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,'Monthly work','MONTHLY',true,1,$3,$3)`,
          [id, org, hrUser],
        );
      await sql`INSERT INTO projects (id,organisation_id,name,code,is_active,order_index,cost_centre_id,created_by,updated_by) VALUES (${project},${org},'Monthly project','MONTHLY',true,1,${costCentre},${hrUser},${hrUser})`;
      const monthlyWork = await getOrCreateTimesheetInDatabase(org, half, pastPeriod.id, halfActor);
      const hours: Record<string, number> = {};
      for (let day = 1; day <= 30; day++) {
        const date = `2026-09-${String(day).padStart(2, "0")}`;
        if ([1, 2, 3, 4, 5].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) hours[date] = 9;
      }
      await saveTimesheetDraftInDatabase(
        org,
        monthlyWork,
        [
          {
            id: randomUUID(),
            projectId: project,
            costCentreId: costCentre,
            activityCodeId: activity,
            locationId: location,
            hours,
          },
        ],
        {},
        halfActor,
      );
      await submitTimesheetInDatabase(org, monthlyWork, halfActor);
      await assert.rejects(
        decideTimesheetInDatabase(org, monthlyWork, "approve", undefined, hrActor),
        /assigned timesheet approver/,
      );
      await decideTimesheetInDatabase(org, monthlyWork, "approve", undefined, managerActor);
      assert.equal(
        (await listTimesheetSnapshotForActor(org, halfActor)).timesheets.find(
          (item) => item.id === monthlyWork,
        )!.status,
        "Pending HR",
      );
      await decideTimesheetInDatabase(org, monthlyWork, "approve", undefined, hrActor);
      const reviewed = (await listTimesheetSnapshotForActor(org, halfActor)).timesheets.find(
        (item) => item.id === monthlyWork,
      )!;
      assert.equal(reviewed.status, "Approved");
      assert.equal(reviewed.totalHours, 198);
      assert.equal(reviewed.expectedHours, 198);
      const [dailyEntries] =
        await sql`SELECT count(*)::int AS count FROM timesheet_entries WHERE timesheet_id=${monthlyWork}`;
      assert.equal(dailyEntries!.count, 22);

      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Muscat",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (today < "2026-10-01" || today > "2026-10-31") await addLeave(employee, today, today);
      const live = await getMyLiveAttendance(org, employeeActor);
      assert.equal(live.approvedLeaveFraction, 1);
      assert.equal(live.targetMinutes, 0);
      assert.equal(live.leaveType, "Annual Leave");
      assert.equal(live.record, null);
      // A backdated full approval also suppresses a stale missing-clock-out email.
      await sql`INSERT INTO attendance_records (organisation_id,employee_id,date,clock_in_at,source,status,calculated_hours,created_by,updated_by) VALUES (${org},${employee},'2026-10-07','2026-10-07T04:30:00Z','Web','Present',0,${employeeUser},${employeeUser})`;
      const candidates = await getDatabaseClient().execute(missingClockoutCandidates(at));
      assert.ok(!candidates.some((candidate) => candidate["employee_id"] === employee));
      await processTimesheetWorker(new Date("2026-11-01T07:00:00Z"));
      const conflictSheet = (
        await listTimesheetSnapshotForActor(org, employeeActor)
      ).timesheets.find(
        (item) =>
          item.periodId ===
          snapshot.periods.find((period) => period.startDate === "2026-10-01")!.id,
      )!;
      assert.equal(
        conflictSheet.status,
        "Draft",
        "real attendance conflicts must not be auto-submitted as leave-only",
      );
      assert.equal(
        (conflictSheet.attendanceReconciliationSnapshot as { unresolvedCount: number })
          .unresolvedCount,
        1,
      );
    } finally {
      await sql`UPDATE organisations SET is_active=false WHERE id=${org}`;
      await sql.end({ timeout: 5 });
    }
  },
);
