-- Retain removed identities to stop automatic rematching, without reserving an employee forever.
DROP INDEX "attendance_device_employee_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_employee_unique" ON "attendance_device_employee_mappings" ("device_id", "employee_id") WHERE "archived_at" IS NULL;
