import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection } from "../src/lib/db/client.ts";
import { decryptSensitiveJson } from "../src/lib/db/encryption.server.ts";
import {
  createEmployeeInDatabase,
  updateEmploymentRecordInDatabase,
  updatePersonalRecordInDatabase,
  processScheduledEmploymentChanges,
  listScheduledEmploymentChangesInDatabase,
  cancelScheduledEmploymentChangeInDatabase,
} from "../src/lib/db/repositories/employee.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "scheduled employment changes apply atomically on the organisation date, once, with private review and cancellation",
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const query = postgres(databaseUrl!, { max: 2, prepare: false });
    const org = randomUUID();
    const authorId = randomUUID();
    const authorEmployeeId = randomUUID();
    const department = randomUUID();
    const position = randomUUID();
    const location = randomUUID();
    const employmentType = randomUUID();
    const actor = {
      userId: authorId,
      employeeId: authorEmployeeId,
      displayName: "Scheduling administrator",
      activeRole: "Super Admin" as const,
      roles: ["Employee", "HR", "Accounts", "Super Admin"] as const,
    };
    const hr = { ...actor, activeRole: "HR" as const };
    const accounts = { ...actor, activeRole: "Accounts" as const };
    const beforeMidnight = new Date("2026-09-30T19:59:59Z");
    const midnight = new Date("2026-09-30T20:00:00Z");
    try {
      await query`INSERT INTO organisations (id,name,slug,created_by,updated_by)
      VALUES (${org},'Employment scheduling test',${`schedule-${org}`},${authorId},${authorId})`;
      await query`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,
      standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by)
      VALUES (${org},'Asia/Muscat','OMR',ARRAY[0,1,2,3,4],8,40,'01-01','12-31',ARRAY[30,7],'TEST-{####}','CAN-{####}',${authorId},${authorId})`;
      for (const [table, id, name] of [
        ["departments", department, "Operations"],
        ["positions", position, "Coordinator"],
        ["locations", location, "Muscat"],
        ["employment_types", employmentType, "Full-time"],
        ["positions", randomUUID(), "Lead"],
      ] as const) {
        await query.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        VALUES ($1,$2,$3,$3,true,1,$4,$4)`,
          [id, org, name, authorId],
        );
      }
      await query`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,
      department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by)
      VALUES (${authorEmployeeId},${org},'SCHED-ADMIN','Scheduling administrator','Admin',${`admin-${org}@viahr.test`},
      ${department},${position},${location},${employmentType},'Active','2020-01-01',${authorId},${authorId})`;
      await query`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
      VALUES (${authorId},${org},${authorEmployeeId},'Scheduling administrator',${`admin-${org}@viahr.test`},'Active',${authorId},${authorId})`;
      await query`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason)
      SELECT ${org},${authorId},id,${authorId},'Test scheduler' FROM roles WHERE code IN ('Employee','HR','Accounts','Super Admin') ON CONFLICT DO NOTHING`;
      const created = await createEmployeeInDatabase(
        org,
        {
          employeeNumber: "SCHED-001",
          legalName: "Scheduled Employee",
          preferredName: "Scheduled",
          workEmail: `employee-${org}@viahr.test`,
          department: "Operations",
          position: "Coordinator",
          location: "Muscat",
          employmentType: "Full-time",
          status: "Active",
          startDate: "2020-01-01",
          lineManagerId: authorEmployeeId,
          salary: { baseMonthly: 1000, currency: "OMR" },
          emergencyContacts: [],
          dependants: [],
        },
        actor,
      );
      const employeeId = created.employeeId;
      await query`UPDATE employees SET employment_confirmation_status='Confirmed' WHERE id=${employeeId}`;
      const siteLocation = randomUUID();
      await query`INSERT INTO locations (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        VALUES (${siteLocation},${org},'Site','SITE',true,2,${authorId},${authorId})`;
      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { location: "Site", position: "Coordinator", employmentType: "Full-time" },
        "2026-09-30",
        "",
        hr,
        beforeMidnight,
      );
      assert.equal(
        (await query`SELECT location_id FROM employees WHERE id=${employeeId}`)[0]!.location_id,
        siteLocation,
      );
      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { position: "Lead" },
        "2026-09-30",
        "",
        hr,
        beforeMidnight,
      );
      assert.equal(
        (
          await query`SELECT p.name FROM employees e JOIN positions p ON p.id=e.position_id WHERE e.id=${employeeId}`
        )[0]!.name,
        "Lead",
      );
      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { position: "Coordinator" },
        "2026-09-30",
        "",
        hr,
        beforeMidnight,
      );
      await assert.rejects(
        updateEmploymentRecordInDatabase(
          org,
          employeeId,
          { salary: { baseMonthly: 9000, currency: "OMR" } },
          "2026-09-30",
          "",
          accounts,
          beforeMidnight,
        ),
        /reason/,
      );
      await updatePersonalRecordInDatabase(org, employeeId, { phone: "12345678" }, "", hr);
      await updatePersonalRecordInDatabase(org, employeeId, { nationality: "Omani" }, "", hr);
      const [routineAudit] =
        await query`SELECT reason FROM audit_events WHERE entity_id=${employeeId} AND action='update-personal-record' LIMIT 1`;
      assert.equal(routineAudit!.reason, "Personal details updated by HR");
      const snapshot = async () => ({
        employee: await query`SELECT * FROM employees WHERE id=${employeeId}`,
        compensation:
          await query`SELECT * FROM employee_compensation WHERE employee_id=${employeeId}`,
        reporting:
          await query`SELECT * FROM employee_reporting_lines WHERE employee_id=${employeeId} ORDER BY id`,
        history:
          await query`SELECT * FROM employment_changes WHERE employee_id=${employeeId} ORDER BY id`,
        access: await query`SELECT * FROM users WHERE employee_id=${employeeId}`,
      });
      const before = await snapshot();
      assert.equal(
        (
          await updateEmploymentRecordInDatabase(
            org,
            employeeId,
            {
              position: "Lead",
              lineManagerId: null,
              salary: { baseMonthly: 7500, currency: "OMR" },
            },
            "2026-10-01",
            "Future promotion approved",
            actor,
            beforeMidnight,
          )
        ).status,
        "Scheduled",
      );
      assert.deepEqual(
        await snapshot(),
        before,
        "Scheduling must not change current employee, salary, reporting lines or history",
      );
      const [stored] =
        await query`SELECT encrypted_payload FROM scheduled_employment_changes WHERE organisation_id=${org}`;
      assert.doesNotMatch(String(stored?.encrypted_payload), /7500|baseline|Lead/);
      const pending = await listScheduledEmploymentChangesInDatabase(org, employeeId, actor);
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.status, "Pending");
      await assert.rejects(
        query`UPDATE scheduled_employment_changes SET organisation_id=${randomUUID()} WHERE id=${pending[0]!.id}`,
        /organisation_id cannot be changed/i,
      );
      await assert.rejects(
        query`UPDATE scheduled_employment_changes SET record_version=record_version+2 WHERE id=${pending[0]!.id}`,
        /can advance by at most one/i,
      );
      assert.deepEqual(
        await listScheduledEmploymentChangesInDatabase(org, employeeId, hr),
        [],
        "HR must not read mixed salary batches",
      );
      await assert.rejects(
        listScheduledEmploymentChangesInDatabase(org, employeeId, {
          ...actor,
          activeRole: "Employee",
        }),
        /access/,
      );
      await assert.rejects(
        cancelScheduledEmploymentChangeInDatabase(
          org,
          pending[0]!.id,
          "Unauthorised cancellation",
          hr,
        ),
        /permission/,
      );
      await assert.rejects(
        updateEmploymentRecordInDatabase(
          org,
          employeeId,
          { salary: { baseMonthly: 8000, currency: "OMR" } },
          "2026-10-02",
          "Conflicting future salary",
          accounts,
          beforeMidnight,
        ),
        /pending change/,
      );
      assert.deepEqual(await processScheduledEmploymentChanges(beforeMidnight, org), {
        applied: 0,
        needsReview: 0,
      });
      assert.deepEqual(await snapshot(), before);
      const outcomes = await Promise.all([
        processScheduledEmploymentChanges(midnight, org),
        processScheduledEmploymentChanges(midnight, org),
      ]);
      assert.equal(
        outcomes.reduce((sum, result) => sum + result.applied, 0),
        1,
        "Concurrent workers apply once",
      );
      const applied = await snapshot();
      assert.equal(applied.employee[0]?.line_manager_id, null);
      assert.equal(
        decryptSensitiveJson<{ baseMonthly: number }>(
          String(applied.compensation[0]?.encrypted_payload),
        ).baseMonthly,
        7500,
      );
      assert.equal(applied.reporting.length, 1);
      assert.equal(applied.reporting[0]?.effective_to.toISOString().slice(0, 10), "2026-10-01");
      assert.equal(
        applied.history.filter((entry) => entry.reason === "Future promotion approved").length,
        3,
      );
      await processScheduledEmploymentChanges(new Date("2026-10-03T00:00:00Z"), org);
      assert.deepEqual(
        await snapshot(),
        applied,
        "Repeated and catch-up worker runs cannot reapply a change",
      );
      await assert.rejects(
        cancelScheduledEmploymentChangeInDatabase(org, pending[0]!.id, "Too late to cancel", actor),
        /already been applied/,
      );

      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { weeklyHours: 35 },
        "2026-11-01",
        "Reduced weekly hours",
        hr,
        midnight,
      );
      const toCancel = (await listScheduledEmploymentChangesInDatabase(org, employeeId, hr))[0]!;
      await cancelScheduledEmploymentChangeInDatabase(
        org,
        toCancel.id,
        "Contract change withdrawn",
        hr,
      );
      await processScheduledEmploymentChanges(new Date("2026-11-02T00:00:00Z"), org);
      assert.deepEqual(
        await snapshot(),
        applied,
        "Cancelled changes never affect current employment",
      );

      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { weeklyHours: 36 },
        "2026-11-01",
        "Revised weekly hours",
        hr,
        midnight,
      );
      // A separate controlled workflow may change the baseline while this change is pending.
      await query`UPDATE employees SET weekly_hours=30 WHERE id=${employeeId}`;
      const conflictedBefore = await snapshot();
      assert.deepEqual(
        await processScheduledEmploymentChanges(new Date("2026-11-02T00:00:00Z"), org),
        { applied: 0, needsReview: 1 },
      );
      assert.deepEqual(await snapshot(), conflictedBefore);
      const review = (await listScheduledEmploymentChangesInDatabase(org, employeeId, hr))[0]!;
      assert.equal(review.status, "Needs Review");
      const [notification] =
        await query`SELECT count(*)::int as count FROM notifications WHERE organisation_id=${org} AND type='employment.scheduled_change_review'`;
      assert.ok(Number(notification?.count) > 0);
      await cancelScheduledEmploymentChangeInDatabase(
        org,
        review.id,
        "Correct the proposed change",
        hr,
      );

      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { weeklyHours: 37 },
        "2026-11-01",
        "Change awaiting author review",
        hr,
        midnight,
      );
      await query`DELETE FROM user_roles WHERE organisation_id=${org} AND user_id=${authorId} AND role_id IN (SELECT id FROM roles WHERE code='HR')`;
      assert.deepEqual(
        await processScheduledEmploymentChanges(new Date("2026-11-02T00:00:00Z"), org),
        { applied: 0, needsReview: 1 },
      );
      assert.deepEqual(
        await snapshot(),
        conflictedBefore,
        "Removed HR authority must not be silently reused",
      );
      await updateEmploymentRecordInDatabase(
        org,
        employeeId,
        { salary: { baseMonthly: 7600, currency: "OMR" } },
        "2026-11-01",
        "Salary decision racing cancellation",
        accounts,
        midnight,
      );
      const racing = (
        await listScheduledEmploymentChangesInDatabase(org, employeeId, accounts)
      )[0]!;
      const raceResults = await Promise.allSettled([
        cancelScheduledEmploymentChangeInDatabase(
          org,
          racing.id,
          "Cancel this salary decision",
          accounts,
        ),
        processScheduledEmploymentChanges(new Date("2026-11-02T00:00:00Z"), org),
      ]);
      assert.equal(raceResults[1]?.status, "fulfilled");
      const [raceRow] =
        await query`SELECT status FROM scheduled_employment_changes WHERE id=${racing.id}`;
      assert.ok(raceRow?.status === "Applied" || raceRow?.status === "Cancelled");
      if (raceRow.status === "Cancelled") assert.deepEqual(await snapshot(), conflictedBefore);
      else {
        assert.equal(raceResults[0]?.status, "rejected");
        const afterRace = await snapshot();
        assert.equal(
          decryptSensitiveJson<{ baseMonthly: number }>(
            String(afterRace.compensation[0]?.encrypted_payload),
          ).baseMonthly,
          7600,
        );
      }
    } finally {
      await query.end();
      await closeDatabaseConnection();
    }
  },
);
