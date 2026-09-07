import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import postgres from "postgres";

import {
  listEmployeeOpportunitiesInDatabase,
  submitEmployeeReferralInDatabase,
  submitInternalApplicationInDatabase,
} from "../src/lib/db/repositories/employee-opportunities.repository.server.ts";

const testDatabaseUrl = process.env["VIA_HR_TEST_DATABASE_URL"]?.trim();
const hasObjectStorage = Boolean(process.env["VIA_HR_OBJECT_STORAGE_ENDPOINT"]?.trim());
if (testDatabaseUrl) process.env["DATABASE_URL"] = testDatabaseUrl;

test(
  "employees can apply and recommend while PostgreSQL preserves scope and pinned referrals",
  { skip: !testDatabaseUrl || !hasObjectStorage },
  async () => {
    assert.match(new URL(testDatabaseUrl!).pathname.slice(1).toLowerCase(), /(test|scratch)/);
    const sql = postgres(testDatabaseUrl!, { max: 1, prepare: false });
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
      const [stored] = await sql`
        SELECT
          ca.internal_applicant_employee_id,
          cr.recommender_employee_id,
          cr.candidate_aware,
          cai.source AS inclusion_source,
          cvr.source AS cv_source,
          (SELECT count(*)::int FROM audit_events
            WHERE entity_id IN (${application.applicationId}, ${referral.recommendationId})) AS audit_count
        FROM candidate_applications ca
        JOIN candidate_recommendations cr ON cr.id = ${referral.recommendationId}
        JOIN candidate_assessment_inclusions cai
          ON cai.candidate_id = cr.candidate_id AND cai.vacancy_id = ${vacancyId}
        JOIN candidate_cv_records cvr ON cvr.application_id = ca.id
        WHERE ca.id = ${application.applicationId}
      `;
      assert.equal(String(stored.internal_applicant_employee_id), String(employee.employee_id));
      assert.equal(String(stored.recommender_employee_id), String(employee.employee_id));
      assert.equal(stored.candidate_aware, true);
      assert.equal(stored.inclusion_source, "Recommended");
      assert.equal(stored.cv_source, "Internal Application");
      assert.equal(Number(stored.audit_count), 2);
    } finally {
      await sql.end();
    }
  },
);
