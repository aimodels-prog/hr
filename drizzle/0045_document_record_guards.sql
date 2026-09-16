-- Extend the existing version and tenant guards to the new document modules.
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON employee_payslips
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
--> statement-breakpoint
CREATE TRIGGER via_hr_record_version_guard
BEFORE UPDATE ON company_library
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
