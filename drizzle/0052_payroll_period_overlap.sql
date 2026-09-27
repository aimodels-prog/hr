-- The application serialises creation, but the database also protects imports,
-- future writers and concurrent transactions. Existing conflicts must be reviewed,
-- never silently archived or deleted to make a release pass.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_no_active_overlap
  EXCLUDE USING gist (
    organisation_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (archived_at IS NULL);
