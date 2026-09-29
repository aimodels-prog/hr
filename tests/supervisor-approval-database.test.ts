import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { closeDatabaseConnection, getDatabaseClient } from "../src/lib/db/client.ts";
import {
  createEmployeeInDatabase,
  updateEmploymentRecordInDatabase,
  updateUserAccessInDatabase,
  processScheduledEmploymentChanges,
} from "../src/lib/db/repositories/employee.repository.server.ts";
import {
  assignSupervisorApprovalAccess,
  requireEmployeeSupervisor,
  restoreConfirmedSupervisorAccess,
} from "../src/lib/db/repositories/supervisor-access.repository.server.ts";
import {
  requestAttendanceCorrectionInDatabase,
  decideAttendanceCorrectionInDatabase,
} from "../src/lib/db/repositories/attendance.repository.server.ts";
import { createTrainingRequestInDatabase } from "../src/lib/db/repositories/training.repository.server.ts";
import { listTasksForActorInDatabase } from "../src/lib/db/repositories/task.repository.server.ts";

const databaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (databaseUrl) process.env["DATABASE_URL"] = databaseUrl;

test(
  "supervisor approval access follows HR-confirmed reporting lines",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(new URL(databaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const query = postgres(databaseUrl!, { max: 2, prepare: false });
    const org = randomUUID();
    const author = randomUUID();
    const department = randomUUID();
    const position = randomUUID();
    const location = randomUUID();
    const employmentType = randomUUID();
    const now = new Date("2026-09-27T08:00:00Z");
    try {
      await query`INSERT INTO organisations (id,name,slug,created_by,updated_by)
      VALUES (${org},'Supervisor test',${`supervisor-${org}`},${author},${author})`;
      await query`INSERT INTO app_settings (organisation_id,timezone,base_currency,working_days,standard_daily_hours,
      standard_weekly_hours,leave_year_start,leave_year_end,document_reminder_days,employee_number_format,candidate_reference_format,created_by,updated_by)
      VALUES (${org},'Asia/Muscat','OMR',ARRAY[0,1,2,3,4],8,40,'01-01','12-31',ARRAY[30,7],'TEST-{####}','CAN-{####}',${author},${author})`;
      for (const [table, id, name] of [
        ["departments", department, "Operations"],
        ["positions", position, "Coordinator"],
        ["locations", location, "Muscat"],
        ["employment_types", employmentType, "Full-time"],
      ] as const) {
        await query.unsafe(
          `INSERT INTO ${table} (id,organisation_id,name,code,is_active,order_index,created_by,updated_by)
        VALUES ($1,$2,$3,$3,true,1,$4,$4)`,
          [id, org, name, author],
        );
      }
      const person = async (name: string, extraRole?: string, account = true) => {
        const employeeId = randomUUID(),
          userId = randomUUID();
        await query`INSERT INTO employees (id,organisation_id,employee_number,legal_name,preferred_name,work_email,
        department_id,position_id,location_id,employment_type_id,status,start_date,created_by,updated_by)
        VALUES (${employeeId},${org},${employeeId},${name},${name},${`${employeeId}@viahr.test`},
          ${department},${position},${location},${employmentType},'Active','2020-01-01',${author},${author})`;
        if (account) {
          await query`INSERT INTO users (id,organisation_id,employee_id,display_name,workspace_email,status,created_by,updated_by)
          VALUES (${userId},${org},${employeeId},${name},${`${employeeId}@viahr.test`},'Active',${author},${author})`;
          await query`INSERT INTO user_roles (organisation_id,user_id,role_id,assigned_by,reason)
          SELECT ${org},${userId},id,${author},'Test setup' FROM roles WHERE code::text IN ('Employee',${extraRole ?? "Employee"}) ON CONFLICT DO NOTHING`;
        }
        return {
          employeeId,
          userId,
          displayName: name,
          activeRole: "Employee" as const,
          roles: ["Employee"],
        };
      };
      const admin = {
        ...(await person("HR administrator", "HR")),
        activeRole: "HR" as const,
        roles: ["Employee", "HR"],
      };
      const finance = await person("Finance supervisor", "Accounts");
      const employee = await person("Employee");
      const outsider = await person("Other manager", "Line Manager");
      const roleCodes = async (userId: string) =>
        (
          await query`SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=${userId} ORDER BY r.code::text`
        ).map((row) => row.code);
      const setManager = (supervisorId: string) =>
        updateEmploymentRecordInDatabase(
          org,
          employee.employeeId,
          { lineManagerId: supervisorId },
          "2026-09-27",
          "HR assigns supervisor",
          admin,
          now,
        );

      await t.test(
        "HR assignment adds approval access once without removing Finance or Employee",
        async () => {
          await setManager(finance.employeeId);
          await setManager(finance.employeeId);
          assert.deepEqual(await roleCodes(finance.userId), [
            "Accounts",
            "Employee",
            "Line Manager",
          ]);
          assert.equal(
            (
              await query`SELECT id FROM audit_events WHERE organisation_id=${org} AND entity_id=${finance.userId} AND action='supervisor_access_granted'`
            ).length,
            1,
          );
          const account = await getDatabaseClient().transaction((tx) =>
            requireEmployeeSupervisor(tx, org, employee.employeeId),
          );
          assert.equal(account.userId, finance.userId);
          await assert.rejects(
            updateUserAccessInDatabase(
              org,
              finance.userId,
              ["Employee", "Accounts"],
              "Active",
              "Remove manager role",
              admin,
            ),
            /Reassign/,
          );
          await assert.rejects(
            updateUserAccessInDatabase(
              org,
              finance.userId,
              ["Employee", "Accounts", "Line Manager"],
              "Suspended",
              "Suspend manager",
              admin,
            ),
            /Reassign/,
          );
        },
      );

      await t.test(
        "invalid assignments roll back and employee actions never grant access",
        async () => {
          const missing = await person("No account", undefined, false);
          const suspended = await person("Suspended account");
          await query`UPDATE users SET status='Suspended' WHERE id=${suspended.userId}`;
          const inactive = await person("Inactive supervisor");
          await query`UPDATE employees SET status='Inactive' WHERE id=${inactive.employeeId}`;
          const archived = await person("Archived account");
          await query`UPDATE users SET archived_at=now() WHERE id=${archived.userId}`;
          for (const id of [
            missing.employeeId,
            suspended.employeeId,
            inactive.employeeId,
            archived.employeeId,
            employee.employeeId,
            randomUUID(),
          ]) {
            await assert.rejects(setManager(id), /supervisor|themselves/);
            assert.equal(
              (
                await query`SELECT line_manager_id FROM employees WHERE id=${employee.employeeId}`
              )[0]?.line_manager_id,
              finance.employeeId,
            );
          }
          await assert.rejects(
            getDatabaseClient().transaction((tx) =>
              assignSupervisorApprovalAccess(
                tx,
                org,
                employee.employeeId,
                outsider.employeeId,
                employee,
              ),
            ),
            /Only HR/,
          );
          await assert.rejects(
            getDatabaseClient().transaction((tx) =>
              requireEmployeeSupervisor(tx, randomUUID(), employee.employeeId),
            ),
            /Ask HR/,
          );
        },
      );

      await t.test(
        "request submission fails closed when a legacy manager lacks the approval role",
        async () => {
          await query`DELETE FROM user_roles WHERE user_id=${finance.userId} AND role_id IN (SELECT id FROM roles WHERE code='Line Manager')`;
          await assert.rejects(
            requestAttendanceCorrectionInDatabase(
              org,
              {
                employeeId: employee.employeeId,
                date: "2026-09-26",
                proposedClockOut: "17:00",
                explanation: "Forgot to clock out",
              },
              employee,
            ),
            /Line Manager approval access/,
          );
          assert.equal(
            (await query`SELECT id FROM attendance_corrections WHERE organisation_id=${org}`)
              .length,
            0,
          );
          assert.deepEqual(await roleCodes(finance.userId), ["Accounts", "Employee"]);
          // Re-saving the current, HR-authorised assignment repairs legacy access too.
          await setManager(finance.employeeId);
        },
      );

      await t.test(
        "the assigned Finance supervisor can see and act on a real correction in Manager mode",
        async () => {
          const tracking = {
            headOfficeLocationId: location,
            effectiveFrom: "2020-01-01",
            revision: 1,
            assignments: [
              {
                employeeId: employee.employeeId,
                effectiveFrom: "2020-01-01",
                mode: "Head Office biometric",
                source: "location",
              },
            ],
          };
          await query`UPDATE app_settings SET additional_settings = additional_settings ||
            ${query.json({ attendanceTracking: tracking })}::jsonb WHERE organisation_id = ${org}`;
          const attendanceId = randomUUID();
          await query`INSERT INTO attendance_records (id,organisation_id,employee_id,date,source,status,clock_in_at,created_by,updated_by)
        VALUES (${attendanceId},${org},${employee.employeeId},'2020-01-06','Manual Entry','Present','2020-01-06T04:00:00Z',${author},${author})`;
          const correctionId = await requestAttendanceCorrectionInDatabase(
            org,
            {
              attendanceRecordId: attendanceId,
              proposedClockIn: "2020-01-06T05:00:00Z",
              proposedClockOut: "2020-01-06T13:00:00Z",
              explanation: "Both recorded arrival and departure need correction",
            },
            employee,
          );
          const manager = {
            ...finance,
            activeRole: "Line Manager" as const,
            roles: ["Employee", "Accounts", "Line Manager"],
          };
          assert.ok(
            (await listTasksForActorInDatabase(org, manager)).some(
              (task) => task.sourceId === correctionId,
            ),
          );
          assert.ok(
            !(
              await listTasksForActorInDatabase(org, { ...outsider, activeRole: "Line Manager" })
            ).some((task) => task.sourceId === correctionId),
          );
          await assert.rejects(
            decideAttendanceCorrectionInDatabase(
              org,
              correctionId,
              "approve",
              "Reviewed",
              {
                ...finance,
                activeRole: "Accounts",
              },
              1,
            ),
            /assigned/,
          );
          await decideAttendanceCorrectionInDatabase(
            org,
            correctionId,
            "approve",
            "Reviewed",
            manager,
            1,
          );
          assert.equal(
            (await query`SELECT status FROM attendance_corrections WHERE id=${correctionId}`)[0]
              ?.status,
            "Pending HR",
          );
        },
      );

      await t.test(
        "future assignments do not grant access early, and apply both changes together",
        async () => {
          const future = await person("Future supervisor");
          await updateEmploymentRecordInDatabase(
            org,
            employee.employeeId,
            { lineManagerId: future.employeeId },
            "2026-10-01",
            "Future reporting change",
            admin,
            now,
          );
          assert.deepEqual(await roleCodes(future.userId), ["Employee"]);
          assert.equal(
            (await query`SELECT line_manager_id FROM employees WHERE id=${employee.employeeId}`)[0]
              ?.line_manager_id,
            finance.employeeId,
          );
          assert.deepEqual(
            await processScheduledEmploymentChanges(new Date("2026-10-02T08:00:00Z"), org),
            { applied: 1, needsReview: 0 },
          );
          assert.deepEqual(await roleCodes(future.userId), ["Employee", "Line Manager"]);
          assert.equal(
            (await query`SELECT line_manager_id FROM employees WHERE id=${employee.employeeId}`)[0]
              ?.line_manager_id,
            future.employeeId,
          );
        },
      );

      await t.test(
        "migration repairs only confirmed, active reporting assignments and is idempotent",
        async () => {
          const legacy = await person("Legacy manager");
          const unconfirmed = await person("Unconfirmed manager");
          const disabled = await person("Disabled manager");
          await query`UPDATE users SET status='Suspended' WHERE id=${disabled.userId}`;
          for (const [manager, confirmed] of [
            [legacy, true],
            [unconfirmed, false],
            [disabled, true],
          ] as const) {
            const report = await person(`Report for ${manager.displayName}`);
            await query`UPDATE employees SET line_manager_id=${manager.employeeId}, employment_confirmation_status=${confirmed ? "Confirmed" : "Pending HR Review"} WHERE id=${report.employeeId}`;
          }
          const migration = await readFile(
            new URL("../drizzle/0049_supervisor_approval_access.sql", import.meta.url),
            "utf8",
          );
          await query.unsafe(migration);
          await query.unsafe(migration);
          assert.deepEqual(await roleCodes(legacy.userId), ["Employee", "Line Manager"]);
          assert.deepEqual(await roleCodes(unconfirmed.userId), ["Employee"]);
          assert.deepEqual(await roleCodes(disabled.userId), ["Employee"]);
          assert.equal(
            (
              await query`SELECT id FROM audit_events WHERE entity_id=${legacy.userId} AND action='supervisor_access_granted'`
            ).length,
            1,
          );
          await getDatabaseClient().transaction((tx) =>
            restoreConfirmedSupervisorAccess(tx, org, unconfirmed.employeeId, unconfirmed),
          );
          assert.deepEqual(await roleCodes(unconfirmed.userId), ["Employee"]);
        },
      );

      await t.test(
        "free training and the existing HR fallback still work without a supervisor",
        async () => {
          const learner = await person("Learner without manager");
          for (const [cost, expected] of [
            [0, "Approved"],
            [100, "Pending HR"],
          ] as const) {
            const courseId = randomUUID();
            await query`INSERT INTO training_courses (id,organisation_id,code,title,description,provider,category,delivery_type,duration_hours,cost,currency,created_by,updated_by)
          VALUES (${courseId},${org},${courseId},'Test course','Description','Provider','General','Virtual',1,${cost},'OMR',${author},${author})`;
            await createTrainingRequestInDatabase(
              org,
              {
                employeeId: learner.employeeId,
                courseId,
                reason: "Development training",
                origin: "Employee Request",
              },
              learner,
            );
            assert.equal(
              (
                await query`SELECT status FROM training_requests WHERE employee_id=${learner.employeeId} AND course_id=${courseId}`
              )[0]?.status,
              expected,
            );
          }
        },
      );

      await t.test("employee creation rejects an inaccessible supervisor atomically", async () => {
        const blocked = await person("Blocked supervisor");
        await query`UPDATE users SET status='Suspended' WHERE id=${blocked.userId}`;
        const input = {
          employeeNumber: `created-${org}`,
          legalName: "New Employee",
          preferredName: "New",
          workEmail: `new-${org}@viahr.test`,
          department: "Operations",
          position: "Coordinator",
          location: "Muscat",
          employmentType: "Full-time",
          status: "Active" as const,
          startDate: "2020-01-01",
          lineManagerId: blocked.employeeId,
          emergencyContacts: [],
          dependants: [],
        };
        await assert.rejects(createEmployeeInDatabase(org, input, admin), /Ask HR/);
        assert.equal(
          (await query`SELECT id FROM employees WHERE work_email=${input.workEmail}`).length,
          0,
        );
        const created = await createEmployeeInDatabase(
          org,
          { ...input, lineManagerId: finance.employeeId },
          admin,
        );
        assert.ok(created.employeeId);
      });
    } finally {
      await query.end();
      await closeDatabaseConnection();
    }
  },
);
