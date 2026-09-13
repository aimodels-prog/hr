-- A placeholder was not proof of dispatch. Preserve the old record in history and
-- request verification; this migration never sends or resends an email.
WITH corrected AS (
  UPDATE job_offers
  SET status = 'Ready to Send',
      history = history || jsonb_build_array(jsonb_build_object(
        'date', now(), 'actor', 'VIA delivery integrity migration',
        'action', 'Unverified sending status corrected',
        'details', 'Verify previous dispatch and record evidence. Do not automatically resend.',
        'previousSentDate', sent_date, 'previousDeliveryReference', delivery_reference
      )),
      sent_date = NULL, delivery_reference = NULL,
      updated_at = now(), record_version = record_version + 1
  WHERE status = 'Sent' AND delivery_reference LIKE 'pending-google-workspace:%'
    AND archived_at IS NULL
  RETURNING id, organisation_id
)
INSERT INTO audit_events (organisation_id, actor_display_name, action, module, entity_type, entity_id, before_summary, after_summary, reason, risk_level)
SELECT organisation_id, 'VIA delivery integrity migration', 'correct-unverified-delivery', 'recruitment', 'offer', id,
       '{"status":"Sent","delivery":"unverified placeholder"}'::jsonb,
       '{"status":"Ready to Send","evidenceRequired":true}'::jsonb,
       'Preserved previous sending claims in offer history; HR must verify dispatch evidence.', 'High'
FROM corrected;
