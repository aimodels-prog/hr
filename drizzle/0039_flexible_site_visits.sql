-- Additive: existing scheduled visits preserve their approved attendance times.
ALTER TABLE site_visit_requests ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE site_visit_requests ADD CONSTRAINT site_visit_details_object CHECK (jsonb_typeof(details) = 'object');
