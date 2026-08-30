import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import postgres from "postgres";

import { decryptSensitiveJson, encryptSensitiveJson } from "../src/lib/db/encryption.server.ts";

const originalKeyring = process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
const originalActiveKey = process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];

function configureTestEncryption(): void {
  process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = "recruitment-test-v1";
  process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = JSON.stringify({
    "recruitment-test-v1": randomBytes(32).toString("base64"),
  });
}

afterEach(() => {
  if (originalKeyring === undefined) delete process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"];
  else process.env["VIA_HR_FIELD_ENCRYPTION_KEYS"] = originalKeyring;
  if (originalActiveKey === undefined) {
    delete process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"];
  } else {
    process.env["VIA_HR_ACTIVE_FIELD_ENCRYPTION_KEY_ID"] = originalActiveKey;
  }
});

test(
  "fresh H3.3 database supports recruitment and enforces tenant, encryption and audit controls",
  { skip: !process.env["VIA_HR_TEST_DATABASE_URL"] },
  async () => {
    configureTestEncryption();
    const client = postgres(process.env["VIA_HR_TEST_DATABASE_URL"]!, {
      max: 1,
      prepare: false,
    });
    const ids = Object.fromEntries(
      [
        "actor",
        "org",
        "otherOrg",
        "department",
        "otherDepartment",
        "location",
        "position",
        "grade",
        "employmentType",
        "employee",
        "user",
        "vacancy",
        "document",
        "candidate",
        "application",
        "recommendation",
        "cv",
        "preparation",
        "batch",
        "score",
        "interviewRecommendation",
        "template",
        "interview",
        "offer",
        "audit",
      ].map((name) => [name, randomUUID()]),
    ) as Record<string, string>;
    const salaryRange = { min: 1_800, max: 2_400, currency: "OMR" };
    const expectedSalary = { amount: 2_200, currency: "OMR" };

    try {
      await client.begin(async (tx) => {
        await tx`INSERT INTO organisations (id, created_by, updated_by, name, slug) VALUES
          (${ids.org}, ${ids.actor}, ${ids.actor}, 'VIA Recruitment Test', ${`via-${ids.org}`}),
          (${ids.otherOrg}, ${ids.actor}, ${ids.actor}, 'Other Organisation', ${`other-${ids.otherOrg}`})`;
        await tx`INSERT INTO departments (id, created_by, updated_by, organisation_id, name, code) VALUES
          (${ids.department}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'People Operations', 'PEOPLE'),
          (${ids.otherDepartment}, ${ids.actor}, ${ids.actor}, ${ids.otherOrg}, 'Other Department', 'OTHER')`;
        await tx`INSERT INTO locations (id, created_by, updated_by, organisation_id, name, code) VALUES
          (${ids.location}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Muscat Office', 'MCT')`;
        await tx`INSERT INTO positions (id, created_by, updated_by, organisation_id, name, code, department_id) VALUES
          (${ids.position}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Operations Specialist', 'OPS', ${ids.department})`;
        await tx`INSERT INTO grades (id, created_by, updated_by, organisation_id, name, code) VALUES
          (${ids.grade}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Grade 5', 'G5')`;
        await tx`INSERT INTO employment_types (id, created_by, updated_by, organisation_id, name, code) VALUES
          (${ids.employmentType}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Full-time', 'FT')`;
        await tx`INSERT INTO employees
          (id, created_by, updated_by, organisation_id, employee_number, legal_name, preferred_name, work_email, department_id, position_id, location_id, employment_type_id, start_date, status)
          VALUES (${ids.employee}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'VIA-T001', 'Aisha Al Habsi', 'Aisha', 'aisha.recruitment@via.test', ${ids.department}, ${ids.position}, ${ids.location}, ${ids.employmentType}, '2025-01-01', 'Active')`;
        await tx`INSERT INTO users
          (id, created_by, updated_by, organisation_id, employee_id, display_name, workspace_email, status)
          VALUES (${ids.user}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.employee}, 'Aisha Al Habsi', 'aisha.recruitment@via.test', 'Active')`;

        const roles = await tx<{ code: string }[]>`SELECT roles.code FROM user_roles
          JOIN roles ON roles.id = user_roles.role_id WHERE user_roles.user_id = ${ids.user}`;
        assert.deepEqual(
          roles.map((role) => role.code),
          ["Employee"],
        );

        await tx`INSERT INTO vacancies
          (id, created_by, updated_by, organisation_id, title, department_id, location_id, position_id, grade_id, employment_type_id, hiring_manager_id, assigned_owner_id, status, summary, responsibilities, requirements, headcount, salary_range_encrypted, salary_visible_to_public, hiring_reason, education, minimum_experience, skills, certifications, languages, mandatory_criteria, notes, screening_questions)
          VALUES (${ids.vacancy}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Senior Trade Operations Specialist', ${ids.department}, ${ids.location}, ${ids.position}, ${ids.grade}, ${ids.employmentType}, ${ids.employee}, ${ids.employee}, 'Open', 'Lead compliant international trade operations.', ${tx.json(["Coordinate shipments"])}, ${tx.json(["Five years of experience"])}, 1, ${encryptSensitiveJson(salaryRange)}, true, 'Growth', 'Degree or equivalent', '5 years', ${tx.json({ required: ["Freight forwarding"], preferred: ["GCC customs"] })}, ${tx.json([])}, ${tx.json(["English"])}, ${tx.json(["Valid work eligibility"])}, '', ${tx.json(["Do you hold valid work eligibility?"])})`;
        await tx`INSERT INTO vacancy_versions
          (organisation_id, vacancy_id, version_number, responsibilities, requirements, mandatory_criteria, created_by)
          VALUES (${ids.org}, ${ids.vacancy}, 1, ${tx.json(["Coordinate shipments"])}, ${tx.json(["Five years of experience"])}, ${tx.json(["Valid work eligibility"])}, ${ids.actor})`;
        await tx`INSERT INTO recruitment_documents
          (id, created_by, updated_by, organisation_id, name, mime_type, size, checksum, owner_entity_type, owner_entity_id)
          VALUES (${ids.document}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'candidate-cv.pdf', 'application/pdf', 2048, ${`sha256-${ids.document}`}, 'Candidate', ${ids.candidate})`;
        await tx`INSERT INTO candidates
          (id, created_by, updated_by, organisation_id, first_name, last_name, email, phone, location, years_of_experience, stage, cv_file_id, hr_owner_id, current_salary_encrypted, expected_salary_encrypted)
          VALUES (${ids.candidate}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Mariam', 'Al Balushi', ${`mariam.${ids.candidate}@example.com`}, ${`+968${ids.candidate.replaceAll("-", "").slice(0, 8)}`}, 'Muscat', 7, 'Applied', ${ids.document}, ${ids.employee}, ${encryptSensitiveJson({ amount: 2_000, currency: "OMR" })}, ${encryptSensitiveJson(expectedSalary)})`;
        await tx`INSERT INTO candidate_applications
          (id, created_by, updated_by, organisation_id, reference_id, candidate_id, vacancy_id, status, cv_file_id, notice_period, salary_expectation_encrypted, screening_answers, source, consent_given, consented_at, preparation_status)
          VALUES (${ids.application}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${`VIA-APP-${ids.application}`}, ${ids.candidate}, ${ids.vacancy}, 'New', ${ids.document}, '30 days', ${encryptSensitiveJson(expectedSalary)}, ${tx.json([{ question: "Work eligibility?", answer: "Yes" }])}, 'Careers Portal', true, now(), 'Queued')`;
        await tx`INSERT INTO candidate_recommendations
          (id, created_by, updated_by, organisation_id, candidate_id, vacancy_id, recommender_type, recommender_name, recommender_company, recommender_email, recommender_phone, relationship, date, notes, hr_owner_id, source_outcome)
          VALUES (${ids.recommendation}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.candidate}, ${ids.vacancy}, 'Employee Referral', 'Salim Al Harthy', 'VIA International', 'salim@via.test', '+96890000000', 'Former supervisor', current_date, 'Objective assessment required', ${ids.employee}, 'In Progress')`;
        await tx`INSERT INTO candidate_cv_records
          (id, created_by, updated_by, organisation_id, candidate_id, application_id, vacancy_id, file_id, original_file_name, source, received_at, processing_status, extraction_method, extracted_fields, field_confidence, extraction_warnings, consent_status, recommendation_id)
          VALUES (${ids.cv}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.candidate}, ${ids.application}, ${ids.vacancy}, ${ids.document}, 'candidate-cv.pdf', 'Careers Portal', now(), 'Ready', 'Python Service', ${tx.json({ skills: ["Freight forwarding"] })}, ${tx.json({ skills: 0.96 })}, ${tx.json([])}, 'Confirmed', ${ids.recommendation})`;
        await tx`UPDATE candidates SET latest_cv_record_id = ${ids.cv} WHERE id = ${ids.candidate}`;
        await tx`INSERT INTO candidate_preparation_runs
          (id, created_by, updated_by, organisation_id, vacancy_id, vacancy_record_version, candidate_id, application_id, cv_record_id, cv_file_id, status, document_route, preparation_method, extracted_profile, field_confidence, preliminary_score, band, compulsory_checks, matched_skills, missing_required_skills, evidence, warnings, started_at, completed_at)
          VALUES (${ids.preparation}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, 1, ${ids.candidate}, ${ids.application}, ${ids.cv}, ${ids.document}, 'Ready', 'Searchable PDF', 'Python Service', ${tx.json({ skills: ["Freight forwarding"] })}, ${tx.json({ skills: 0.96 })}, 86, 'Strong Match', ${tx.json([{ criterion: "Work eligibility", status: "Confirmed" }])}, ${tx.json(["Freight forwarding"])}, ${tx.json([])}, ${tx.json(["Seven years of relevant experience"])}, ${tx.json([])}, now() - interval '1 minute', now())`;
        await tx`INSERT INTO candidate_assessment_batches
          (id, created_by, updated_by, organisation_id, vacancy_id, vacancy_record_version, target_size, ranked_candidate_ids, selected_candidate_ids, recommended_candidate_ids, preparation_run_ids, status)
          VALUES (${ids.batch}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, 1, 1, ${tx.json([ids.candidate])}, ${tx.json([ids.candidate])}, ${tx.json([ids.candidate])}, ${tx.json([ids.preparation])}, 'Draft')`;
        await tx`INSERT INTO candidate_assessment_inclusions
          (created_by, updated_by, organisation_id, vacancy_id, candidate_id, cv_record_id, source, reason, active)
          VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, ${ids.candidate}, ${ids.cv}, 'Recommended', 'Recommendation guarantees consideration only', true)`;
        await tx`INSERT INTO candidate_score_runs
          (id, created_by, updated_by, organisation_id, vacancy_id, candidate_id, application_id, cv_record_id, cv_file_id, vacancy_record_version, assessment_batch_id, timestamp, model_rules_version, vacancy_version, overall_score, category_scores, strengths, risks, missing_data, evidence)
          VALUES (${ids.score}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, ${ids.candidate}, ${ids.application}, ${ids.cv}, ${ids.document}, 1, ${ids.batch}, now(), 'via-v1', '1', 88, ${tx.json({ Experience: 90, Location: 90, Profile: 84 })}, ${tx.json(["GCC experience"])}, ${tx.json([])}, ${tx.json([])}, 'Evidence-based assessment')`;
        await tx`INSERT INTO candidate_interview_recommendations
          (id, created_by, updated_by, organisation_id, candidate_id, vacancy_id, application_id, cv_record_id, recommended_by_user_id, reason, assessment_score_id, assessment_source, status)
          VALUES (${ids.interviewRecommendation}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.candidate}, ${ids.vacancy}, ${ids.application}, ${ids.cv}, ${ids.user}, 'Compulsory criteria confirmed', ${ids.score}, 'Automatic Assessment', 'Ready to Schedule')`;
        await tx`UPDATE candidate_applications SET preparation_run_id=${ids.preparation}, assessment_score_id=${ids.score}, hr_interview_recommendation_id=${ids.interviewRecommendation}, status='Shortlisted', preparation_status='Ready' WHERE id=${ids.application}`;
        await tx`INSERT INTO candidate_contacts (created_by, updated_by, organisation_id, candidate_id, channel, date, contacted_by_user_id, vacancy_id, outcome, notes)
          VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.candidate}, 'Phone', current_date, ${ids.user}, ${ids.vacancy}, 'Interview Arranged', 'Availability confirmed')`;
        await tx`INSERT INTO shortlist_snapshots (created_by, updated_by, organisation_id, vacancy_id, target_size, ranked_candidate_ids, selected_candidate_ids, pinned_candidate_ids, overrides, status)
          VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, 1, ${tx.json([ids.candidate])}, ${tx.json([ids.candidate])}, ${tx.json([ids.candidate])}, ${tx.json([])}, 'Finalized')`;
        await tx`INSERT INTO interview_templates (id, created_by, updated_by, organisation_id, name, criteria, blind_scoring, vacancy_id, stage_name, ai_decision_weight, interview_decision_weight)
          VALUES (${ids.template}, ${ids.actor}, ${ids.actor}, ${ids.org}, 'Operations Interview', ${tx.json([])}, true, ${ids.vacancy}, 'Panel', 30, 70)`;
        await tx`INSERT INTO interviews (id, created_by, updated_by, organisation_id, vacancy_id, candidate_id, template_id, source, stage_name, duration_minutes, location, video_method, notes, status, proposed_slots, history)
          VALUES (${ids.interview}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, ${ids.candidate}, ${ids.template}, 'Scheduled Recruitment', 'Panel', 60, 'Google Meet', 'Google Meet', '', 'Completed', ${tx.json([])}, ${tx.json([])})`;
        await tx`INSERT INTO interview_panelists (organisation_id, interview_id, user_id, role) VALUES (${ids.org}, ${ids.interview}, ${ids.user}, 'Panel Chair')`;
        await tx`INSERT INTO interview_scorecards (created_by, updated_by, organisation_id, interview_id, panel_user_id, status, scores, overall_recommendation, submitted_at, revision_history)
          VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.interview}, ${ids.user}, 'Submitted', ${tx.json([])}, 'Strong Yes', now(), ${tx.json([])})`;
        await tx`INSERT INTO interview_dispositions (created_by, updated_by, organisation_id, interview_id, candidate_id, vacancy_id, outcome, reason, future_vacancy_ids, suggested_role_titles, recorded_at, recorded_by_user_id)
          VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.interview}, ${ids.candidate}, ${ids.vacancy}, 'Recommend for Offer', 'Panel evidence supports offer', ${tx.json([])}, ${tx.json([])}, now(), ${ids.user})`;
        await tx`INSERT INTO hiring_decisions (created_by, updated_by, organisation_id, vacancy_id, system_recommended_candidate_id, final_selected_candidate_id, decision_source, interview_id, status)
          VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, ${ids.candidate}, ${ids.candidate}, 'Standard Recruitment', ${ids.interview}, 'Finalized')`;
        await tx`INSERT INTO job_offers (id, created_by, updated_by, organisation_id, candidate_id, vacancy_id, status, template, position, grade, salary_encrypted, currency_encrypted, allowances_encrypted, benefits_encrypted, start_date, probation, location, conditions, history)
          VALUES (${ids.offer}, ${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.candidate}, ${ids.vacancy}, 'Approved', 'VIA Standard', 'Senior Trade Operations Specialist', 'G5', ${encryptSensitiveJson({ amount: 2_300, currency: "OMR" })}, ${encryptSensitiveJson("OMR")}, ${encryptSensitiveJson({ transport: 150 })}, ${encryptSensitiveJson(["Medical insurance"])}, '2026-10-01', 'Three months', 'Muscat', 'Document verification', ${tx.json([])})`;

        const [raw] = await tx<
          {
            salary_range_encrypted: string;
            salary_expectation_encrypted: string;
          }[]
        >`SELECT vacancies.salary_range_encrypted, candidate_applications.salary_expectation_encrypted
          FROM vacancies JOIN candidate_applications ON candidate_applications.vacancy_id=vacancies.id
          WHERE vacancies.id=${ids.vacancy}`;
        assert.ok(raw);
        assert.equal(raw.salary_range_encrypted.includes("2400"), false);
        assert.equal(raw.salary_expectation_encrypted.includes("2200"), false);
        assert.deepEqual(decryptSensitiveJson(raw.salary_range_encrypted), salaryRange);
        assert.deepEqual(decryptSensitiveJson(raw.salary_expectation_encrypted), expectedSalary);

        await assert.rejects(
          tx.savepoint(async (savepoint) => {
            await savepoint`INSERT INTO vacancies (created_by, updated_by, organisation_id, title, department_id, location_id, position_id, grade_id, employment_type_id, status, summary, responsibilities, requirements, hiring_reason, education, minimum_experience, skills, notes)
              VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, 'Cross Tenant', ${ids.otherDepartment}, ${ids.location}, ${ids.position}, ${ids.grade}, ${ids.employmentType}, 'Draft', 'Invalid', '[]', '[]', 'Test', 'Test', 'Test', '{"required":[],"preferred":[]}', '')`;
          }),
          /Cross-organisation reference rejected/,
        );
        await assert.rejects(
          tx.savepoint(async (savepoint) => {
            await savepoint`INSERT INTO candidate_assessment_batches (created_by, updated_by, organisation_id, vacancy_id, vacancy_record_version, target_size, status) VALUES (${ids.actor}, ${ids.actor}, ${ids.org}, ${ids.vacancy}, 1, 11, 'Draft')`;
          }),
          /candidate_assessment_batches_target_size/,
        );

        await tx`INSERT INTO audit_events (id, organisation_id, actor_user_id, actor_employee_id, actor_display_name, active_role, actor_roles, action, module, entity_type, entity_id, after_summary, reason, risk_level, ip_address, user_agent)
          VALUES (${ids.audit}, ${ids.org}, ${ids.user}, ${ids.employee}, 'Aisha Al Habsi', 'HR', ARRAY['Employee','HR'], 'CREATE', 'Recruitment', 'JobOffer', ${ids.offer}, ${tx.json({ status: "Approved" })}, 'Panel decision', 'High', '127.0.0.1', 'VIA integration test')`;
        await assert.rejects(
          tx.savepoint(async (savepoint) => {
            await savepoint`UPDATE audit_events SET reason='tampered' WHERE id=${ids.audit}`;
          }),
          /append-only/,
        );
        await assert.rejects(
          tx.savepoint(async (savepoint) => {
            await savepoint`DELETE FROM audit_events WHERE id=${ids.audit}`;
          }),
          /append-only/,
        );

        const [privileges] = await tx<
          {
            can_insert: boolean;
            can_update: boolean;
            can_delete: boolean;
          }[]
        >`SELECT
          has_table_privilege('via_hr_runtime','audit_events','INSERT') can_insert,
          has_table_privilege('via_hr_runtime','audit_events','UPDATE') can_update,
          has_table_privilege('via_hr_runtime','audit_events','DELETE') can_delete`;
        assert.deepEqual(privileges, { can_insert: true, can_update: false, can_delete: false });

        const [counts] = await tx<Record<string, number>[]>`SELECT
          (SELECT count(*)::int FROM candidate_recommendations WHERE candidate_id=${ids.candidate}) recommendations,
          (SELECT count(*)::int FROM candidate_assessment_inclusions WHERE candidate_id=${ids.candidate}) inclusions,
          (SELECT count(*)::int FROM candidate_contacts WHERE candidate_id=${ids.candidate}) contacts,
          (SELECT count(*)::int FROM interview_dispositions WHERE candidate_id=${ids.candidate}) dispositions,
          (SELECT count(*)::int FROM hiring_decisions WHERE final_selected_candidate_id=${ids.candidate}) decisions,
          (SELECT count(*)::int FROM job_offers WHERE id=${ids.offer}) offers`;
        assert.deepEqual(counts, {
          recommendations: 1,
          inclusions: 1,
          contacts: 1,
          dispositions: 1,
          decisions: 1,
          offers: 1,
        });

        throw new Error("ROLLBACK_H3_3_RECRUITMENT_TEST");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ROLLBACK_H3_3_RECRUITMENT_TEST") {
        throw error;
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  },
);
