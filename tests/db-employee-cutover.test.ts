import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";
import { libraryUpload } from "../src/lib/db/repositories/company-library.repository.server.ts";
import { uploadCandidateCvIntakeToDatabase } from "../src/lib/db/repositories/candidate-cv-intake.repository.server.ts";
import {
  getDocumentRequirementSettings,
  saveDocumentRequirementSettings,
  getEmployeeRequirements,
} from "../src/lib/db/repositories/document-requirements.repository.server.ts";

import {
  createEmployeeInDatabase,
  createProfileChangeRequestInDatabase,
  decideProfileChangeRequestInDatabase,
  listEmployeesForOrganisation,
  listEmploymentHistoryForOrganisation,
  listProfileChangeRequestsForOrganisation,
  updateEmploymentRecordInDatabase,
  updateUserAccessInDatabase,
} from "../src/lib/db/repositories/employee.repository.server.ts";
import {
  assignOffboardingTaskOwnerInDatabase,
  cancelOffboardingCaseInDatabase,
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

      await sql`INSERT INTO positions (id, organisation_id, name, code, is_active, created_by, updated_by)
        VALUES (${randomUUID()}, ${organisationId}, 'CEO', 'CEO', true, ${managerUserId}, ${managerUserId})`;
      const chiefInput = {
        employeeNumber: "CEO-TEST",
        legalName: "Test Chief",
        preferredName: "Chief",
        workEmail: `chief-${organisationId}@viahr.test`,
        department: "Operations",
        position: "CEO",
        location: "Head Office",
        employmentType: "Full-time",
        startDate: "2026-01-01",
        status: "Active" as const,
      };
      await assert.rejects(
        createEmployeeInDatabase(
          organisationId,
          { ...chiefInput, lineManagerId: managerEmployeeId },
          actor,
        ),
        /CEO has no supervisor/,
      );
      await assert.rejects(
        createEmployeeInDatabase(organisationId, { ...chiefInput, position: "Manager" }, actor),
        /supervisor must be assigned/,
      );
      const chief = await createEmployeeInDatabase(organisationId, chiefInput, actor);
      const [chiefRow] =
        await sql`SELECT line_manager_id FROM employees WHERE id=${chief.employeeId}`;
      assert.equal(chiefRow.line_manager_id, null);

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

      await sql`INSERT INTO employment_changes (organisation_id,employee_id,effective_date,field,old_value,new_value,reason,created_by,updated_by)
        VALUES (${organisationId},${created.employeeId},'2026-09-01','salary','100','200','Private salary reason',${managerUserId},${managerUserId})`;
      const selfActor = {
        ...actor,
        userId: created.userId,
        employeeId: created.employeeId,
        roles: ["Employee"] as const,
        activeRole: "Employee" as const,
      };
      const selfHistory = await listEmploymentHistoryForOrganisation(organisationId, selfActor);
      assert.ok(selfHistory.length > 0);
      assert.ok(selfHistory.every((entry) => entry.employeeId === created.employeeId));
      for (const role of [
        "Employee",
        "IT",
        "Accounts",
        "Line Manager",
        "HR",
        "Super Admin",
      ] as const) {
        const records = await listEmploymentHistoryForOrganisation(organisationId, {
          ...actor,
          activeRole: role,
          roles: [role],
        });
        const target = records.filter((entry) => entry.employeeId === created.employeeId);
        if (role === "Employee" || role === "IT") assert.equal(target.length, 0);
        if (role === "Accounts")
          assert.ok(target.length > 0 && target.every((entry) => entry.field === "salary"));
        if (role === "Line Manager" || role === "HR")
          assert.ok(target.length > 0 && target.every((entry) => entry.field !== "salary"));
        if (role === "Super Admin") assert.ok(target.some((entry) => entry.field === "salary"));
      }
      const outside = await listEmploymentHistoryForOrganisation(randomUUID(), actor);
      assert.deepEqual(outside, []);
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
      await assert.rejects(
        updateOnboardingTaskInDatabase(
          organisationId,
          { caseId: onboardingCaseId, taskId: managerTask.id, status: "Pending" },
          actor,
        ),
        /completed task is locked/,
      );
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
          type: "other",
          requirementId: "cv",
          answers: {},
          fileName: "cv.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 CV unchanged bytes"),
          visibility: "Public",
        },
        selfActor,
      );
      const config = await getDocumentRequirementSettings(organisationId);
      const duplicateInput = {
        employeeId: created.employeeId,
        type: "other" as const,
        fileName: "concurrent-upload.pdf",
        mimeType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.4 concurrent identical employee file"),
      };
      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          uploadEmployeeDocumentToDatabase(organisationId, duplicateInput, actor),
        ),
      );
      assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
      for (const result of attempts)
        if (result.status === "rejected") assert.match(String(result.reason), /already uploaded/);
      await assert.rejects(
        uploadEmployeeDocumentToDatabase(
          organisationId,
          { ...duplicateInput, fileName: "renamed.pdf" },
          actor,
        ),
        /already uploaded/,
      );
      const libraryInput = {
        title: "Concurrent handbook",
        category: "Policy",
        kind: "Library" as const,
        audience: "All staff" as const,
        name: "policy.pdf",
        bytes: new TextEncoder().encode("%PDF-1.4 concurrent identical library file"),
      };
      const libraryAttempts = await Promise.allSettled(
        Array.from({ length: 6 }, () => libraryUpload(organisationId, libraryInput, actor)),
      );
      assert.equal(libraryAttempts.filter((r) => r.status === "fulfilled").length, 1);
      for (const result of libraryAttempts)
        if (result.status === "rejected") assert.match(String(result.reason), /already uploaded/);
      const [counted] = await sql`SELECT count(*)::int AS count FROM company_library
        WHERE organisation_id=${organisationId} AND title='Concurrent handbook'`;
      assert.equal(counted.count, 1);
      const cvInput = {
        fileName: "concurrent-cv.pdf",
        mimeType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.4 concurrent CV"),
        source: "HR Upload" as const,
        receivedAt: new Date().toISOString(),
        consentStatus: "Confirmed" as const,
        isRecommended: false,
      };
      const cvAttempts = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          uploadCandidateCvIntakeToDatabase(organisationId, cvInput, actor),
        ),
      );
      assert.equal(cvAttempts.filter((r) => r.status === "fulfilled").length, 1);
      for (const result of cvAttempts)
        if (result.status === "rejected") assert.match(String(result.reason), /already uploaded/);
      await assert.rejects(
        saveDocumentRequirementSettings(
          organisationId,
          config.definitions,
          config.version,
          selfActor,
        ),
        /Only HR/,
      );
      await assert.rejects(
        getEmployeeRequirements(organisationId, managerEmployeeId, selfActor),
        /cannot view/,
      );
      const cv = (await listEmployeeDocumentsForActor(organisationId, actor)).find(
        (d) => d.id === documentId,
      )!;
      assert.equal(cv.visibility, "Restricted");
      assert.equal(cv.requirementSnapshot?.name, "Updated CV");
      await decideEmployeeDocumentInDatabase(
        organisationId,
        documentId,
        "verify",
        undefined,
        actor,
      );
      const changedConfig = config.definitions.map((r) =>
        r.id === "cv" ? { ...r, name: "Employee CV" } : r,
      );
      await saveDocumentRequirementSettings(organisationId, changedConfig, config.version, actor);
      await assert.rejects(
        saveDocumentRequirementSettings(organisationId, changedConfig, config.version, actor),
        /Reload/,
      );
      const replacement = await replaceEmployeeDocumentInDatabase(
        organisationId,
        documentId,
        {
          fileName: "new-cv.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 replacement"),
          reason: "New CV",
          answers: {},
        },
        selfActor,
      );
      let cvDocs = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(cvDocs.find((d) => d.id === documentId)?.status, "Valid");
      assert.equal(
        cvDocs.find((d) => d.id === replacement)?.requirementSnapshot?.name,
        "Updated CV",
      );
      await decideEmployeeDocumentInDatabase(
        organisationId,
        replacement,
        "verify",
        undefined,
        actor,
      );
      cvDocs = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(cvDocs.find((d) => d.id === documentId)?.status, "Replaced");
      await assert.rejects(
        uploadEmployeeDocumentToDatabase(
          organisationId,
          {
            employeeId: created.employeeId,
            type: "other",
            requirementId: "cv",
            answers: {},
            fileName: "duplicate.pdf",
            mimeType: "application/pdf",
            bytes: new TextEncoder().encode("%PDF-1.4 duplicate"),
          },
          selfActor,
        ),
        /already exists/,
      );
      await assert.rejects(
        uploadEmployeeDocumentToDatabase(
          organisationId,
          {
            employeeId: created.employeeId,
            type: "education_certificate",
            requirementId: "education_certificate",
            answers: {},
            fileName: "degree.pdf",
            mimeType: "application/pdf",
            bytes: new TextEncoder().encode("%PDF-1.4"),
          },
          selfActor,
        ),
        /required/,
      );
      const degreeId = await uploadEmployeeDocumentToDatabase(
        organisationId,
        {
          employeeId: created.employeeId,
          type: "education_certificate",
          requirementId: "education_certificate",
          answers: {
            qualification: "BEng",
            institution: "Private Institution",
            graduationYear: "2020",
          },
          fileName: "degree.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 degree"),
        },
        selfActor,
      );
      const [storedAnswers] =
        await sql`SELECT answers_encrypted FROM employee_documents WHERE id=${degreeId}`;
      assert.doesNotMatch(String(storedAnswers!.answers_encrypted), /Private Institution|BEng/);
      assert.equal(
        (await listEmployeeDocumentsForActor(organisationId, selfActor)).find(
          (d) => d.id === degreeId,
        )?.answers?.["graduationYear"],
        "2020",
      );
      const passportId = await uploadEmployeeDocumentToDatabase(
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
      const passport = employeeDocuments.find((document) => document.id === passportId);
      assert.equal(passport?.documentNumber, "P-TEST-100");
      assert.equal(passport?.status, "Pending Verification");
      await decideEmployeeDocumentInDatabase(
        organisationId,
        passportId,
        "verify",
        undefined,
        actor,
      );
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(
        employeeDocuments.find((document) => document.id === passportId)?.status,
        "Valid",
      );
      await assert.rejects(
        uploadEmployeeDocumentToDatabase(
          organisationId,
          {
            employeeId: created.employeeId,
            type: "work_permit",
            fileName: "work-permit.pdf",
            mimeType: "application/pdf",
            bytes: new TextEncoder().encode("%PDF-1.4"),
          },
          { ...actor, employeeId: created.employeeId, activeRole: "Employee" },
        ),
        /Only HR/,
      );
      const visaId = await uploadEmployeeDocumentToDatabase(
        organisationId,
        {
          employeeId: created.employeeId,
          type: "visa",
          fileName: "visa.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4 employee supplied visa"),
          documentNumber: "VISA-100",
          issuingAuthority: "UAE Authority",
          issueDate: "2026-01-01",
          expiryDate: "2027-01-01",
          visibility: "Restricted",
        },
        actor,
      );
      await decideEmployeeDocumentInDatabase(organisationId, visaId, "verify", undefined, actor, {
        documentNumber: "VISA-100",
        issuingAuthority: "UAE Authority",
        issuingCountry: "United Arab Emirates",
        issueDate: "2026-01-01",
        expiryDate: "2027-01-01",
        visibility: "Restricted",
      });
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      const verifiedVisa = employeeDocuments.find((document) => document.id === visaId);
      assert.equal(verifiedVisa?.status, "Valid");
      assert.equal(verifiedVisa?.documentNumber, "VISA-100");
      assert.equal(verifiedVisa?.issuingAuthority, "UAE Authority");
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
        passportId,
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
        employeeDocuments.find((document) => document.id === passportId)?.status,
        "Valid",
      );
      await decideEmployeeDocumentInDatabase(
        organisationId,
        replacementId,
        "verify",
        undefined,
        actor,
      );
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(
        employeeDocuments.find((document) => document.id === passportId)?.status,
        "Replaced",
      );
      assert.equal(
        employeeDocuments.find((document) => document.id === replacementId)?.documentNumber,
        "P-TEST-200",
      );
      const revisionInput = {
        fileName: "passport-correction.pdf",
        mimeType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.4 corrected employee passport"),
        reason: "Corrected employee upload",
      };
      const documentOwner = {
        ...actor,
        employeeId: created.employeeId,
        activeRole: "Employee" as const,
      };
      const pendingRevision = await replaceEmployeeDocumentInDatabase(
        organisationId,
        replacementId,
        revisionInput,
        documentOwner,
      );
      await assert.rejects(
        replaceEmployeeDocumentInDatabase(
          organisationId,
          replacementId,
          revisionInput,
          documentOwner,
        ),
        /already awaiting/,
      );
      await decideEmployeeDocumentInDatabase(
        organisationId,
        pendingRevision,
        "reject",
        "Please correct this upload",
        actor,
      );
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(
        employeeDocuments.find((document) => document.id === replacementId)?.status,
        "Valid",
      );
      const correctedRevision = await replaceEmployeeDocumentInDatabase(
        organisationId,
        pendingRevision,
        revisionInput,
        documentOwner,
      );
      await assert.rejects(
        decideEmployeeDocumentInDatabase(
          organisationId,
          pendingRevision,
          "verify",
          undefined,
          actor,
        ),
        /not awaiting/,
      );
      await decideEmployeeDocumentInDatabase(
        organisationId,
        correctedRevision,
        "verify",
        undefined,
        actor,
      );
      employeeDocuments = await listEmployeeDocumentsForActor(organisationId, actor);
      assert.equal(
        employeeDocuments.find((document) => document.id === replacementId)?.status,
        "Replaced",
      );
      assert.equal(
        employeeDocuments.find((document) => document.id === correctedRevision)?.status,
        "Valid",
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
        { lineManagerId: null },
        "2026-08-31",
        "Temporarily placed at the top of the organisation",
        actor,
      );
      const [topLevelEmployee] = await sql`
        SELECT line_manager_id FROM employees WHERE id = ${created.employeeId}
      `;
      assert.equal(topLevelEmployee?.line_manager_id, null);
      const [closedReportingLine] = await sql`
        SELECT count(*)::int AS count FROM employee_reporting_lines
        WHERE employee_id = ${created.employeeId} AND effective_to IS NULL
      `;
      assert.equal(Number(closedReportingLine?.count), 0);
      await updateEmploymentRecordInDatabase(
        organisationId,
        created.employeeId,
        { lineManagerId: managerEmployeeId },
        "2026-09-01",
        "Reporting line restored after organisation-chart review",
        actor,
      );

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

      const readyOffboarding = async (employeeId: string) => {
        const offboardingCaseId = await createOffboardingCaseInDatabase(
          organisationId,
          {
            employeeId,
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
        const [activeAccess] =
          await sql`SELECT status FROM users WHERE employee_id = ${employeeId}`;
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
        await grantOffboardingClearanceInDatabase(
          organisationId,
          offboardingCaseId,
          "legal",
          actor,
        );
        return { caseId: offboardingCaseId, taskId: offboarding.tasks[0]!.id };
      };
      const hrActor = { ...actor, activeRole: "HR" as const, roles: ["HR"] as const };
      const snapshot = async (caseId: string, employeeId: string) => ({
        cases: await sql`SELECT * FROM offboarding_cases WHERE id = ${caseId}`,
        tasks: await sql`SELECT * FROM offboarding_tasks WHERE case_id = ${caseId} ORDER BY id`,
        employees: await sql`SELECT * FROM employees WHERE id = ${employeeId}`,
        users: await sql`SELECT * FROM users WHERE employee_id = ${employeeId} ORDER BY id`,
        audits:
          await sql`SELECT * FROM audit_events WHERE organisation_id = ${organisationId} ORDER BY id`,
      });
      const assertClosed = async (closed: { caseId: string; taskId: string }, status: string) => {
        const before = await snapshot(closed.caseId, created.employeeId);
        const error = new RegExp(status);
        await assert.rejects(
          finaliseOffboardingCaseInDatabase(organisationId, closed.caseId, hrActor, "2026-09-05"),
          error,
        );
        await assert.rejects(
          cancelOffboardingCaseInDatabase(
            organisationId,
            closed.caseId,
            "Repeated cancellation",
            hrActor,
          ),
          error,
        );
        await assert.rejects(
          grantOffboardingClearanceInDatabase(organisationId, closed.caseId, "financial", actor),
          error,
        );
        await assert.rejects(
          grantOffboardingClearanceInDatabase(organisationId, closed.caseId, "legal", hrActor),
          error,
        );
        await assert.rejects(
          assignOffboardingTaskOwnerInDatabase(
            organisationId,
            closed.caseId,
            closed.taskId,
            undefined,
            hrActor,
          ),
          error,
        );
        await assert.rejects(
          updateOffboardingTaskInDatabase(
            organisationId,
            {
              caseId: closed.caseId,
              taskId: closed.taskId,
              status: "Waived",
              waiverReason: "Repeated task waiver",
            },
            hrActor,
          ),
          error,
        );
        assert.deepEqual(await snapshot(closed.caseId, created.employeeId), before);
      };

      const cancelled = await readyOffboarding(created.employeeId);
      await cancelOffboardingCaseInDatabase(
        organisationId,
        cancelled.caseId,
        "Employee decided to stay",
        hrActor,
      );
      await assertClosed(cancelled, "Cancelled");
      const cancelledState = await snapshot(cancelled.caseId, created.employeeId);
      assert.equal(cancelledState.employees[0]?.status, "Active");
      assert.equal(cancelledState.users[0]?.status, "Active");
      assert.equal(cancelledState.cases[0]?.finalized_at, null);

      const completed = await readyOffboarding(created.employeeId);
      await finaliseOffboardingCaseInDatabase(
        organisationId,
        completed.caseId,
        hrActor,
        "2026-09-05",
      );
      await assertClosed(completed, "Completed");
      const [closedEmployee] =
        await sql`SELECT status FROM employees WHERE id = ${created.employeeId}`;
      const [closedAccess] = await sql`SELECT status FROM users WHERE id = ${created.userId}`;
      assert.equal(closedEmployee?.status, "Inactive");
      assert.equal(closedAccess?.status, "Suspended");

      const raceEmployee = await createEmployeeInDatabase(
        organisationId,
        {
          employeeNumber: "TEST-OFFBOARD-RACE",
          legalName: "Concurrent Offboarding Employee",
          preferredName: "Concurrent",
          workEmail: `offboard-race-${organisationId}@viahr.test`,
          department: "Operations",
          position: "Manager",
          location: "Head Office",
          employmentType: "Full-time",
          lineManagerId: managerEmployeeId,
          startDate: "2026-08-31",
          status: "Active",
          emergencyContacts: [],
          dependants: [],
        },
        actor,
      );
      const racing = await readyOffboarding(raceEmployee.employeeId);
      const outcomes = await Promise.allSettled([
        cancelOffboardingCaseInDatabase(
          organisationId,
          racing.caseId,
          "Concurrent cancellation",
          hrActor,
        ),
        finaliseOffboardingCaseInDatabase(organisationId, racing.caseId, hrActor, "2026-09-05"),
      ]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = outcomes.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      assert.match(String(rejected.reason), /Cancelled|Completed/);
      const raceState = await snapshot(racing.caseId, raceEmployee.employeeId);
      const wasCancelled = raceState.cases[0]?.status === "Cancelled";
      assert.equal(raceState.employees[0]?.status, wasCancelled ? "Active" : "Inactive");
      assert.equal(raceState.users[0]?.status, wasCancelled ? "Active" : "Suspended");
      assert.equal(
        raceState.audits.filter(
          (event) =>
            event.entity_id === racing.caseId &&
            ["cancel", "complete"].includes(String(event.action)),
        ).length,
        1,
        "Only the successful final decision may write a completion/cancellation audit",
      );
    } finally {
      await sql.end();
    }
  },
);
