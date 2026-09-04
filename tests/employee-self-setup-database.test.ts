import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import { createPortalSession } from "../src/lib/db/repositories/portal-session.repository.server.ts";
import {
  decideEmploymentDetailsInDatabase,
  saveOnboardingSelfServiceInDatabase,
} from "../src/lib/db/repositories/core-hr-lifecycle.repository.server.ts";
import {
  createLeaveRequestInDatabase,
  rolloverLeaveBalancesInDatabase,
} from "../src/lib/db/repositories/leave.repository.server.ts";
import { clearDefaultOrganisationCacheForTests } from "../src/lib/db/utils.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

function dateAfter(days: number): string {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  while (value.getUTCDay() === 0 || value.getUTCDay() === 6)
    value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

test(
  "verified VIA staff complete self-setup and receive policy-controlled leave",
  { skip: !testDatabaseUrl },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 2, prepare: false });
    const organisationId = randomUUID();
    const bootstrapId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const locationId = randomUUID();
    const employmentTypeId = randomUUID();
    const policyId = randomUUID();
    const employeeEmail = `setup-${organisationId}@via-int.com`;
    const managerEmail = `manager-${organisationId}@via-int.com`;
    const priorOrg = process.env["VIA_HR_ORGANISATION_ID"];
    process.env["VIA_HR_ORGANISATION_ID"] = organisationId;
    clearDefaultOrganisationCacheForTests();

    try {
      await sql`
        INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by)
        VALUES (${organisationId}, 'Employee Setup Test', ${`setup-${organisationId}`}, true,
          ${bootstrapId}, ${bootstrapId})
      `;
      for (const [table, id, name, code] of [
        ["departments", departmentId, "Engineering", "ENG"],
        ["positions", positionId, "Project Engineer", "PROJECT-ENG"],
        ["locations", locationId, "Dubai Office", "DXB"],
        ["employment_types", employmentTypeId, "Full Time", "FULL"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by)
           VALUES ($1, $2, $3, $4, true, 1, $5, $5)`,
          [id, organisationId, name, code, bootstrapId],
        );
      }
      await sql`
        INSERT INTO app_settings (
          organisation_id, timezone, base_currency, working_days, standard_daily_hours,
          standard_weekly_hours, probation_duration_months, leave_year_start, leave_year_end, document_reminder_days,
          employee_number_format, candidate_reference_format, created_by, updated_by
        ) VALUES (
          ${organisationId}, 'Asia/Dubai', 'AED', ${[1, 2, 3, 4, 5]}, 8, 40, 6,
          '01-01', '12-31', ${[60, 30, 14, 7]}, 'EMAIL', 'CAN-{YYYY}-{SEQ}',
          ${bootstrapId}, ${bootstrapId}
        )
      `;
      await sql`
        INSERT INTO leave_policies (
          id, organisation_id, code, name, type, category, description, is_paid,
          base_entitlement_days, scope, accrual_mode, carry_forward_limit,
          allow_negative_balance, requires_attachment, requires_handover_contact,
          counts_toward_gratuity, eligibility, approval_chain, is_enabled, is_statutory,
          consumes_balance, created_by, updated_by
        ) VALUES (
          ${policyId}, ${organisationId}, 'A/L', 'Annual Leave', 'Annual', 'Statutory',
          'Annual leave after the configured joining wait', true, 30, 'Annual', 'Upfront', 0,
          false, false, false, true, ${sql.json({ minimumServiceMonths: 3 })},
          ${sql.json(["Line Manager", "HR"])}, true, true, true, ${bootstrapId}, ${bootstrapId}
        )
      `;

      const employeeSession = await createPortalSession(
        {
          email: employeeEmail,
          name: "New VIA Employee",
          portalRole: "user",
          mappedRole: "Employee",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
        },
        { lifetimeSeconds: 28_800 },
      );
      const actor = {
        userId: employeeSession.user.id,
        employeeId: employeeSession.employee.id,
        displayName: employeeSession.user.displayName,
        workspaceEmail: employeeEmail,
        roles: ["Employee"] as const,
        activeRole: "Employee" as const,
      };
      const [caseRow] = await sql<{ id: string }[]>`
        SELECT id FROM onboarding_cases WHERE employee_id = ${employeeSession.employee.id}
      `;
      const [employmentTask] = await sql<{ id: string }[]>`
        SELECT id FROM onboarding_tasks
        WHERE case_id = ${caseRow!.id} AND self_service_form_key = 'employment_details'
      `;
      const [temporaryAssignment] = await sql<
        Array<{
          department_id: string;
          position_id: string;
          location_id: string;
          employment_type_id: string;
        }>
      >`
        SELECT department_id, position_id, location_id, employment_type_id
        FROM employees WHERE id = ${employeeSession.employee.id}
      `;
      await assert.rejects(
        saveOnboardingSelfServiceInDatabase(
          organisationId,
          {
            caseId: caseRow!.id,
            taskId: employmentTask!.id,
            kind: "employment_details",
            details: {
              staffEntryType: "New Employee",
              legalName: "New VIA Employee",
              preferredName: "New",
              startDate: dateAfter(0),
              departmentId: temporaryAssignment!.department_id,
              positionId: temporaryAssignment!.position_id,
              locationId: temporaryAssignment!.location_id,
              employmentTypeId: temporaryAssignment!.employment_type_id,
              lineManagerEmail: managerEmail,
              visaRequired: false,
            },
          },
          actor,
        ),
        /confirmed employment details/,
      );
      await saveOnboardingSelfServiceInDatabase(
        organisationId,
        {
          caseId: caseRow!.id,
          taskId: employmentTask!.id,
          kind: "employment_details",
          details: {
            staffEntryType: "New Employee",
            legalName: "New VIA Employee",
            preferredName: "New",
            startDate: dateAfter(0),
            departmentId,
            positionId,
            locationId,
            employmentTypeId,
            lineManagerEmail: managerEmail,
            visaRequired: false,
          },
        },
        actor,
      );
      const [pendingManager] = await sql`
        SELECT staff_entry_type, profile_setup_status, employment_confirmation_status,
               proposed_employment_details, proposed_line_manager_email, probation_end_date
        FROM employees WHERE id = ${employeeSession.employee.id}
      `;
      assert.equal(pendingManager?.staff_entry_type, null);
      assert.equal(pendingManager?.profile_setup_status, "In Progress");
      assert.equal(pendingManager?.employment_confirmation_status, "Pending HR Review");
      assert.equal(pendingManager?.proposed_employment_details?.staffEntryType, "New Employee");
      assert.equal(pendingManager?.proposed_line_manager_email, managerEmail);
      assert.equal(pendingManager?.probation_end_date, null);

      const managerSession = await createPortalSession(
        {
          email: managerEmail,
          name: "VIA Supervisor",
          portalRole: "user",
          mappedRole: "Employee",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
        },
        { lifetimeSeconds: 28_800 },
      );
      const [linked] = await sql`
        SELECT line_manager_id, proposed_line_manager_email, proposed_employment_details
        FROM employees WHERE id = ${employeeSession.employee.id}
      `;
      assert.equal(linked?.line_manager_id, null);
      assert.equal(linked?.proposed_line_manager_email, managerEmail);

      const hrEmail = `hr-${organisationId}@via-int.com`;
      const hrSession = await createPortalSession(
        {
          email: hrEmail,
          name: "VIA HR Reviewer",
          portalRole: "hr",
          mappedRole: "HR",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
        },
        { lifetimeSeconds: 28_800 },
      );
      const hrActor = {
        userId: hrSession.user.id,
        employeeId: hrSession.employee.id,
        displayName: hrSession.user.displayName,
        workspaceEmail: hrEmail,
        roles: ["Employee", "HR"] as const,
        activeRole: "HR" as const,
      };

      await assert.rejects(
        createLeaveRequestInDatabase(
          organisationId,
          {
            employeeId: employeeSession.employee.id,
            policyId,
            startDate: dateAfter(100),
            endDate: dateAfter(100),
            reason: "Profile must be complete first",
          },
          actor,
        ),
        /HR must confirm your employment details/,
      );

      await decideEmploymentDetailsInDatabase(
        organisationId,
        { employeeId: employeeSession.employee.id, decision: "Confirmed", note: "Checked" },
        hrActor,
      );
      const [confirmedEmployment] = await sql`
        SELECT staff_entry_type, line_manager_id, employment_confirmation_status,
               proposed_employment_details, proposed_line_manager_email, probation_end_date
        FROM employees WHERE id = ${employeeSession.employee.id}
      `;
      assert.equal(confirmedEmployment?.staff_entry_type, "New Employee");
      assert.equal(confirmedEmployment?.line_manager_id, managerSession.employee.id);
      assert.equal(confirmedEmployment?.employment_confirmation_status, "Confirmed");
      assert.equal(confirmedEmployment?.proposed_employment_details, null);
      assert.equal(confirmedEmployment?.proposed_line_manager_email, null);
      const expectedProbation = new Date(`${dateAfter(0)}T00:00:00Z`);
      expectedProbation.setUTCMonth(expectedProbation.getUTCMonth() + 6);
      assert.equal(
        confirmedEmployment?.probation_end_date instanceof Date
          ? confirmedEmployment.probation_end_date.toISOString().slice(0, 10)
          : confirmedEmployment?.probation_end_date,
        expectedProbation.toISOString().slice(0, 10),
      );

      const [personalTask] = await sql<{ id: string }[]>`
        SELECT id FROM onboarding_tasks
        WHERE case_id = ${caseRow!.id} AND self_service_form_key = 'personal_details'
      `;
      await saveOnboardingSelfServiceInDatabase(
        organisationId,
        {
          caseId: caseRow!.id,
          taskId: personalTask!.id,
          kind: "personal_details",
          details: {
            dateOfBirth: "1990-01-01",
            gender: "Male",
            nationality: "Emirati",
            maritalStatus: "Single",
            phone: "+971500000000",
            address: "Dubai, United Arab Emirates",
            emergencyContacts: [
              { name: "Emergency Contact", relationship: "Sibling", phone: "+971500000001" },
            ],
          },
        },
        actor,
      );
      await sql`
        UPDATE onboarding_tasks
        SET status = 'Waived', waiver_reason = 'Test fixture supplies no identity documents',
            updated_at = now(), record_version = record_version + 1
        WHERE case_id = ${caseRow!.id} AND self_service_form_key = 'document_upload'
      `;
      const [bankTask] = await sql<{ id: string }[]>`
        SELECT id FROM onboarding_tasks
        WHERE case_id = ${caseRow!.id} AND self_service_form_key = 'bank_details'
      `;
      await saveOnboardingSelfServiceInDatabase(
        organisationId,
        {
          caseId: caseRow!.id,
          taskId: bankTask!.id,
          kind: "bank_details",
          details: {
            bankName: "VIA Test Bank",
            accountNumber: "123456789",
            iban: "AE070331234567890123456",
          },
        },
        actor,
      );
      const [completed] = await sql`
        SELECT profile_setup_status, status FROM employees WHERE id = ${employeeSession.employee.id}
      `;
      assert.equal(completed?.profile_setup_status, "Completed");
      assert.equal(completed?.status, "Probation");
      const [completionAudit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE entity_id = ${employeeSession.employee.id}
          AND entity_type = 'employee-profile-setup'
      `;
      assert.equal(Number(completionAudit?.count), 1);

      assert.equal(
        await rolloverLeaveBalancesInDatabase(
          organisationId,
          new Date().getUTCFullYear(),
          actor,
          employeeSession.employee.id,
        ),
        1,
      );
      assert.equal(
        await rolloverLeaveBalancesInDatabase(
          organisationId,
          new Date().getUTCFullYear(),
          actor,
          employeeSession.employee.id,
        ),
        0,
      );
      await assert.rejects(
        createLeaveRequestInDatabase(
          organisationId,
          {
            employeeId: employeeSession.employee.id,
            policyId,
            startDate: dateAfter(30),
            endDate: dateAfter(30),
            reason: "Too early during probation",
          },
          actor,
        ),
        /can be taken from/,
      );
      const requestId = await createLeaveRequestInDatabase(
        organisationId,
        {
          employeeId: employeeSession.employee.id,
          policyId,
          startDate: dateAfter(100),
          endDate: dateAfter(100),
          reason: "Eligible leave after the waiting period",
        },
        actor,
      );
      assert.match(requestId, /^[0-9a-f-]{36}$/i);
    } finally {
      clearDefaultOrganisationCacheForTests();
      if (priorOrg === undefined) delete process.env["VIA_HR_ORGANISATION_ID"];
      else process.env["VIA_HR_ORGANISATION_ID"] = priorOrg;
      await sql.end();
    }
  },
);
