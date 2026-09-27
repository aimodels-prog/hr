import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { decideAttendanceCorrectionInDatabase } from "../src/lib/db/repositories/attendance.repository.server.ts";
import type { AuditActorContext } from "../src/lib/db/repositories/master-data.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "attendance correction decisions are atomic, versioned and cannot overwrite newer attendance",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const query = postgres(databaseUrl!, { max: 3, prepare: false });
    const org = randomUUID(),
      author = randomUUID();
    const department = randomUUID(),
      position = randomUUID(),
      location = randomUUID(),
      employmentType = randomUUID();
    try {
      await query`INSERT INTO organisations (id,name,slug,created_by,updated_by)
      VALUES (${org},'Attendance decision test',${`correction-${org}`},${author},${author})`;
      for (const [table, id] of [
        ["departments", department],
        ["positions", position],
        ["locations", location],
        ["employment_types", employmentType],
      ] as const) {
        await query.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        VALUES ($1,$2,'Test','TEST',true,1,$3,$3)`,
          [id, org, author],
        );
      }
      const person = async (
        role: AuditActorContext["activeRole"],
        managerId: string | null = null,
      ): Promise<AuditActorContext> => {
        const employeeId = randomUUID(),
          userId = randomUUID();
        await query`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,
        department_id,position_id,location_id,employment_type_id,line_manager_id,status,start_date,created_by,updated_by)
        VALUES (${employeeId},${org},${employeeId},${role},${role},${`${employeeId}@viahr.test`},
          ${department},${position},${location},${employmentType},${managerId},'Active','2019-01-01',${author},${author})`;
        await query`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
        VALUES (${userId},${org},${employeeId},${role},${`${employeeId}@viahr.test`},'Active',${author},${author})`;
        await query`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason)
        SELECT ${org},${userId},id,${author},'Test role' FROM roles WHERE code::text IN ('Employee',${role}) ON CONFLICT DO NOTHING`;
        return {
          userId,
          employeeId,
          displayName: role,
          activeRole: role,
          roles: ["Employee", role],
        };
      };
      const manager = await person("Line Manager");
      const hr = await person("HR"),
        otherHr = await person("HR"),
        outsider = await person("Line Manager");
      const employee = await person("Employee", manager.employeeId!);
      let day = 1;
      const fixture = async (status: "Pending Manager" | "Pending HR" = "Pending HR") => {
        const recordId = randomUUID(),
          id = randomUUID();
        const date = new Date(Date.UTC(2020, 0, day++)).toISOString().slice(0, 10);
        const originalIn = `${date}T08:00:00Z`,
          originalOut = `${date}T16:00:00Z`;
        const proposedIn = `${date}T09:00:00Z`,
          proposedOut = `${date}T17:00:00Z`;
        const version = status === "Pending HR" ? 2 : 1;
        await query`INSERT INTO attendance_records (id,organisation_id,employee_id,date,source,status,clock_in_at,clock_out_at,calculated_hours,created_by,updated_by)
        VALUES (${recordId},${org},${employee.employeeId!},${date},'Manual Entry','Present',${originalIn},${originalOut},8,${author},${author})`;
        await query`INSERT INTO attendance_corrections (id,organisation_id,attendance_record_id,employee_id,correction_type,original_clock_in,original_clock_out,
        original_status,proposed_clock_in,proposed_clock_out,explanation,status,record_version,created_by,updated_by)
        VALUES (${id},${org},${recordId},${employee.employeeId!},'Punch Correction',${originalIn},${originalOut},'Present',${proposedIn},${proposedOut},'Correct the punches',${status},${version},${author},${author})`;
        return { id, recordId, version, proposedOut };
      };
      const record = async (id: string) =>
        (await query`SELECT * FROM attendance_records WHERE id=${id}`)[0]!;
      const correction = async (id: string) =>
        (await query`SELECT * FROM attendance_corrections WHERE id=${id}`)[0]!;
      const decisions = (id: string) =>
        query`SELECT * FROM audit_events WHERE entity_id=${id} AND entity_type='attendance-correction' AND action IN ('approve','reject')`;
      const decide = (
        item: { id: string; version: number },
        decision: "approve" | "reject",
        actor = hr,
      ) =>
        decideAttendanceCorrectionInDatabase(
          org,
          item.id,
          decision,
          `${actor.displayName} ${decision}`,
          actor,
          item.version,
        );
      const assertOneWinner = (results: PromiseSettledResult<void>[]) => {
        assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
        const rejected = results.find(
          (item) => item.status === "rejected",
        ) as PromiseRejectedResult;
        assert.match(rejected.reason.message, /changed|decided/);
      };

      await t.test(
        "opposing simultaneous HR decisions have one winner and consistent attendance, audit and notices",
        async () => {
          for (let attempt = 0; attempt < 4; attempt++) {
            const item = await fixture(),
              before = await record(item.recordId);
            const results = await Promise.allSettled([
              decide(item, "approve", hr),
              decide(item, "reject", otherHr),
            ]);
            assertOneWinner(results);
            const saved = await correction(item.id),
              attendance = await record(item.recordId);
            const approved = results[0]?.status === "fulfilled";
            assert.equal(saved.status, approved ? "Approved" : "Rejected");
            assert.equal(saved.hr_reviewed_by, approved ? hr.userId : otherHr.userId);
            assert.equal(saved.record_version, item.version + 1);
            if (approved) {
              assert.equal(attendance.status, "Corrected");
              assert.equal(
                new Date(attendance.clock_out_at).getTime(),
                Date.parse(item.proposedOut),
              );
              assert.equal(attendance.record_version, before.record_version + 1);
            } else assert.deepEqual(attendance, before);
            assert.equal((await decisions(item.id)).length, 1);
            const notices =
              await query`SELECT * FROM notifications WHERE organisation_id=${org} AND type='attendance.correction' AND link->>'entityId'=${item.id}`;
            assert.equal(notices.length, 1);
            assert.match(String(notices[0]?.title), approved ? /approved/ : /declined/);
          }
        },
      );

      await t.test("duplicate approvals and later retries do not apply punches twice", async () => {
        const item = await fixture();
        assertOneWinner(
          await Promise.allSettled([decide(item, "approve"), decide(item, "approve", otherHr)]),
        );
        const before = await record(item.recordId),
          saved = await correction(item.id);
        await assert.rejects(decide(item, "approve"), /changed|decided/);
        await assert.rejects(
          decide({ ...item, version: saved.record_version }, "reject"),
          /changed|decided/,
        );
        assert.deepEqual(await record(item.recordId), before);
        assert.deepEqual(await correction(item.id), saved);
        assert.equal((await decisions(item.id)).length, 1);
      });

      await t.test(
        "manager decisions serialize and stale HR screens cannot skip a review stage",
        async () => {
          const racing = await fixture("Pending Manager"),
            before = await record(racing.recordId);
          assertOneWinner(
            await Promise.allSettled([
              decide(racing, "approve", manager),
              decide(racing, "reject", manager),
            ]),
          );
          assert.deepEqual(await record(racing.recordId), before);
          assert.equal((await decisions(racing.id)).length, 1);
          const item = await fixture("Pending Manager");
          await decide(item, "approve", manager);
          await assert.rejects(decide(item, "approve", hr), /changed/);
          assert.equal((await correction(item.id)).status, "Pending HR");
          await decide({ ...item, version: 2 }, "approve", hr);
          assert.equal((await correction(item.id)).record_version, 3);
          assert.equal((await decisions(item.id)).length, 2);
        },
      );

      await t.test(
        "two different corrections cannot overwrite each other's attendance changes",
        async () => {
          const first = await fixture(),
            second = { ...first, id: randomUUID() };
          await query`INSERT INTO attendance_corrections (id,organisation_id,attendance_record_id,employee_id,correction_type,original_clock_in,original_clock_out,
        original_status,proposed_clock_in,proposed_clock_out,explanation,status,record_version,created_by,updated_by)
        SELECT ${second.id},organisation_id,attendance_record_id,employee_id,correction_type,original_clock_in,original_clock_out,
          original_status,proposed_clock_in,proposed_clock_out + interval '1 hour',explanation,status,record_version,created_by,updated_by
        FROM attendance_corrections WHERE id=${first.id}`;
          const results = await Promise.allSettled([
            decide(first, "approve"),
            decide(second, "approve", otherHr),
          ]);
          assertOneWinner(results);
          const loser = results[0]?.status === "rejected" ? first : second;
          assert.equal((await correction(loser.id)).status, "Pending HR");
          assert.equal((await decisions(loser.id)).length, 0);
          const before = await record(first.recordId);
          await decide(loser, "reject");
          assert.deepEqual(
            await record(first.recordId),
            before,
            "Rejecting a stale correction must preserve the newer attendance",
          );
        },
      );

      await t.test(
        "changed or archived attendance cannot be overwritten by an old request",
        async () => {
          for (const change of ["punch", "status", "archive"] as const) {
            const item = await fixture();
            if (change === "punch")
              await query`UPDATE attendance_records SET clock_out_at=clock_out_at + interval '30 minutes' WHERE id=${item.recordId}`;
            if (change === "status")
              await query`UPDATE attendance_records SET status='On Leave' WHERE id=${item.recordId}`;
            if (change === "archive")
              await query`UPDATE attendance_records SET archived_at=now() WHERE id=${item.recordId}`;
            const before = await record(item.recordId),
              saved = await correction(item.id);
            await assert.rejects(decide(item, "approve"), /Attendance has changed/);
            assert.deepEqual(await record(item.recordId), before);
            assert.deepEqual(await correction(item.id), saved);
            assert.equal((await decisions(item.id)).length, 0);
          }
        },
      );

      await t.test(
        "permissions, self-approval, invalid versions and archived requests remain blocked",
        async () => {
          const item = await fixture("Pending Manager"),
            before = await correction(item.id);
          await assert.rejects(decide(item, "approve", outsider), /assigned/);
          await assert.rejects(decide(item, "approve", hr), /assigned/);
          await assert.rejects(
            decideAttendanceCorrectionInDatabase(
              randomUUID(),
              item.id,
              "approve",
              "Wrong organisation",
              manager,
              1,
            ),
            /not found/,
          );
          for (const version of [0, -1, 1.5, NaN])
            await assert.rejects(decide({ ...item, version }, "approve", manager), /Refresh/);
          assert.deepEqual(await correction(item.id), before);
          await query`UPDATE attendance_corrections SET archived_at=now() WHERE id=${item.id}`;
          await assert.rejects(decide(item, "approve", manager), /not found/);
          const self = await fixture();
          await assert.rejects(
            decide(self, "approve", { ...employee, activeRole: "HR" }),
            /own attendance/,
          );
          await assert.rejects(
            decideAttendanceCorrectionInDatabase(org, self.id, "reject", "", hr, self.version),
            /Explain why/,
          );
          assert.equal((await decisions(self.id)).length, 0);
        },
      );
    } finally {
      await query.end();
      await closeDatabaseConnection();
    }
  },
);
