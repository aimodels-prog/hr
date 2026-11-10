-- Keep independent review assignments under the same record-version and
-- organisation-identity protections as every other mutable HR record.
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON hr_independent_review_assignments
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
