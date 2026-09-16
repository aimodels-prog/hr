CREATE TABLE sick_leave_backdate_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_by_request_id uuid,
  CONSTRAINT sick_backdate_dates_valid CHECK (end_date >= start_date),
  CONSTRAINT sick_backdate_reason_required CHECK (length(btrim(reason)) >= 5)
);
CREATE INDEX sick_backdate_employee_idx ON sick_leave_backdate_permissions (organisation_id, employee_id, start_date, end_date);
