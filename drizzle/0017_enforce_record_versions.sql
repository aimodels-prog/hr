CREATE OR REPLACE FUNCTION "via_hr_enforce_record_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.record_version = OLD.record_version THEN
    NEW.record_version := OLD.record_version + 1;
  ELSIF NEW.record_version <> OLD.record_version + 1 THEN
    RAISE EXCEPTION 'record_version must advance by exactly one for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT DISTINCT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'record_version'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS via_hr_record_version_guard ON %I.%I', target.table_schema, target.table_name);
    EXECUTE format(
      'CREATE TRIGGER via_hr_record_version_guard BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version()',
      target.table_schema,
      target.table_name
    );
  END LOOP;
END;
$$;
