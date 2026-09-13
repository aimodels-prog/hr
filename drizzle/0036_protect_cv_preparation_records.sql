-- These tables were introduced after the original version/tenant guards.
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON candidate_cv_extractions
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
--> statement-breakpoint
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON candidate_vacancy_matches
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
