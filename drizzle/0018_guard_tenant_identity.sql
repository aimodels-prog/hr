CREATE OR REPLACE FUNCTION "via_hr_enforce_record_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_jsonb(NEW) ? 'organisation_id'
     AND (to_jsonb(NEW)->>'organisation_id') IS DISTINCT FROM (to_jsonb(OLD)->>'organisation_id') THEN
    RAISE EXCEPTION 'organisation_id cannot be changed for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF NEW.record_version = OLD.record_version THEN
    NEW.record_version := OLD.record_version + 1;
  ELSIF NEW.record_version <> OLD.record_version + 1 THEN
    RAISE EXCEPTION 'record_version must advance by exactly one for %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
