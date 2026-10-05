CREATE TABLE office_exceptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL,
 archived_at timestamptz, record_version integer NOT NULL DEFAULT 1,
 organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
 title text NOT NULL, kind text NOT NULL,
 start_date date NOT NULL, end_date date NOT NULL,
 employee_ids uuid[] NOT NULL, scope_label text NOT NULL,
 daily_hours numeric(5,2) NOT NULL, count_as_worked boolean NOT NULL,
 CONSTRAINT office_exceptions_date_order CHECK(end_date>=start_date),
 CONSTRAINT office_exceptions_hours CHECK(daily_hours>0 AND daily_hours<=24)
);
--> statement-breakpoint
CREATE INDEX office_exceptions_org_dates_idx ON office_exceptions(organisation_id,start_date,end_date);
