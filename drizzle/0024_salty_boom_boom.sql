ALTER TABLE "attendance_device_punches" ADD COLUMN "device_user_name" text;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "via_hr_protect_attendance_device_punch_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.external_event_id IS DISTINCT FROM OLD.external_event_id
     OR NEW.device_user_id IS DISTINCT FROM OLD.device_user_id
     OR NEW.device_user_name IS DISTINCT FROM OLD.device_user_name
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.device_status IS DISTINCT FROM OLD.device_status
     OR NEW.punch_method IS DISTINCT FROM OLD.punch_method
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'terminal punch evidence cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
