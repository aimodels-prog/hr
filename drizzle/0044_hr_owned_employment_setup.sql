-- Reassign existing HR-owned fields without removing employee data or documents.
ALTER TABLE employees ADD COLUMN visa_required boolean;
--> statement-breakpoint
UPDATE onboarding_tasks SET owner_role = 'HR', assigned_user_id = NULL,
  updated_at = now(), record_version = record_version + 1
WHERE self_service_form_key = 'employment_details' OR document_type IN ('visa', 'work_permit');
--> statement-breakpoint
-- Release staff who had already finished every employee-owned form before the ownership change.
-- Employment confirmation and leave eligibility remain separate checks.
UPDATE employees e SET profile_setup_status = 'Completed',
  profile_setup_completed_at = COALESCE(profile_setup_completed_at, now()),
  updated_at = now(), record_version = record_version + 1
WHERE e.profile_setup_status <> 'Completed' AND e.archived_at IS NULL
AND EXISTS (
  SELECT 1 FROM onboarding_cases c WHERE c.employee_id = e.id AND c.organisation_id = e.organisation_id
  AND c.status = 'In Progress'
  AND EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.case_id = c.id AND t.owner_role = 'Employee'
    AND t.is_mandatory AND t.archived_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM onboarding_tasks t WHERE t.case_id = c.id AND t.owner_role = 'Employee'
    AND t.is_mandatory AND t.archived_at IS NULL AND t.status NOT IN ('Completed', 'Waived'))
);
