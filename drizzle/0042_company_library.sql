CREATE TABLE company_library (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL REFERENCES organisations(id),
 family_id uuid NOT NULL, version integer NOT NULL CHECK(version > 0),
 title text NOT NULL, category text NOT NULL, kind text NOT NULL CHECK(kind IN ('Library','Company')),
 audience text NOT NULL CHECK(audience IN ('All staff','HR only')), status text NOT NULL DEFAULT 'Draft',
 processing text NOT NULL DEFAULT 'Not prepared', encrypted_pages text,
 issue_date date, expiry_date date, file_id uuid NOT NULL REFERENCES file_metadata(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, archived_at timestamptz, record_version integer NOT NULL DEFAULT 1,
 CHECK(kind <> 'Company' OR audience='HR only'), CHECK(expiry_date IS NULL OR issue_date IS NULL OR expiry_date >= issue_date),
 UNIQUE(organisation_id,family_id,version)
);
CREATE INDEX company_library_org_idx ON company_library(organisation_id,kind,status);
CREATE UNIQUE INDEX company_library_current_unique ON company_library(organisation_id,family_id) WHERE status='Published';
