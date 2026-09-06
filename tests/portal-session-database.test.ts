import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import {
  createPortalSession,
  findPortalSession,
  revokePortalSession,
} from "../src/lib/db/repositories/portal-session.repository.server.ts";
import { clearDefaultOrganisationCacheForTests } from "../src/lib/db/utils.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "VIA Portal identity creates an Employee-only local account and opaque PostgreSQL session",
  { skip: !testDatabaseUrl },
  async () => {
    const databaseName = new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase();
    assert.match(databaseName, /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const organisationId = randomUUID();
    const bootstrapId = randomUUID();
    const employeeId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const locationId = randomUUID();
    const employmentTypeId = randomUUID();
    const email = `portal-${organisationId}@via-int.com`;
    const priorOrg = process.env["VIA_HR_ORGANISATION_ID"];
    const priorSuperAdminEmails = process.env["VIA_HR_SUPER_ADMIN_EMAILS"];
    process.env["VIA_HR_ORGANISATION_ID"] = organisationId;
    delete process.env["VIA_HR_SUPER_ADMIN_EMAILS"];
    clearDefaultOrganisationCacheForTests();

    try {
      await sql`
        INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by)
        VALUES (${organisationId}, 'Portal Session Test', ${`portal-${organisationId}`}, true,
          ${bootstrapId}, ${bootstrapId})
      `;
      for (const [table, id, name, code] of [
        ["departments", departmentId, "Operations", "OPS"],
        ["positions", positionId, "Coordinator", "COORD"],
        ["locations", locationId, "Muscat Office", "MCT"],
        ["employment_types", employmentTypeId, "Full Time", "FULL"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by)
           VALUES ($1, $2, $3, $4, true, 1, $5, $5)`,
          [id, organisationId, name, code, bootstrapId],
        );
      }
      await sql`
        INSERT INTO employees (
          id, organisation_id, employee_number, legal_name, preferred_name, work_email,
          department_id, position_id, location_id, employment_type_id, status, start_date,
          created_by, updated_by
        ) VALUES (
          ${employeeId}, ${organisationId}, 'SSO-0001', 'Portal Employee', 'Portal Employee',
          ${email}, ${departmentId}, ${positionId}, ${locationId}, ${employmentTypeId},
          'Active', '2026-01-01', ${bootstrapId}, ${bootstrapId}
        )
      `;

      const created = await createPortalSession(
        {
          email,
          name: "Portal Employee Updated",
          portalRole: "unrecognised-administrator",
          mappedRole: "Employee",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
        },
        { lifetimeSeconds: 28_800, ipAddress: "192.0.2.10", userAgent: "VIA SSO test" },
      );
      assert.equal(created.user.workspaceEmail, email);
      assert.deepEqual(created.user.roles, ["Employee"]);
      assert.equal(created.user.displayName, "Portal Employee Updated");
      assert.equal(created.employee.id, employeeId);
      assert.match(created.sessionToken, /^[A-Za-z0-9_-]{43}$/);

      const [rawSession] = await sql`
        SELECT token_hash, expires_at, ip_address FROM portal_sessions WHERE id = ${created.sessionId}
      `;
      assert.notEqual(rawSession?.token_hash, created.sessionToken);
      assert.equal(String(rawSession?.token_hash).length, 64);
      assert.equal(rawSession?.ip_address, "192.0.2.10");
      assert.ok(new Date(String(rawSession?.expires_at)).getTime() <= Date.now() + 28_801_000);

      const restored = await findPortalSession(created.sessionToken);
      assert.equal(restored?.user.id, created.user.id);
      assert.equal(restored?.employee.id, employeeId);

      const [mapping] = await sql`
        SELECT status, workspace_email FROM workspace_identity_mappings WHERE user_id = ${created.user.id}
      `;
      assert.equal(mapping?.status, "Verified");
      assert.equal(mapping?.workspace_email, email);
      const [audit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId}
          AND action IN ('portal_identity_linked', 'portal_sign_in')
      `;
      assert.equal(Number(audit?.count), 2);

      await revokePortalSession(created.sessionToken);
      assert.equal(await findPortalSession(created.sessionToken), null);
      const [logoutAudit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId} AND action = 'portal_sign_out'
      `;
      assert.equal(Number(logoutAudit?.count), 1);

      const firstLoginEmail = `first-login-${organisationId}@via-int.com`;
      const firstLogin = await createPortalSession(
        {
          email: firstLoginEmail,
          name: "First Login Employee",
          portalRole: "administrator",
          mappedRole: "Employee",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
        },
        { lifetimeSeconds: 28_800 },
      );
      assert.equal(firstLogin.employee.employeeNumber, firstLoginEmail);
      assert.equal(firstLogin.employee.profileSetupStatus, "In Progress");
      assert.equal(firstLogin.employee.status, "Onboarding");
      assert.deepEqual(firstLogin.user.roles, ["Employee"]);
      const [checklist] = await sql`
        SELECT
          count(*)::int AS task_count,
          count(*) FILTER (WHERE self_service_form_key = 'employment_details')::int AS employment_count
        FROM onboarding_tasks
        WHERE assigned_user_id = ${firstLogin.user.id}
      `;
      assert.equal(Number(checklist?.task_count), 6);
      assert.equal(Number(checklist?.employment_count), 1);
      const [selfRegistrationAudit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId}
          AND entity_id = ${firstLogin.employee.id}
          AND action = 'self-register'
      `;
      assert.equal(Number(selfRegistrationAudit?.count), 1);
      await revokePortalSession(firstLogin.sessionToken);

      const superAdminEmail = `super-admin-${organisationId}@via-int.com`;
      process.env["VIA_HR_SUPER_ADMIN_EMAILS"] = superAdminEmail;
      const superAdminLogin = await createPortalSession(
        {
          email: superAdminEmail,
          name: "Configured Super Admin",
          portalRole: "user",
          mappedRole: "Employee",
          expiresAt: Math.floor(Date.now() / 1000) + 120,
        },
        { lifetimeSeconds: 28_800 },
      );
      assert.deepEqual(new Set(superAdminLogin.user.roles), new Set(["Employee", "Super Admin"]));
      const [adminAudit] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId}
          AND entity_id = ${superAdminLogin.user.id}
          AND action = 'bootstrap-super-admin-access'
          AND risk_level = 'Critical'
      `;
      assert.equal(Number(adminAudit?.count), 1);
      await revokePortalSession(superAdminLogin.sessionToken);
    } finally {
      clearDefaultOrganisationCacheForTests();
      if (priorOrg === undefined) delete process.env["VIA_HR_ORGANISATION_ID"];
      else process.env["VIA_HR_ORGANISATION_ID"] = priorOrg;
      if (priorSuperAdminEmails === undefined) delete process.env["VIA_HR_SUPER_ADMIN_EMAILS"];
      else process.env["VIA_HR_SUPER_ADMIN_EMAILS"] = priorSuperAdminEmails;
      await sql.end();
    }
  },
);
