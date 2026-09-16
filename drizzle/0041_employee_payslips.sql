CREATE TABLE employee_payslips (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES organisations(id),
 employee_id uuid NOT NULL REFERENCES employees(id),
 pay_month text NOT NULL CHECK (pay_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 file_id uuid NOT NULL REFERENCES file_metadata(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 archived_at timestamptz,
 record_version integer NOT NULL DEFAULT 1
);
CREATE INDEX employee_payslips_org_employee_month_idx ON employee_payslips (organisation_id, employee_id, pay_month);
CREATE UNIQUE INDEX employee_payslips_active_month_unique ON employee_payslips (organisation_id, employee_id, pay_month) WHERE archived_at IS NULL;
