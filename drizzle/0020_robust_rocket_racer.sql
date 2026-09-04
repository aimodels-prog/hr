CREATE TYPE "public"."profile_setup_status" AS ENUM('Not Started', 'In Progress', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."staff_entry_type" AS ENUM('New Employee', 'Existing Employee');--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "staff_entry_type" "staff_entry_type";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "profile_setup_status" "profile_setup_status" DEFAULT 'Completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "profile_setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "proposed_line_manager_email" text;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_proposed_manager_email_normalized" CHECK ("employees"."proposed_line_manager_email" IS NULL OR "employees"."proposed_line_manager_email" = lower(btrim("employees"."proposed_line_manager_email")));--> statement-breakpoint
UPDATE "leave_policies"
SET "eligibility" = jsonb_set(COALESCE("eligibility", '{}'::jsonb), '{minimumServiceMonths}', '3'::jsonb, true)
WHERE (lower("code") IN ('a/l', 'al', 'annual') OR lower("name") = 'annual leave')
  AND NOT (COALESCE("eligibility", '{}'::jsonb) ? 'minimumServiceMonths');
