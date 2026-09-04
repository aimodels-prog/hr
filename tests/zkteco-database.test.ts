import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  ingestZktecoPunchBatch,
  listAttendanceDeviceAdministration,
  mapAttendanceDeviceUserInDatabase,
  saveAttendanceDeviceInDatabase,
} from "../src/lib/db/repositories/zkteco.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "ZKTeco batches are idempotent, exactly mapped and recover unmatched punches",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const organisationId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const employmentTypeId = randomUUID();
    const locationId = randomUUID();
    const hrEmployeeId = randomUUID();
    const hrUserId = randomUUID();
    const employeeId = randomUUID();
    const secondEmployeeId = randomUUID();
    const createdAt = new Date();
    const hrActor = {
      userId: hrUserId,
      employeeId: hrEmployeeId,
      displayName: "HR Device Administrator",
      activeRole: "HR" as const,
      roles: ["Employee", "HR"] as const,
    };

    try {
      await sql`
        INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by, created_at, updated_at)
        VALUES (${organisationId}, 'ZKTeco Database Test', ${`zkteco-${organisationId}`}, true,
          ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt})
      `;
      for (const [table, id, name] of [
        ["departments", departmentId, "Operations"],
        ["positions", positionId, "Coordinator"],
        ["employment_types", employmentTypeId, "Full-time"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, 1, $5, $5, $6, $6)`,
          [id, organisationId, name, name.slice(0, 3).toUpperCase(), hrUserId, createdAt],
        );
      }
      await sql`
        INSERT INTO locations (
          id, organisation_id, name, code, is_active, order_index, latitude, longitude,
          radius_meters, is_clock_in_site, created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${locationId}, ${organisationId}, 'Main Office', 'HQ', true, 1, 25.2048, 55.2708,
          150, true, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
        )
      `;
      for (const [id, number, name] of [
        [hrEmployeeId, "HR-DEVICE", "HR Device Administrator"],
        [employeeId, "VIA-TERM-101", "Terminal Employee"],
        [secondEmployeeId, "VIA-TERM-102", "Unmatched Employee"],
      ] as const) {
        await sql`
          INSERT INTO employees (
            id, organisation_id, employee_number, legal_name, preferred_name, work_email,
            department_id, position_id, location_id, employment_type_id, status, start_date,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${id}, ${organisationId}, ${number}, ${name}, ${name}, ${`${number.toLowerCase()}@via-int.com`},
            ${departmentId}, ${positionId}, ${locationId}, ${employmentTypeId}, 'Active', '2026-01-01',
            ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
          )
        `;
      }
      await sql`
        INSERT INTO users (
          id, organisation_id, employee_id, display_name, workspace_email, status,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${hrUserId}, ${organisationId}, ${hrEmployeeId}, 'HR Device Administrator',
          'hr.device@via-int.com', 'Active', ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
        )
      `;

      const deviceId = await saveAttendanceDeviceInDatabase(
        organisationId,
        {
          code: "front-door",
          name: "Front Door Terminal",
          locationId,
          serialNumber: "SN-TEST-001",
          model: "ZKTeco F18",
          isActive: true,
        },
        "Register the office terminal",
        hrActor,
      );
      await saveAttendanceDeviceInDatabase(
        organisationId,
        {
          id: deviceId,
          recordVersion: 1,
          code: "front-door",
          name: "Front Door Terminal",
          locationId,
          serialNumber: "SN-TEST-001",
          model: "ZKTeco F18/ID",
          isActive: true,
        },
        "Confirm the terminal model",
        hrActor,
      );
      await assert.rejects(
        saveAttendanceDeviceInDatabase(
          organisationId,
          {
            id: deviceId,
            recordVersion: 1,
            code: "front-door",
            name: "Stale terminal edit",
            locationId,
            serialNumber: "SN-TEST-001",
            model: "ZKTeco F18/ID",
            isActive: true,
          },
          "Reject an out-of-date edit",
          hrActor,
        ),
        /changed by someone else/,
      );
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterday.setUTCHours(8, 0, 0, 0);
      const clockOut = new Date(yesterday.getTime() + 8 * 3_600_000);
      const repeatedTap = new Date(yesterday.getTime() + 60_000);
      const batch = {
        serialNumber: "SN-TEST-001",
        punches: [
          {
            externalEventId: "terminal-event-1",
            deviceUserId: "VIA-TERM-101",
            occurredAt: yesterday.toISOString(),
            status: 0,
            punchMethod: 1,
          },
          {
            externalEventId: "terminal-event-repeat",
            deviceUserId: "VIA-TERM-101",
            occurredAt: repeatedTap.toISOString(),
            status: 0,
            punchMethod: 1,
          },
          {
            externalEventId: "terminal-event-2",
            deviceUserId: "VIA-TERM-101",
            occurredAt: clockOut.toISOString(),
            status: 1,
            punchMethod: 1,
          },
        ],
      };
      assert.deepEqual(await ingestZktecoPunchBatch(organisationId, "front-door", batch), {
        accepted: 3,
        duplicates: 0,
        unmatched: 0,
        rejected: 0,
      });
      assert.deepEqual(await ingestZktecoPunchBatch(organisationId, "front-door", batch), {
        accepted: 0,
        duplicates: 3,
        unmatched: 0,
        rejected: 0,
      });
      const [record] = await sql`
        SELECT source, clock_in_at, clock_out_at, calculated_hours
        FROM attendance_records
        WHERE organisation_id = ${organisationId} AND employee_id = ${employeeId}
      `;
      assert.equal(record?.source, "Hardware Terminal");
      assert.ok(record?.clock_in_at);
      assert.ok(record?.clock_out_at);
      assert.equal(Number(record?.calculated_hours), 8);
      const directions = await sql<{ direction: string }[]>`
        SELECT direction FROM attendance_punch_events
        WHERE organisation_id = ${organisationId} AND employee_id = ${employeeId}
        ORDER BY occurred_at
      `;
      assert.deepEqual(
        directions.map((item) => item.direction),
        ["in", "in", "out"],
      );

      const unknownAt = new Date(yesterday.getTime() + 60_000);
      const unknownResult = await ingestZktecoPunchBatch(organisationId, "front-door", {
        punches: [
          {
            externalEventId: "terminal-event-unknown",
            deviceUserId: "terminal-unknown-7",
            deviceUserName: "Unmatched Employee",
            occurredAt: unknownAt.toISOString(),
          },
        ],
      });
      assert.equal(unknownResult.unmatched, 1);
      const beforeMapping = await listAttendanceDeviceAdministration(organisationId, hrActor);
      assert.equal(beforeMapping.unmatched.length, 1);
      assert.equal(beforeMapping.unmatched[0]?.punch.deviceUserName, "Unmatched Employee");

      await mapAttendanceDeviceUserInDatabase(
        organisationId,
        {
          deviceId,
          deviceUserId: "terminal-unknown-7",
          employeeId: secondEmployeeId,
        },
        "HR verified this terminal identity",
        hrActor,
      );
      const afterMapping = await listAttendanceDeviceAdministration(organisationId, hrActor);
      assert.equal(afterMapping.unmatched.length, 0);
      const [recovered] = await sql`
        SELECT status, employee_id, attendance_record_id, punch_event_id
        FROM attendance_device_punches
        WHERE organisation_id = ${organisationId} AND external_event_id = 'terminal-event-unknown'
      `;
      assert.equal(recovered?.status, "Applied");
      assert.equal(recovered?.employee_id, secondEmployeeId);
      assert.ok(recovered?.attendance_record_id);
      assert.ok(recovered?.punch_event_id);
      await assert.rejects(
        sql`UPDATE attendance_device_punches
            SET device_user_name = 'Tampered Name'
            WHERE organisation_id = ${organisationId}
              AND external_event_id = 'terminal-event-unknown'`,
        /terminal punch evidence cannot be changed/,
      );

      await assert.rejects(
        listAttendanceDeviceAdministration(organisationId, {
          ...hrActor,
          activeRole: "Employee",
          roles: ["Employee"],
        }),
        /Only HR or a Super Admin/,
      );
    } finally {
      await sql.end();
    }
  },
);
