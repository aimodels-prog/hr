ALTER TABLE attendance_policies ADD COLUMN break_start text NOT NULL DEFAULT '13:00';
--> statement-breakpoint
ALTER TABLE attendance_policies ADD CONSTRAINT attendance_policies_break_start_format CHECK (break_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
