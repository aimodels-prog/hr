CREATE TABLE workflow_email_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  delivery_day date NOT NULL,
  topic text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organisation_id, recipient_user_id, delivery_day, topic)
);
--> statement-breakpoint
ALTER TABLE workflow_notification_emails ADD COLUMN digest_id uuid REFERENCES workflow_email_digests(id);
--> statement-breakpoint
CREATE INDEX workflow_notification_emails_digest_idx ON workflow_notification_emails(digest_id);
--> statement-breakpoint
UPDATE app_settings SET additional_settings=jsonb_set(additional_settings, '{reminderRules}',
  coalesce(additional_settings->'reminderRules','{}'::jsonb) || '{"dailyEmailTime":"10:00"}'::jsonb)
WHERE NOT coalesce(additional_settings->'reminderRules','{}'::jsonb) ? 'dailyEmailTime';
