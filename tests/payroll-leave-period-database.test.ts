import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { collectPayrollInputsInDatabase } from "../src/lib/db/repositories/payroll.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "payroll splits unpaid leave by period without duplicating the approved total",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname, /(test|scratch)/i);
    const sql = postgres(databaseUrl!, { max: 5, prepare: false });
    const org = randomUUID(),
      employee = randomUUID(),
      user = randomUUID(),
      location = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      employment = randomUUID(),
      policy = randomUUID();
    const request = randomUUID(),
      september = randomUUID(),
      october = randomUUID();
    const actor = {
      userId: user,
      employeeId: employee,
      displayName: "Finance",
      activeRole: "Accounts" as const,
      roles: ["Employee", "Accounts"] as const,
    };
    try {
      await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${org},'Leave payroll test',${org},true,${user},${user})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["employment_types", employment],
        ["locations", location],
      ] as const)
        await sql.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,'Office','TEST',true,1,$3,$3)`,
          [id, org, user],
        );
      await sql`INSERT INTO app_settings (organisation_id,base_currency,timezone,working_days,standard_daily_hours,standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by) VALUES (${org},'OMR','Asia/Muscat',ARRAY[1,2,3,4,5],8,40,'01-01','12-31',ARRAY[30],'EMP-{0000}','CAN-{0000}',${user},${user})`;
      await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by) VALUES (${employee},${org},'LEAVE-1','Employee','Employee',${`${employee}@viahr.test`},${department},${position},${location},${employment},'Active','2020-01-01',${user},${user})`;
      await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${user},${org},${employee},'Finance',${`${user}@viahr.test`},'Active',${user},${user})`;
      await sql`INSERT INTO leave_policies (id,organisation_id,code,name,type,category,description,is_paid,scope,accrual_mode,consumes_balance,created_by,updated_by) VALUES (${policy},${org},'UNPAID','Unpaid','Unpaid','Company','Unpaid leave',false,'Not Tracked','Not Applicable',false,${user},${user})`;
      await sql`INSERT INTO public_holidays (organisation_id,name,code,holiday_date,location_id,is_active,created_by,updated_by) VALUES (${org},'Office holiday','HOL','2026-09-29',${location},true,${user},${user})`;
      await sql`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) VALUES (${request},${org},${employee},${policy},'2026-09-28','2026-10-05',5,'Cross-month unpaid leave','Approved',${sql.json({ isPaid: false })},${user},${user})`;
      for (const [id, start, end] of [
        [september, "2026-09-01", "2026-09-30"],
        [october, "2026-10-01", "2026-10-31"],
      ])
        await sql`INSERT INTO payroll_periods (id,organisation_id,name,start_date,end_date,cutoff_date,payment_date,status,created_by,updated_by) VALUES (${id!},${org},${start!},${start!},${end!},${end!},${end!},'Collecting Inputs',${user},${user})`;

      async function totals() {
        await collectPayrollInputsInDatabase(org, september, actor);
        await collectPayrollInputsInDatabase(org, october, actor);
        const rows =
          await sql`SELECT period_id,unpaid_leave_days FROM payroll_inputs WHERE organisation_id=${org}`;
        return [september, october].map((id) =>
          Number(rows.find((r) => r.period_id === id)?.unpaid_leave_days ?? 0),
        );
      }
      await t.test(
        "five working days crossing September and October become two plus three",
        async () => {
          assert.deepEqual(await totals(), [2, 3]);
          assert.deepEqual(await totals(), [2, 3], "Recollection must not accumulate deductions");
          for (const status of [
            "Cancellation Pending",
            "Amendment Pending Line Manager",
            "Amendment Pending HR",
          ]) {
            await sql`UPDATE leave_requests SET status=${status} WHERE id=${request}`;
            assert.deepEqual(
              await totals(),
              [2, 3],
              "Original approved unpaid leave remains effective during review",
            );
          }
          await sql`UPDATE leave_requests SET status='Approved' WHERE id=${request}`;
        },
      );
      const workingDates = ["2026-09-28", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"];
      await t.test(
        "saved dates and paid status survive later calendar and policy edits",
        async () => {
          await sql`UPDATE leave_requests SET policy_snapshot=${sql.json({ isPaid: false, workingDates })} WHERE id=${request}`;
          await sql`UPDATE app_settings SET working_days=ARRAY[0,1,2,3,4,5,6] WHERE organisation_id=${org}`;
          await sql`UPDATE public_holidays SET is_active=false WHERE organisation_id=${org}`;
          await sql`UPDATE leave_policies SET is_paid=true WHERE id=${policy}`;
          assert.deepEqual(await totals(), [2, 3]);
        },
      );
      await t.test(
        "inconsistent dates fail atomically rather than inventing deductions",
        async () => {
          for (const snapshot of [
            { isPaid: false },
            { isPaid: false, workingDates: [workingDates[0]!] },
          ]) {
            await sql`UPDATE leave_requests SET policy_snapshot=${sql.json(snapshot)} WHERE id=${request}`;
            await assert.rejects(
              collectPayrollInputsInDatabase(org, september, actor),
              /Ask HR to review/,
            );
            const rows =
              await sql`SELECT period_id,unpaid_leave_days FROM payroll_inputs WHERE organisation_id=${org}`;
            assert.equal(
              Number(rows.find((row) => row.period_id === september)!.unpaid_leave_days),
              2,
            );
            assert.equal(
              Number(rows.find((row) => row.period_id === october)!.unpaid_leave_days),
              3,
            );
          }
          await sql`UPDATE leave_requests SET policy_snapshot=${sql.json({ isPaid: false, workingDates })} WHERE id=${request}`;
        },
      );
      await t.test(
        "archived, cancelled and paid leave do not produce unpaid deductions",
        async () => {
          await sql`UPDATE leave_requests SET archived_at=now() WHERE id=${request}`;
          assert.deepEqual(await totals(), [0, 0]);
          await sql`UPDATE leave_requests SET archived_at=null,status='Cancelled' WHERE id=${request}`;
          assert.deepEqual(await totals(), [0, 0]);
          await sql`UPDATE leave_requests SET status='Approved',policy_snapshot=${sql.json({ isPaid: true, workingDates })} WHERE id=${request}`;
          await sql`UPDATE leave_policies SET is_paid=false WHERE id=${policy}`;
          assert.deepEqual(
            await totals(),
            [0, 0],
            "A later unpaid policy edit must not change approved paid leave",
          );
        },
      );
      await t.test(
        "half-days belong only to their period and approved amendments replace old dates",
        async () => {
          await sql`UPDATE leave_requests SET start_date='2026-10-01',end_date='2026-10-01',is_half_day=true,working_days_requested=0.5,policy_snapshot=${sql.json({ isPaid: false, workingDates: ["2026-10-01"] })} WHERE id=${request}`;
          assert.deepEqual(await totals(), [0, 0.5]);
          await sql`UPDATE leave_requests SET start_date='2026-09-30',end_date='2026-10-01',is_half_day=false,working_days_requested=2,policy_snapshot=${sql.json({ isPaid: false, workingDates: ["2026-09-30", "2026-10-01"] })} WHERE id=${request}`;
          assert.deepEqual(await totals(), [1, 1]);
        },
      );
      await t.test(
        "legacy allocation respects office holidays and the organisation working week",
        async () => {
          await sql`UPDATE leave_requests SET start_date='2026-09-28',end_date='2026-10-05',working_days_requested=5,policy_snapshot=${sql.json({ isPaid: false })} WHERE id=${request}`;
          await sql`UPDATE app_settings SET working_days=ARRAY[1,2,3,4,5] WHERE organisation_id=${org}`;
          await sql`UPDATE public_holidays SET is_active=true WHERE organisation_id=${org}`;
          const otherLocation = randomUUID();
          await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,created_by,updated_by) VALUES (${otherLocation},${org},'Other office','OTHER',true,${user},${user})`;
          await sql`INSERT INTO public_holidays (organisation_id,name,code,holiday_date,location_id,is_active,created_by,updated_by) VALUES (${org},'Other office holiday','OTHER','2026-10-01',${otherLocation},true,${user},${user})`;
          assert.deepEqual(await totals(), [2, 3]);
          await sql`UPDATE app_settings SET working_days=ARRAY[0,1,2,3,4] WHERE organisation_id=${org}`;
          // Sunday October 4 replaces Friday October 2, preserving five approved days.
          assert.deepEqual(await totals(), [2, 3]);
        },
      );
      await t.test(
        "sick-pay tiers use approved history and allocate only this month's reduction",
        async () => {
          const tiers = [
            { fromDay: 1, toDay: 2, payPercentage: 100 },
            { fromDay: 3, toDay: 4, payPercentage: 50 },
            { fromDay: 5, toDay: 8, payPercentage: 25 },
          ];
          await sql`UPDATE leave_policies SET type='Sick',is_paid=true,pay_tiers=${sql.json(tiers)} WHERE id=${policy}`;
          await sql`UPDATE leave_requests SET policy_snapshot=${sql.json({ type: "Sick", isPaid: true, payTiers: tiers, workingDates })} WHERE id=${request}`;
          const previous = randomUUID();
          await sql`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) VALUES (${previous},${org},${employee},${policy},'2026-09-24','2026-09-25',2,'Previous sick leave','Taken',${sql.json({ type: "Sick", isPaid: true, payTiers: tiers, workingDates: ["2026-09-24", "2026-09-25"] })},${user},${user})`;
          const pending = randomUUID();
          await sql`INSERT INTO leave_requests (id,organisation_id,employee_id,policy_id,start_date,end_date,working_days_requested,reason,status,policy_snapshot,created_by,updated_by) VALUES (${pending},${org},${employee},${policy},'2026-09-01','2026-09-01',1,'Pending sick leave','Pending Line Manager',${sql.json({ type: "Sick", isPaid: true, payTiers: tiers, workingDates: ["2026-09-01"] })},${user},${user})`;
          assert.deepEqual(await totals(), [1, 2.25]);
          await sql`UPDATE leave_policies SET pay_tiers=${sql.json([{ fromDay: 1, toDay: 100, payPercentage: 0 }])} WHERE id=${policy}`;
          assert.deepEqual(await totals(), [1, 2.25], "Saved rules must survive policy changes");
          for (const status of [
            "Cancellation Pending",
            "Amendment Pending Line Manager",
            "Amendment Pending HR",
          ]) {
            await sql`UPDATE leave_requests SET status=${status} WHERE id=${request}`;
            assert.deepEqual(
              await totals(),
              [1, 2.25],
              "Pending changes must preserve approved sick-pay deductions",
            );
          }
          await sql`UPDATE leave_requests SET status='Approved' WHERE id=${request}`;
          await sql`UPDATE leave_requests SET status='Cancelled' WHERE id=${previous}`;
          assert.deepEqual(await totals(), [0, 1.75], "Cancelled history must not consume tiers");
          await sql`UPDATE leave_requests SET status='Taken' WHERE id=${previous}`;
          assert.deepEqual(
            await totals(),
            [1, 2.25],
            "Backdated approved history must be recomputed chronologically",
          );
          const [notice] =
            await sql`SELECT description FROM payroll_exceptions WHERE organisation_id=${org} AND type='Sick Leave Pay Adjustment' LIMIT 1`;
          assert.match(notice!.description, /unpaid-equivalent/);
        },
      );
    } finally {
      await closeDatabaseConnection();
      await sql.end({ timeout: 5 });
    }
  },
);
