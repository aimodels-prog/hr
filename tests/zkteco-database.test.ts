import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  createAttendanceConnectorPairingCode,
  changeAttendanceDeviceEmployee,
  ingestZktecoPunchBatch,
  listAttendanceDeviceAdministration,
  mapAttendanceDeviceUserInDatabase,
  redeemAttendanceConnectorPairingCode,
  resolveAttendanceDeviceCredential,
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
        "",
        hrActor,
      );
      const previousKeyId = process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];
      await assert.doesNotReject(
        saveAttendanceDeviceInDatabase(
          organisationId,
          {
            id: deviceId,
            recordVersion: 1,
            code: "front-door",
            name: "Renamed terminal",
            locationId,
            serialNumber: "SN-TEST-001",
            model: "ZKTeco F18",
            isActive: true,
          },
          "",
          hrActor,
        ),
      );
      const previousKeys = process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
      process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "test";
      process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({
        test: Buffer.alloc(32, 7).toString("base64"),
      });
      try {
        await assert.rejects(
          createAttendanceConnectorPairingCode(organisationId, deviceId, {
            userId: randomUUID(),
            employeeId,
            displayName: "Terminal Employee",
            activeRole: "Employee",
            roles: ["Employee"],
          }),
          /Only HR or a Super Admin/,
        );
        const pairing = await createAttendanceConnectorPairingCode(
          organisationId,
          deviceId,
          hrActor,
        );
        assert.match(pairing.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        const redeemed = await redeemAttendanceConnectorPairingCode(pairing.code, {
          connectorVersion: "1.1",
          connectorPlatform: "Windows",
          serialNumber: "SN-TEST-001",
        });
        assert.equal(redeemed.deviceCode, "front-door");
        assert.equal(
          await resolveAttendanceDeviceCredential(organisationId, "front-door"),
          redeemed.credential,
        );
        await assert.rejects(
          redeemAttendanceConnectorPairingCode(pairing.code, {}),
          /invalid or expired/,
        );
      } finally {
        if (previousKeyId === undefined)
          delete process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];
        else process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = previousKeyId;
        if (previousKeys === undefined) delete process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
        else process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = previousKeys;
      }
      const pairedAdministration = await listAttendanceDeviceAdministration(
        organisationId,
        hrActor,
      );
      const pairedDeviceVersion = pairedAdministration.devices.find(
        ({ device }) => device.id === deviceId,
      )?.device.recordVersion;
      assert.ok(pairedDeviceVersion);
      await saveAttendanceDeviceInDatabase(
        organisationId,
        {
          id: deviceId,
          recordVersion: pairedDeviceVersion,
          code: "front-door",
          name: "Front Door Terminal",
          locationId,
          serialNumber: "SN-TEST-001",
          model: "ZKTeco F18/ID",
          isActive: true,
        },
        "",
        hrActor,
      );
      await assert.rejects(
        saveAttendanceDeviceInDatabase(
          organisationId,
          {
            id: deviceId,
            recordVersion: pairedDeviceVersion,
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
      assert.equal(Number(record?.calculated_hours), 7, "Deduct the 13:00–14:00 lunch overlap");
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
        "",
        hrActor,
      );
      await assert.rejects(
        mapAttendanceDeviceUserInDatabase(
          organisationId,
          {
            deviceId,
            deviceUserId: "terminal-unknown-7",
            employeeId,
          },
          "",
          hrActor,
        ),
        /reassigned/,
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

      const match = afterMapping.mappings.find(
        (m) => m.mapping.deviceUserId === "terminal-unknown-7",
      )!.mapping;
      const changeInput = { mappingId: match.id, employeeId: hrEmployeeId };
      await assert.rejects(
        changeAttendanceDeviceEmployee(organisationId, changeInput, {
          ...hrActor,
          activeRole: "Employee",
        }),
        /Only HR/,
      );
      await assert.rejects(
        changeAttendanceDeviceEmployee(randomUUID(), changeInput, hrActor),
        /no longer exists/,
      );
      await assert.rejects(
        changeAttendanceDeviceEmployee(organisationId, { ...changeInput, employeeId }, hrActor),
        /already has a user ID/,
      );
      const preview = await changeAttendanceDeviceEmployee(organisationId, changeInput, hrActor);
      assert.equal(preview.changed, false);
      assert.equal(preview.punchCount, 1);
      assert.deepEqual(preview.blocked, []);
      const [unchanged] =
        await sql`SELECT employee_id FROM attendance_device_employee_mappings WHERE id=${match.id}`;
      assert.equal(unchanged.employee_id, secondEmployeeId, "Preview must not change the match");
      await ingestZktecoPunchBatch(organisationId, "front-door", {
        punches: [
          {
            externalEventId: "unknown-second-punch",
            deviceUserId: "terminal-unknown-7",
            occurredAt: clockOut.toISOString(),
          },
        ],
      });
      await assert.rejects(
        changeAttendanceDeviceEmployee(
          organisationId,
          { ...changeInput, previewToken: preview.previewToken },
          hrActor,
        ),
        /changed since your preview/,
      );
      await sql`UPDATE attendance_records SET status='Corrected' WHERE id=${recovered.attendance_record_id}`;
      const blockedPreview = await changeAttendanceDeviceEmployee(
        organisationId,
        changeInput,
        hrActor,
      );
      assert.ok(blockedPreview.blocked.some((b) => b.includes("HR corrections")));
      await assert.rejects(
        changeAttendanceDeviceEmployee(
          organisationId,
          { ...changeInput, previewToken: blockedPreview.previewToken },
          hrActor,
        ),
        /HR corrections/,
      );
      await sql`UPDATE attendance_records SET status='Present' WHERE id=${recovered.attendance_record_id}`;
      const periodId = randomUUID();
      const sheetId = randomUUID();
      const date = preview.dates[0]!;
      await sql`INSERT INTO timesheet_periods (id, organisation_id, start_date, end_date, created_by, updated_by)
        VALUES (${periodId}, ${organisationId}, ${date}, ${date}, ${hrUserId}, ${hrUserId})`;
      await sql`INSERT INTO timesheets (id, organisation_id, employee_id, period_id, status, expected_hours, total_hours, created_by, updated_by)
        VALUES (${sheetId}, ${organisationId}, ${secondEmployeeId}, ${periodId}, 'Pending HR', 8, 8, ${hrUserId}, ${hrUserId})`;
      const sheetPreview = await changeAttendanceDeviceEmployee(
        organisationId,
        changeInput,
        hrActor,
      );
      assert.ok(sheetPreview.blocked.some((b) => b.includes("timesheet")));
      await sql`UPDATE timesheets SET status='Draft' WHERE id=${sheetId}`;
      const ready = await changeAttendanceDeviceEmployee(organisationId, changeInput, hrActor);
      const decisions = await Promise.allSettled(
        [0, 1].map(() =>
          changeAttendanceDeviceEmployee(
            organisationId,
            { ...changeInput, previewToken: ready.previewToken },
            hrActor,
          ),
        ),
      );
      assert.equal(decisions.filter((d) => d.status === "fulfilled" && d.value.changed).length, 1);
      assert.equal(
        decisions.filter((d) => d.status === "rejected").length,
        1,
        "Concurrent confirmation cannot apply twice",
      );
      const [oldRecord] =
        await sql`SELECT clock_in_at, clock_out_at, calculated_hours FROM attendance_records WHERE id=${recovered.attendance_record_id}`;
      assert.equal(oldRecord.clock_in_at, null);
      assert.equal(oldRecord.clock_out_at, null);
      assert.equal(Number(oldRecord.calculated_hours), 0);
      const [newRecord] =
        await sql`SELECT clock_in_at, clock_out_at FROM attendance_records WHERE organisation_id=${organisationId} AND employee_id=${hrEmployeeId} AND date=${date}`;
      assert.ok(newRecord.clock_in_at);
      assert.equal(new Date(newRecord.clock_out_at).toISOString(), clockOut.toISOString());
      const [retained] =
        await sql`SELECT employee_id, punch_event_id, device_user_id FROM attendance_device_punches WHERE organisation_id=${organisationId} AND external_event_id='terminal-event-unknown'`;
      assert.equal(retained.employee_id, hrEmployeeId);
      assert.equal(
        retained.punch_event_id,
        recovered.punch_event_id,
        "Original punch IDs are retained",
      );
      assert.equal(retained.device_user_id, "terminal-unknown-7");
      const [audit] =
        await sql`SELECT before_summary, after_summary FROM audit_events WHERE organisation_id=${organisationId} AND action='correct-device-user-match'`;
      assert.equal(audit.before_summary.employeeId, secondEmployeeId);
      assert.equal(audit.after_summary.employeeId, hrEmployeeId);
      await assert.rejects(
        changeAttendanceDeviceEmployee(
          organisationId,
          { ...changeInput, previewToken: ready.previewToken },
          hrActor,
        ),
        /different employee/,
      );
      const [sheet] = await sql`SELECT total_hours FROM timesheets WHERE id=${sheetId}`;
      assert.equal(Number(sheet.total_hours), 8, "Never silently edit saved timesheet entries");

      const siteDay = new Date(yesterday);
      siteDay.setUTCDate(siteDay.getUTCDate() - 5);
      const siteDate = siteDay.toISOString().slice(0, 10);
      const siteRecordId = randomUUID();
      await sql`INSERT INTO attendance_records (id, organisation_id, employee_id, date, clock_in_at, source, status, created_by, updated_by)
        VALUES (${siteRecordId}, ${organisationId}, ${employeeId}, ${siteDate}, ${`${siteDate}T08:00:00Z`}, 'Site Visit Auto', 'Present', ${hrUserId}, ${hrUserId})`;
      await sql`INSERT INTO site_visit_requests (organisation_id, employee_id, date, start_time, end_time, origin, destination, purpose, status, requested_at, details, created_by, updated_by)
        VALUES (${organisationId}, ${employeeId}, ${siteDate}, '08:00', '17:00', 'Home', 'Client site', 'Approved site duty', 'Approved', now(), '{"returnPlan":"Unknown"}'::jsonb, ${hrUserId}, ${hrUserId})`;
      await ingestZktecoPunchBatch(organisationId, "front-door", {
        punches: [
          {
            externalEventId: "site-return",
            deviceUserId: "VIA-TERM-101",
            occurredAt: `${siteDate}T14:00:00Z`,
            status: 0,
          },
        ],
      });
      const [returnedFromSite] =
        await sql`SELECT clock_in_at, clock_out_at FROM attendance_records WHERE id=${siteRecordId}`;
      assert.equal(
        new Date(returnedFromSite.clock_in_at).toISOString(),
        `${siteDate}T08:00:00.000Z`,
        "Keep the approved home-origin start",
      );
      assert.equal(returnedFromSite.clock_out_at, null, "Terminal IN marks return, not clock-out");
      const [siteVisit] =
        await sql`SELECT details FROM site_visit_requests WHERE employee_id=${employeeId} AND date=${siteDate}`;
      assert.equal(
        new Date(siteVisit.details.returnedAt).toISOString(),
        `${siteDate}T14:00:00.000Z`,
      );
      await ingestZktecoPunchBatch(organisationId, "front-door", {
        punches: [
          {
            externalEventId: "site-office-out",
            deviceUserId: "VIA-TERM-101",
            occurredAt: `${siteDate}T17:30:00Z`,
            status: 1,
          },
        ],
      });
      const [finishedOffice] =
        await sql`SELECT clock_in_at, clock_out_at FROM attendance_records WHERE id=${siteRecordId}`;
      assert.equal(new Date(finishedOffice.clock_in_at).toISOString(), `${siteDate}T08:00:00.000Z`);
      assert.equal(
        new Date(finishedOffice.clock_out_at).toISOString(),
        `${siteDate}T17:30:00.000Z`,
      );
      // Keep history: stop exact-ID automatic rematching without touching approved/site records.
      const [mainMatch] =
        await sql`SELECT id FROM attendance_device_employee_mappings WHERE device_id=${deviceId} AND device_user_id='VIA-TERM-101'`;
      const removeMain = { mappingId: mainMatch.id, removeMode: "keep" as const };
      const unsafeRemoval = await changeAttendanceDeviceEmployee(
        organisationId,
        { ...removeMain, removeMode: "review" },
        hrActor,
      );
      assert.ok(
        unsafeRemoval.blocked.length,
        "Returning history cannot overwrite protected site visits",
      );
      await assert.rejects(
        changeAttendanceDeviceEmployee(
          organisationId,
          { ...removeMain, removeMode: "review", previewToken: unsafeRemoval.previewToken },
          hrActor,
        ),
        /site visit|HR corrections/,
      );
      const removal = await changeAttendanceDeviceEmployee(organisationId, removeMain, hrActor);
      assert.deepEqual(removal.blocked, []);
      await assert.rejects(
        changeAttendanceDeviceEmployee(organisationId, removeMain, {
          ...hrActor,
          activeRole: "Employee",
        }),
        /Only HR/,
      );
      await changeAttendanceDeviceEmployee(
        organisationId,
        { ...removeMain, previewToken: removal.previewToken },
        hrActor,
      );
      const [kept] =
        await sql`SELECT clock_in_at, clock_out_at FROM attendance_records WHERE id=${siteRecordId}`;
      assert.deepEqual(kept, finishedOffice);
      const afterRemoval = await ingestZktecoPunchBatch(organisationId, "front-door", {
        punches: [
          {
            externalEventId: "after-removal",
            deviceUserId: "VIA-TERM-101",
            occurredAt: new Date().toISOString(),
          },
        ],
      });
      assert.equal(
        afterRemoval.unmatched,
        1,
        "A deliberately removed exact-ID match must not return automatically",
      );
      await mapAttendanceDeviceUserInDatabase(
        organisationId,
        { deviceId, deviceUserId: "replacement-id", employeeId },
        "",
        hrActor,
      );
      const [replacement] =
        await sql`SELECT id FROM attendance_device_employee_mappings WHERE device_id=${deviceId} AND device_user_id='replacement-id'`;
      const replacementPreview = await changeAttendanceDeviceEmployee(
        organisationId,
        { mappingId: replacement.id, removeMode: "keep" },
        hrActor,
      );
      await changeAttendanceDeviceEmployee(
        organisationId,
        {
          mappingId: replacement.id,
          removeMode: "keep",
          previewToken: replacementPreview.previewToken,
        },
        hrActor,
      );
      await mapAttendanceDeviceUserInDatabase(
        organisationId,
        { deviceId, deviceUserId: "VIA-TERM-101", employeeId },
        "",
        hrActor,
      );
      const [reattached] =
        await sql`SELECT employee_id,status FROM attendance_device_punches WHERE device_id=${deviceId} AND external_event_id='after-removal'`;
      assert.equal(reattached.employee_id, employeeId);
      assert.equal(reattached.status, "Applied");

      // Incorrect history: raw punches remain, while only calculated assignment is removed.
      const removeWrong = { mappingId: match.id, removeMode: "review" as const };
      const wrongPreview = await changeAttendanceDeviceEmployee(
        organisationId,
        removeWrong,
        hrActor,
      );
      assert.equal(wrongPreview.punchCount, 2);
      const rawBefore =
        await sql`SELECT id,device_user_id,occurred_at,external_event_id FROM attendance_device_punches WHERE device_id=${deviceId} AND device_user_id='terminal-unknown-7' ORDER BY id`;
      await changeAttendanceDeviceEmployee(
        organisationId,
        { ...removeWrong, previewToken: wrongPreview.previewToken },
        hrActor,
      );
      const rawAfter =
        await sql`SELECT id,device_user_id,occurred_at,external_event_id FROM attendance_device_punches WHERE device_id=${deviceId} AND device_user_id='terminal-unknown-7' ORDER BY id`;
      assert.deepEqual(rawAfter, rawBefore);
      const [cleared] =
        await sql`SELECT clock_in_at,calculated_hours FROM attendance_records WHERE employee_id=${hrEmployeeId} AND date=${date}`;
      assert.equal(cleared.clock_in_at, null);
      assert.equal(Number(cleared.calculated_hours), 0);
      const pendingAgain = await listAttendanceDeviceAdministration(organisationId, hrActor);
      assert.equal(
        pendingAgain.unmatched.filter((x) => x.punch.deviceUserId === "terminal-unknown-7").length,
        2,
      );
      assert.equal(
        pendingAgain.mappings.some((x) => x.mapping.id === match.id),
        false,
      );
      const appliedAgain = await mapAttendanceDeviceUserInDatabase(
        organisationId,
        { deviceId, deviceUserId: "terminal-unknown-7", employeeId: secondEmployeeId },
        "",
        hrActor,
      );
      assert.equal(
        appliedAgain,
        2,
        "Returned punches can be matched to a different employee without duplicates",
      );
      const [eventCount] =
        await sql`SELECT count(*)::int AS count FROM attendance_punch_events WHERE device_id=${deviceId} AND device_user_id='terminal-unknown-7'`;
      assert.equal(eventCount.count, 2);
      const [removedAudit] =
        await sql`SELECT before_summary FROM audit_events WHERE entity_id=${match.id} AND action='remove-device-user-match'`;
      assert.equal(removedAudit.before_summary.projectedEvents.length, 2);
    } finally {
      await sql.end();
    }
  },
);
