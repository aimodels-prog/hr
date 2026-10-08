-- Existing timesheets, approvals and payroll links are deliberately left untouched.
ALTER TABLE timesheet_settings
  ADD COLUMN period_frequency text NOT NULL DEFAULT 'Monthly';
--> statement-breakpoint
ALTER TABLE timesheet_settings
  ADD CONSTRAINT timesheet_settings_frequency CHECK (period_frequency IN ('Monthly', 'Weekly'));
