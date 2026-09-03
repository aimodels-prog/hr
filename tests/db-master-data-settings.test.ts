import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";

import {
  archiveCollectionRecord,
  archiveProject,
  countActiveEmployeesForMasterRecord,
  countActiveEmployeesForProject,
  countActiveProjectsForCostCentre,
  createCollectionRecord,
  createProject,
  listCollection,
  listProjects,
  restoreCollectionRecord,
  restoreProject,
  updateCollectionRecord,
  updateProject,
} from "../src/lib/db/repositories/master-data.repository.server.ts";
import {
  getAppSettings,
  saveAppSettings,
} from "../src/lib/db/repositories/settings.repository.server.ts";
import {
  clearDefaultOrganisationCacheForTests,
  resolveDefaultOrganisationId,
  resolveOrganisationIdForActor,
  verifyServerActorRole,
} from "../src/lib/db/utils.server.ts";

const testDbUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDbUrl) process.env["DATABASE_URL"] = testDbUrl;

test(
  "H3.5A PostgreSQL master data and settings transactions with atomic audit logging",
  { skip: !testDbUrl },
  async () => {
    const databaseName = new URL(testDbUrl!).pathname.slice(1).toLowerCase();
    assert.match(
      databaseName,
      /(test|scratch)/,
      "VIA_HR_TEST_DATABASE_URL must identify a visibly test-only database",
    );
    const sql = postgres(testDbUrl!, { max: 1, prepare: false });

    try {
      const orgId = randomUUID();
      const actorUserId = randomUUID();
      const actorEmployeeId = randomUUID();
      const now = new Date();

      // Setup organisation
      await sql`
      INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by, created_at, updated_at)
      VALUES (${orgId}, 'H35A Comprehensive Org', ${`h35a-comp-${orgId.slice(0, 8)}`}, true, ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;

      // Setup app settings
      await sql`
      INSERT INTO app_settings (
        organisation_id, timezone, base_currency, working_days,
        standard_daily_hours, standard_weekly_hours, leave_year_start, leave_year_end,
        document_reminder_days, employee_number_format, candidate_reference_format,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${orgId}, 'Asia/Muscat', 'OMR', '{0, 1, 2, 3, 4}'::integer[],
        8.00, 40.00, '01-01', '12-31',
        '{30, 15, 7}'::integer[], 'VIA-{0000}', 'CAND-{00000}',
        ${actorUserId}, ${actorUserId}, ${now}, ${now}
      )
    `;

      const deptId = randomUUID();
      const posId = randomUUID();
      const locId = randomUUID();
      const empTypeId = randomUUID();

      // Insert master data required for employee
      await sql`
      INSERT INTO departments (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
      VALUES (${deptId}, ${orgId}, 'Executive', 'EXEC', true, 1, ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;
      await sql`
      INSERT INTO positions (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
      VALUES (${posId}, ${orgId}, 'Director', 'DIR', true, 1, ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;
      await sql`
      INSERT INTO locations (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
      VALUES (${locId}, ${orgId}, 'Headquarters', 'HQ', true, 1, ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;
      await sql`
      INSERT INTO employment_types (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
      VALUES (${empTypeId}, ${orgId}, 'Permanent Full-time', 'PFT', true, 1, ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;

      // Setup employee
      await sql`
      INSERT INTO employees (
        id, organisation_id, employee_number, legal_name, preferred_name,
        work_email, department_id, position_id, location_id, employment_type_id,
        status, start_date, created_by, updated_by, created_at, updated_at
      ) VALUES (
        ${actorEmployeeId}, ${orgId}, 'EMP-0001', 'Super Admin', 'Super Admin',
        ${`admin-${orgId.slice(0, 6)}@viahr.test`}, ${deptId}, ${posId}, ${locId}, ${empTypeId},
        'Active', '2026-01-01', ${actorUserId}, ${actorUserId}, ${now}, ${now}
      )
    `;

      // Setup actor user and roles
      await sql`
      INSERT INTO users (id, organisation_id, employee_id, display_name, workspace_email, status, created_by, updated_by, created_at, updated_at)
      VALUES (${actorUserId}, ${orgId}, ${actorEmployeeId}, 'Super Administrator', ${`admin-${orgId.slice(0, 6)}@viahr.test`}, 'Active', ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;

      // Get super admin role id
      const [superAdminRole] = await sql`SELECT id FROM roles WHERE code = 'Super Admin'`;
      assert.ok(superAdminRole, "Super Admin role must exist");

      await sql`
      INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by, assigned_at, reason)
      VALUES (${orgId}, ${actorUserId}, ${superAdminRole.id}, ${actorUserId}, ${now}, 'Initial test super admin')
    `;

      // 1. Verify actor role verification against PostgreSQL
      const verifiedResult = await verifyServerActorRole(orgId, actorUserId, "Super Admin");
      assert.equal(verifiedResult.verified, true);
      assert.ok(verifiedResult.actor);
      assert.equal(verifiedResult.actor.displayName, "Super Administrator");

      const actor = verifiedResult.actor;
      assert.equal(await resolveOrganisationIdForActor(actorUserId), orgId);
      const previewEmail = `admin-${orgId.slice(0, 6)}@viahr.test`;
      assert.equal(await resolveOrganisationIdForActor("user-preview", previewEmail), orgId);
      const previewActor = await verifyServerActorRole(
        orgId,
        "user-preview",
        "Super Admin",
        previewEmail,
      );
      assert.equal(
        previewActor.verified,
        true,
        "development preview identity must resolve by email",
      );

      const rejectedRole = await verifyServerActorRole(orgId, actorUserId, "HR");
      assert.equal(
        rejectedRole.verified,
        false,
        "database role checks must reject an unassigned role",
      );

      // 2. Test master data CRUD across collections
      const collections = [
        "departments",
        "locations",
        "costCentres",
        "positions",
        "grades",
        "employmentTypes",
        "workingTimes",
        "currencies",
        "activityCodes",
      ] as const;

      for (const coll of collections) {
        const code = coll === "currencies" ? "AED" : `T-${coll.slice(0, 4).toUpperCase()}`;
        const created = await createCollectionRecord(
          orgId,
          coll,
          {
            name: `Test ${coll}`,
            code,
            description: `Test description for ${coll}`,
            isActive: true,
            orderIndex: 1,
          },
          actor,
        );
        assert.ok(created.id);
        assert.equal(created.name, `Test ${coll}`);

        // Update
        const updated = await updateCollectionRecord(
          orgId,
          coll,
          created.id,
          {
            description: `Updated description for ${coll}`,
          },
          actor,
        );
        assert.equal(updated.description, `Updated description for ${coll}`);

        // List
        const list = await listCollection(orgId, coll, false);
        assert.ok(list.some((r) => r.id === created.id));

        // Archive
        const archived = await archiveCollectionRecord(orgId, coll, created.id, actor);
        assert.equal(archived.isActive, false);

        // Restore
        const restored = await restoreCollectionRecord(orgId, coll, created.id, actor);
        assert.equal(restored.isActive, true);
      }

      // 3. Test public holiday with date field
      const holiday = await createCollectionRecord(
        orgId,
        "publicHolidays",
        {
          name: "National Day",
          code: "NAT-DAY",
          date: "2026-11-18",
          isActive: true,
          orderIndex: 1,
        },
        actor,
      );
      assert.equal(holiday.date, "2026-11-18");

      const office = await createCollectionRecord(
        orgId,
        "locations",
        {
          name: "Verified Attendance Office",
          code: "ATT-OFFICE",
          latitude: 25.2048,
          longitude: 55.2708,
          radiusMeters: 150,
          isClockInSite: true,
          isActive: true,
          orderIndex: 3,
        },
        actor,
      );
      assert.equal(office.isClockInSite, true);
      assert.equal(office.radiusMeters, 150);

      const rollbackName = `Rollback ${orgId.slice(0, 8)}`;
      await assert.rejects(
        createCollectionRecord(
          orgId,
          "departments",
          {
            name: rollbackName,
            code: `RB-${orgId.slice(0, 6)}`,
            isActive: true,
            orderIndex: 2,
          },
          { ...actor, employeeId: "not-a-uuid" },
        ),
      );
      const rolledBackRows = await sql`
      SELECT id FROM departments
      WHERE organisation_id = ${orgId} AND name = ${rollbackName}
    `;
      assert.equal(
        rolledBackRows.length,
        0,
        "a failed audit insert must roll back the data insert",
      );

      // 4. Test projects CRUD and cost centre dependency
      const costCentre = await createCollectionRecord(
        orgId,
        "costCentres",
        {
          name: "Engineering CC",
          code: "ENG-CC",
          isActive: true,
          orderIndex: 1,
        },
        actor,
      );

      const project = await createProject(
        orgId,
        {
          name: "Core HR Modernisation",
          code: "PRJ-HR-MOD",
          startDate: "2026-01-01",
          costCentreId: costCentre.id,
          status: "Active",
          isActive: true,
          orderIndex: 1,
        },
        actor,
      );
      assert.equal(project.name, "Core HR Modernisation");
      assert.equal(project.costCentreId, costCentre.id);

      const projectCount = await countActiveProjectsForCostCentre(orgId, costCentre.id);
      assert.equal(projectCount, 1);

      const employeeCountForProj = await countActiveEmployeesForProject(orgId, project.id);
      assert.equal(employeeCountForProj, 0);

      const employeeCountForDept = await countActiveEmployeesForMasterRecord(
        orgId,
        "departments",
        costCentre.id,
      );
      assert.equal(employeeCountForDept, 0);

      // 5. Test Settings Repository
      const currentSettings = await getAppSettings(orgId);
      assert.equal(currentSettings.baseCurrency, "OMR");
      assert.equal(currentSettings.organisationName, "H35A Comprehensive Org");

      const updatedSettings = await saveAppSettings(
        orgId,
        {
          ...currentSettings,
          organisationName: "H35A Renamed Org",
          baseCurrency: "OMR",
          standardDailyHours: 8.5,
          standardWeeklyHours: 42.5,
        },
        actor,
      );
      assert.equal(updatedSettings.organisationName, "H35A Renamed Org");
      assert.equal(updatedSettings.standardDailyHours, 8.5);
      assert.equal(updatedSettings.recordVersion, currentSettings.recordVersion + 1);

      const secondOrgId = randomUUID();
      await sql`
      INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by, created_at, updated_at)
      VALUES (${secondOrgId}, 'Second Test Organisation', ${`second-${secondOrgId.slice(0, 8)}`}, true, ${actorUserId}, ${actorUserId}, ${now}, ${now})
    `;
      delete process.env["VIA_HR_ORGANISATION_ID"];
      clearDefaultOrganisationCacheForTests();
      await assert.rejects(resolveDefaultOrganisationId(), /More than one active organisation/);
      process.env["VIA_HR_ORGANISATION_ID"] = orgId;
      clearDefaultOrganisationCacheForTests();
      assert.equal(await resolveDefaultOrganisationId(), orgId);

      // Verify audit logs were written atomically for all operations
      const auditLogs = await sql`
      SELECT action, entity_type FROM audit_events
      WHERE organisation_id = ${orgId}
    `;
      assert.ok(auditLogs.length >= 20, "Every operation must record an atomic audit event");

      // Cleanup mutable records
      await sql`DELETE FROM user_roles WHERE organisation_id = ${orgId}`;
      await sql`DELETE FROM users WHERE organisation_id = ${orgId}`;
      await sql`DELETE FROM employees WHERE organisation_id = ${orgId}`;
      await sql`DELETE FROM projects WHERE organisation_id = ${orgId}`;
      const dbTableNames = [
        "departments",
        "locations",
        "cost_centres",
        "positions",
        "grades",
        "employment_types",
        "working_times",
        "currencies",
        "activity_codes",
        "public_holidays",
      ];
      for (const tableName of dbTableNames) {
        await sql`DELETE FROM ${sql(tableName)} WHERE organisation_id = ${orgId}`;
      }
    } finally {
      await sql.end();
    }
  },
);
