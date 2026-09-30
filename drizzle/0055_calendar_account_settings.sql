UPDATE app_settings s
SET additional_settings = s.additional_settings || jsonb_build_object(
  'calendarOrganiserEmail', COALESCE((SELECT lower(c.account_email) FROM google_calendar_connections c WHERE c.organisation_id=s.organisation_id), 'hr@via-int.com')
)
WHERE NOT (s.additional_settings ? 'calendarOrganiserEmail');
