import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  approveLeaveRequestInDatabase,
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
      await sql`UPDATE employees SET profile_setup_status = 'In Progress' WHERE id = ${employeeId}`;
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
        /Complete your employee profile/,
      );
      await sql`UPDATE employees SET profile_setup_status = 'Completed' WHERE id = ${employeeId}`;
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
      await assert.rejects(
        approveLeaveRequestInDatabase(organisationId, requestId, hrActor, "approve"),
        /assigned approver/,
      );
      await approveLeaveRequestInDatabase(organisationId, requestId, managerActor, "approve");
      snapshot = await listLeaveSnapshotForActor(organisationId, hrActor);
      assert.equal(snapshot.requests.find((item) => item.id === requestId)?.status, "Pending HR");
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
    } finally {
      await sql.end();
    }
  },
);
