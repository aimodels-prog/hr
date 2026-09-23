ALTER TABLE google_calendar_connections ADD COLUMN email_enabled_at timestamptz;
--> statement-breakpoint
CREATE TABLE workflow_notification_emails (
  notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  status text NOT NULL DEFAULT 'Queued' CHECK (status IN ('Queued','Sending','Sent','Blocked','Failed','Uncertain','Skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  CHECK (status <> 'Sent' OR (provider_message_id IS NOT NULL AND sent_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX workflow_notification_emails_queue_idx ON workflow_notification_emails(status,next_attempt_at);
--> statement-breakpoint
CREATE INDEX workflow_notification_emails_org_idx ON workflow_notification_emails(organisation_id,status);
