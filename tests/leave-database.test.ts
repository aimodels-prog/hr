import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import postgres from "postgres";
import { processLeaveUsageReminders } from "../src/lib/db/repositories/leave-reminder.repository.server.ts";

import {
  approveLeaveRequestInDatabase,
  grantSickLeaveBackdatePermission,
  createLeaveRequestInDatabase,
  exportLeaveRequestsCsvInDatabase,
  listLeaveSnapshotForActor,
  processScheduledLeaveRollover,
  requestLeaveChangeInDatabase,
  rolloverLeaveBalancesInDatabase,
  updateLeavePolicyInDatabase,
} from "../src/lib/db/repositories/leave.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function futureMonday(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 75);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

test(
  "leave is scoped, policy-driven and concurrency-safe in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 5, prepare: false });
    const organisationId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const locationId = randomUUID();
    const employmentTypeId = randomUUID();
    const managerEmployeeId = randomUUID();
    const managerUserId = randomUUID();
    const hrEmployeeId = randomUUID();
    const hrUserId = randomUUID();
    const employeeId = randomUUID();
    const employeeUserId = randomUUID();
    const colleagueEmployeeId = randomUUID();
    const colleagueUserId = randomUUID();
    const annualPolicyId = randomUUID();
    const sickPolicyId = randomUUID();
    const balanceId = randomUUID();
    const createdAt = new Date();
    const start = futureMonday();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 4);
    const holiday = new Date(start);
    holiday.setUTCDate(holiday.getUTCDate() + 2);
    const actor = (userId: string, employee: string, role: "Employee" | "Line Manager" | "HR") => ({
      userId,
      employeeId: employee,
      displayName: `${role} database test`,
      roles: role === "Employee" ? (["Employee"] as const) : (["Employee", role] as const),
      activeRole: role,
    });

    try {
      await sql`
        INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by, created_at, updated_at)
        VALUES (${organisationId}, 'Leave Database Test', ${`leave-${organisationId}`}, true,
          ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt})
      `;
      for (const [table, id, name, code] of [
        ["departments", departmentId, "Operations", "OPS"],
        ["positions", positionId, "Coordinator", "COORD"],
        ["employment_types", employmentTypeId, "Full-time", "FT"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, 1, $5, $5, $6, $6)`,
          [id, organisationId, name, code, hrUserId, createdAt],
        );
      }
      await sql`
        INSERT INTO locations (
          id, organisation_id, name, code, is_active, order_index, latitude, longitude,
          radius_meters, is_clock_in_site, created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${locationId}, ${organisationId}, 'Muscat Office', 'MCT', true, 1, 23.588, 58.383,
          150, true, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
        )
      `;
      const people = [
        [managerEmployeeId, managerUserId, "Manager", null],
        [hrEmployeeId, hrUserId, "HR Reviewer", null],
        [employeeId, employeeUserId, "Employee", managerEmployeeId],
        [colleagueEmployeeId, colleagueUserId, "Colleague", managerEmployeeId],
      ] as const;
      for (const [personEmployeeId, personUserId, name, lineManagerId] of people) {
        await sql`
          INSERT INTO employees (
            id, organisation_id, employee_number, legal_name, preferred_name, work_email,
            department_id, position_id, location_id, employment_type_id, line_manager_id,
            status, start_date, gender, nationality, created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${personEmployeeId}, ${organisationId}, ${`LV-${personEmployeeId.slice(0, 6)}`}, ${name}, ${name},
            ${`${personEmployeeId}@viahr.test`}, ${departmentId}, ${positionId}, ${locationId},
            ${employmentTypeId}, ${lineManagerId}, 'Active', '2020-01-01', 'Male', 'Omani',
            ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
          )
        `;
        await sql`
          INSERT INTO users (
            id, organisation_id, employee_id, display_name, workspace_email, status,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            ${personUserId}, ${organisationId}, ${personEmployeeId}, ${name},
            ${`${personEmployeeId}@viahr.test`}, 'Active', ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
          )
        `;
      }
      const roleRows = await sql<{ id: string; code: "Employee" | "Line Manager" | "HR" }[]>`
        SELECT id, code FROM roles WHERE code IN ('Employee', 'Line Manager', 'HR')
      `;
      const roleIds = Object.fromEntries(roleRows.map((row) => [row.code, row.id])) as Record<
        "Employee" | "Line Manager" | "HR",
        string
      >;
      for (const [userId, role] of [
        [managerUserId, "Line Manager"],
        [hrUserId, "HR"],
      ] as const) {
        await sql`
          INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by)
          VALUES (${organisationId}, ${userId}, ${roleIds[role]}, ${hrUserId})
        `;
      }
      await sql`
        INSERT INTO app_settings (
          organisation_id, timezone, base_currency, working_days, standard_daily_hours,
          standard_weekly_hours, leave_year_start, leave_year_end, document_reminder_days,
          employee_number_format, candidate_reference_format, created_by, updated_by
        ) VALUES (
          ${organisationId}, 'Asia/Muscat', 'OMR', ${[1, 2, 3, 4, 5]}, 8, 40,
          '01-01', '12-31', ${[60, 30, 14, 7]}, 'VIA-{YYYY}-{SEQ}', 'CAN-{YYYY}-{SEQ}',
          ${hrUserId}, ${hrUserId}
        )
      `;
      await sql`
        INSERT INTO public_holidays (
          id, organisation_id, name, code, holiday_date, location_id, is_active, order_index,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${randomUUID()}, ${organisationId}, 'Test Public Holiday', 'TPH', ${isoDate(holiday)},
          ${locationId}, true, 1, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}
        )
      `;
      await sql`
        INSERT INTO leave_policies (
          id, organisation_id, code, name, type, category, description, is_paid,
          base_entitlement_days, scope, accrual_mode, carry_forward_limit,
          allow_negative_balance, requires_attachment, requires_handover_contact,
          counts_toward_gratuity, approval_chain, notice_rules, is_enabled, is_statutory,
          consumes_balance, created_by, updated_by, created_at, updated_at
        ) VALUES
        (${annualPolicyId}, ${organisationId}, 'AL', 'Annual Leave', 'Annual', 'Statutory',
          'Annual leave policy used by the database test', true, 30, 'Annual', 'Upfront', 10,
          false, false, true, true, ${sql.json(["Line Manager", "HR"])},
          ${sql.json({ enabled: true, shortLeaveMaxDays: 5, shortLeaveNoticeDays: 14, longLeaveNoticeDays: 60 })},
          true, true, true, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt}),
        (${sickPolicyId}, ${organisationId}, 'SICK', 'Sick Leave', 'Sick', 'Statutory',
          'Sick leave evidence policy used by the database test', true, 14, 'Annual', 'Upfront', 0,
          false, true, false, true, ${sql.json(["Line Manager", "HR"])}, null,
          true, true, true, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt})
      `;
      await sql`
        INSERT INTO leave_balances (
          id, organisation_id, employee_id, policy_id, leave_year, balance_days,
          created_by, updated_by, created_at, updated_at
        ) VALUES (${balanceId}, ${organisationId}, ${employeeId}, ${annualPolicyId},
          ${start.getUTCFullYear()}, 30, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt})
      `;
      await sql`
        INSERT INTO leave_transactions (
          id, organisation_id, employee_id, policy_id, date, transaction_type, days, reason,
          reference_id, actor_user_id, created_by, updated_by, created_at, updated_at
        ) VALUES (${randomUUID()}, ${organisationId}, ${employeeId}, ${annualPolicyId},
          ${`${start.getUTCFullYear()}-01-01`}, 'Entitlement', 30, 'Annual leave allowance',
          ${balanceId}, ${hrUserId}, ${hrUserId}, ${hrUserId}, ${createdAt}, ${createdAt})
      `;

      const employeeActor = actor(employeeUserId, employeeId, "Employee");
      const managerActor = actor(managerUserId, managerEmployeeId, "Line Manager");
      const hrActor = actor(hrUserId, hrEmployeeId, "HR");
      await sql`UPDATE employees SET profile_setup_status = 'In Progress', employment_confirmation_status = 'Pending HR Review' WHERE id = ${employeeId}`;
      await assert.rejects(
        createLeaveRequestInDatabase(
          organisationId,
          {
            employeeId,
            policyId: annualPolicyId,
            startDate: isoDate(start),
            endDate: isoDate(end),
            reason: "Profile setup bypass check",
            handoverContactId: colleagueEmployeeId,
          },
          employeeActor,
        ),
        /HR must confirm your employment details/,
      );
      await sql`UPDATE employees SET profile_setup_status = 'Completed', employment_confirmation_status = 'Confirmed' WHERE id = ${employeeId}`;
      await assert.rejects(
        createLeaveRequestInDatabase(
          organisationId,
          {
            employeeId,
            policyId: sickPolicyId,
            startDate: isoDate(start),
            endDate: isoDate(start),
            reason: "Medical appointment",
          },
          employeeActor,
        ),
        /Supporting evidence is required/,
      );
      const secondHrUserId = randomUUID();
      const inactiveHrUserId = randomUUID();
      const foreignHrUserId = randomUUID();
      const foreignOrgId = randomUUID();
      await sql`INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by)
        VALUES (${foreignOrgId}, 'Other leave organisation', ${`leave-other-${foreignOrgId}`}, true, ${hrUserId}, ${hrUserId})`;
      for (const [id, org, status] of [
        [secondHrUserId, organisationId, "Active"],
        [inactiveHrUserId, organisationId, "Suspended"],
        [foreignHrUserId, foreignOrgId, "Active"],
      ] as const) {
        const noticeEmployeeId = randomUUID();
        const noticeMasterIds = [departmentId, positionId, locationId, employmentTypeId];
        if (org !== organisationId) {
          for (const [index, table] of [
            "departments",
            "positions",
            "locations",
            "employment_types",
          ].entries()) {
            const masterId = randomUUID();
            noticeMasterIds[index] = masterId;
            await sql.unsafe(
              `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by)
              VALUES ($1, $2, 'Other organisation master', 'OTHER', true, 1, $3, $3)`,
              [masterId, org, hrUserId],
            );
          }
        }
        await sql`INSERT INTO employees (id, organisation_id, employee_number, legal_name, preferred_name, work_email,
          department_id, position_id, location_id, employment_type_id, status, start_date, created_by, updated_by)
          VALUES (${noticeEmployeeId}, ${org}, ${`HR-${id.slice(0, 6)}`}, 'HR notification test', 'HR', ${`${id}@viahr.test`},
          ${noticeMasterIds[0]!}, ${noticeMasterIds[1]!}, ${noticeMasterIds[2]!}, ${noticeMasterIds[3]!}, 'Active', '2020-01-01', ${hrUserId}, ${hrUserId})`;
        await sql`INSERT INTO users (id, organisation_id, employee_id, display_name, workspace_email, status, created_by, updated_by)
          VALUES (${id}, ${org}, ${noticeEmployeeId}, 'HR notification test', ${`${id}@viahr.test`}, ${status}, ${hrUserId}, ${hrUserId})`;
        await sql`INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by)
          VALUES (${org}, ${id}, ${roleIds.HR}, ${hrUserId})`;
      }
      const requestId = await createLeaveRequestInDatabase(
        organisationId,
        {
          employeeId,
          policyId: annualPolicyId,
          startDate: isoDate(start),
          endDate: isoDate(end),
          reason: "Family travel arrangements",
          handoverContactId: colleagueEmployeeId,
        },
        employeeActor,
      );
      let snapshot = await listLeaveSnapshotForActor(organisationId, employeeActor);
      const submitted = snapshot.requests.find((item) => item.id === requestId);
      assert.equal(submitted?.workingDaysRequested, 4, "the public holiday must not count");
      assert.equal(submitted?.status, "Pending Line Manager");
      const submissionNotices = await sql`
        SELECT recipient_user_id, type, message, priority, link FROM notifications
        WHERE organisation_id = ${organisationId} AND link->>'entityId' = ${requestId}
      `;
      assert.deepEqual(
        submissionNotices.map((item) => item.recipient_user_id).sort(),
        [managerUserId, hrUserId, secondHrUserId].sort(),
        "Notify the manager and every active HR user in this organisation only",
      );
      assert.equal(
        submissionNotices.find((item) => item.recipient_user_id === managerUserId)?.type,
        "leave_approval",
      );
      for (const notice of submissionNotices.filter((item) => item.type === "leave_submitted")) {
        assert.equal(notice.priority, "Normal");
        assert.match(notice.message, /Awaiting line manager approval/);
        assert.doesNotMatch(notice.message, /Family travel arrangements/);
        assert.equal(notice.link.path, "/staff/leave-admin");
      }
      await assert.rejects(
        approveLeaveRequestInDatabase(organisationId, requestId, hrActor, "approve"),
        /assigned approver/,
      );
      await approveLeaveRequestInDatabase(organisationId, requestId, managerActor, "approve");
      snapshot = await listLeaveSnapshotForActor(organisationId, hrActor);
      assert.equal(snapshot.requests.find((item) => item.id === requestId)?.status, "Pending HR");
      const [hrApprovalNotice] = await sql`SELECT count(*)::int AS count FROM notifications
        WHERE recipient_user_id = ${hrUserId} AND type = 'leave_approval' AND link->>'entityId' = ${requestId}`;
      assert.equal(
        hrApprovalNotice.count,
        1,
        "The later actionable HR approval notice is separate from the submission FYI",
      );
      const decisions = await Promise.allSettled([
        approveLeaveRequestInDatabase(organisationId, requestId, hrActor, "approve"),
        approveLeaveRequestInDatabase(organisationId, requestId, hrActor, "approve"),
      ]);
      assert.equal(decisions.filter((item) => item.status === "fulfilled").length, 1);
      const [balance] = await sql`SELECT balance_days FROM leave_balances WHERE id = ${balanceId}`;
      assert.equal(Number(balance?.balance_days), 26);
      const [officeNotice] = await sql`
        SELECT count(*)::int AS count FROM notifications
        WHERE recipient_user_id = ${colleagueUserId} AND type = 'leave_approved'
      `;
      assert.ok(Number(officeNotice?.count) >= 1);
      const [policy] =
        await sql`SELECT record_version FROM leave_policies WHERE id = ${annualPolicyId}`;
      await updateLeavePolicyInDatabase(
        organisationId,
        annualPolicyId,
        {
          recordVersion: Number(policy?.record_version),
          description: "Updated annual leave policy used by the database test",
          isPaid: true,
          baseEntitlementDays: 35,
          accrualMode: "Upfront",
          carryForwardLimit: 10,
          allowNegativeBalance: false,
          requiresAttachment: false,
          requiresHandoverContact: true,
          countsTowardGratuity: true,
          approvalChain: ["Line Manager", "HR"],
          noticeRules: {
            enabled: true,
            shortLeaveMaxDays: 5,
            shortLeaveNoticeDays: 14,
            longLeaveNoticeDays: 60,
          },
          isEnabled: true,
          consumesBalance: true,
        },
        hrActor,
      );
      const [adjusted] = await sql`SELECT balance_days FROM leave_balances WHERE id = ${balanceId}`;
      assert.equal(Number(adjusted?.balance_days), 31);
      const exported = await exportLeaveRequestsCsvInDatabase(organisationId, {}, hrActor);
      assert.equal(exported.rowCount, 1);
      assert.match(exported.content, /Family travel arrangements/);
      const [exportAudit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId} AND entity_type = 'leave-export'
      `;
      assert.equal(Number(exportAudit?.count), 1);
      assert.ok(
        (await rolloverLeaveBalancesInDatabase(organisationId, start.getUTCFullYear(), hrActor)) >
          0,
      );
      assert.equal(
        await rolloverLeaveBalancesInDatabase(organisationId, start.getUTCFullYear(), hrActor),
        0,
      );
      const worker = await processScheduledLeaveRollover(new Date());
      assert.ok(worker.organisations >= 1);

      await requestLeaveChangeInDatabase(
        organisationId,
        requestId,
        { kind: "cancel", reason: "Family travel plans changed" },
        employeeActor,
      );
      await approveLeaveRequestInDatabase(organisationId, requestId, hrActor, "approve");
      const [restored] = await sql`SELECT balance_days FROM leave_balances WHERE id = ${balanceId}`;
      assert.equal(Number(restored?.balance_days), 35);

      // Old or incorrectly configured statutory policies must still enforce nationality.
      const statutoryPolicyIds: string[] = [];
      for (const type of ["Exam", "AccompanyPatient", "Hajj"]) {
        const policyId = randomUUID();
        statutoryPolicyIds.push(policyId);
        await sql`INSERT INTO leave_policies (id, organisation_id, code, name, type, category,
          description, is_paid, scope, accrual_mode, is_statutory, consumes_balance,
          requires_handover_contact, eligibility, approval_chain, created_by, updated_by)
          VALUES (${policyId}, ${organisationId}, ${type}, ${type}, ${type}, 'Statutory',
          'Nationality eligibility regression', true, 'Annual', 'Upfront', true, false,
          false, ${sql.json({ omaniOnly: type === "Hajj", minimumServiceMonths: 12 })},
          '["Line Manager", "HR"]'::jsonb, ${hrUserId}, ${hrUserId})`;
        for (const nationality of ["Indian", ""]) {
          await sql`UPDATE employees SET nationality = ${nationality} WHERE id = ${employeeId}`;
          if (type !== "Hajj") {
            await assert.rejects(
              createLeaveRequestInDatabase(
                organisationId,
                {
                  employeeId,
                  policyId,
                  startDate: isoDate(start),
                  endDate: isoDate(start),
                  reason: "Nationality restriction test",
                },
                employeeActor,
              ),
              /only to Omani employees/,
            );
          }
        }
        await sql`UPDATE employees SET nationality = ${type === "Hajj" ? "Indian" : "OMN"} WHERE id = ${employeeId}`;
        const eligibleRequestId = await createLeaveRequestInDatabase(
          organisationId,
          {
            employeeId,
            policyId,
            startDate: isoDate(start),
            endDate: isoDate(start),
            reason: "Eligible nationality test",
          },
          employeeActor,
        );
        if (type !== "Hajj") {
          await sql`UPDATE employees SET nationality = 'Indian' WHERE id = ${employeeId}`;
          await assert.rejects(
            approveLeaveRequestInDatabase(
              organisationId,
              eligibleRequestId,
              managerActor,
              "approve",
            ),
            /only to Omani employees/,
          );
        }
        await approveLeaveRequestInDatabase(
          organisationId,
          eligibleRequestId,
          managerActor,
          "decline",
          "Regression test complete",
        );
      }

      // Correct existing metadata, audit the correction, preserve ledger/history, and remain idempotent.
      const [beforeMigration] = await sql`SELECT
        (SELECT count(*) FROM leave_requests WHERE organisation_id = ${organisationId}) AS requests,
        (SELECT count(*) FROM leave_transactions WHERE organisation_id = ${organisationId}) AS transactions`;
      const migration = await readFile(
        new URL("../drizzle/0038_omani_leave_eligibility.sql", import.meta.url),
        "utf8",
      );
      await sql.unsafe(migration);
      const correctedPolicies =
        await sql`SELECT type, eligibility FROM leave_policies WHERE id IN ${sql(statutoryPolicyIds)}`;
      for (const policy of correctedPolicies) {
        assert.equal(policy.eligibility.omaniOnly, policy.type !== "Hajj");
        assert.equal(policy.eligibility.minimumServiceMonths, 12);
      }
      await sql.unsafe(migration);
      const [auditCount] = await sql`SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId} AND action = 'correct-statutory-nationality'`;
      assert.equal(auditCount.count, 3);
      const [afterMigration] = await sql`SELECT
        (SELECT count(*) FROM leave_requests WHERE organisation_id = ${organisationId}) AS requests,
        (SELECT count(*) FROM leave_transactions WHERE organisation_id = ${organisationId}) AS transactions`;
      assert.deepEqual(afterMigration, beforeMigration);
      const [preservedBalance] =
        await sql`SELECT balance_days FROM leave_balances WHERE id = ${balanceId}`;
      assert.equal(Number(preservedBalance.balance_days), 35);
      const past = new Date();
      past.setUTCDate(past.getUTCDate() - 14);
      while (past.getUTCDay() !== 1) past.setUTCDate(past.getUTCDate() - 1);
      const pastDate = isoDate(past);
      const permissionInput = {
        employeeId,
        startDate: pastDate,
        endDate: pastDate,
        reason: "Too unwell to apply at the time",
      };
      await assert.rejects(
        grantSickLeaveBackdatePermission(organisationId, permissionInput, employeeActor),
        /Only HR/,
      );
      await assert.rejects(
        grantSickLeaveBackdatePermission(
          organisationId,
          { ...permissionInput, employeeId: hrEmployeeId },
          hrActor,
        ),
        /Another HR/,
      );
      await assert.rejects(
        grantSickLeaveBackdatePermission(
          organisationId,
          { ...permissionInput, employeeId: randomUUID() },
          hrActor,
        ),
        /active employee/,
      );
      // Evidence is tested above; disable only for these isolated authorisation scenarios.
      await sql`UPDATE leave_policies SET requires_attachment=false, consumes_balance=false,
        notice_rules=${sql.json({ enabled: true, shortLeaveMaxDays: 5, shortLeaveNoticeDays: 14, longLeaveNoticeDays: 60 })}
        WHERE id=${sickPolicyId}`;
      const lateInput = { ...permissionInput, policyId: sickPolicyId };
      await assert.rejects(
        createLeaveRequestInDatabase(organisationId, lateInput, employeeActor),
        /Ask HR to authorise/,
      );
      const permission = await grantSickLeaveBackdatePermission(
        organisationId,
        permissionInput,
        hrActor,
      );
      await assert.rejects(
        createLeaveRequestInDatabase(
          organisationId,
          { ...lateInput, endDate: isoDate(new Date(past.getTime() + 86400000)) },
          employeeActor,
        ),
        /exact dates/,
      );
      const submissions = await Promise.allSettled([
        createLeaveRequestInDatabase(organisationId, lateInput, employeeActor),
        createLeaveRequestInDatabase(organisationId, lateInput, employeeActor),
      ]);
      assert.equal(submissions.filter((result) => result.status === "fulfilled").length, 1);
      const [used] =
        await sql`SELECT p.used_by_request_id, r.status, r.policy_snapshot FROM sick_leave_backdate_permissions p JOIN leave_requests r ON r.id=p.used_by_request_id WHERE p.id=${permission.id}`;
      assert.equal(used.status, "Pending Line Manager");
      assert.equal(used.policy_snapshot.backdatePermissionId, permission.id);
      await assert.rejects(
        createLeaveRequestInDatabase(organisationId, lateInput, employeeActor),
        /Ask HR to authorise/,
      );
      const expired = await grantSickLeaveBackdatePermission(
        organisationId,
        permissionInput,
        hrActor,
      );
      await sql`UPDATE sick_leave_backdate_permissions SET expires_at=now()-interval '1 second' WHERE id=${expired.id}`;
      await assert.rejects(
        createLeaveRequestInDatabase(organisationId, lateInput, employeeActor),
        /Ask HR to authorise/,
      );
      const [notice] =
        await sql`SELECT link FROM notifications WHERE organisation_id=${organisationId} AND recipient_user_id=${employeeUserId} AND deduplication_key=${`sick-backdate-${permission.id}-${employeeUserId}`}`;
      assert.equal(notice.link.path, "/staff/leave");
      // Scheduled reminders are role-independent, private, repeat-safe and read-only for balances.
      await sql`UPDATE app_settings SET leave_year_start='01-01', timezone='Asia/Muscat' WHERE organisation_id=${organisationId}`;
      const reminderBalanceId = randomUUID();
      await sql`INSERT INTO leave_balances (id, organisation_id, employee_id, policy_id, leave_year, balance_days, created_by, updated_by)
        VALUES (${reminderBalanceId}, ${organisationId}, ${employeeId}, ${annualPolicyId}, 2090, 40, ${hrUserId}, ${hrUserId})`;
      await sql`INSERT INTO leave_transactions (organisation_id, employee_id, policy_id, date, transaction_type, days, reason, actor_user_id, created_by, updated_by)
        VALUES (${organisationId}, ${employeeId}, ${annualPolicyId}, '2090-01-01', 'Carry-Forward', 10, 'Test old leave', ${hrUserId}, ${hrUserId}, ${hrUserId})`;
      await Promise.all([
        processLeaveUsageReminders(new Date("2090-04-15T08:00:00Z")),
        processLeaveUsageReminders(new Date("2090-04-15T08:00:00Z")),
      ]);
      const reminders =
        await sql`SELECT * FROM notifications WHERE organisation_id=${organisationId} AND deduplication_key=${`leave-use:${reminderBalanceId}:carry:2090-04-15`}`;
      assert.equal(reminders.length, 1);
      assert.equal(reminders[0].recipient_user_id, employeeUserId);
      assert.equal(reminders[0].priority, "Normal");
      assert.equal(reminders[0].link.path, "/staff/leave");
      assert.match(reminders[0].message, /30 April 2090/);
      await processLeaveUsageReminders(new Date("2090-05-01T08:00:00Z"));
      const annualReminder =
        await sql`SELECT * FROM notifications WHERE organisation_id=${organisationId} AND deduplication_key=${`leave-use:${reminderBalanceId}:annual:2090-05`}`;
      assert.equal(annualReminder.length, 1);
      const [unchanged] =
        await sql`SELECT balance_days FROM leave_balances WHERE id=${reminderBalanceId}`;
      assert.equal(Number(unchanged.balance_days), 40);
      await sql`UPDATE leave_balances SET balance_days=0 WHERE id=${reminderBalanceId}`;
      await processLeaveUsageReminders(new Date("2090-06-01T08:00:00Z"));
      const none =
        await sql`SELECT * FROM notifications WHERE organisation_id=${organisationId} AND deduplication_key=${`leave-use:${reminderBalanceId}:annual:2090-06`}`;
      assert.equal(none.length, 0);
    } finally {
      await sql.end();
    }
  },
);
