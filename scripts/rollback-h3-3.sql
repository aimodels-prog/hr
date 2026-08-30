-- Development/staging rollback for migration 0001_h3_3_modules.
-- This is intentionally transactional and removes the matching Drizzle ledger
-- row so `npm run db:migrate` can reapply H3.3 immediately afterwards.
BEGIN;

SELECT pg_advisory_xact_lock(hashtext('via_hr_h3_3_rollback'));

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM "drizzle"."__drizzle_migrations"
    WHERE "created_at" IN (1788092770627, 1788093308743)
  ) <> 2 THEN
    RAISE EXCEPTION 'Both H3.3 migrations must be recorded as applied before rollback.';
  END IF;
END;
$$;

-- Remove the cross-tenant triggers from H3.2 parent tables before dropping the
-- trigger function. H3.3 tables and their triggers are dropped below.
DO $$
DECLARE
  tenant_trigger record;
BEGIN
  FOR tenant_trigger IN
    SELECT event_object_schema, event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_name LIKE 'via_hr_tenant_%'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      tenant_trigger.trigger_name,
      tenant_trigger.event_object_schema,
      tenant_trigger.event_object_table
    );
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS "via_hr_enforce_same_organisation"();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'document_versions', 'employee_documents', 'employment_changes', 'file_metadata',
    'import_batches', 'profile_change_requests', 'employee_leave_entitlement_overrides',
    'leave_balances', 'leave_policies', 'leave_requests', 'leave_transactions',
    'offboarding_cases', 'offboarding_tasks', 'offboarding_templates', 'onboarding_cases',
    'onboarding_tasks', 'onboarding_templates', 'workflow_tasks', 'candidate_applications',
    'candidate_assessment_batches', 'candidate_assessment_inclusions', 'candidate_contacts',
    'candidate_cv_records', 'candidate_interview_recommendations', 'candidate_preparation_runs',
    'candidate_recommendations', 'candidate_score_runs', 'candidates', 'hiring_decisions',
    'interview_dispositions', 'interview_panelists', 'interview_scorecards',
    'interview_templates', 'interviews', 'job_offers', 'recruitment_documents',
    'shortlist_snapshots', 'vacancies', 'vacancy_versions', 'audit_events', 'notifications',
    'portal_sessions', 'workspace_identity_mappings',
    'performance_cycles', 'performance_reviews', 'review_templates', 'training_assignments',
    'training_courses', 'training_records', 'training_requests', 'training_sessions',
    'attendance_corrections', 'attendance_exception_cases', 'attendance_policies',
    'attendance_records', 'overtime_claims', 'site_visit_requests', 'timesheet_entries',
    'timesheet_periods', 'timesheet_settings', 'timesheets', 'expense_items',
    'payroll_exceptions', 'payroll_inputs', 'payroll_manual_adjustments', 'payroll_periods',
    'reimbursements', 'travel_approvals', 'travel_requests'
  ]
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', table_name);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS "via_hr_reject_audit_mutation"();

DO $$
DECLARE
  type_name text;
BEGIN
  FOREACH type_name IN ARRAY ARRAY[
    'document_status', 'document_type', 'document_visibility', 'file_storage_status',
    'import_batch_status', 'profile_change_request_status', 'leave_accrual_mode',
    'leave_request_status', 'leave_scope', 'leave_transaction_type',
    'offboarding_case_status', 'offboarding_confidentiality', 'offboarding_task_status',
    'onboarding_case_status', 'onboarding_task_status', 'application_status',
    'candidate_consent_status', 'candidate_cv_source', 'candidate_marital_status',
    'candidate_stage', 'contact_channel', 'contact_outcome', 'cv_processing_status',
    'interview_disposition_outcome', 'interview_status', 'job_offer_status',
    'recommender_type', 'scorecard_recommendation', 'vacancy_status', 'visa_status',
    'audit_risk_level', 'notification_priority', 'notification_status',
    'review_cycle_status', 'attendance_correction_status', 'attendance_source',
    'attendance_status', 'overtime_claim_status', 'timesheet_period_status',
    'timesheet_status', 'payroll_period_status', 'travel_approval_state',
    'travel_request_status'
  ]
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', type_name);
  END LOOP;
END;
$$;

DELETE FROM "drizzle"."__drizzle_migrations"
WHERE "created_at" IN (1788092770627, 1788093308743);

COMMIT;
