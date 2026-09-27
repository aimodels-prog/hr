CREATE TABLE scheduled_employment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  effective_date date NOT NULL,
  fields text[] NOT NULL,
  encrypted_payload text NOT NULL,
  reason text NOT NULL,
  author_role system_role_code NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  applied_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  archived_at timestamptz,
  record_version integer NOT NULL DEFAULT 1,
  CONSTRAINT scheduled_employment_status_check CHECK (status IN ('Pending','Applied','Cancelled','Needs Review')),
  CONSTRAINT scheduled_employment_reason_check CHECK (length(btrim(reason)) >= 5),
  CONSTRAINT scheduled_employment_fields_check CHECK (cardinality(fields) > 0),
  CONSTRAINT scheduled_employment_applied_check CHECK (status <> 'Applied' OR applied_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX scheduled_employment_due_idx ON scheduled_employment_changes(organisation_id,status,effective_date);
--> statement-breakpoint
CREATE INDEX scheduled_employment_employee_idx ON scheduled_employment_changes(organisation_id,employee_id);
