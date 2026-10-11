ALTER TABLE "vacancies" ADD COLUMN "public_slug" text;
--> statement-breakpoint
-- Keep the reference stable even when a vacancy is renamed or closed. A transaction
-- lock serialises same-organisation allocations, including simultaneous draft saves.
CREATE FUNCTION via_hr_allocate_vacancy_slug(org_id uuid, job_title text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base_slug text;
  candidate_slug text;
  suffix integer := 1;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vacancy-public-slug:' || org_id::text, 0));
  base_slug := trim(both '-' from left(regexp_replace(
    lower(regexp_replace(normalize(job_title, NFKD), U&'[\0300-\036f]', '', 'g')),
    '[^a-z0-9]+', '-', 'g'
  ), 80));
  IF base_slug = '' THEN base_slug := 'role'; END IF;
  -- "applied" is the application receipt page; UUID routes remain legacy links.
  IF base_slug = 'applied' OR base_slug ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
    base_slug := base_slug || '-role';
  END IF;
  candidate_slug := base_slug;
  WHILE EXISTS (
    SELECT 1 FROM vacancies WHERE organisation_id = org_id AND public_slug = candidate_slug
  ) LOOP
    suffix := suffix + 1;
    candidate_slug := base_slug || '-' || suffix::text;
  END LOOP;
  RETURN candidate_slug;
END;
$$;
--> statement-breakpoint
-- Existing vacancies retain their UUIDs and all applications. The first vacancy
-- with a title receives the unsuffixed link; archived links are never recycled.
DO $$
DECLARE vacancy record;
BEGIN
  FOR vacancy IN SELECT id, organisation_id, title FROM vacancies ORDER BY created_at, id LOOP
    UPDATE vacancies
    SET public_slug = via_hr_allocate_vacancy_slug(vacancy.organisation_id, vacancy.title),
        record_version = record_version + 1, updated_at = now()
    WHERE id = vacancy.id;
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER TABLE "vacancies" ALTER COLUMN "public_slug" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "vacancies" ALTER COLUMN "public_slug" SET DEFAULT '';
--> statement-breakpoint
CREATE FUNCTION via_hr_guard_vacancy_slug()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.public_slug := via_hr_allocate_vacancy_slug(NEW.organisation_id, NEW.title);
  ELSIF NEW.public_slug IS DISTINCT FROM OLD.public_slug THEN
    RAISE EXCEPTION 'A vacancy public link cannot be changed.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vacancies_public_slug_guard
BEFORE INSERT OR UPDATE ON vacancies
FOR EACH ROW EXECUTE FUNCTION via_hr_guard_vacancy_slug();
--> statement-breakpoint
CREATE UNIQUE INDEX "vacancies_org_public_slug_unique" ON "vacancies" USING btree ("organisation_id","public_slug");--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_public_slug_valid" CHECK ("vacancies"."public_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "vacancies"."public_slug" <> 'applied');
