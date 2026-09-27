-- Scheduled changes contain confidential employment decisions and must retain
-- the same tenant immutability and optimistic version guard as other records.
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON scheduled_employment_changes
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
