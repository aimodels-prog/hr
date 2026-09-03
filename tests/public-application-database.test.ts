import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

import { readObjectFile } from "../src/lib/db/object-storage.server.ts";
import { processNextCandidateCvJob } from "../src/lib/db/repositories/candidate-cv-intake.repository.server.ts";
import { submitPublicApplicationToDatabase } from "../src/lib/db/repositories/public-application.repository.server.ts";
import {
  addCandidateRecommendationInDatabase,
  exportCandidatesFromDatabase,
  logCandidateContactInDatabase,
  mergeCandidatesInDatabase,
  reassignCandidateOwnerInDatabase,
  updateCandidateDetailsInDatabase,
  updateCandidateStageInDatabase,
} from "../src/lib/db/repositories/candidate-mutation.repository.server.ts";
import {
  createAssessmentBatchInDatabase,
  finaliseShortlistInDatabase,
  runDetailedAssessmentInDatabase,
} from "../src/lib/db/repositories/recruitment-screening.repository.server.ts";
import {
  createInterviewInDatabase,
  recordInterviewDispositionInDatabase,
  recordManualInterviewOutcomeInDatabase,
  saveInterviewScorecardInDatabase,
  saveInterviewTemplateInDatabase,
  updateInterviewWorkflowInDatabase,
} from "../src/lib/db/repositories/recruitment-interview.repository.server.ts";
import {
  finaliseHiringDecisionInDatabase,
  generateJobOfferDocumentInDatabase,
  prepareManualInterviewHireInDatabase,
  saveJobOfferInDatabase,
  transitionJobOfferInDatabase,
} from "../src/lib/db/repositories/recruitment-offer.repository.server.ts";
import { listPanelInterviewReadSnapshot } from "../src/lib/db/repositories/recruitment-read.repository.server.ts";
import { parseCandidateSpreadsheetInDatabase } from "../src/lib/db/repositories/candidate-spreadsheet.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const hasObjectStorage = Boolean(process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"]?.trim());
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "public application atomically creates the Candidate Pool, CV, queue and audit records",
  { skip: !testDatabaseUrl || !hasObjectStorage },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    try {
      const [seedVacancy] = await sql`
        SELECT id, organisation_id FROM vacancies
        WHERE status = 'Open' AND archived_at IS NULL ORDER BY created_at LIMIT 1
      `;
      assert.ok(seedVacancy, "The test seed must contain an open vacancy.");
      const unique = randomUUID().slice(0, 8);
      const vacancyId = randomUUID();
      await sql`
        INSERT INTO vacancies (
          id, created_by, updated_by, organisation_id, title, department_id, location_id,
          position_id, grade_id, employment_type_id, hiring_manager_id, project_id,
          target_start_date, assigned_owner_id, status, summary, responsibilities, requirements,
          applicant_count, headcount, salary_range_encrypted, salary_visible_to_public,
          hiring_reason, education, minimum_experience, skills, certifications, languages,
          mandatory_criteria, notes, screening_questions
        )
        SELECT
          ${vacancyId}, created_by, updated_by, organisation_id, title || ${` Test ${unique}`},
          department_id, location_id, position_id, grade_id, employment_type_id,
          hiring_manager_id, project_id, target_start_date, assigned_owner_id, 'Open', summary,
          responsibilities, requirements, 0, 1, salary_range_encrypted,
          salary_visible_to_public, hiring_reason, education, minimum_experience, skills,
          certifications, languages, mandatory_criteria, notes, screening_questions
        FROM vacancies WHERE id = ${seedVacancy.id}
      `;
      const vacancy = {
        id: vacancyId,
        organisation_id: String(seedVacancy.organisation_id),
      };
      const cv = new TextEncoder().encode("%PDF-1.7\nVIA HR applicant integration test\n%%EOF");
      const result = await submitPublicApplicationToDatabase(String(vacancy.organisation_id), {
        vacancyId: String(vacancy.id),
        firstName: "Database",
        lastName: "Applicant",
        email: `database.applicant.${unique}@example.test`,
        phone: `+97150${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        location: "Dubai",
        yearsOfExperience: 7,
        noticePeriod: "30 days",
        salaryExpectation: "AED 18,000",
        screeningAnswers: [],
        consent: true,
        fileName: "database-applicant.pdf",
        mimeType: "application/pdf",
        fileBytes: cv,
      });
      assert.match(result.referenceId, /^APP-\d{2}-[A-F0-9]{8}$/);
      const [records] = await sql`
        SELECT
          (SELECT count(*)::int FROM candidates WHERE id = ${result.candidateId}) AS candidate_count,
          (SELECT count(*)::int FROM candidate_applications WHERE id = ${result.applicationId} AND preparation_status = 'Queued') AS application_count,
          (SELECT count(*)::int FROM candidate_cv_records WHERE application_id = ${result.applicationId}) AS cv_count,
          (SELECT count(*)::int FROM candidate_preparation_runs WHERE application_id = ${result.applicationId} AND status = 'Queued') AS queue_count,
          (SELECT count(*)::int FROM audit_events WHERE entity_id = ${result.applicationId} AND action = 'submit') AS audit_count
      `;
      assert.deepEqual(
        [
          records.candidate_count,
          records.application_count,
          records.cv_count,
          records.queue_count,
          records.audit_count,
        ],
        [1, 1, 1, 1, 1],
      );
      const [file] = await sql`
        SELECT fm.id FROM file_metadata fm
        JOIN candidate_applications ca ON ca.cv_file_id = fm.id
        WHERE ca.id = ${result.applicationId}
      `;
      const downloaded = await readObjectFile(
        String(vacancy.organisation_id),
        String(file.id),
        { displayName: "Application integration test", activeRole: "Super Admin" },
        "Verified the public application CV",
      );
      assert.deepEqual(new Uint8Array(downloaded.bytes), cv);
      const [ciphertext] = await sql`
        SELECT salary_expectation_encrypted FROM candidate_applications WHERE id = ${result.applicationId}
      `;
      assert.ok(!String(ciphertext.salary_expectation_encrypted).includes("18,000"));

      const [queuedJob] = await sql`
        SELECT bj.id, bj.status
        FROM background_jobs bj
        JOIN candidate_cv_records cvr ON cvr.id = bj.entity_id
        WHERE cvr.application_id = ${result.applicationId}
          AND bj.job_type = 'candidate-cv-extraction'
      `;
      assert.ok(queuedJob?.id);
      if (queuedJob.status !== "Completed") {
        assert.equal(
          await processNextCandidateCvJob("public-application-database-test", String(queuedJob.id)),
          true,
          "The durable worker should claim and process the queued CV.",
        );
      }
      const [prepared] = await sql`
        SELECT
          ca.preparation_status,
          cvr.processing_status,
          cvr.extracted_fields IS NOT NULL AS has_extracted_fields,
          cpr.preliminary_score
        FROM candidate_applications ca
        JOIN candidate_cv_records cvr ON cvr.application_id = ca.id
        JOIN candidate_preparation_runs cpr ON cpr.application_id = ca.id
        WHERE ca.id = ${result.applicationId}
      `;
      assert.ok(["Ready", "Needs Review"].includes(String(prepared.preparation_status)));
      assert.equal(prepared.processing_status, "Awaiting HR Review");
      assert.equal(prepared.has_extracted_fields, true);
      assert.ok(Number.isFinite(Number(prepared.preliminary_score)));

      const [hr] = await sql`
        SELECT u.id, u.employee_id, u.display_name
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id AND r.code IN ('HR', 'Super Admin')
        WHERE u.organisation_id = ${vacancy.organisation_id} AND u.status = 'Active'
        ORDER BY CASE WHEN r.code = 'HR' THEN 0 ELSE 1 END LIMIT 1
      `;
      assert.ok(hr?.employee_id);
      const actor = {
        userId: String(hr.id),
        employeeId: String(hr.employee_id),
        displayName: String(hr.display_name),
        activeRole: "HR" as const,
        roles: ["Employee", "HR"] as const,
      };
      const importPreview = await parseCandidateSpreadsheetInDatabase(
        String(vacancy.organisation_id),
        {
          fileName: `candidate-import-${unique}.csv`,
          mimeType: "text/csv",
          bytes: Buffer.from(
            "Name,Email,Phone,Position\nPreview Candidate,preview@example.test,+971500000000,Coordinator\n",
          ),
        },
        actor,
      );
      assert.equal(importPreview[0]?.headers[1], "Email");
      assert.equal(importPreview[0]?.rows[0]?.["Name"], "Preview Candidate");
      await updateCandidateDetailsInDatabase(
        String(vacancy.organisation_id),
        result.candidateId,
        {
          email: `database.applicant.${unique}@example.test`,
          phone: `+97150${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          location: "Abu Dhabi",
          yearsOfExperience: 8,
          currentTitle: "Senior Logistics Specialist",
          expectedSalary: "AED 19,500",
        },
        actor,
        "Integration test candidate correction",
      );
      await updateCandidateStageInDatabase(
        String(vacancy.organisation_id),
        result.candidateId,
        "Screened",
        actor,
        "Integration test screening decision",
      );
      await reassignCandidateOwnerInDatabase(
        String(vacancy.organisation_id),
        result.candidateId,
        String(hr.id),
        actor,
        "Integration test ownership",
      );
      await logCandidateContactInDatabase(
        String(vacancy.organisation_id),
        {
          candidateId: result.candidateId,
          channel: "Phone",
          date: new Date().toISOString().slice(0, 10),
          vacancyId: String(vacancy.id),
          outcome: "Interested",
          notes: "Candidate confirmed continued interest.",
        },
        actor,
      );
      await addCandidateRecommendationInDatabase(
        String(vacancy.organisation_id),
        {
          candidateId: result.candidateId,
          vacancyId: String(vacancy.id),
          recommenderType: "External Person",
          recommenderName: "VIA Test Recommender",
          recommenderEmail: "recommender@example.test",
          date: new Date().toISOString().slice(0, 10),
          notes: "Known logistics professional.",
        },
        actor,
      );
      const [assessmentAvailability] = await sql`
        SELECT count(DISTINCT candidate_id)::int AS prepared_count
        FROM candidate_preparation_runs
        WHERE vacancy_id = ${vacancy.id} AND status IN ('Ready', 'Needs Review')
      `;
      const [pinnedAvailability] = await sql`
        SELECT count(DISTINCT candidate_id)::int AS pinned_count
        FROM candidate_assessment_inclusions
        WHERE vacancy_id = ${vacancy.id} AND active = true
      `;
      const assessmentTarget = Math.max(1, Number(pinnedAvailability.pinned_count));
      assert.ok(assessmentTarget <= 10);
      assert.ok(Number(assessmentAvailability.prepared_count) >= assessmentTarget);
      const assessmentBatchId = await createAssessmentBatchInDatabase(
        String(vacancy.organisation_id),
        String(vacancy.id),
        assessmentTarget,
        actor,
      );
      const shortlistId = await runDetailedAssessmentInDatabase(
        String(vacancy.organisation_id),
        assessmentBatchId,
        actor,
      );
      await finaliseShortlistInDatabase(
        String(vacancy.organisation_id),
        shortlistId,
        "On Hold",
        actor,
      );
      const [screening] = await sql`
        SELECT
          (SELECT count(*)::int FROM candidate_assessment_inclusions
            WHERE vacancy_id = ${vacancy.id} AND candidate_id = ${result.candidateId}
              AND source = 'Recommended' AND active = true) AS pinned,
          (SELECT count(*)::int FROM candidate_score_runs
            WHERE assessment_batch_id = ${assessmentBatchId} AND candidate_id = ${result.candidateId}) AS scores,
          (SELECT status FROM shortlist_snapshots WHERE id = ${shortlistId}) AS shortlist_status,
          (SELECT status FROM candidate_applications WHERE id = ${result.applicationId}) AS application_stage
      `;
      assert.deepEqual(
        [
          screening.pinned,
          screening.scores,
          screening.shortlist_status,
          screening.application_stage,
        ],
        [1, 1, "Finalized", "Shortlisted"],
      );
      const interviewTemplateId = await saveInterviewTemplateInDatabase(
        String(vacancy.organisation_id),
        {
          name: `Database interview ${unique}`,
          criteria: [
            {
              id: `criterion-${unique}`,
              name: "Role knowledge",
              description: "Evidence of practical role knowledge",
              requiresEvidence: true,
              weight: 100,
              minimumScore: 3,
              isCritical: true,
            },
          ],
          blindScoring: true,
          vacancyId: String(vacancy.id),
          stageName: "Panel Interview",
          aiDecisionWeight: 40,
          interviewDecisionWeight: 60,
        },
        actor,
      );
      const interviewStart = new Date(
        Date.UTC(2035, 0, 1, 6, 0) + Number.parseInt(unique, 16) * 60_000,
      );
      const interviewEnd = new Date(interviewStart.getTime() + 60 * 60_000);
      const interviewId = await createInterviewInDatabase(
        String(vacancy.organisation_id),
        {
          candidateId: result.candidateId,
          vacancyId: String(vacancy.id),
          templateId: interviewTemplateId,
          source: "Scheduled Recruitment",
          stageName: "Panel Interview",
          durationMinutes: 60,
          panelUserIds: [String(hr.id)],
          location: "VIA Dubai office",
          videoMethod: "Google Meet (connection pending)",
          notes: "Database-backed interview lifecycle test.",
          proposedSlots: [
            {
              startTime: interviewStart.toISOString(),
              endTime: interviewEnd.toISOString(),
              timezone: "Asia/Dubai",
            },
          ],
        },
        actor,
      );
      await updateInterviewWorkflowInDatabase(
        String(vacancy.organisation_id),
        {
          interviewId,
          action: "candidate-accepted",
          slot: {
            startTime: interviewStart.toISOString(),
            endTime: interviewEnd.toISOString(),
            timezone: "Asia/Dubai",
          },
          reason: "Candidate accepted the database test interview time",
        },
        actor,
      );
      await saveInterviewScorecardInDatabase(
        String(vacancy.organisation_id),
        {
          interviewId,
          scores: [
            {
              criterionId: `criterion-${unique}`,
              score: 4,
              evidence: "Candidate provided a detailed relevant operations example.",
            },
          ],
          recommendation: "Yes",
          submit: true,
        },
        actor,
      );
      await updateInterviewWorkflowInDatabase(
        String(vacancy.organisation_id),
        {
          interviewId,
          action: "change-status",
          status: "Completed",
          reason: "Panel interview and required scorecard are complete",
        },
        actor,
      );
      await recordInterviewDispositionInDatabase(
        String(vacancy.organisation_id),
        interviewId,
        {
          outcome: "Recommend for Offer",
          reason: "The completed panel recommends proceeding to an offer.",
        },
        actor,
      );
      const [interviewLifecycle] = await sql`
        SELECT
          (SELECT status FROM interviews WHERE id = ${interviewId}) AS interview_status,
          (SELECT count(*)::int FROM interview_scorecards WHERE interview_id = ${interviewId} AND status = 'Submitted') AS submitted_scorecards,
          (SELECT outcome FROM interview_dispositions WHERE interview_id = ${interviewId}) AS outcome,
          (SELECT stage FROM candidates WHERE id = ${result.candidateId}) AS candidate_stage
      `;
      assert.deepEqual(
        [
          interviewLifecycle.interview_status,
          interviewLifecycle.submitted_scorecards,
          interviewLifecycle.outcome,
          interviewLifecycle.candidate_stage,
        ],
        ["Completed", 1, "Recommend for Offer", "Offer"],
      );
      const panelSnapshot = await listPanelInterviewReadSnapshot(
        String(vacancy.organisation_id),
        String(hr.id),
      );
      assert.ok(panelSnapshot.interviewEvents.some((item) => item.id === interviewId));
      const panelCandidate = panelSnapshot.candidates.find(
        (item) => item.id === result.candidateId,
      );
      assert.equal(panelCandidate?.firstName, "Database");
      assert.equal(panelCandidate?.email, "");
      assert.ok(panelSnapshot.interviewScorecards.some((item) => item.interviewId === interviewId));
      assert.deepEqual(panelSnapshot.jobOffers, []);
      assert.deepEqual(panelSnapshot.candidateRecommendations, []);
      assert.deepEqual(panelSnapshot.candidateContacts, []);

      const [unassignedUser] = await sql`
        SELECT id FROM users
        WHERE organisation_id = ${vacancy.organisation_id}
          AND status = 'Active'
          AND id <> ${hr.id}
        ORDER BY created_at LIMIT 1
      `;
      if (unassignedUser) {
        const unassignedSnapshot = await listPanelInterviewReadSnapshot(
          String(vacancy.organisation_id),
          String(unassignedUser.id),
        );
        assert.ok(!unassignedSnapshot.interviewEvents.some((item) => item.id === interviewId));
        assert.ok(!unassignedSnapshot.candidates.some((item) => item.id === result.candidateId));
      }
      const manualCandidateId = randomUUID();
      await sql`
        INSERT INTO candidates
          (id, created_by, updated_by, organisation_id, first_name, last_name, email, phone,
           location, years_of_experience, stage, do_not_contact)
        VALUES
          (${manualCandidateId}, ${hr.id}, ${hr.id}, ${vacancy.organisation_id},
           'Manual', 'Interviewee', ${`manual.${unique}@example.test`},
           ${`+97156${Math.floor(10_000_000 + Math.random() * 89_999_999)}`},
           'Dubai', 9, 'Interview', false)
      `;
      const manualInterviewId = await createInterviewInDatabase(
        String(vacancy.organisation_id),
        {
          candidateId: manualCandidateId,
          templateId: interviewTemplateId,
          source: "Manual / Offline",
          stageName: "Recorded Interview",
          durationMinutes: 45,
          panelUserIds: [String(hr.id)],
          location: "VIA Dubai office",
          videoMethod: "In person",
          notes: "Interview occurred outside the scheduling workflow.",
          occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
          timezone: "Asia/Dubai",
          positionTitle: "Operations Lead",
        },
        actor,
      );
      await saveInterviewScorecardInDatabase(
        String(vacancy.organisation_id),
        {
          interviewId: manualInterviewId,
          scores: [
            {
              criterionId: `criterion-${unique}`,
              score: 4,
              evidence: "Manual interview evidence met the required role standard.",
            },
          ],
          recommendation: "Yes",
          submit: true,
        },
        actor,
      );
      await recordManualInterviewOutcomeInDatabase(
        String(vacancy.organisation_id),
        manualInterviewId,
        "Selected",
        "Documented interview evidence supports direct hire",
        actor,
      );
      const [directHireOptions] = await sql`
        SELECT
          (SELECT name FROM positions WHERE organisation_id = ${vacancy.organisation_id} AND is_active = true AND archived_at IS NULL ORDER BY order_index LIMIT 1) AS position,
          (SELECT name FROM departments WHERE organisation_id = ${vacancy.organisation_id} AND is_active = true AND archived_at IS NULL ORDER BY order_index LIMIT 1) AS department,
          (SELECT name FROM locations WHERE organisation_id = ${vacancy.organisation_id} AND is_active = true AND archived_at IS NULL ORDER BY order_index LIMIT 1) AS location,
          (SELECT name FROM grades WHERE organisation_id = ${vacancy.organisation_id} AND is_active = true AND archived_at IS NULL ORDER BY order_index LIMIT 1) AS grade,
          (SELECT name FROM employment_types WHERE organisation_id = ${vacancy.organisation_id} AND is_active = true AND archived_at IS NULL ORDER BY order_index LIMIT 1) AS employment_type
      `;
      const directHire = await prepareManualInterviewHireInDatabase(
        String(vacancy.organisation_id),
        manualInterviewId,
        {
          position: String(directHireOptions.position),
          department: String(directHireOptions.department),
          location: String(directHireOptions.location),
          grade: String(directHireOptions.grade),
          employmentType: String(directHireOptions.employment_type),
        },
        "Documented manual interview approved for the controlled offer path",
        actor,
      );
      const [manualHireState] = await sql`
        SELECT
          (SELECT status FROM vacancies WHERE id = ${directHire.vacancyId}) AS vacancy_status,
          (SELECT decision_source FROM hiring_decisions WHERE id = ${directHire.decisionId}) AS decision_source,
          (SELECT vacancy_id FROM interviews WHERE id = ${manualInterviewId}) AS interview_vacancy,
          (SELECT stage FROM candidates WHERE id = ${manualCandidateId}) AS candidate_stage
      `;
      assert.deepEqual(
        [
          manualHireState.vacancy_status,
          manualHireState.decision_source,
          String(manualHireState.interview_vacancy),
          manualHireState.candidate_stage,
        ],
        ["Closed", "Manual Interview", directHire.vacancyId, "Offer"],
      );
      const hiringDecisionId = await finaliseHiringDecisionInDatabase(
        String(vacancy.organisation_id),
        { vacancyId: String(vacancy.id), selectedCandidateId: result.candidateId },
        actor,
      );
      const offerId = await saveJobOfferInDatabase(
        String(vacancy.organisation_id),
        {
          candidateId: result.candidateId,
          vacancyId: String(vacancy.id),
          template: "VIA Standard Employment Offer",
          position: "Logistics Specialist",
          grade: "G6",
          salary: 19_500,
          currency: "AED",
          allowances: "As stated in VIA policy",
          benefits: "Medical insurance and annual leave",
          startDate: "2035-03-01",
          probation: "Six months",
          location: "Dubai",
          conditions: "Subject to employment-document verification",
          responseDeadline: "2035-02-01T12:00:00.000Z",
        },
        actor,
      );
      for (const status of ["Pending Approval", "Approved", "Ready to Send", "Sent"] as const) {
        await transitionJobOfferInDatabase(
          String(vacancy.organisation_id),
          offerId,
          status,
          `Integration test moved the offer to ${status}`,
          actor,
        );
      }
      const conversion = await transitionJobOfferInDatabase(
        String(vacancy.organisation_id),
        offerId,
        "Accepted",
        "Candidate accepted the database-backed offer",
        actor,
      );
      assert.ok(conversion.employeeId && conversion.userId && conversion.onboardingCaseId);
      const offerDocument = await generateJobOfferDocumentInDatabase(
        String(vacancy.organisation_id),
        offerId,
        actor,
      );
      assert.match(offerDocument.content, /Base salary: 19,500 AED/);
      assert.match(offerDocument.fileName, /^Job_Offer_/);
      const [conversionState] = await sql`
        SELECT
          (SELECT status FROM job_offers WHERE id = ${offerId}) AS offer_status,
          (SELECT converted_to_employee_id FROM job_offers WHERE id = ${offerId}) AS offer_employee_id,
          (SELECT converted_to_employee_id FROM candidates WHERE id = ${result.candidateId}) AS candidate_employee_id,
          (SELECT status FROM employees WHERE id = ${conversion.employeeId}) AS employee_status,
          (SELECT count(*)::int FROM users WHERE id = ${conversion.userId} AND employee_id = ${conversion.employeeId}) AS users,
          (SELECT count(*)::int FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${conversion.userId} AND r.code = 'Employee') AS employee_roles,
          (SELECT count(*)::int FROM onboarding_cases WHERE id = ${conversion.onboardingCaseId} AND employee_id = ${conversion.employeeId}) AS onboarding_cases,
          (SELECT count(*)::int FROM audit_events WHERE entity_id = ${hiringDecisionId} AND action = 'finalise') AS decision_audits,
          (SELECT count(*)::int FROM audit_events WHERE entity_id = ${offerId} AND action = 'export') AS offer_exports
      `;
      assert.deepEqual(
        [
          conversionState.offer_status,
          String(conversionState.offer_employee_id),
          String(conversionState.candidate_employee_id),
          conversionState.employee_status,
          conversionState.users,
          conversionState.employee_roles,
          conversionState.onboarding_cases,
          conversionState.decision_audits,
          conversionState.offer_exports,
        ],
        ["Accepted", conversion.employeeId, conversion.employeeId, "Onboarding", 1, 1, 1, 1, 1],
      );
      const csv = await exportCandidatesFromDatabase(
        String(vacancy.organisation_id),
        [result.candidateId],
        actor,
        "Integration test export",
      );
      assert.match(csv, /Database Applicant/);
      assert.doesNotMatch(csv, /18,000/);
      const [mutations] = await sql`
        SELECT
          (SELECT stage FROM candidates WHERE id = ${result.candidateId}) AS stage,
          (SELECT count(*)::int FROM candidate_contacts WHERE candidate_id = ${result.candidateId}) AS contacts,
          (SELECT count(*)::int FROM candidate_recommendations WHERE candidate_id = ${result.candidateId}) AS recommendations,
          (SELECT count(*)::int FROM audit_events WHERE organisation_id = ${vacancy.organisation_id} AND entity_id = ${hr.id} AND action = 'export') AS exports
      `;
      assert.deepEqual(
        [mutations.stage, mutations.contacts, mutations.recommendations],
        ["Hired", 1, 1],
      );
      assert.ok(Number(mutations.exports) >= 1);

      const duplicateId = randomUUID();
      await sql`
        INSERT INTO candidates
          (id, created_by, updated_by, organisation_id, first_name, last_name, email, phone,
           location, years_of_experience, stage, do_not_contact)
        VALUES
          (${duplicateId}, ${hr.id}, ${hr.id}, ${vacancy.organisation_id}, 'Duplicate', 'Applicant',
           ${`duplicate.${unique}@example.test`}, ${`+97155${Math.floor(10_000_000 + Math.random() * 89_999_999)}`},
           'Dubai', 5, 'Sourced', false)
      `;
      await logCandidateContactInDatabase(
        String(vacancy.organisation_id),
        {
          candidateId: duplicateId,
          channel: "Email",
          date: new Date().toISOString().slice(0, 10),
          outcome: "Interested",
          notes: "Duplicate history retained.",
        },
        actor,
      );
      await mergeCandidatesInDatabase(
        String(vacancy.organisation_id),
        result.candidateId,
        duplicateId,
        actor,
        "Confirmed duplicate profile in integration test",
      );
      const [merge] = await sql`
        SELECT
          (SELECT merged_into_id FROM candidates WHERE id = ${duplicateId}) AS merged_into_id,
          (SELECT count(*)::int FROM candidate_contacts WHERE candidate_id = ${result.candidateId}) AS primary_contacts,
          (SELECT count(*)::int FROM audit_events WHERE entity_id = ${duplicateId} AND action = 'merge') AS merge_audits
      `;
      assert.deepEqual(
        [String(merge.merged_into_id), merge.primary_contacts, merge.merge_audits],
        [result.candidateId, 2, 1],
      );
    } finally {
      await sql.end();
    }
  },
);
