import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";
import { getDatabaseClient } from "../src/lib/db/client.ts";
import {
  listLeaveAttendanceOverlapReviewsInDatabase,
  previewExistingApprovedLeaveOfficeOverlapsInDatabase,
  reconcileApprovedLeaveForOfficeWorkDayInDatabase,
  resolveLeaveAttendanceOverlapReviewInDatabase,
  stageExistingApprovedLeaveOfficeOverlapInDatabase,
  stageOfficeWorkOverlapsAfterLeaveApprovalInDatabase,
} from "../src/lib/db/repositories/leave-attendance-reconciliation.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "verified office punches remove only the approved leave day and refund its balance once",
  {
    skip: !testDatabaseUrl,
  },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 2, prepare: false });
    const organisationId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const locationId = randomUUID();
    const employmentTypeId = randomUUID();
    const employeeId = randomUUID();
    const employeeUserId = randomUUID();
    const hrEmployeeId = randomUUID();
    const hrUserId = randomUUID();
    const policyId = randomUUID();
    const requestId = randomUUID();
    const eventPolicyId = randomUUID();
    const eventRequestId = randomUUID();
    const deviceId = randomUUID();
    const firstRecordId = randomUUID();
    const secondRecordId = randomUUID();
    const eventRecordId = randomUUID();
    try {
      await sql`insert into organisations (id,name,slug,is_active,created_by,updated_by)
      values (${organisationId},'Leave overlap test',${`overlap-${organisationId}`},true,${hrUserId},${hrUserId})`;
      for (const [table, id, name] of [
        ["departments", departmentId, "Design"],
        ["positions", positionId, "Engineer"],
        ["employment_types", employmentTypeId, "Full-time"],
      ] as const) {
        await sql.unsafe(
          `insert into ${table}
        (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        values ($1,$2,$3,$4,true,1,$5,$5)`,
          [id, organisationId, name, name.slice(0, 3).toUpperCase(), hrUserId],
        );
      }
      await sql`insert into locations
      (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by)
      values (${locationId},${organisationId},'Head Office','HQ',true,1,23.588,58.383,150,true,${hrUserId},${hrUserId})`;
      for (const [personId, userId, name] of [
        [employeeId, employeeUserId, "Employee"],
        [hrEmployeeId, hrUserId, "HR Reviewer"],
      ] as const) {
        await sql`insert into employees
        (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,
         location_id,employment_type_id,status,start_date,gender,nationality,created_by,updated_by)
        values (${personId},${organisationId},${`OV-${personId.slice(0, 6)}`},${name},${name},
          ${`${personId}@viahr.test`},${departmentId},${positionId},${locationId},${employmentTypeId},
          'Active','2025-01-01','Male','Omani',${hrUserId},${hrUserId})`;
        await sql`insert into users
        (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
        values (${userId},${organisationId},${personId},${name},${`${personId}@viahr.test`},
          'Active',${hrUserId},${hrUserId})`;
      }
      const [hrRole] = await sql<{ id: string }[]>`select id from roles where code='HR'`;
      await sql`insert into user_roles (organisation_id,user_id,role_id,assigned_by)
      values (${organisationId},${hrUserId},${hrRole!.id},${hrUserId})`;
      await sql`insert into app_settings
      (organisation_id,timezone,base_currency,working_days,standard_daily_hours,standard_weekly_hours,
       leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,
       created_by,updated_by)
      values (${organisationId},'Asia/Muscat','OMR',${[1, 2, 3, 4, 5]},8,40,'01-01','12-31',
        ${[60, 30, 14, 7]},'VIA-{YYYY}-{SEQ}','CAN-{YYYY}-{SEQ}',${hrUserId},${hrUserId})`;
      await sql`insert into leave_policies
      (id,organisation_id,code,name,type,category,description,is_paid,base_entitlement_days,scope,
       accrual_mode,carry_forward_limit,allow_negative_balance,requires_attachment,
       requires_handover_contact,counts_toward_gratuity,approval_chain,is_enabled,is_statutory,
       consumes_balance,created_by,updated_by)
      values (${policyId},${organisationId},'AL','Annual Leave','Annual','Statutory','Annual leave',
        true,10,'Annual','Upfront',0,false,false,false,true,${sql.json(["HR"])},true,true,true,
        ${hrUserId},${hrUserId})`;
      await sql`insert into leave_balances
      (organisation_id,employee_id,policy_id,leave_year,balance_days,created_by,updated_by)
      values (${organisationId},${employeeId},${policyId},2026,8,${hrUserId},${hrUserId})`;
      await sql`insert into leave_requests
      (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,working_days_requested,
       reason,status,chain_approvals,policy_snapshot,created_by,updated_by)
      values (${requestId},${organisationId},${employeeId},${policyId},'2026-11-10','2026-11-11',
        false,2,'Approved leave','Approved',${sql.json([{ role: "HR", approvedBy: hrUserId, status: "Approved" }])},
        ${sql.json({
          name: "Annual Leave",
          type: "Annual",
          isPaid: true,
          workingDates: ["2026-11-10", "2026-11-11"],
        })},${hrUserId},${hrUserId})`;
      await sql`insert into leave_transactions
      (organisation_id,employee_id,policy_id,date,transaction_type,days,reason,reference_id,
       actor_user_id,created_by,updated_by)
      values (${organisationId},${employeeId},${policyId},'2026-11-10','Approved Leave',-2,
        'Approved by HR',${requestId},${hrUserId},${hrUserId},${hrUserId})`;
      await sql`insert into attendance_devices
      (id,organisation_id,code,name,location_id,is_active,created_by,updated_by)
      values (${deviceId},${organisationId},'F18','Head Office F18',${locationId},true,${hrUserId},${hrUserId})`;
      for (const [date, recordId, hours, clockOut] of [
        ["2026-11-10", firstRecordId, 8.5, "2026-11-10T17:30:00+04:00"],
        ["2026-11-11", secondRecordId, 0.5, "2026-11-11T09:00:00+04:00"],
      ] as const) {
        await sql`insert into attendance_records
        (id,organisation_id,employee_id,date,clock_in_at,clock_out_at,source,work_mode,status,
         calculated_hours,location_id,created_by,updated_by)
        values (${recordId},${organisationId},${employeeId},${date},${`${date}T08:30:00+04:00`},
          ${clockOut},'Hardware Terminal','Office','Present',${hours},${locationId},${hrUserId},${hrUserId})`;
        for (const [suffix, time, status] of [
          ["in", `${date}T08:30:00+04:00`, 0],
          ["out", clockOut, 1],
        ] as const) {
          await sql`insert into attendance_device_punches
          (organisation_id,device_id,external_event_id,device_user_id,occurred_at,device_status,
           employee_id,attendance_record_id,status)
          values (${organisationId},${deviceId},${`${recordId}-${suffix}`},'23',${time},${status},
            ${employeeId},${recordId},'Applied')`;
        }
      }

      const db = getDatabaseClient();
      const firstInput = {
        organisationId,
        employeeId,
        date: "2026-11-10",
        attendanceRecordId: firstRecordId,
        observedWorkHours: 8.5,
        explicitOut: true,
      };
      const first = await db.transaction((tx) =>
        reconcileApprovedLeaveForOfficeWorkDayInDatabase(tx, firstInput),
      );
      assert.equal(first.kind, "changed");
      const secondPass = await db.transaction((tx) =>
        reconcileApprovedLeaveForOfficeWorkDayInDatabase(tx, firstInput),
      );
      assert.ok(["no-overlap", "already-reconciled"].includes(secondPass.kind));
      const [afterFirst] = await sql<
        {
          balance_days: string;
          working_days_requested: string;
          policy_snapshot: { workingDates: string[]; officeWorkCorrections: unknown[] };
        }[]
      >`
      select b.balance_days,r.working_days_requested,r.policy_snapshot from leave_balances b
      join leave_requests r on r.employee_id=b.employee_id and r.policy_id=b.policy_id
      where r.id=${requestId}`;
      assert.equal(Number(afterFirst!.balance_days), 9);
      assert.equal(Number(afterFirst!.working_days_requested), 1);
      assert.deepEqual(afterFirst!.policy_snapshot.workingDates, ["2026-11-11"]);
      assert.equal(afterFirst!.policy_snapshot.officeWorkCorrections.length, 1);
      const [credit] = await sql<{ count: string }[]>`select count(*) from leave_transactions
      where reference_id=${requestId} and transaction_type='Cancellation Restoration'`;
      assert.equal(Number(credit!.count), 1);

      const historicalPreview =
        await previewExistingApprovedLeaveOfficeOverlapsInDatabase(organisationId);
      assert.equal(
        historicalPreview.some((item) => item.date === "2026-11-11"),
        true,
      );
      const stagedAfterApproval = await db.transaction((tx) =>
        stageOfficeWorkOverlapsAfterLeaveApprovalInDatabase(tx, { organisationId, requestId }),
      );
      assert.equal(stagedAfterApproval, 1);
      await assert.rejects(
        stageExistingApprovedLeaveOfficeOverlapInDatabase(
          organisationId,
          {
            requestId,
            date: "2026-11-11",
            attendanceRecordId: secondRecordId,
          },
          { userId: employeeUserId, employeeId, displayName: "Employee" },
        ),
        /Only an active HR/,
      );
      const staged = await stageExistingApprovedLeaveOfficeOverlapInDatabase(
        organisationId,
        {
          requestId,
          date: "2026-11-11",
          attendanceRecordId: secondRecordId,
        },
        { userId: hrUserId, employeeId: hrEmployeeId, displayName: "HR Reviewer" },
      );
      assert.equal(staged.kind, "needs-review");
      const shortDay = await db.transaction((tx) =>
        reconcileApprovedLeaveForOfficeWorkDayInDatabase(tx, {
          organisationId,
          employeeId,
          date: "2026-11-11",
          attendanceRecordId: secondRecordId,
          observedWorkHours: 0.5,
          explicitOut: true,
        }),
      );
      assert.equal(shortDay.kind, "needs-review");
      const [review] = await listLeaveAttendanceOverlapReviewsInDatabase(organisationId);
      assert.equal(review?.date, "2026-11-11");
      await assert.rejects(
        resolveLeaveAttendanceOverlapReviewInDatabase(
          organisationId,
          {
            reviewId: review!.reviewId,
            decision: "remove-leave",
            reason: "Confirmed office work",
          },
          { userId: employeeUserId, employeeId, displayName: "Employee" },
        ),
        /Only an active HR/,
      );
      const manual = await resolveLeaveAttendanceOverlapReviewInDatabase(
        organisationId,
        {
          reviewId: review!.reviewId,
          decision: "remove-leave",
          reason: "HR verified the full office workday",
        },
        { userId: hrUserId, employeeId: hrEmployeeId, displayName: "HR Reviewer" },
      );
      assert.equal(manual.kind, "changed");
      const [final] = await sql<
        {
          balance_days: string;
          working_days_requested: string;
          status: string;
          policy_snapshot: { workingDates: string[]; officeWorkCorrections: unknown[] };
        }[]
      >`
      select b.balance_days,r.working_days_requested,r.status,r.policy_snapshot from leave_balances b
      join leave_requests r on r.employee_id=b.employee_id and r.policy_id=b.policy_id
      where r.id=${requestId}`;
      assert.equal(Number(final!.balance_days), 10);
      assert.equal(Number(final!.working_days_requested), 0);
      assert.equal(final!.status, "Cancellation Approved");
      assert.deepEqual(final!.policy_snapshot.workingDates, []);
      assert.equal(final!.policy_snapshot.officeWorkCorrections.length, 2);
      assert.equal((await listLeaveAttendanceOverlapReviewsInDatabase(organisationId)).length, 0);
      assert.equal(
        (
          await listLeaveAttendanceOverlapReviewsInDatabase(organisationId, {
            includeResolved: true,
          })
        ).length,
        1,
      );

      // Per-event leave is ledger-tracked but deliberately has no leave_balances row.
      await sql`insert into leave_policies
      (id,organisation_id,code,name,type,category,description,is_paid,base_entitlement_days,scope,
       accrual_mode,carry_forward_limit,allow_negative_balance,requires_attachment,
       requires_handover_contact,counts_toward_gratuity,approval_chain,is_enabled,is_statutory,
       consumes_balance,created_by,updated_by)
      values (${eventPolicyId},${organisationId},'COMP','Compassionate Leave','Compassionate',
        'Company','Compassionate leave',true,5,'Per Event','Not Applicable',0,false,false,false,true,
        ${sql.json(["HR"])},true,false,true,${hrUserId},${hrUserId})`;
      await sql`insert into leave_requests
      (id,organisation_id,employee_id,policy_id,start_date,end_date,is_half_day,working_days_requested,
       reason,status,chain_approvals,policy_snapshot,created_by,updated_by)
      values (${eventRequestId},${organisationId},${employeeId},${eventPolicyId},'2026-11-12','2026-11-12',
        false,1,'Approved event leave','Approved',${sql.json([{ role: "HR", approvedBy: hrUserId, status: "Approved" }])},
        ${sql.json({
          name: "Compassionate Leave",
          type: "Compassionate",
          isPaid: true,
          workingDates: ["2026-11-12"],
        })},${hrUserId},${hrUserId})`;
      await sql`insert into leave_transactions
      (organisation_id,employee_id,policy_id,date,transaction_type,days,reason,reference_id,
       actor_user_id,created_by,updated_by)
      values (${organisationId},${employeeId},${eventPolicyId},'2026-11-12','Approved Leave',-1,
        'Approved by HR',${eventRequestId},${hrUserId},${hrUserId},${hrUserId})`;
      await sql`insert into attendance_records
      (id,organisation_id,employee_id,date,clock_in_at,clock_out_at,source,work_mode,status,
       calculated_hours,location_id,created_by,updated_by)
      values (${eventRecordId},${organisationId},${employeeId},'2026-11-12',
        '2026-11-12T08:30:00+04:00','2026-11-12T17:30:00+04:00','Hardware Terminal',
        'Office','Present',8.5,${locationId},${hrUserId},${hrUserId})`;
      for (const [suffix, time, status] of [
        ["in", "2026-11-12T08:30:00+04:00", 0],
        ["out", "2026-11-12T17:30:00+04:00", 1],
      ] as const) {
        await sql`insert into attendance_device_punches
        (organisation_id,device_id,external_event_id,device_user_id,occurred_at,device_status,
         employee_id,attendance_record_id,status)
        values (${organisationId},${deviceId},${`${eventRecordId}-${suffix}`},'23',${time},${status},
          ${employeeId},${eventRecordId},'Applied')`;
      }
      const eventResult = await db.transaction((tx) =>
        reconcileApprovedLeaveForOfficeWorkDayInDatabase(tx, {
          organisationId,
          employeeId,
          date: "2026-11-12",
          attendanceRecordId: eventRecordId,
          observedWorkHours: 8.5,
          explicitOut: true,
        }),
      );
      assert.equal(eventResult.kind, "changed");
      const [eventRow] = await sql<{ status: string; working_days_requested: string }[]>`
      select status,working_days_requested from leave_requests where id=${eventRequestId}`;
      assert.equal(eventRow!.status, "Cancellation Approved");
      assert.equal(Number(eventRow!.working_days_requested), 0);
      const [eventLedger] = await sql<{ net: string }[]>`
      select sum(days)::text as net from leave_transactions where reference_id=${eventRequestId}`;
      assert.equal(Number(eventLedger!.net), 0);
      const [eventBalance] = await sql<{ count: string }[]>`
      select count(*) from leave_balances where employee_id=${employeeId} and policy_id=${eventPolicyId}`;
      assert.equal(Number(eventBalance!.count), 0);
    } finally {
      await sql.end();
    }
  },
);
