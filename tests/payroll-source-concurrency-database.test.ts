import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import {
  collectPayrollInputsInDatabase,
  createPayrollPeriodInDatabase,
} from "../src/lib/db/repositories/payroll.repository.server.ts";
import { assignOvertimeToPayrollInDatabase } from "../src/lib/db/repositories/overtime.repository.server.ts";
import { assignTravelReimbursementsToPayrollInDatabase } from "../src/lib/db/repositories/travel.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;
type TestSql = ReturnType<typeof postgres>;

async function fixture(sql: TestSql) {
  const org = randomUUID();
  const employee = randomUUID();
  const user = randomUUID();
  const department = randomUUID();
  const position = randomUUID();
  const employmentType = randomUUID();
  const location = randomUUID();
  const costCentre = randomUUID();
  const activity = randomUUID();
  const overtime = randomUUID();
  const travel = randomUUID();
  const firstPeriod = randomUUID();
  const secondPeriod = randomUUID();
  await sql`INSERT INTO organisations (id,name,slug,is_active,created_by,updated_by) VALUES (${org},'Payroll source race',${org},true,${user},${user})`;
  for (const [table, id] of [
    ["departments", department],
    ["positions", position],
    ["employment_types", employmentType],
    ["cost_centres", costCentre],
    ["activity_codes", activity],
  ] as const) {
    await sql.unsafe(
      `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES ($1,$2,'Test','TEST',true,1,$3,$3)`,
      [id, org, user],
    );
  }
  await sql`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,created_by,updated_by) VALUES (${location},${org},'Office','OFFICE',true,1,${user},${user})`;
  await sql`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by) VALUES (${employee},${org},'PAY-1','Payroll Employee','Payroll Employee',${`${employee}@viahr.test`},${department},${position},${location},${employmentType},'Active','2020-01-01',${user},${user})`;
  await sql`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES (${user},${org},${employee},'Finance',${`${user}@viahr.test`},'Active',${user},${user})`;
  await sql`INSERT INTO overtime_claims (id,organisation_id,employee_id,date,hours,cost_centre_id,activity_code_id,location_id,reason,request_kind,compensation_type,status,approved_at,approved_by,created_by,updated_by) VALUES (${overtime},${org},${employee},'2026-09-05',4,${costCentre},${activity},${location},'Approved overtime','Planned','Payment','Approved','2026-09-06',${user},${user},${user})`;
  await sql`INSERT INTO travel_requests (id,organisation_id,employee_id,purpose,destination,start_date,end_date,total_estimate,currency,status,manager_approval_status,hr_approval_status,accounts_approval_status,actual_total,actual_total_omr,closed_at,closed_by,created_by,updated_by) VALUES (${travel},${org},${employee},'Site visit','Muscat','2026-09-01','2026-09-02',100,'OMR','Closed','Approved','Approved','Approved',90,90,'2026-09-07',${user},${user},${user})`;
  await sql`INSERT INTO reimbursements (organisation_id,travel_request_id,employee_id,amount,currency,status,closed_at,closed_by,created_by,updated_by) VALUES (${org},${travel},${employee},90,'OMR','Ready for Payroll','2026-09-07',${user},${user},${user})`;
  for (const [id, start, end] of [
    [firstPeriod, "2026-09-01", "2026-09-30"],
    [secondPeriod, "2026-10-01", "2026-10-31"],
  ]) {
    await sql`INSERT INTO payroll_periods (id,organisation_id,name,start_date,end_date,cutoff_date,payment_date,status,created_by,updated_by) VALUES (${id!},${org},${start!},${start!},${end!},${end!},${end!},'Collecting Inputs',${user},${user})`;
  }
  return {
    org,
    employee,
    user,
    overtime,
    travel,
    firstPeriod,
    secondPeriod,
    actor: {
      userId: user,
      employeeId: employee,
      displayName: "Finance",
      activeRole: "Accounts" as const,
      roles: ["Employee", "Accounts"] as const,
    },
  };
}

// Hold inserts after the collectors have read their sources. This deterministically exposes
// stale-source races; an organisation allocation lock instead makes the second operation wait.
async function pausePayrollInsert(sql: TestSql, org: string) {
  const name = `test_payroll_gate_${randomUUID().replaceAll("-", "")}`;
  const key = randomInt(1, 2_000_000_000);
  await sql.unsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organisation_id = '${org}'::uuid THEN PERFORM pg_advisory_xact_lock(782341, ${key}); END IF; RETURN NEW; END $$`,
  );
  await sql.unsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT ON payroll_inputs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  );
  const connection = await sql.reserve();
  await connection`SELECT pg_advisory_lock(782341, ${key})`;
  let released = false;
  return {
    async release() {
      if (!released) {
        released = true;
        await connection`SELECT pg_advisory_unlock(782341, ${key})`;
        connection.release();
      }
    },
    async cleanup() {
      await this.release();
      await sql.unsafe(`DROP TRIGGER ${name} ON payroll_inputs`);
      await sql.unsafe(`DROP FUNCTION ${name}()`);
    },
    async waitForBlocked(count: number) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [row] =
          await sql`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
        if (row!.count >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.fail(`Expected ${count} operations waiting at the payroll allocation barrier`);
    },
  };
}

test(
  "payroll sources are allocated once across periods and assignment paths",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname, /(test|scratch)/i);
    const sql = postgres(databaseUrl!, { max: 5, prepare: false });
    try {
      await t.test("simultaneous payroll periods cannot both count the same source", async () => {
        const f = await fixture(sql);
        const gate = await pausePayrollInsert(sql, f.org);
        const work: Promise<PromiseSettledResult<void>[]>[] = [];
        try {
          work.push(
            Promise.allSettled([collectPayrollInputsInDatabase(f.org, f.firstPeriod, f.actor)]),
          );
          await gate.waitForBlocked(1);
          work.push(
            Promise.allSettled([collectPayrollInputsInDatabase(f.org, f.secondPeriod, f.actor)]),
          );
          await gate.waitForBlocked(2);
          await gate.release();
          const outcomes = (await Promise.all(work)).flat();
          assert.ok(
            outcomes.every((outcome) => outcome.status === "fulfilled"),
            JSON.stringify(outcomes),
          );
          const rows =
            await sql`SELECT period_id,approved_overtime_hours,reimbursements_total FROM payroll_inputs WHERE organisation_id=${f.org}`;
          assert.equal(
            rows.reduce((sum, row) => sum + Number(row.approved_overtime_hours), 0),
            4,
            "Overtime must be counted once across payroll periods",
          );
          assert.equal(
            rows.reduce((sum, row) => sum + Number(row.reimbursements_total), 0),
            90,
            "Travel reimbursement must be counted once across payroll periods",
          );
          const [overtime] =
            await sql`SELECT payroll_period_id FROM overtime_claims WHERE id=${f.overtime}`;
          const [travel] =
            await sql`SELECT payroll_period_id FROM travel_requests WHERE id=${f.travel}`;
          assert.equal(
            rows.find((row) => Number(row.approved_overtime_hours) > 0)?.period_id,
            overtime!.payroll_period_id,
          );
          assert.equal(
            rows.find((row) => Number(row.reimbursements_total) > 0)?.period_id,
            travel!.payroll_period_id,
          );
          await collectPayrollInputsInDatabase(f.org, f.firstPeriod, f.actor);
          const [totals] =
            await sql`SELECT sum(approved_overtime_hours) AS hours, sum(reimbursements_total) AS amount FROM payroll_inputs WHERE organisation_id=${f.org}`;
          assert.equal(Number(totals!.hours), 4);
          assert.equal(Number(totals!.amount), 90);
        } finally {
          await gate.release();
          await Promise.all(work);
          await gate.cleanup();
        }
      });
      for (const source of ["overtime", "travel"] as const) {
        await t.test(
          `collection and manual ${source} assignment cannot allocate the same source twice`,
          async () => {
            const f = await fixture(sql);
            const gate = await pausePayrollInsert(sql, f.org);
            const work: Promise<PromiseSettledResult<void>[]>[] = [];
            try {
              work.push(
                Promise.allSettled([collectPayrollInputsInDatabase(f.org, f.firstPeriod, f.actor)]),
              );
              await gate.waitForBlocked(1);
              const assign =
                source === "overtime"
                  ? assignOvertimeToPayrollInDatabase(f.org, [f.overtime], f.secondPeriod, f.actor)
                  : assignTravelReimbursementsToPayrollInDatabase(
                      f.org,
                      [f.travel],
                      f.secondPeriod,
                      f.actor,
                    );
              work.push(Promise.allSettled([assign]));
              await gate.waitForBlocked(2);
              await gate.release();
              const [collected, assigned] = (await Promise.all(work)).flat();
              assert.equal(collected!.status, "fulfilled");
              assert.equal(assigned!.status, "rejected");
              if (assigned!.status === "rejected")
                assert.match(String(assigned.reason), /another payroll period/);
              const [claim] =
                await sql`SELECT payroll_period_id FROM overtime_claims WHERE id=${f.overtime}`;
              const [trip] =
                await sql`SELECT payroll_period_id FROM travel_requests WHERE id=${f.travel}`;
              assert.equal(claim!.payroll_period_id, f.firstPeriod);
              assert.equal(trip!.payroll_period_id, f.firstPeriod);
              const [input] =
                await sql`SELECT approved_overtime_hours,reimbursements_total FROM payroll_inputs WHERE organisation_id=${f.org}`;
              assert.equal(Number(input!.approved_overtime_hours), 4);
              assert.equal(Number(input!.reimbursements_total), 90);
            } finally {
              await gate.release();
              await Promise.all(work);
              await gate.cleanup();
            }
          },
        );
      }

      await t.test("prior manual assignments stay with their selected period", async () => {
        const f = await fixture(sql);
        await assignOvertimeToPayrollInDatabase(f.org, [f.overtime], f.secondPeriod, f.actor);
        await assignTravelReimbursementsToPayrollInDatabase(
          f.org,
          [f.travel],
          f.secondPeriod,
          f.actor,
        );
        await collectPayrollInputsInDatabase(f.org, f.firstPeriod, f.actor);
        await collectPayrollInputsInDatabase(f.org, f.secondPeriod, f.actor);
        const rows =
          await sql`SELECT period_id,approved_overtime_hours,reimbursements_total FROM payroll_inputs WHERE organisation_id=${f.org}`;
        const first = rows.find((row) => row.period_id === f.firstPeriod);
        const second = rows.find((row) => row.period_id === f.secondPeriod)!;
        assert.equal(first, undefined, "A period with no allocated inputs has no input row");
        assert.equal(Number(second.approved_overtime_hours), 4);
        assert.equal(Number(second.reimbursements_total), 90);
      });

      await t.test("manual assignments cannot change reviewed or archived periods", async () => {
        const f = await fixture(sql);
        for (const status of ["Prepared", "Approved", "Locked", "Exported", "Archived"]) {
          await sql`UPDATE payroll_periods SET status=${status === "Archived" ? "Collecting Inputs" : status},archived_at=${status === "Archived" ? new Date() : null} WHERE id=${f.firstPeriod}`;
          await assert.rejects(
            assignOvertimeToPayrollInDatabase(f.org, [f.overtime], f.firstPeriod, f.actor),
            /still collecting inputs/,
          );
          await assert.rejects(
            assignTravelReimbursementsToPayrollInDatabase(
              f.org,
              [f.travel],
              f.firstPeriod,
              f.actor,
            ),
            /still collecting inputs/,
          );
        }
        const [claim] =
          await sql`SELECT payroll_period_id FROM overtime_claims WHERE id=${f.overtime}`;
        const [trip] =
          await sql`SELECT payroll_period_id FROM travel_requests WHERE id=${f.travel}`;
        const [events] =
          await sql`SELECT count(*)::int AS count FROM audit_events WHERE organisation_id=${f.org}`;
        assert.equal(claim!.payroll_period_id, null);
        assert.equal(trip!.payroll_period_id, null);
        assert.equal(events!.count, 0);
      });

      await t.test(
        "a failed assignment releases the lock without partially allocating sources",
        async () => {
          const f = await fixture(sql);
          await assert.rejects(
            assignOvertimeToPayrollInDatabase(
              f.org,
              [f.overtime, randomUUID()],
              f.firstPeriod,
              f.actor,
            ),
            /could not be found/,
          );
          await assert.rejects(
            assignTravelReimbursementsToPayrollInDatabase(
              f.org,
              [f.travel, randomUUID()],
              f.firstPeriod,
              f.actor,
            ),
            /not found/,
          );
          const [claim] =
            await sql`SELECT payroll_period_id FROM overtime_claims WHERE id=${f.overtime}`;
          const [trip] =
            await sql`SELECT payroll_period_id FROM travel_requests WHERE id=${f.travel}`;
          assert.equal(claim!.payroll_period_id, null);
          assert.equal(trip!.payroll_period_id, null);
          await collectPayrollInputsInDatabase(f.org, f.secondPeriod, f.actor);
          const [input] =
            await sql`SELECT approved_overtime_hours,reimbursements_total FROM payroll_inputs WHERE organisation_id=${f.org}`;
          assert.equal(Number(input!.approved_overtime_hours), 4);
          assert.equal(Number(input!.reimbursements_total), 90);
        },
      );

      await t.test("collecting one organisation does not block another organisation", async () => {
        const first = await fixture(sql);
        const second = await fixture(sql);
        const gate = await pausePayrollInsert(sql, first.org);
        const work: Promise<PromiseSettledResult<void>[]>[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          work.push(
            Promise.allSettled([
              collectPayrollInputsInDatabase(first.org, first.firstPeriod, first.actor),
            ]),
          );
          await gate.waitForBlocked(1);
          const other = Promise.allSettled([
            collectPayrollInputsInDatabase(second.org, second.firstPeriod, second.actor),
          ]);
          work.push(other);
          const outcomes = await Promise.race([
            other,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Unrelated organisation was blocked")),
                5000,
              );
            }),
          ]);
          assert.equal(outcomes[0]!.status, "fulfilled");
        } finally {
          clearTimeout(timer);
          await gate.release();
          await Promise.all(work);
          await gate.cleanup();
        }
      });
      await t.test(
        "concurrent creation and direct inserts cannot create overlapping active periods",
        async () => {
          const f = await fixture(sql);
          const periods = [
            {
              name: "January",
              startDate: "2027-01-01",
              endDate: "2027-01-31",
              cutoffDate: "2027-01-31",
              paymentDate: "2027-02-01",
            },
            {
              name: "Overlapping",
              startDate: "2027-01-15",
              endDate: "2027-02-15",
              cutoffDate: "2027-02-15",
              paymentDate: "2027-02-16",
            },
          ];
          const outcomes = await Promise.allSettled(
            periods.map((period) => createPayrollPeriodInDatabase(f.org, period, f.actor)),
          );
          assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
          const rejected = outcomes.find(
            (outcome) => outcome.status === "rejected",
          ) as PromiseRejectedResult;
          assert.match(String(rejected.reason), /overlap/);
          await assert.rejects(
            sql`INSERT INTO payroll_periods (organisation_id,name,start_date,end_date,cutoff_date,payment_date,status,created_by,updated_by) VALUES (${f.org},'Direct overlap','2026-09-15','2026-10-15','2026-10-15','2026-10-16','Draft',${f.user},${f.user})`,
            /payroll_periods_no_active_overlap/,
          );
        },
      );
      await t.test("archived periods and sources cannot enter payroll", async () => {
        const f = await fixture(sql);
        await sql`UPDATE payroll_periods SET archived_at=now() WHERE id=${f.firstPeriod}`;
        await assert.rejects(
          collectPayrollInputsInDatabase(f.org, f.firstPeriod, f.actor),
          /Archived payroll/,
        );
        await sql`UPDATE overtime_claims SET archived_at=now() WHERE id=${f.overtime}`;
        await sql`UPDATE travel_requests SET archived_at=now() WHERE id=${f.travel}`;
        await assert.rejects(
          assignTravelReimbursementsToPayrollInDatabase(f.org, [f.travel], f.secondPeriod, f.actor),
          /Only closed/,
        );
        await collectPayrollInputsInDatabase(f.org, f.secondPeriod, f.actor);
        assert.equal(
          (await sql`SELECT id FROM payroll_inputs WHERE organisation_id=${f.org}`).length,
          0,
        );
        const [claim] =
          await sql`SELECT payroll_period_id FROM overtime_claims WHERE id=${f.overtime}`;
        const [trip] =
          await sql`SELECT payroll_period_id FROM travel_requests WHERE id=${f.travel}`;
        assert.equal(claim!.payroll_period_id, null);
        assert.equal(trip!.payroll_period_id, null);
        await sql`UPDATE travel_requests SET archived_at=null WHERE id=${f.travel}`;
        await sql`UPDATE reimbursements SET archived_at=now() WHERE travel_request_id=${f.travel}`;
        await assert.rejects(
          assignTravelReimbursementsToPayrollInDatabase(f.org, [f.travel], f.secondPeriod, f.actor),
          /missing or archived/,
        );
        await collectPayrollInputsInDatabase(f.org, f.secondPeriod, f.actor);
        assert.equal(
          (await sql`SELECT id FROM payroll_inputs WHERE organisation_id=${f.org}`).length,
          0,
        );
      });
    } finally {
      await closeDatabaseConnection();
      await sql.end({ timeout: 5 });
    }
  },
);
