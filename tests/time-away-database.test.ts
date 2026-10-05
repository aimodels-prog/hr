import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  listTimeAway,
  recordTimeAway,
  decideTimeAway,
} from "../src/lib/db/repositories/time-away.repository.server.ts";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
const url = process.env["VIA_HR_TEST_DATABASE_URL"];
test(
  "time away protects teams, prevents duplicate periods and serialises HR decisions without changing pay or leave",
  { skip: !url },
  async () => {
    assert.match(new URL(url!).pathname, /test|scratch/);
    process.env["DATABASE_URL"] = url;
    const db = postgres(url!, { max: 1 });
    const org = randomUUID(),
      manager = randomUUID(),
      staff = randomUUID(),
      hr = randomUUID();
    const dept = randomUUID(),
      position = randomUUID(),
      employment = randomUUID(),
      location = randomUUID();
    const employeeActor = {
      userId: staff,
      employeeId: staff,
      displayName: "Staff",
      activeRole: "Employee" as const,
    };
    const managerActor = {
      userId: manager,
      employeeId: manager,
      displayName: "Manager",
      activeRole: "Line Manager" as const,
    };
    const hrActor = { userId: hr, employeeId: hr, displayName: "HR", activeRole: "HR" as const };
    try {
      await db`INSERT INTO organisations(id,name,slug,created_by,updated_by) VALUES(${org},'Time away test',${org},${hr},${hr})`;
      for (const [table, id] of [
        ["departments", dept],
        ["positions", position],
        ["employment_types", employment],
        ["locations", location],
      ])
        await db.unsafe(
          `INSERT INTO ${table}(id,organisation_id,name,code,created_by,updated_by) VALUES($1,$2,'Time away','TA',$3,$3)`,
          [id!, org, hr],
        );
      for (const id of [manager, staff, hr]) {
        await db`INSERT INTO employees(id,organisation_id,employee_number,legal_name,preferred_name,work_email,department_id,position_id,employment_type_id,location_id,status,start_date,created_by,updated_by) VALUES(${id},${org},${id},'Test employee','Test',${id + "@example.com"},${dept},${position},${employment},${location},'Active','2020-01-01',${hr},${hr})`;
        await db`INSERT INTO users(id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by) VALUES(${id},${org},${id},'Test',${id + "@example.com"},'Active',${hr},${hr})`;
      }
      await db`UPDATE employees SET line_manager_id=${manager}, record_version=record_version+1 WHERE id=${staff}`;
      const input = {
        employeeId: staff,
        date: "2026-10-05",
        startTime: "09:00",
        endTime: "12:00",
        category: "Medical appointment",
        note: "",
      };
      await assert.rejects(
        recordTimeAway(org, { ...input, employeeId: hr }, managerActor),
        /authorised team/,
      );
      await assert.rejects(recordTimeAway(randomUUID(), input, employeeActor), /authorised team/);
      const results = await Promise.allSettled([
        recordTimeAway(org, input, managerActor),
        recordTimeAway(org, input, managerActor),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const records = await listTimeAway(org, input.date, employeeActor);
      assert.equal(records.rows.length, 1);
      assert.equal(records.people.length, 1);
      assert.equal((await listTimeAway(org, input.date, managerActor)).people.length, 2);
      assert.equal(
        (await listTimeAway(org, input.date, { ...hrActor, activeRole: "Accounts" })).rows.length,
        0,
      );
      const record = records.rows[0]!;
      const decision = {
        id: record.id,
        version: 1,
        action: "Approve" as const,
        treatment: "Paid time" as const,
        note: "",
      };
      await assert.rejects(decideTimeAway(org, decision, managerActor), /Only HR/);
      await assert.rejects(
        decideTimeAway(org, decision, { ...employeeActor, activeRole: "HR" }),
        /Another HR/,
      );
      const decisions = await Promise.allSettled([
        decideTimeAway(org, decision, hrActor),
        decideTimeAway(org, { ...decision, action: "Reject", note: "Wrong times" }, hrActor),
      ]);
      assert.equal(decisions.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await listTimeAway(org, input.date, employeeActor)).rows[0]!.recordVersion, 2);
      for (const table of [
        "attendance_records",
        "leave_transactions",
        "payroll_manual_adjustments",
      ]) {
        const rows = await db.unsafe(
          `SELECT count(*)::int AS count FROM ${table} WHERE organisation_id=$1`,
          [org],
        );
        assert.equal(rows[0]!.count, 0);
      }
      assert.ok((await db`SELECT id FROM notifications WHERE organisation_id=${org}`).length > 0);
    } finally {
      // Keep this uniquely named fixture in the isolated test database: audit history is append-only.
      await db.end();
      await closeDatabaseConnection();
    }
  },
);
