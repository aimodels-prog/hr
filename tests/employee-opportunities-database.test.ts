import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import {
  listEmployeeOpportunitiesInDatabase,
  submitEmployeeReferralInDatabase,
  submitInternalApplicationInDatabase,
} from "../src/lib/db/repositories/employee-opportunities.repository.server.ts";
import { reviewEmployeeReferralInDatabase } from "../src/lib/db/repositories/recruitment-referral.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const hasObjectStorage = Boolean(process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"]?.trim());
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "employees can apply and submit referrals for HR review without bypassing screening",
  { skip: !testDatabaseUrl || !hasObjectStorage },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
    const originalFetch = globalThis.fetch;
    const originalProcessorUrl = process.env["VIA_HR_CV_PROCESSOR_URL"];
    try {
      const [employee] = await sql`
        SELECT u.id AS user_id, u.employee_id, u.display_name, u.organisation_id
        FROM users u
        JOIN employees e ON e.id = u.employee_id
        WHERE u.status = 'Active' AND u.archived_at IS NULL
          AND e.status IN ('Active', 'Onboarding') AND e.archived_at IS NULL
          AND e.phone IS NOT NULL AND btrim(e.phone) <> ''
        ORDER BY u.created_at
        LIMIT 1
      `;
      const [seedVacancy] = await sql`
        SELECT * FROM vacancies
        WHERE status = 'Open' AND archived_at IS NULL
          AND organisation_id = ${employee?.organisation_id}
        ORDER BY created_at
        LIMIT 1
      `;
      assert.ok(
        employee?.employee_id,
        "The test seed must contain an active employee with a phone.",
      );
      assert.ok(seedVacancy, "The test seed must contain an open vacancy.");
      const [hrUser] = await sql`
        SELECT DISTINCT u.id AS user_id, u.employee_id, u.display_name
        FROM users u
        JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles r ON r.id = ur.role_id
        WHERE u.organisation_id = ${employee.organisation_id}
          AND u.status = 'Active' AND u.archived_at IS NULL
          AND r.code IN ('HR', 'Super Admin')
        ORDER BY u.id
        LIMIT 1
      `;
      assert.ok(hrUser?.user_id, "The test seed must contain an active HR reviewer.");

      const unique = randomUUID().slice(0, 8);
      const vacancyId = randomUUID();
      await sql`
        INSERT INTO vacancies (
          id, created_by, updated_by, organisation_id, title, department_id, location_id,
          position_id, grade_id, employment_type_id, hiring_manager_id, project_id,
          target_start_date, assigned_owner_id, status, summary, responsibilities, requirements,
          applicant_count, headcount, salary_range_encrypted, salary_visible_to_public,
          hiring_reason, education, minimum_experience, skills, certifications, languages,
          mandatory_criteria, notes, screening_questions, accepts_internal_applications,
          accepts_employee_referrals
        )
        VALUES (
          ${vacancyId}, ${seedVacancy.created_by}, ${seedVacancy.updated_by},
          ${seedVacancy.organisation_id}, ${`${seedVacancy.title} Opportunity ${unique}`},
          ${seedVacancy.department_id}, ${seedVacancy.location_id}, ${seedVacancy.position_id},
          ${seedVacancy.grade_id}, ${seedVacancy.employment_type_id},
          ${seedVacancy.hiring_manager_id}, ${seedVacancy.project_id},
          ${seedVacancy.target_start_date}, ${seedVacancy.assigned_owner_id}, 'Open',
          ${seedVacancy.summary}, ${seedVacancy.responsibilities}, ${seedVacancy.requirements},
          0, 1, ${seedVacancy.salary_range_encrypted}, ${seedVacancy.salary_visible_to_public},
          ${seedVacancy.hiring_reason}, ${seedVacancy.education},
          ${seedVacancy.minimum_experience}, ${seedVacancy.skills},
          ${seedVacancy.certifications}, ${seedVacancy.languages},
          ${seedVacancy.mandatory_criteria}, ${seedVacancy.notes}, '[]'::jsonb, true, true
        )
      `;

      const actor = {
        userId: String(employee.user_id),
        employeeId: String(employee.employee_id),
        displayName: String(employee.display_name),
        activeRole: "Employee" as const,
        roles: ["Employee"] as const,
      };
      const cv = new TextEncoder().encode("%PDF-1.7\nVIA staff opportunity test\n%%EOF");
      const application = await submitInternalApplicationInDatabase(
        String(employee.organisation_id),
        {
          vacancyId,
          noticePeriod: "Available after four weeks",
          coverNote: "I would like to be considered for this position.",
          screeningAnswers: [],
          cv: {
            fileName: `internal-${unique}.pdf`,
            mimeType: "application/pdf",
            bytes: cv,
          },
        },
        actor,
      );
      const referral = await submitEmployeeReferralInDatabase(
        String(employee.organisation_id),
        {
          vacancyId,
          candidate: {
            firstName: "Employee",
            lastName: "Referral",
            email: `employee.referral.${unique}@example.test`,
            phone: `+97150${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
            location: "Dubai",
          },
          relationship: "Former colleague",
          yearsKnown: 4,
          notes: "Strong relevant experience and a reliable professional record.",
          candidateAware: true,
          cv: {
            fileName: `referral-${unique}.pdf`,
            mimeType: "application/pdf",
            bytes: cv,
          },
        },
        actor,
      );

      const snapshot = await listEmployeeOpportunitiesInDatabase(
        String(employee.organisation_id),
        actor,
      );
      assert.ok(snapshot.applications.some((item) => item.id === application.applicationId));
      assert.ok(snapshot.referrals.some((item) => item.id === referral.recommendationId));
      const [storedApplication] = await sql`
        SELECT
          ca.internal_applicant_employee_id,
          cvr.source AS cv_source,
          (SELECT count(*)::int FROM audit_events
            WHERE entity_id IN (${application.applicationId}, ${referral.recommendationId})) AS audit_count
        FROM candidate_applications ca
        JOIN candidate_cv_records cvr ON cvr.application_id = ca.id
        WHERE ca.id = ${application.applicationId}
      `;
      const [storedReferral] = await sql`
        SELECT
          cr.recommender_employee_id,
          cr.candidate_aware,
          cr.review_status,
          cvr.source AS cv_source,
          cvr.processing_status,
          (SELECT count(*)::int FROM candidate_applications
            WHERE candidate_id = cr.candidate_id AND vacancy_id = ${vacancyId}
              AND source = 'Employee Referral' AND archived_at IS NULL) AS application_count,
          (SELECT count(*)::int FROM candidate_assessment_inclusions
            WHERE candidate_id = cr.candidate_id AND vacancy_id = ${vacancyId}
              AND active = true) AS inclusion_count,
          (SELECT count(*)::int FROM candidate_interview_recommendations
            WHERE candidate_id = cr.candidate_id AND vacancy_id = ${vacancyId}
              AND status <> 'Withdrawn') AS interview_recommendation_count
        FROM candidate_recommendations cr
        JOIN candidate_cv_records cvr ON cvr.recommendation_id = cr.id
        WHERE cr.id = ${referral.recommendationId}
      `;
      assert.equal(
        String(storedApplication.internal_applicant_employee_id),
        String(employee.employee_id),
      );
      assert.equal(storedApplication.cv_source, "Internal Application");
      assert.equal(Number(storedApplication.audit_count), 2);
      assert.equal(String(storedReferral.recommender_employee_id), String(employee.employee_id));
      assert.equal(storedReferral.candidate_aware, true);
      assert.equal(storedReferral.review_status, "Pending HR Review");
      assert.equal(storedReferral.cv_source, "Employee Referral");
      assert.equal(storedReferral.processing_status, "Uploaded");
      assert.equal(Number(storedReferral.application_count), 0);
      assert.equal(Number(storedReferral.inclusion_count), 0);
      assert.equal(Number(storedReferral.interview_recommendation_count), 0);

      await sql`
        UPDATE candidate_cv_records
        SET processing_status = 'Ready',
            extracted_fields = ${sql.json({
              skills: ["freight forwarding", "customs clearance"],
              yearsOfExperience: 8,
            })},
            field_confidence = ${sql.json({ skills: 0.95, yearsOfExperience: 0.9 })},
            document_route = 'Searchable PDF'
        WHERE recommendation_id = ${referral.recommendationId}
      `;
      process.env["VIA_HR_CV_PROCESSOR_URL"] = "http://cv-processor.test";
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            score: 84,
            model: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const hrActor = {
        userId: String(hrUser.user_id),
        employeeId: hrUser.employee_id ? String(hrUser.employee_id) : undefined,
        displayName: String(hrUser.display_name),
        activeRole: "HR" as const,
        roles: ["Employee", "HR"] as const,
      };
      await reviewEmployeeReferralInDatabase(
        String(employee.organisation_id),
        {
          recommendationId: referral.recommendationId,
          decision: "Approve",
          reason: "The referral meets the evidence threshold for interview consideration.",
        },
        hrActor,
      );
      const [approved] = await sql`
        SELECT
          cr.review_status,
          (SELECT count(*)::int FROM candidate_applications
            WHERE candidate_id = cr.candidate_id AND vacancy_id = ${vacancyId}
              AND status = 'Shortlisted') AS application_count,
          (SELECT count(*)::int FROM candidate_assessment_inclusions
            WHERE candidate_id = cr.candidate_id AND vacancy_id = ${vacancyId}
              AND source = 'Recommended' AND active = true) AS inclusion_count,
          (SELECT count(*)::int FROM candidate_interview_recommendations
            WHERE candidate_id = cr.candidate_id AND vacancy_id = ${vacancyId}
              AND status = 'Ready to Schedule') AS interview_recommendation_count
        FROM candidate_recommendations cr
        WHERE cr.id = ${referral.recommendationId}
      `;
      assert.equal(approved.review_status, "Approved for Interview");
      assert.equal(Number(approved.application_count), 1);
      assert.equal(Number(approved.inclusion_count), 1);
      assert.equal(Number(approved.interview_recommendation_count), 1);

      const declinedReferral = await submitEmployeeReferralInDatabase(
        String(employee.organisation_id),
        {
          vacancyId,
          candidate: {
            firstName: "Retained",
            lastName: "Candidate",
            email: `retained.candidate.${unique}@example.test`,
            phone: `+97155${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
            location: "Dubai",
          },
          relationship: "Professional contact",
          yearsKnown: 2,
          notes: "Submitted for HR to review without bypassing the standard process.",
          candidateAware: true,
          cv: {
            fileName: `declined-referral-${unique}.pdf`,
            mimeType: "application/pdf",
            bytes: cv,
          },
        },
        actor,
      );
      await reviewEmployeeReferralInDatabase(
        String(employee.organisation_id),
        {
          recommendationId: declinedReferral.recommendationId,
          decision: "Decline",
          reason: "Experience is not aligned with this vacancy.",
        },
        hrActor,
      );
      const [declined] = await sql`
        SELECT
          cr.review_status,
          cr.review_reason,
          (SELECT count(*)::int FROM candidates
            WHERE id = cr.candidate_id AND archived_at IS NULL) AS retained_candidate_count,
          (SELECT count(*)::int FROM candidate_cv_records
            WHERE recommendation_id = cr.id AND archived_at IS NULL) AS retained_cv_count
        FROM candidate_recommendations cr
        WHERE cr.id = ${declinedReferral.recommendationId}
      `;
      assert.equal(declined.review_status, "Declined");
      assert.equal(declined.review_reason, "Experience is not aligned with this vacancy.");
      assert.equal(Number(declined.retained_candidate_count), 1);
      assert.equal(Number(declined.retained_cv_count), 1);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalProcessorUrl === undefined) delete process.env["VIA_HR_CV_PROCESSOR_URL"];
      else process.env["VIA_HR_CV_PROCESSOR_URL"] = originalProcessorUrl;
      await sql.end();
    }
  },
);
