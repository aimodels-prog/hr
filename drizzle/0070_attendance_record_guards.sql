CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON office_exceptions
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
--> statement-breakpoint
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON time_away
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
