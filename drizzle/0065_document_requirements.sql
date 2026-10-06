CREATE TABLE document_requirement_settings (
  organisation_id uuid PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  definitions jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
--> statement-breakpoint
ALTER TABLE employee_documents ADD COLUMN requirement_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE employee_documents ADD COLUMN answers_encrypted text;
--> statement-breakpoint
ALTER TABLE employees ADD COLUMN home_country_phone text, ADD COLUMN home_country_address text;
