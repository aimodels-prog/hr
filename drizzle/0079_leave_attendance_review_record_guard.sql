-- Leave/attendance overlap reviews must keep the same optimistic version and
-- immutable organisation identity guarantees as every other mutable record.
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON leave_attendance_overlap_reviews
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
