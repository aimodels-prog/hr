-- Ministry of Labour: https://www.mol.gov.om/Laborlaw, Article 84(6), (7), (9).
-- Correct statutory policy metadata only. Do not rewrite leave history or balances.
WITH existing AS (
  SELECT id, organisation_id, eligibility AS previous_eligibility,
    jsonb_set(COALESCE(eligibility, '{}'::jsonb), '{omaniOnly}',
      CASE WHEN type = 'Hajj' THEN 'false'::jsonb ELSE 'true'::jsonb END) AS corrected_eligibility
  FROM leave_policies
  WHERE is_statutory = true AND type IN ('Exam', 'AccompanyPatient', 'Hajj')
    AND archived_at IS NULL
), corrected AS (
  UPDATE leave_policies p SET eligibility = e.corrected_eligibility, updated_at = now()
  FROM existing e WHERE p.id = e.id AND p.eligibility IS DISTINCT FROM e.corrected_eligibility
  RETURNING p.id, p.organisation_id, e.previous_eligibility, p.eligibility
)
INSERT INTO audit_events (organisation_id, actor_display_name, active_role, actor_roles,
  action, module, entity_type, entity_id, before_summary, after_summary, reason, risk_level)
SELECT organisation_id, 'VIA policy migration', 'Super Admin', ARRAY['Super Admin'],
  'correct-statutory-nationality', 'leave', 'leave-policy', id,
  jsonb_build_object('eligibility', previous_eligibility), jsonb_build_object('eligibility', eligibility),
  'Align statutory nationality eligibility with Oman Labour Law Article 84(6), (7), (9). Leave history and balances are unchanged.', 'Medium'
FROM corrected;
