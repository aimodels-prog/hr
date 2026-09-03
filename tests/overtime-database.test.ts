import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  assignOvertimeToPayrollInDatabase,
  correctOvertimeClaimInDatabase,
  createOvertimeClaimInDatabase,
  decideOvertimeClaimInDatabase,
  exportPayrollOvertimeLedgerInDatabase,
  listOvertimeClaimsForActor,
  listPayrollOvertimeLedgerInDatabase,
  processOvertimeWorker,
} from "../src/lib/db/repositories/overtime.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "overtime is scoped, approved, credited, corrected and sent to payroll in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 5, prepare: false });
    const ids = Object.fromEntries(
      [
        "organisation",
        "department",
        "position",
        "employmentType",
        "location",
        "project",
        "costCentre",
        "activity",
        "managerEmployee",
        "managerUser",
        "otherManagerEmployee",
        "otherManagerUser",
        "hrEmployee",
        "hrUser",
        "accountsEmployee",
        "accountsUser",
        "employee",
        "employeeUser",
        "policy",
        "payrollPeriod",
      ].map((key) => [key, randomUUID()]),
    ) as Record<string, string>;
    const now = new Date();
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 2);
    const workDate = date.toISOString().slice(0, 10);
    const toilDateValue = new Date(date);
    toilDateValue.setUTCDate(toilDateValue.getUTCDate() - 1);
    const toilDate = toilDateValue.toISOString().slice(0, 10);
    const actor = (
      userId: string,
      employeeId: string,
      activeRole: "Employee" | "Line Manager" | "HR" | "Accounts",
    ) => ({
      userId,
      employeeId,
      displayName: `${activeRole} database actor`,
      activeRole,
      roles: ["Employee", activeRole] as const,
    });
    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${ids.organisation},'Overtime Test',${`overtime-${ids.organisation}`},true,${ids.hrUser},${ids.hrUser})`;
      for (const [table, key, name, code] of [
        ["departments", "department", "Operations", "OPS"],
        ["positions", "position", "Coordinator", "COORD"],
        ["employment_types", "employmentType", "Full-time", "FT"],
        ["cost_centres", "costCentre", "Operations", "CC-OPS"],
        ["activity_codes", "activity", "Delivery", "DELIVERY"],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,$3,$4,true,1,$5,$5)`,
          [ids[key], ids.organisation, name, code, ids.hrUser],
        );
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by) VALUES (${ids.location},${ids.organisation},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${ids.hrUser},${ids.hrUser})`;
      await sql`INSERT INTO projects (id,organisation_id,name,code,is_active,order_index,cost_centre_id,created_by,updated_by) VALUES (${ids.project},${ids.organisation},'Trade Operations','TRADE',true,1,${ids.costCentre},${ids.hrUser},${ids.hrUser})`;
      for (const [employeeKey, userKey, name, manager] of [
        ["managerEmployee", "managerUser", "Manager", null],
        ["otherManagerEmployee", "otherManagerUser", "Other Manager", null],
        ["hrEmployee", "hrUser", "HR", null],
        ["accountsEmployee", "accountsUser", "Accounts", null],
        ["employee", "employeeUser", "Employee", ids.managerEmployee],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,created_by,updated_by) VALUES (${ids[employeeKey]},${ids.organisation},${`OT-${ids[employeeKey]!.slice(0, 6)}`},${name},${name},${`${ids[employeeKey]}@viahr.test`},${ids.department},${ids.position},${ids.location},${ids.employmentType},${manager},'Active','2020-01-01',${ids.hrUser},${ids.hrUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${ids[userKey]},${ids.organisation},${ids[employeeKey]},${name},${`${ids[employeeKey]}@viahr.test`},'Active',${ids.hrUser},${ids.hrUser})`;
      }
      const roleRows = await sql<
        { id: string; code: string }[]
      >`SELECT id,code FROM roles WHERE code IN ('HR','Line Manager','Accounts')`;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      for (const [userId, code] of [
        [ids.managerUser, "Line Manager"],
        [ids.otherManagerUser, "Line Manager"],
        [ids.hrUser, "HR"],
        [ids.accountsUser, "Accounts"],
      ] as const)
        await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by) VALUES (${ids.organisation},${userId},${roleIds[code]},${ids.hrUser})`;
      await sql`INSERT INTO timesheet_settings (organisation_id,weekly_period_start_day,standard_daily_hours,submission_deadline_days,overtime_threshold_weekly,allow_copy_previous_week,payroll_lock_behaviour,require_hr_overtime_verification,attendance_variance_tolerance_hours,created_by,updated_by) VALUES (${ids.organisation},1,8,2,40,true,'Manual by HR',true,0.25,${ids.hrUser},${ids.hrUser})`;
      await sql`INSERT INTO leave_policies (id,organisation_id,code,name,type,category,description,is_paid,base_entitlement_days,scope,accrual_mode,carry_forward_limit,allow_negative_balance,requires_attachment,requires_handover_contact,counts_toward_gratuity,approval_chain,is_enabled,is_statutory,consumes_balance,created_by,updated_by) VALUES (${ids.policy},${ids.organisation},'TOIL','Compensation Leave','Other','Company','Time off in lieu',true,0,'Ledger','Not Applicable',0,false,false,false,true,${sql.json(["Line Manager", "HR"])},true,false,true,${ids.hrUser},${ids.hrUser})`;
      await sql`INSERT INTO payroll_periods (id,organisation_id,name,start_date,end_date,cutoff_date,payment_date,status,created_by,updated_by) VALUES (${ids.payrollPeriod},${ids.organisation},'September Payroll','2026-09-01','2026-09-30','2026-09-25','2026-09-30','Collecting Inputs',${ids.accountsUser},${ids.accountsUser})`;
      const employeeActor = actor(ids.employeeUser!, ids.employee!, "Employee");
      const managerActor = actor(ids.managerUser!, ids.managerEmployee!, "Line Manager");
      const otherManagerActor = actor(
        ids.otherManagerUser!,
        ids.otherManagerEmployee!,
        "Line Manager",
      );
      const hrActor = actor(ids.hrUser!, ids.hrEmployee!, "HR");
      const accountsActor = actor(ids.accountsUser!, ids.accountsEmployee!, "Accounts");
      const base = {
        employeeId: ids.employee!,
        hours: 2,
        reason: "Evening client shipment coordination",
        compensationType: "Payment" as const,
        projectId: ids.project!,
        costCentreId: ids.costCentre!,
        activityCodeId: ids.activity!,
        locationId: ids.location!,
      };
      const paymentId = await createOvertimeClaimInDatabase(
        ids.organisation!,
        { ...base, date: workDate },
        employeeActor,
      );
      await assert.rejects(
        decideOvertimeClaimInDatabase(
          ids.organisation!,
          paymentId,
          "approve",
          undefined,
          otherManagerActor,
        ),
        /assigned overtime approver/,
      );
      await assert.rejects(
        decideOvertimeClaimInDatabase(
          ids.organisation!,
          paymentId,
          "approve",
          undefined,
          employeeActor,
        ),
        /assigned overtime approver|own overtime/,
      );
      await decideOvertimeClaimInDatabase(
        ids.organisation!,
        paymentId,
        "approve",
        undefined,
        managerActor,
      );
      const finalRace = await Promise.allSettled([
        decideOvertimeClaimInDatabase(
          ids.organisation!,
          paymentId,
          "approve",
          "Verified against attendance",
          hrActor,
        ),
        decideOvertimeClaimInDatabase(
          ids.organisation!,
          paymentId,
          "approve",
          "Verified against attendance",
          hrActor,
        ),
      ]);
      assert.equal(finalRace.filter((result) => result.status === "fulfilled").length, 1);
      const ledger = await listPayrollOvertimeLedgerInDatabase(ids.organisation!, accountsActor);
      assert.equal(ledger.find((row) => row.claimId === paymentId)?.state, "Ready for Payroll");
      await assignOvertimeToPayrollInDatabase(
        ids.organisation!,
        [paymentId],
        ids.payrollPeriod!,
        accountsActor,
      );
      assert.equal(
        (await listPayrollOvertimeLedgerInDatabase(ids.organisation!, accountsActor)).find(
          (row) => row.claimId === paymentId,
        )?.state,
        "Included in Payroll",
      );
      assert.match(
        await exportPayrollOvertimeLedgerInDatabase(ids.organisation!, accountsActor),
        /Employee Number/,
      );

      const toilId = await createOvertimeClaimInDatabase(
        ids.organisation!,
        { ...base, date: toilDate, compensationType: "TOIL" },
        employeeActor,
      );
      await decideOvertimeClaimInDatabase(
        ids.organisation!,
        toilId,
        "approve",
        undefined,
        managerActor,
      );
      await decideOvertimeClaimInDatabase(
        ids.organisation!,
        toilId,
        "approve",
        "TOIL verified",
        hrActor,
      );
      const [credited] =
        await sql`SELECT balance_days FROM leave_balances WHERE employee_id=${ids.employee} AND policy_id=${ids.policy}`;
      assert.equal(Number(credited?.balance_days), 0.25);
      const correctionId = await correctOvertimeClaimInDatabase(
        ids.organisation!,
        toilId,
        { hours: 1, reason: "Corrected overtime duration after review" },
        employeeActor,
      );
      const [reversed] =
        await sql`SELECT balance_days FROM leave_balances WHERE employee_id=${ids.employee} AND policy_id=${ids.policy}`;
      assert.equal(Number(reversed?.balance_days), 0);
      assert.equal(
        (await listOvertimeClaimsForActor(ids.organisation!, employeeActor)).find(
          (claim) => claim.id === correctionId,
        )?.status,
        "Pending Manager",
      );
      await sql`UPDATE overtime_claims SET updated_at=${new Date(now.getTime() - 72 * 60 * 60 * 1000)} WHERE id=${correctionId}`;
      assert.ok((await processOvertimeWorker(now)).reminders > 0);
      assert.equal((await processOvertimeWorker(now)).reminders, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
