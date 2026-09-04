CREATE TYPE "public"."employment_confirmation_status" AS ENUM('Not Submitted', 'Pending HR Review', 'Confirmed', 'Changes Requested');--> statement-breakpoint
CREATE TYPE "public"."onboarding_case_kind" AS ENUM('New Hire Onboarding', 'Employee Record Completion');--> statement-breakpoint
ALTER TYPE "public"."overtime_claim_status" ADD VALUE 'Pending Pre-authorisation' BEFORE 'Pending Manager';--> statement-breakpoint
ALTER TYPE "public"."overtime_claim_status" ADD VALUE 'Pre-authorised' BEFORE 'Pending Manager';--> statement-breakpoint
ALTER TABLE "travel_approvals" DROP CONSTRAINT "travel_approvals_stage";--> statement-breakpoint
ALTER TABLE "travel_requests" DROP CONSTRAINT "travel_requests_pre_authorised_dual_approval";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_confirmation_status" "employment_confirmation_status" DEFAULT 'Confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "employment_review_note" text;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD COLUMN "kind" "onboarding_case_kind" DEFAULT 'New Hire Onboarding' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "probation_duration_months" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD COLUMN "request_kind" text DEFAULT 'Emergency Retrospective' NOT NULL;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD COLUMN "emergency_reason" text;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD COLUMN "authorised_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD COLUMN "pre_authorised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD COLUMN "pre_authorised_by" uuid;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD COLUMN "actual_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_settings" ADD COLUMN "overtime_preauthorisation_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_settings" ADD COLUMN "overtime_max_daily_hours" numeric(5, 2) DEFAULT '4' NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_settings" ADD COLUMN "overtime_max_weekly_hours" numeric(6, 2) DEFAULT '12' NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_settings" ADD COLUMN "overtime_max_monthly_hours" numeric(7, 2) DEFAULT '40' NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD COLUMN "manager_approval_status" "travel_approval_state" DEFAULT 'Pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD COLUMN "manager_notes" text;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD COLUMN "manager_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD COLUMN "manager_approved_by" uuid;--> statement-breakpoint
UPDATE "overtime_claims"
SET "emergency_reason" = "reason"
WHERE "request_kind" = 'Emergency Retrospective' AND btrim(coalesce("emergency_reason", '')) = '';--> statement-breakpoint
UPDATE "travel_requests"
SET "manager_approval_status" = 'Approved',
    "manager_approved_at" = coalesce("pre_authorised_at", "updated_at")
WHERE "status" IN ('Pre-authorised', 'Pending Super Admin Closure', 'Closed');--> statement-breakpoint
UPDATE "onboarding_cases" AS c
SET "kind" = 'Employee Record Completion'
FROM "employees" AS e
WHERE c."employee_id" = e."id" AND e."staff_entry_type" = 'Existing Employee';--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_pre_authorised_by_users_id_fk" FOREIGN KEY ("pre_authorised_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_manager_approved_by_users_id_fk" FOREIGN KEY ("manager_approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_probation_months_range" CHECK ("app_settings"."probation_duration_months" BETWEEN 0 AND 36);--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_request_kind" CHECK ("overtime_claims"."request_kind" IN ('Planned', 'Emergency Retrospective'));--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_emergency_reason" CHECK ("overtime_claims"."request_kind" <> 'Emergency Retrospective' OR btrim(coalesce("overtime_claims"."emergency_reason", '')) <> '');--> statement-breakpoint
ALTER TABLE "timesheet_settings" ADD CONSTRAINT "timesheet_settings_overtime_limits_positive" CHECK ("timesheet_settings"."overtime_max_daily_hours" > 0 AND "timesheet_settings"."overtime_max_weekly_hours" > 0 AND "timesheet_settings"."overtime_max_monthly_hours" > 0);--> statement-breakpoint
ALTER TABLE "travel_approvals" ADD CONSTRAINT "travel_approvals_stage" CHECK ("travel_approvals"."stage" IN ('Manager', 'HR', 'Accounts'));--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_pre_authorised_dual_approval" CHECK ("travel_requests"."status" <> 'Pre-authorised' OR ("travel_requests"."manager_approval_status" = 'Approved' AND "travel_requests"."hr_approval_status" = 'Approved' AND "travel_requests"."accounts_approval_status" = 'Approved' AND "travel_requests"."pre_authorised_at" IS NOT NULL));
