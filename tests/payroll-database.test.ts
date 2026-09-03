import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import { encryptSensitiveJson } from "../src/lib/db/encryption.server.ts";
import {
  acknowledgePayrollExceptionInDatabase,
  addPayrollAdjustmentInDatabase,
  approvePayrollPeriodInDatabase,
  collectPayrollInputsInDatabase,
  createPayrollPeriodInDatabase,
  exportPayrollPeriodInDatabase,
  listPayrollPeriodsInDatabase,
  lockPayrollPeriodInDatabase,
  reopenPayrollPeriodInDatabase,
} from "../src/lib/db/repositories/payroll.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "payroll atomically consolidates source feeds, locks, exports and corrects in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "test-v1";
    process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({
      "test-v1": Buffer.alloc(32, 9).toString("base64"),
    });
    const sql = postgres(testDatabaseUrl!, { max: 5, prepare: false });
    const ids = Object.fromEntries(
      [
        "org",
        "department",
        "position",
        "employmentType",
        "location",
        "costCentre",
        "activity",
        "employee",
        "employeeUser",
        "accountsEmployee",
        "accountsUser",
        "adminEmployee",
        "adminUser",
        "policy",
        "overtime",
        "travel",
        "reimbursement",
        "evidenceOne",
        "evidenceTwo",
      ].map((key) => [key, randomUUID()]),
    ) as Record<string, string>;
    const actor = (userId: string, employeeId: string, activeRole: "Accounts" | "Super Admin") => ({
      userId,
      employeeId,
      displayName: `${activeRole} payroll actor`,
      activeRole,
      roles: ["Employee", activeRole] as const,
    });
    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${ids.org},'Payroll Test',${`payroll-${ids.org}`},true,${ids.adminUser},${ids.adminUser})`;
      for (const [table, key, name, code] of [
        ["departments", "department", "Operations", "OPS"],
        ["positions", "position", "Coordinator", "COORD"],
        ["employment_types", "employmentType", "Full-time", "FT"],
        ["cost_centres", "costCentre", "Operations", "CC-OPS"],
        ["activity_codes", "activity", "Delivery", "DELIVERY"],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,$3,$4,true,1,$5,$5)`,
          [ids[key], ids.org, name, code, ids.adminUser],
        );
      await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,latitude,longitude,radius_meters,is_clock_in_site,created_by,updated_by) VALUES (${ids.location},${ids.org},'Dubai Office','DXB',true,1,25.2,55.27,150,true,${ids.adminUser},${ids.adminUser})`;
      for (const [employeeKey, userKey, name] of [
        ["employee", "employeeUser", "Employee"],
        ["accountsEmployee", "accountsUser", "Accounts"],
        ["adminEmployee", "adminUser", "Super Admin"],
      ] as const) {
        await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by) VALUES (${ids[employeeKey]},${ids.org},${`PR-${ids[employeeKey]!.slice(0, 6)}`},${name},${name},${`${ids[employeeKey]}@viahr.test`},${ids.department},${ids.position},${ids.location},${ids.employmentType},'Active','2020-01-01',${ids.adminUser},${ids.adminUser})`;
        await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${ids[userKey]},${ids.org},${ids[employeeKey]},${name},${`${ids[employeeKey]}@viahr.test`},'Active',${ids.adminUser},${ids.adminUser})`;
      }
      const roleRows = await sql<
        { id: string; code: string }[]
      >`SELECT id,code FROM roles WHERE code IN ('Accounts','Super Admin')`;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id]));
      await sql`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by) VALUES (${ids.org},${ids.accountsUser},${roleIds.Accounts},${ids.adminUser}),(${ids.org},${ids.adminUser},${roleIds["Super Admin"]},${ids.adminUser})`;
      await sql`INSERT INTO employee_compensation (organisation_id,employee_id,encrypted_payload,created_by,updated_by) VALUES (${ids.org},${ids.employee},${encryptSensitiveJson({ baseMonthly: 2500, currency: "OMR" })},${ids.adminUser},${ids.adminUser})`;
      await sql`INSERT INTO employee_bank_details (organisation_id,employee_id,encrypted_payload,created_by,updated_by) VALUES (${ids.org},${ids.employee},${encryptSensitiveJson({ iban: "OM000001" })},${ids.adminUser},${ids.adminUser})`;
      await sql`INSERT INTO leave_policies (id,organisation_id,code,name,type,category,description,is_paid,base_entitlement_days,scope,accrual_mode,carry_forward_limit,allow_negative_balance,requires_attachment,requires_handover_contact,counts_toward_gratuity,approval_chain,is_enabled,is_statutory,consumes_balance,created_by,updated_by) VALUES (${ids.policy},${ids.org},'UNPAID','Unpaid Leave','Unpaid','Company','Unpaid leave',false,0,'Not Tracked','Not Applicable',0,false,false,false,true,${sql.json(["Line Manager", "HR"])},true,false,false,${ids.adminUser},${ids.adminUser})`;
      await sql`INSERT INTO leave_requests (organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) VALUES (${ids.org},${ids.employee},${ids.policy},'2026-09-10','2026-09-11',2,'Personal leave','Approved',${sql.json({ type: "Unpaid", isPaid: false })},${ids.employeeUser},${ids.adminUser})`;
      await sql`INSERT INTO overtime_claims (id,organisation_id,employee_id,date,hours,cost_centre_id,activity_code_id,location_id,reason,compensation_type,status,approved_at,approved_by,created_by,updated_by) VALUES (${ids.overtime},${ids.org},${ids.employee},'2026-09-05',4,${ids.costCentre},${ids.activity},${ids.location},'Month-end work','Payment','Approved','2026-09-06',${ids.adminUser},${ids.employeeUser},${ids.adminUser})`;
      await sql`INSERT INTO travel_requests (id,organisation_id,employee_id,purpose,destination,start_date,end_date,total_estimate,currency,status,hr_approval_status,accounts_approval_status,pre_authorised_at,actual_total,actual_total_omr,closed_at,closed_by,created_by,updated_by) VALUES (${ids.travel},${ids.org},${ids.employee},'Client visit','Muscat','2026-08-01','2026-08-03',100,'OMR','Closed','Approved','Approved','2026-07-20',90,90,'2026-09-07',${ids.adminUser},${ids.employeeUser},${ids.adminUser})`;
      await sql`INSERT INTO reimbursements (id,organisation_id,travel_request_id,employee_id,amount,currency,status,closed_at,closed_by,created_by,updated_by) VALUES (${ids.reimbursement},${ids.org},${ids.travel},${ids.employee},90,'OMR','Ready for Payroll','2026-09-07',${ids.adminUser},${ids.adminUser},${ids.adminUser})`;
      const accounts = actor(ids.accountsUser!, ids.accountsEmployee!, "Accounts");
      const admin = actor(ids.adminUser!, ids.adminEmployee!, "Super Admin");
      for (const evidenceId of [ids.evidenceOne!, ids.evidenceTwo!])
        await sql`INSERT INTO file_metadata (id,organisation_id,name,mime_type,size,checksum,storage_key,storage_status,owner_entity_type,owner_entity_id,created_by,updated_by) VALUES (${evidenceId},${ids.org},'payroll-evidence.pdf','application/pdf',4,'test-checksum',${`tests/payroll/${evidenceId}`},'Available','payroll-adjustment-evidence',${ids.employee},${ids.accountsUser},${ids.accountsUser})`;
      await assert.rejects(
        () =>
          listPayrollPeriodsInDatabase(ids.org!, {
            userId: ids.employeeUser,
            employeeId: ids.employee,
            displayName: "Employee",
            activeRole: "Employee",
            roles: ["Employee"],
          }),
        /Only Accounts or Super Admin/,
      );
      const periodId = await createPayrollPeriodInDatabase(
        ids.org!,
        {
          name: "September 2026",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          cutoffDate: "2026-09-25",
          paymentDate: "2026-09-30",
        },
        accounts,
      );
      await addPayrollAdjustmentInDatabase(
        ids.org!,
        periodId,
        {
          employeeId: ids.employee!,
          type: "Allowance",
          amount: 25,
          currency: "OMR",
          reason: "Approved phone allowance",
          evidenceFileId: ids.evidenceOne!,
        },
        accounts,
      );
      const race = await Promise.allSettled([
        collectPayrollInputsInDatabase(ids.org!, periodId, accounts),
        collectPayrollInputsInDatabase(ids.org!, periodId, accounts),
      ]);
      assert.equal(race.filter((item) => item.status === "fulfilled").length, 2);
      let period = (await listPayrollPeriodsInDatabase(ids.org!, accounts)).find(
        (item) => item.id === periodId,
      )!;
      assert.equal(period.compiledInputs?.[0]?.approvedOvertimeHours, 4);
      assert.equal(period.compiledInputs?.[0]?.unpaidLeaveDays, 2);
      assert.equal(period.compiledInputs?.[0]?.reimbursementsTotal, 90);
      assert.equal(period.compiledInputs?.[0]?.manualAdjustmentsTotal, 25);
      const unacknowledged = period.exceptions.filter((item) => !item.acknowledged);
      for (const exception of unacknowledged) {
        await acknowledgePayrollExceptionInDatabase(
          ids.org!,
          periodId,
          exception.id,
          "Verified in database test",
          accounts,
        );
      }
      await approvePayrollPeriodInDatabase(
        ids.org!,
        periodId,
        "Independent approval completed",
        admin,
      );
      await lockPayrollPeriodInDatabase(ids.org!, periodId, accounts);
      assert.match(
        await exportPayrollPeriodInDatabase(ids.org!, periodId, accounts),
        /Employee Number/,
      );
      await reopenPayrollPeriodInDatabase(
        ids.org!,
        periodId,
        "Correct approved phone allowance",
        admin,
      );
      await addPayrollAdjustmentInDatabase(
        ids.org!,
        periodId,
        {
          employeeId: ids.employee!,
          type: "Correction",
          amount: 5,
          currency: "OMR",
          reason: "Allowance correction",
          evidenceFileId: ids.evidenceTwo!,
        },
        accounts,
      );
      await collectPayrollInputsInDatabase(ids.org!, periodId, accounts);
      period = (await listPayrollPeriodsInDatabase(ids.org!, accounts)).find(
        (item) => item.id === periodId,
      )!;
      assert.equal(period.compiledInputs?.[0]?.manualAdjustmentsTotal, 30);
      const [counts] =
        await sql`SELECT count(*)::int AS inputs,(SELECT count(*) FROM overtime_claims WHERE payroll_period_id=${periodId})::int AS overtime,(SELECT count(*) FROM travel_requests WHERE payroll_period_id=${periodId})::int AS travel FROM payroll_inputs WHERE period_id=${periodId}`;
      assert.equal(counts?.inputs, 1);
      assert.equal(counts?.overtime, 1);
      assert.equal(counts?.travel, 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
