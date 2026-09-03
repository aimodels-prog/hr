import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import {
  createEmployeeInDatabase,
  createProfileChangeRequestInDatabase,
  decideProfileChangeRequestInDatabase,
  listEmployeesForOrganisation,
  listProfileChangeRequestsForOrganisation,
  updateEmploymentRecordInDatabase,
  updateUserAccessInDatabase,
} from "../src/lib/db/repositories/employee.repository.server.ts";
import {
  createOnboardingCaseInDatabase,
  createOffboardingCaseInDatabase,
  ensureCoreHrLifecycleTemplates,
  finaliseOffboardingCaseInDatabase,
  grantOffboardingClearanceInDatabase,
  listCoreHrLifecycleForActor,
  saveOnboardingSelfServiceInDatabase,
  updateOffboardingTaskInDatabase,
  updateOnboardingTaskInDatabase,
} from "../src/lib/db/repositories/core-hr-lifecycle.repository.server.ts";
import {
  decideEmployeeDocumentInDatabase,
  listEmployeeDocumentsForActor,
  readEmployeeDocumentInDatabase,
  replaceEmployeeDocumentInDatabase,
  uploadEmployeeDocumentToDatabase,
} from "../src/lib/db/repositories/employee-document.repository.server.ts";
import {
  assignCompanyAssetInDatabase,
  closeCompanyAssetAssignmentInDatabase,
  listCompanyAssetAssignmentsForActor,
} from "../src/lib/db/repositories/company-asset.repository.server.ts";
import { processCoreHrScheduledReminders } from "../src/lib/db/repositories/core-hr-reminder.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "Core HR employee, reporting, access and profile changes persist atomically in PostgreSQL",
  { skip: !testDatabaseUrl },
  async () => {
    const databaseName = new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase();
    assert.match(databaseName, /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const organisationId = randomUUID();
    const managerEmployeeId = randomUUID();
    const managerUserId = randomUUID();
    const departmentId = randomUUID();
    const positionId = randomUUID();
    const locationId = randomUUID();
    const employmentTypeId = randomUUID();
    const now = new Date();
    const actor = {
      userId: managerUserId,
      employeeId: managerEmployeeId,
      displayName: "Core HR Test Administrator",
      workspaceEmail: `core-admin-${organisationId}@viahr.test`,
      organisationId,
      roles: ["Employee", "Super Admin"] as const,
      activeRole: "Super Admin" as const,
    };

    try {
      await sql`
        INSERT INTO organisations (id, name, slug, is_active, created_by, updated_by, created_at, updated_at)
        VALUES (${organisationId}, 'Core HR Cutover Test', ${`core-hr-${organisationId}`}, true,
          ${managerUserId}, ${managerUserId}, ${now}, ${now})
      `;
      await sql`
        INSERT INTO app_settings (
          organisation_id, timezone, base_currency, working_days, standard_daily_hours,
          standard_weekly_hours, leave_year_start, leave_year_end, document_reminder_days,
          employee_number_format, candidate_reference_format, created_by, updated_by
        ) VALUES (
          ${organisationId}, 'Asia/Dubai', 'OMR', ARRAY[1,2,3,4,5], 8, 40,
          '01-01', '12-31', ARRAY[30,14,7], 'VIA-{####}', 'VIA-CAN-{####}',
          ${managerUserId}, ${managerUserId}
        )
      `;
      for (const [table, id, name] of [
        ["departments", departmentId, "Operations"],
        ["positions", positionId, "Manager"],
        ["locations", locationId, "Head Office"],
        ["employment_types", employmentTypeId, "Full-time"],
      ] as const) {
        await sql.unsafe(
          `INSERT INTO ${table} (id, organisation_id, name, code, is_active, order_index, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, true, 1, $5, $5, $6, $6)`,
          [id, organisationId, name, name.slice(0, 3).toUpperCase(), managerUserId, now],
        );
      }
      await sql`
        INSERT INTO employees (
          id, organisation_id, employee_number, legal_name, preferred_name, work_email,
          department_id, position_id, location_id, employment_type_id, status, start_date,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${managerEmployeeId}, ${organisationId}, 'TEST-0001', 'Core HR Administrator', 'Administrator',
          ${actor.workspaceEmail}, ${departmentId}, ${positionId}, ${locationId}, ${employmentTypeId},
          'Active', '2025-09-01', ${managerUserId}, ${managerUserId}, ${now}, ${now}
        )
      `;
      await sql`
        INSERT INTO users (
          id, organisation_id, employee_id, display_name, workspace_email, status,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${managerUserId}, ${organisationId}, ${managerEmployeeId}, ${actor.displayName},
          ${actor.workspaceEmail}, 'Active', ${managerUserId}, ${managerUserId}, ${now}, ${now}
        )
      `;
      await sql`
        INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by, reason)
        SELECT ${organisationId}, ${managerUserId}, id, ${managerUserId}, 'Test administrator'
        FROM roles WHERE code IN ('Employee', 'HR', 'Super Admin')
        ON CONFLICT DO NOTHING
      `;

      const created = await createEmployeeInDatabase(
        organisationId,
        {
          employeeNumber: "TEST-0002",
          legalName: "PostgreSQL Employee",
          preferredName: "PostgreSQL",
          workEmail: `core-employee-${organisationId}@viahr.test`,
          department: "Operations",
          position: "Manager",
          location: "Head Office",
          employmentType: "Full-time",
          lineManagerId: managerEmployeeId,
          startDate: "2026-08-31",
          status: "Active",
          salary: { baseMonthly: 3210, currency: "OMR" },
          bankDetails: {
            bankName: "Test Bank",
            accountNumber: "987654321",
            iban: "OM0000000000000000000000",
          },
          passportNumber: "PASSPORT-SECRET",
          emergencyContacts: [],
          dependants: [],
        },
        actor,
      );

      const templates = await ensureCoreHrLifecycleTemplates(organisationId, actor);
      const onboardingCaseId = await createOnboardingCaseInDatabase(
        organisationId,
        {
          employeeId: created.employeeId,
          templateId: templates.onboardingTemplateId,
        },
        actor,
      );
      let lifecycle = await listCoreHrLifecycleForActor(organisationId, actor);
      const onboardingCase = lifecycle.onboardingCases.find((item) => item.id === onboardingCaseId);
      assert.ok(onboardingCase);
      assert.ok(onboardingCase.tasks.length >= 6);
      const managerTask = onboardingCase.tasks.find(
        (task) => task.templateTaskId === "manager-plan",
      );
      assert.ok(managerTask);
      await updateOnboardingTaskInDatabase(
        organisationId,
        {
          caseId: onboardingCaseId,
          taskId: managerTask.id,
          status: "Completed",
        },
        actor,
      );
      lifecycle = await listCoreHrLifecycleForActor(organisationId, actor);
      assert.equal(
        lifecycle.onboardingCases
          .find((item) => item.id === onboardingCaseId)
          ?.tasks.find((task) => task.id === managerTask.id)?.status,
        "Completed",
      );

      const [rawCompensation] = await sql`
        SELECT encrypted_payload FROM employee_compensation WHERE employee_id = ${created.employeeId}
      `;
      assert.ok(rawCompensation);
      assert.doesNotMatch(
        String(rawCompensation.encrypted_payload),
        /3210|987654321|PASSPORT-SECRET/,
      );
      const documentId = await uploadEmployeeDocumentToDatabase(
        organisationId,
        {
          employeeId: created.employeeId,
          type: "passport",
          fileName: "passport.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 VIA employee passport test"),
          documentNumber: "P-TEST-100",
          issueDate: "2025-01-01",
          expiryDate: "2026-09-08",
          issuingAuthority: "Test Authority",
          visibility: "Restricted",
        },
        actor,
      );
      let employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      const passport = employeeDocuments.find((document) => document.id === documentId);
      assert.equal(passport?.documentNumber, "P-TEST-100");
      assert.equal(passport?.status, "Pending Verification");
      await decideEmployeeDocumentInDatabase(
        organisationId,
        documentId,
        "verify",
        undefined,
        actor,
      );
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(
        employeeDocuments.find((document) => document.id === documentId)?.status,
        "Valid",
      );
      const readPassport = await readEmployeeDocumentInDatabase(
        organisationId,
        passport!.fileId,
        actor,
        "Verified encrypted employee-document retrieval",
      );
      assert.match(new TextDecoder().decode(readPassport.bytes), /VIA employee passport test/);
      const reminderResult = await processCoreHrScheduledReminders(
        new Date("2026-09-01T08:00:00Z"),
      );
      assert.ok(reminderResult.documentNotifications > 0);
      assert.ok(reminderResult.anniversaryNotifications > 0);
      const repeatedReminderResult = await processCoreHrScheduledReminders(
        new Date("2026-09-01T09:00:00Z"),
      );
      assert.equal(repeatedReminderResult.documentNotifications, 0);
      assert.equal(repeatedReminderResult.anniversaryNotifications, 0);
      const replacementId = await replaceEmployeeDocumentInDatabase(
        organisationId,
        documentId,
        {
          fileName: "passport-renewed.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 VIA renewed passport test"),
          reason: "Renewed passport received",
          documentNumber: "P-TEST-200",
          issueDate: "2026-01-01",
          expiryDate: "2031-01-01",
        },
        actor,
      );
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(
        employeeDocuments.find((document) => document.id === documentId)?.status,
        "Replaced",
      );
      assert.equal(
        employeeDocuments.find((document) => document.id === replacementId)?.documentNumber,
        "P-TEST-200",
      );
      const assetAssignmentId = await assignCompanyAssetInDatabase(
        organisationId,
        {
          employeeId: created.employeeId,
          assetType: "Laptop",
          assetTag: `VIA-${organisationId.slice(0, 8)}`,
          description: "Dell Latitude test laptop",
          assignedDate: "2026-09-01",
          conditionAtAssignment: "New",
        },
        actor,
      );
      let assignedAssets = await listCompanyAssetAssignmentsForActor(organisationId, actor);
      assert.equal(
        assignedAssets.find((item) => item.id === assetAssignmentId)?.status,
        "Assigned",
      );
      await closeCompanyAssetAssignmentInDatabase(
        organisationId,
        assetAssignmentId,
        "Returned",
        "Good",
        "Returned during test clearance",
        actor,
      );
      assignedAssets = await listCompanyAssetAssignmentsForActor(organisationId, actor);
      assert.equal(
        assignedAssets.find((item) => item.id === assetAssignmentId)?.status,
        "Returned",
      );
      const [reportingLine] = await sql`
        SELECT supervisor_id FROM employee_reporting_lines
        WHERE employee_id = ${created.employeeId} AND effective_to IS NULL
      `;
      assert.equal(reportingLine?.supervisor_id, managerEmployeeId);

      await updateEmploymentRecordInDatabase(
        organisationId,
        created.employeeId,
        { weeklyHours: 37.5, salary: { baseMonthly: 3500, currency: "OMR" } },
        "2026-09-01",
        "Approved contract amendment",
        actor,
      );
      await updateUserAccessInDatabase(
        organisationId,
        created.userId,
        ["Employee", "HR"],
        "Active",
        "Assigned People Operations duties",
        actor,
      );

      const employeeActor = {
        userId: created.userId,
        employeeId: created.employeeId,
        displayName: "PostgreSQL Employee",
        workspaceEmail: `core-employee-${organisationId}@viahr.test`,
        organisationId,
        roles: ["Employee"] as const,
        activeRole: "Employee" as const,
      };
      const employeeOnboarding = (
        await listCoreHrLifecycleForActor(organisationId, employeeActor)
      ).onboardingCases.find((item) => item.id === onboardingCaseId);
      const personalTask = employeeOnboarding?.tasks.find(
        (task) => task.selfServiceFormKey === "personal_details",
      );
      const bankTask = employeeOnboarding?.tasks.find(
        (task) => task.selfServiceFormKey === "bank_details",
      );
      assert.ok(personalTask && bankTask);
      await saveOnboardingSelfServiceInDatabase(
        organisationId,
        {
          caseId: onboardingCaseId,
          taskId: personalTask.id,
          kind: "personal_details",
          details: {
            dateOfBirth: "1990-04-12",
            gender: "Male",
            nationality: "Omani",
            maritalStatus: "Single",
            phone: "+968 9000 1100",
            personalEmail: `personal-${organisationId}@viahr.test`,
            address: "Muscat, Oman",
            emergencyContacts: [
              { name: "Emergency Contact", relationship: "Sibling", phone: "+968 9000 2200" },
            ],
            dependants: [],
          },
        },
        employeeActor,
      );
      await saveOnboardingSelfServiceInDatabase(
        organisationId,
        {
          caseId: onboardingCaseId,
          taskId: bankTask.id,
          kind: "bank_details",
          details: {
            bankName: "Onboarding Test Bank",
            accountNumber: "1234567890",
            iban: "OM0000000000000000000001",
          },
        },
        employeeActor,
      );
      const [rawOnboardingBank] =
        await sql`SELECT encrypted_payload FROM employee_bank_details WHERE employee_id = ${created.employeeId}`;
      assert.doesNotMatch(String(rawOnboardingBank?.encrypted_payload), /1234567890/);
      const requestId = await createProfileChangeRequestInDatabase(
        organisationId,
        created.employeeId,
        { phone: "+968 9000 1000" },
        employeeActor,
      );
      await decideProfileChangeRequestInDatabase(
        organisationId,
        requestId,
        "Approved",
        "Identity checked by HR",
        actor,
      );

      const persistedEmployees = await listEmployeesForOrganisation(organisationId);
      const persisted = persistedEmployees.find((employee) => employee.id === created.employeeId);
      assert.equal(persisted?.weeklyHours, 37.5);
      assert.equal(persisted?.salary?.baseMonthly, 3500);
      assert.equal(persisted?.phone, "+968 9000 1000");
      const requests = await listProfileChangeRequestsForOrganisation(organisationId);
      assert.equal(requests.find((request) => request.id === requestId)?.status, "Approved");

      const [auditCount] = await sql`
        SELECT count(*)::int AS count FROM audit_events
        WHERE organisation_id = ${organisationId} AND module IN ('core-hr', 'user-management')
      `;
      assert.ok(Number(auditCount?.count) >= 5);
      const [notificationCount] = await sql`
        SELECT count(*)::int AS count FROM notifications WHERE organisation_id = ${organisationId}
      `;
      assert.ok(Number(notificationCount?.count) >= 2);

      const offboardingCaseId = await createOffboardingCaseInDatabase(
        organisationId,
        {
          employeeId: created.employeeId,
          templateId: templates.offboardingTemplateId,
          assignedHRId: managerEmployeeId,
          reasonCategory: "Resignation",
          noticeDate: "2026-09-01",
          lastWorkingDate: "2026-09-05",
          confidentialityLevel: "Restricted",
          confidentialNotes: "Restricted test departure record",
          rehireEligible: true,
        },
        actor,
      );
      const offboarding = (
        await listCoreHrLifecycleForActor(organisationId, actor)
      ).offboardingCases.find((item) => item.id === offboardingCaseId);
      assert.ok(offboarding);
      const [activeAccess] = await sql`SELECT status FROM users WHERE id = ${created.userId}`;
      assert.equal(activeAccess?.status, "Active");
      for (const task of offboarding.tasks) {
        await updateOffboardingTaskInDatabase(
          organisationId,
          {
            caseId: offboardingCaseId,
            taskId: task.id,
            status: "Waived",
            waiverReason: "Approved test clearance waiver",
          },
          actor,
        );
      }
      await grantOffboardingClearanceInDatabase(
        organisationId,
        offboardingCaseId,
        "financial",
        actor,
      );
      await grantOffboardingClearanceInDatabase(organisationId, offboardingCaseId, "legal", actor);
      await finaliseOffboardingCaseInDatabase(
        organisationId,
        offboardingCaseId,
        actor,
        "2026-09-05",
      );
      const [closedEmployee] =
        await sql`SELECT status FROM employees WHERE id = ${created.employeeId}`;
      const [closedAccess] = await sql`SELECT status FROM users WHERE id = ${created.userId}`;
      assert.equal(closedEmployee?.status, "Inactive");
      assert.equal(closedAccess?.status, "Suspended");
    } finally {
      await sql.end();
    }
  },
);
