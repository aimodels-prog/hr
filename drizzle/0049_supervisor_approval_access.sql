-- Repair existing, HR-confirmed reporting assignments only. Never reactivate an
-- account or promote a supervisor named only in an employee's unconfirmed proposal.
WITH granted AS (
  INSERT INTO user_roles (organisation_id, user_id, role_id, assigned_by, reason)
  SELECT u.organisation_id, u.id, r.id, u.organisation_id,
    'Approval access restored for an existing HR-confirmed reporting assignment'
  FROM users u
  JOIN employees manager ON manager.id = u.employee_id AND manager.organisation_id = u.organisation_id
  CROSS JOIN roles r
  WHERE r.code = 'Line Manager'
    AND u.status = 'Active' AND u.archived_at IS NULL
    AND manager.status IN ('Active', 'Probation', 'Notice') AND manager.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees report
      WHERE report.organisation_id = u.organisation_id AND report.line_manager_id = manager.id
        AND report.id <> manager.id AND report.archived_at IS NULL
        AND report.status IN ('Onboarding', 'Active', 'Probation', 'Notice')
        AND report.employment_confirmation_status = 'Confirmed'
    )
  ON CONFLICT DO NOTHING
  RETURNING organisation_id, user_id
)
INSERT INTO audit_events (
  organisation_id, actor_display_name, action, module, entity_type, entity_id,
  after_summary, reason, risk_level
)
SELECT organisation_id, 'Supervisor approval access migration', 'supervisor_access_granted',
  'security', 'user', user_id, '{"addedRole":"Line Manager","source":"0049"}'::jsonb,
  'Restored approval access for an existing HR-confirmed reporting assignment; existing roles retained', 'High'
FROM granted;
