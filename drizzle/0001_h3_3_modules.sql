CREATE TYPE "public"."document_status" AS ENUM('Pending Verification', 'Valid', 'Rejected', 'Replaced');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('contract', 'passport', 'visa', 'national_id', 'work_permit', 'driving_licence', 'medical', 'education_certificate', 'professional_certificate', 'bank_evidence', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_visibility" AS ENUM('Public', 'Restricted');--> statement-breakpoint
CREATE TYPE "public"."file_storage_status" AS ENUM('Pending Upload', 'Available', 'Quarantined', 'Deleted');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('Uploaded', 'Validating', 'Ready', 'Importing', 'Completed', 'Failed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."profile_change_request_status" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_accrual_mode" AS ENUM('Upfront', 'Monthly', 'Per Pay Period', 'Not Applicable');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('Pending Line Manager', 'Pending HR', 'Pending Super Admin', 'Approved', 'Taken', 'Declined', 'Automatically Refused', 'Cancelled', 'Cancellation Pending', 'Cancellation Approved', 'Amendment Pending Line Manager', 'Amendment Pending HR');--> statement-breakpoint
CREATE TYPE "public"."leave_scope" AS ENUM('Annual', 'Once Per Service', 'Per Event', 'Ledger', 'Not Tracked');--> statement-breakpoint
CREATE TYPE "public"."leave_transaction_type" AS ENUM('Entitlement', 'Carry-Forward', 'Accrual', 'Approved Leave', 'Leave Amendment', 'Cancellation Restoration', 'Expiry', 'Manual Adjustment');--> statement-breakpoint
CREATE TYPE "public"."offboarding_case_status" AS ENUM('In Progress', 'Pending Clearance', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."offboarding_confidentiality" AS ENUM('Standard', 'Restricted');--> statement-breakpoint
CREATE TYPE "public"."offboarding_task_status" AS ENUM('Pending', 'Blocked', 'Completed', 'Waived');--> statement-breakpoint
CREATE TYPE "public"."onboarding_case_status" AS ENUM('In Progress', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."onboarding_task_status" AS ENUM('Pending', 'Blocked', 'Completed', 'Waived');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('New', 'Shortlisted', 'On Hold', 'Interviewing', 'Offered', 'Hired', 'Rejected', 'Withdrawn');--> statement-breakpoint
CREATE TYPE "public"."candidate_consent_status" AS ENUM('Confirmed', 'Privacy Notice Sent', 'Awaiting Confirmation', 'Refused', 'Expired');--> statement-breakpoint
CREATE TYPE "public"."candidate_cv_source" AS ENUM('Careers Portal', 'Direct Email', 'WhatsApp', 'Employee Referral', 'Agency', 'Walk-in', 'HR Upload', 'Other');--> statement-breakpoint
CREATE TYPE "public"."candidate_marital_status" AS ENUM('Single', 'Married', 'Married (With Family)', 'Not Specified');--> statement-breakpoint
CREATE TYPE "public"."candidate_stage" AS ENUM('Sourced', 'Applied', 'Screened', 'Shortlisted', 'Interview', 'Offer', 'Hired', 'On Hold', 'Not Selected', 'Withdrawn', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."contact_channel" AS ENUM('Email', 'Phone', 'LinkedIn', 'In-Person', 'Other');--> statement-breakpoint
CREATE TYPE "public"."contact_outcome" AS ENUM('No Answer', 'Interested', 'Not Interested', 'Follow-up Required', 'Interview Arranged', 'Unavailable', 'Invalid Contact', 'Do Not Contact');--> statement-breakpoint
CREATE TYPE "public"."cv_processing_status" AS ENUM('Uploaded', 'Extracting', 'Awaiting HR Review', 'Ready', 'Processing Failed');--> statement-breakpoint
CREATE TYPE "public"."interview_disposition_outcome" AS ENUM('Proceed to Next Interview', 'Recommend for Offer', 'Future Consideration', 'Recommend for Another Role', 'Place on Hold', 'Do Not Proceed', 'Candidate Withdrew', 'No Show');--> statement-breakpoint
CREATE TYPE "public"."interview_status" AS ENUM('Proposed', 'Awaiting Candidate', 'Scheduled', 'Completed', 'Cancelled', 'No Show');--> statement-breakpoint
CREATE TYPE "public"."job_offer_status" AS ENUM('Draft', 'Pending Approval', 'Approved', 'Ready to Send', 'Sent', 'Accepted', 'Declined', 'Expired', 'Withdrawn');--> statement-breakpoint
CREATE TYPE "public"."recommender_type" AS ENUM('Agency', 'Employee Referral', 'External Person', 'Client', 'Supplier', 'Company');--> statement-breakpoint
CREATE TYPE "public"."scorecard_recommendation" AS ENUM('Strong Yes', 'Yes', 'Unsure', 'No');--> statement-breakpoint
CREATE TYPE "public"."vacancy_status" AS ENUM('Draft', 'Pending Approval', 'Open', 'Paused', 'Closed', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."visa_status" AS ENUM('Own Visa', 'Company Visa', 'Freelance Visa', 'Visit Visa', 'Requires Sponsorship', 'Omani (No Visa Required)', 'Not Applicable', 'Other');--> statement-breakpoint
CREATE TYPE "public"."audit_risk_level" AS ENUM('Low', 'Medium', 'High', 'Critical');--> statement-breakpoint
CREATE TYPE "public"."notification_priority" AS ENUM('Low', 'Normal', 'High', 'Critical');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('Unread', 'Read', 'Dismissed');--> statement-breakpoint
CREATE TYPE "public"."review_cycle_status" AS ENUM('Draft', 'Active', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."attendance_correction_status" AS ENUM('Pending Manager', 'Pending HR', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."attendance_source" AS ENUM('Hardware Terminal', 'Manual Entry', 'Web', 'Import', 'Site Visit Auto');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('Present', 'Absent', 'On Leave', 'Holiday', 'Rest Day', 'Late', 'Missing Punch', 'Correction Pending', 'Corrected');--> statement-breakpoint
CREATE TYPE "public"."overtime_claim_status" AS ENUM('Pending Manager', 'Pending HR', 'Approved', 'Rejected', 'Corrected');--> statement-breakpoint
CREATE TYPE "public"."timesheet_period_status" AS ENUM('Open', 'Closed');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('Draft', 'Pending Manager', 'Pending HR', 'Returned', 'Approved', 'Payroll Locked', 'Corrected');--> statement-breakpoint
CREATE TYPE "public"."payroll_period_status" AS ENUM('Draft', 'Collecting Inputs', 'Exceptions', 'Prepared', 'Approved', 'Locked', 'Exported', 'Corrected');--> statement-breakpoint
CREATE TYPE "public"."travel_approval_state" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."travel_request_status" AS ENUM('Draft', 'Pending HR and Accounts', 'Pre-authorised', 'Pending Super Admin Closure', 'Closed', 'Rejected', 'Withdrawn');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "document_versions_version_positive" CHECK ("document_versions"."version_number" >= 1),
	CONSTRAINT "document_versions_reason_not_blank" CHECK (btrim("document_versions"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"file_id" uuid NOT NULL,
	"document_number_encrypted" text,
	"issue_date" date,
	"expiry_date" date,
	"issuing_authority" text,
	"issuing_country" text,
	"notes" text,
	"visibility" "document_visibility" DEFAULT 'Restricted' NOT NULL,
	"status" "document_status" DEFAULT 'Pending Verification' NOT NULL,
	"rejection_reason" text,
	"replaced_by_id" uuid,
	"assigned_owner_id" uuid,
	"snoozed_until" date,
	"snooze_reason" text,
	"waiver_reason" text,
	CONSTRAINT "employee_documents_date_order" CHECK ("employee_documents"."issue_date" IS NULL OR "employee_documents"."expiry_date" IS NULL OR "employee_documents"."expiry_date" >= "employee_documents"."issue_date"),
	CONSTRAINT "employee_documents_replacement_not_self" CHECK ("employee_documents"."replaced_by_id" IS NULL OR "employee_documents"."replaced_by_id" <> "employee_documents"."id"),
	CONSTRAINT "employee_documents_rejection_reason" CHECK ("employee_documents"."status" <> 'Rejected' OR btrim(coalesce("employee_documents"."rejection_reason", '')) <> ''),
	CONSTRAINT "employee_documents_record_version_positive" CHECK ("employee_documents"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employment_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"reason" text NOT NULL,
	CONSTRAINT "employment_changes_field_not_blank" CHECK (btrim("employment_changes"."field") <> ''),
	CONSTRAINT "employment_changes_reason_not_blank" CHECK (btrim("employment_changes"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "file_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text,
	"storage_key" text,
	"storage_status" "file_storage_status" DEFAULT 'Pending Upload' NOT NULL,
	"owner_entity_type" text NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	CONSTRAINT "file_metadata_name_not_blank" CHECK (btrim("file_metadata"."name") <> ''),
	CONSTRAINT "file_metadata_mime_not_blank" CHECK (btrim("file_metadata"."mime_type") <> ''),
	CONSTRAINT "file_metadata_size_positive" CHECK ("file_metadata"."size" > 0),
	CONSTRAINT "file_metadata_record_version_positive" CHECK ("file_metadata"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"module" text NOT NULL,
	"file_id" uuid,
	"status" "import_batch_status" DEFAULT 'Uploaded' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"rejected_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "import_batches_counts_non_negative" CHECK ("import_batches"."total_rows" >= 0 AND "import_batches"."valid_rows" >= 0 AND "import_batches"."rejected_rows" >= 0),
	CONSTRAINT "import_batches_counts_consistent" CHECK ("import_batches"."valid_rows" + "import_batches"."rejected_rows" <= "import_batches"."total_rows")
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"status" "profile_change_request_status" DEFAULT 'Pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	CONSTRAINT "profile_change_requests_review_consistency" CHECK ("profile_change_requests"."status" = 'Pending' OR ("profile_change_requests"."reviewer_id" IS NOT NULL AND "profile_change_requests"."reviewed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "employee_leave_entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"days" numeric(8, 2) NOT NULL,
	"reason" text NOT NULL,
	"effective_from" date NOT NULL,
	CONSTRAINT "leave_overrides_days_non_negative" CHECK ("employee_leave_entitlement_overrides"."days" >= 0),
	CONSTRAINT "leave_overrides_reason_not_blank" CHECK (btrim("employee_leave_entitlement_overrides"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"balance_days" numeric(8, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "leave_balances_year_range" CHECK ("leave_balances"."leave_year" BETWEEN 2000 AND 2200),
	CONSTRAINT "leave_balances_record_version_positive" CHECK ("leave_balances"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"legal_basis" text,
	"description" text NOT NULL,
	"is_paid" boolean NOT NULL,
	"pay_tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_entitlement_days" numeric(7, 2) DEFAULT '0' NOT NULL,
	"scope" "leave_scope" NOT NULL,
	"accrual_mode" "leave_accrual_mode" NOT NULL,
	"carry_forward_limit" numeric(7, 2) DEFAULT '0' NOT NULL,
	"allow_negative_balance" boolean DEFAULT false NOT NULL,
	"max_negative_balance" numeric(7, 2),
	"requires_attachment" boolean DEFAULT false NOT NULL,
	"requires_handover_contact" boolean DEFAULT true NOT NULL,
	"counts_toward_gratuity" boolean DEFAULT true NOT NULL,
	"eligibility" jsonb,
	"approval_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notice_rules" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_statutory" boolean DEFAULT false NOT NULL,
	"consumes_balance" boolean DEFAULT true NOT NULL,
	CONSTRAINT "leave_policies_name_not_blank" CHECK (btrim("leave_policies"."name") <> ''),
	CONSTRAINT "leave_policies_code_not_blank" CHECK (btrim("leave_policies"."code") <> ''),
	CONSTRAINT "leave_policies_entitlement_non_negative" CHECK ("leave_policies"."base_entitlement_days" >= 0),
	CONSTRAINT "leave_policies_carry_non_negative" CHECK ("leave_policies"."carry_forward_limit" >= 0),
	CONSTRAINT "leave_policies_negative_balance_consistency" CHECK (("leave_policies"."allow_negative_balance" AND "leave_policies"."max_negative_balance" IS NOT NULL AND "leave_policies"."max_negative_balance" >= 0) OR (NOT "leave_policies"."allow_negative_balance" AND "leave_policies"."max_negative_balance" IS NULL)),
	CONSTRAINT "leave_policies_statutory_enabled" CHECK (NOT "leave_policies"."is_statutory" OR "leave_policies"."is_enabled"),
	CONSTRAINT "leave_policies_record_version_positive" CHECK ("leave_policies"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"working_days_requested" numeric(7, 2) NOT NULL,
	"reason" text NOT NULL,
	"handover_contact_id" uuid,
	"attachment_file_id" uuid,
	"status" "leave_request_status" NOT NULL,
	"refusal_reason" text,
	"cancellation_reason" text,
	"pending_amendment" jsonb,
	"amendment_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sick_pay_tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chain_approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	CONSTRAINT "leave_requests_date_order" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_days_positive" CHECK ("leave_requests"."working_days_requested" > 0),
	CONSTRAINT "leave_requests_reason_not_blank" CHECK (btrim("leave_requests"."reason") <> ''),
	CONSTRAINT "leave_requests_automatic_refusal_reason" CHECK ("leave_requests"."status" <> 'Automatically Refused' OR btrim(coalesce("leave_requests"."refusal_reason", '')) <> ''),
	CONSTRAINT "leave_requests_record_version_positive" CHECK ("leave_requests"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "leave_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"date" date NOT NULL,
	"transaction_type" "leave_transaction_type" NOT NULL,
	"days" numeric(8, 2) NOT NULL,
	"reason" text NOT NULL,
	"reference_id" uuid,
	"actor_user_id" uuid NOT NULL,
	CONSTRAINT "leave_transactions_days_non_zero" CHECK ("leave_transactions"."days" <> 0),
	CONSTRAINT "leave_transactions_reason_not_blank" CHECK (btrim("leave_transactions"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "offboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"template_id" uuid,
	"reason_category" text NOT NULL,
	"notice_date" date NOT NULL,
	"last_working_date" date NOT NULL,
	"confidentiality_level" "offboarding_confidentiality" DEFAULT 'Standard' NOT NULL,
	"confidential_notes_encrypted" text,
	"rehire_eligible" boolean DEFAULT false NOT NULL,
	"status" "offboarding_case_status" DEFAULT 'In Progress' NOT NULL,
	"progress_percentage" integer DEFAULT 0 NOT NULL,
	"financial_clearance_at" timestamp with time zone,
	"financial_clearance_by" uuid,
	"legal_clearance_at" timestamp with time zone,
	"legal_clearance_by" uuid,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"assigned_hr_id" uuid,
	CONSTRAINT "offboarding_cases_date_order" CHECK ("offboarding_cases"."last_working_date" >= "offboarding_cases"."notice_date"),
	CONSTRAINT "offboarding_cases_progress_range" CHECK ("offboarding_cases"."progress_percentage" BETWEEN 0 AND 100),
	CONSTRAINT "offboarding_cases_restricted_notes" CHECK ("offboarding_cases"."confidentiality_level" <> 'Restricted' OR btrim(coalesce("offboarding_cases"."confidential_notes_encrypted", '')) <> ''),
	CONSTRAINT "offboarding_cases_finalization_consistency" CHECK ("offboarding_cases"."status" <> 'Completed' OR ("offboarding_cases"."finalized_at" IS NOT NULL AND "offboarding_cases"."finalized_by" IS NOT NULL AND "offboarding_cases"."financial_clearance_at" IS NOT NULL AND "offboarding_cases"."legal_clearance_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "offboarding_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"template_task_id" text,
	"title" text NOT NULL,
	"task_group" text NOT NULL,
	"owner_role" "system_role_code" NOT NULL,
	"assigned_user_id" uuid,
	"due_date" date NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"requires_evidence" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"depends_on_task_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" "offboarding_task_status" DEFAULT 'Pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"evidence_file_id" uuid,
	"waiver_reason" text,
	CONSTRAINT "offboarding_tasks_title_not_blank" CHECK (btrim("offboarding_tasks"."title") <> ''),
	CONSTRAINT "offboarding_tasks_completion_consistency" CHECK ("offboarding_tasks"."status" <> 'Completed' OR ("offboarding_tasks"."completed_at" IS NOT NULL AND "offboarding_tasks"."completed_by" IS NOT NULL)),
	CONSTRAINT "offboarding_tasks_waiver_reason" CHECK ("offboarding_tasks"."status" <> 'Waived' OR btrim(coalesce("offboarding_tasks"."waiver_reason", '')) <> '')
);
--> statement-breakpoint
CREATE TABLE "offboarding_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"departments" uuid[] DEFAULT '{}' NOT NULL,
	"employment_types" uuid[] DEFAULT '{}' NOT NULL,
	"template_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "offboarding_templates_name_not_blank" CHECK (btrim("offboarding_templates"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "onboarding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"template_id" uuid,
	"status" "onboarding_case_status" DEFAULT 'In Progress' NOT NULL,
	"progress_percentage" integer DEFAULT 0 NOT NULL,
	"is_ready_for_start_date" boolean DEFAULT false NOT NULL,
	"assigned_hr_id" uuid,
	CONSTRAINT "onboarding_cases_progress_range" CHECK ("onboarding_cases"."progress_percentage" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "onboarding_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"template_task_id" text,
	"title" text NOT NULL,
	"task_group" text NOT NULL,
	"checkpoint" text NOT NULL,
	"owner_role" "system_role_code" NOT NULL,
	"assigned_user_id" uuid,
	"offset_days_from_start" integer,
	"due_date" date NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"requires_evidence" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"depends_on_task_ids" uuid[] DEFAULT '{}' NOT NULL,
	"self_service_form_key" text,
	"document_type" text,
	"verification_document_type" text,
	"requires_bank_details" boolean DEFAULT false NOT NULL,
	"status" "onboarding_task_status" DEFAULT 'Pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"evidence_file_id" uuid,
	"waiver_reason" text,
	CONSTRAINT "onboarding_tasks_title_not_blank" CHECK (btrim("onboarding_tasks"."title") <> ''),
	CONSTRAINT "onboarding_tasks_completion_consistency" CHECK ("onboarding_tasks"."status" <> 'Completed' OR ("onboarding_tasks"."completed_at" IS NOT NULL AND "onboarding_tasks"."completed_by" IS NOT NULL)),
	CONSTRAINT "onboarding_tasks_waiver_reason" CHECK ("onboarding_tasks"."status" <> 'Waived' OR btrim(coalesce("onboarding_tasks"."waiver_reason", '')) <> ''),
	CONSTRAINT "onboarding_tasks_evidence_consistency" CHECK (NOT ("onboarding_tasks"."requires_evidence" AND "onboarding_tasks"."status" = 'Completed') OR "onboarding_tasks"."evidence_file_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "onboarding_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"legal_entities" text[] DEFAULT '{}' NOT NULL,
	"departments" uuid[] DEFAULT '{}' NOT NULL,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"employment_types" uuid[] DEFAULT '{}' NOT NULL,
	"template_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "onboarding_templates_name_not_blank" CHECK (btrim("onboarding_templates"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"module" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"assigned_role" "system_role_code",
	"status" text DEFAULT 'Open' NOT NULL,
	"priority" text DEFAULT 'Normal' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_tasks_title_not_blank" CHECK (btrim("workflow_tasks"."title") <> ''),
	CONSTRAINT "workflow_tasks_status" CHECK ("workflow_tasks"."status" IN ('Open', 'In Progress', 'Completed', 'Cancelled')),
	CONSTRAINT "workflow_tasks_priority" CHECK ("workflow_tasks"."priority" IN ('Low', 'Normal', 'High', 'Critical')),
	CONSTRAINT "workflow_tasks_assignment_present" CHECK ("workflow_tasks"."assigned_user_id" IS NOT NULL OR "workflow_tasks"."assigned_role" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "candidate_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reference_id" text NOT NULL,
	"candidate_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"status" "application_status" NOT NULL,
	"cv_file_id" uuid NOT NULL,
	"cover_note" text,
	"notice_period" text NOT NULL,
	"salary_expectation_encrypted" text,
	"screening_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"consent_given" boolean DEFAULT false NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"hr_interview_recommendation_id" uuid,
	"assessment_score_id" uuid,
	"preparation_run_id" uuid,
	"preparation_status" text,
	"screening_decision" text,
	CONSTRAINT "candidate_applications_reference_not_blank" CHECK (btrim("candidate_applications"."reference_id") <> ''),
	CONSTRAINT "candidate_applications_record_version_positive" CHECK ("candidate_applications"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "candidate_assessment_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"vacancy_record_version" integer NOT NULL,
	"target_size" integer NOT NULL,
	"ranked_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hr_added_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preparation_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detailed_score_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "candidate_assessment_batches_target_size" CHECK ("candidate_assessment_batches"."target_size" >= 1 AND "candidate_assessment_batches"."target_size" <= 10)
);
--> statement-breakpoint
CREATE TABLE "candidate_assessment_inclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"cv_record_id" uuid NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"channel" "contact_channel" NOT NULL,
	"date" date NOT NULL,
	"contacted_by_user_id" uuid NOT NULL,
	"vacancy_id" uuid,
	"outcome" "contact_outcome" NOT NULL,
	"notes" text NOT NULL,
	"next_follow_up_date" date
);
--> statement-breakpoint
CREATE TABLE "candidate_cv_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidate_id" uuid,
	"application_id" uuid,
	"vacancy_id" uuid,
	"file_id" uuid NOT NULL,
	"original_file_name" text NOT NULL,
	"source" "candidate_cv_source" NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processing_status" "cv_processing_status" NOT NULL,
	"extraction_method" text NOT NULL,
	"extracted_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extraction_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consent_status" "candidate_consent_status" NOT NULL,
	"notes" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"recommendation_pending" boolean,
	"recommendation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "candidate_interview_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"cv_record_id" uuid,
	"recommended_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"assessment_score_id" uuid,
	"assessment_source" text,
	"screening_decision" text,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_preparation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"vacancy_record_version" integer NOT NULL,
	"candidate_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"cv_record_id" uuid NOT NULL,
	"cv_file_id" uuid NOT NULL,
	"cv_checksum" text,
	"status" text NOT NULL,
	"document_route" text NOT NULL,
	"preparation_method" text NOT NULL,
	"extracted_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preliminary_score" numeric,
	"band" text,
	"compulsory_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reused_from_preparation_run_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	CONSTRAINT "candidate_preparation_runs_score_range" CHECK ("candidate_preparation_runs"."preliminary_score" IS NULL OR ("candidate_preparation_runs"."preliminary_score" >= 0 AND "candidate_preparation_runs"."preliminary_score" <= 100)),
	CONSTRAINT "candidate_preparation_runs_date_order" CHECK ("candidate_preparation_runs"."started_at" IS NULL OR "candidate_preparation_runs"."completed_at" IS NULL OR "candidate_preparation_runs"."started_at" <= "candidate_preparation_runs"."completed_at")
);
--> statement-breakpoint
CREATE TABLE "candidate_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"vacancy_id" uuid,
	"recommender_type" "recommender_type" NOT NULL,
	"recommender_name" text NOT NULL,
	"recommender_company" text,
	"recommender_position" text,
	"recommender_email" text NOT NULL,
	"recommender_phone" text,
	"relationship" text,
	"date" date NOT NULL,
	"notes" text NOT NULL,
	"hr_owner_id" uuid NOT NULL,
	"commercial_terms" text,
	"source_outcome" text NOT NULL,
	"employee_id" uuid
);
--> statement-breakpoint
CREATE TABLE "candidate_score_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"application_id" uuid,
	"cv_record_id" uuid,
	"cv_file_id" uuid,
	"vacancy_record_version" integer,
	"assessment_batch_id" uuid,
	"timestamp" timestamp with time zone NOT NULL,
	"model_rules_version" text NOT NULL,
	"vacancy_version" text NOT NULL,
	"overall_score" numeric NOT NULL,
	"category_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" text NOT NULL,
	CONSTRAINT "candidate_score_runs_positive" CHECK ("candidate_score_runs"."overall_score" >= 0 AND "candidate_score_runs"."overall_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"nationality" text,
	"location" text NOT NULL,
	"current_company" text,
	"current_title" text,
	"linked_in_url" text,
	"cv_file_id" uuid,
	"years_of_experience" integer DEFAULT 0 NOT NULL,
	"stage" "candidate_stage" NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"hr_owner_id" uuid,
	"recommender" text,
	"visa_status" "visa_status",
	"marital_status" "candidate_marital_status",
	"last_contact_at" timestamp with time zone,
	"follow_up_status" text,
	"source" text,
	"ai_score_range" text,
	"project_id" uuid,
	"project_name" text,
	"project_type" text,
	"shortlist_status" text,
	"tracker_status" text,
	"notice_period" text,
	"current_salary_encrypted" text,
	"expected_salary_encrypted" text,
	"accepted_salary_encrypted" text,
	"interview_date" date,
	"remarks" text,
	"import_provenance" text,
	"original_import_values" jsonb,
	"converted_to_employee_id" uuid,
	"merged_into_id" uuid,
	"skills" jsonb,
	"education" jsonb,
	"certifications" jsonb,
	"languages" jsonb,
	"availability" text,
	"work_eligibility" text,
	"talent_pools" jsonb,
	"consent_status" "candidate_consent_status",
	"consent_updated_at" timestamp with time zone,
	"latest_cv_record_id" uuid,
	CONSTRAINT "candidates_email_normalized" CHECK ("candidates"."email" = lower(btrim("candidates"."email"))),
	CONSTRAINT "candidates_experience_non_negative" CHECK ("candidates"."years_of_experience" >= 0),
	CONSTRAINT "candidates_merge_not_self" CHECK ("candidates"."merged_into_id" IS NULL OR "candidates"."merged_into_id" <> "candidates"."id"),
	CONSTRAINT "candidates_record_version_positive" CHECK ("candidates"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "hiring_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"system_recommended_candidate_id" uuid,
	"final_selected_candidate_id" uuid NOT NULL,
	"override_reason" text,
	"waiver_reason" text,
	"decision_source" text,
	"interview_id" uuid,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"vacancy_id" uuid,
	"outcome" "interview_disposition_outcome" NOT NULL,
	"reason" text NOT NULL,
	"future_vacancy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_role_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by_user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_panelists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text
);
--> statement-breakpoint
CREATE TABLE "interview_scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"panel_user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overall_recommendation" "scorecard_recommendation",
	"submitted_at" timestamp with time zone,
	"revision_history" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blind_scoring" boolean DEFAULT false NOT NULL,
	"vacancy_id" uuid,
	"stage_name" text,
	"ai_decision_weight" numeric DEFAULT '0' NOT NULL,
	"interview_decision_weight" numeric DEFAULT '100' NOT NULL,
	CONSTRAINT "interview_templates_weights" CHECK ("interview_templates"."ai_decision_weight" >= 0 AND "interview_templates"."ai_decision_weight" <= 100 AND "interview_templates"."interview_decision_weight" >= 0 AND "interview_templates"."interview_decision_weight" <= 100 AND "interview_templates"."ai_decision_weight" + "interview_templates"."interview_decision_weight" = 100)
);
--> statement-breakpoint
CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid,
	"candidate_id" uuid NOT NULL,
	"template_id" uuid,
	"source" text,
	"position_title" text,
	"project_name" text,
	"occurred_at" timestamp with time zone,
	"manual_outcome" text,
	"manual_decision_reason" text,
	"stage_name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"location" text NOT NULL,
	"video_method" text NOT NULL,
	"notes" text NOT NULL,
	"status" "interview_status" NOT NULL,
	"confirmed_slot" jsonb,
	"proposed_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calendar_event_reference" text,
	"meeting_reference" text,
	"meeting_join_url" text,
	"invitation_delivery_references" jsonb,
	"candidate_response_status" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "interviews_duration_positive" CHECK ("interviews"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "job_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"status" "job_offer_status" NOT NULL,
	"template" text NOT NULL,
	"position" text NOT NULL,
	"grade" text NOT NULL,
	"salary_encrypted" text NOT NULL,
	"currency_encrypted" text NOT NULL,
	"allowances_encrypted" text NOT NULL,
	"benefits_encrypted" text NOT NULL,
	"start_date" date NOT NULL,
	"probation" text NOT NULL,
	"location" text NOT NULL,
	"conditions" text NOT NULL,
	"sent_date" timestamp with time zone,
	"delivery_reference" text,
	"response_deadline" timestamp with time zone,
	"decline_reason" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"converted_to_employee_id" uuid,
	CONSTRAINT "job_offers_salary_not_blank" CHECK (btrim("job_offers"."salary_encrypted") <> ''),
	CONSTRAINT "job_offers_currency_not_blank" CHECK (btrim("job_offers"."currency_encrypted") <> ''),
	CONSTRAINT "job_offers_response_after_sent" CHECK ("job_offers"."response_deadline" IS NULL OR "job_offers"."sent_date" IS NULL OR "job_offers"."response_deadline" >= "job_offers"."sent_date"),
	CONSTRAINT "job_offers_record_version_positive" CHECK ("job_offers"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "recruitment_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"checksum" text,
	"owner_entity_type" text NOT NULL,
	"owner_entity_id" uuid NOT NULL,
	CONSTRAINT "recruitment_documents_name_not_blank" CHECK (btrim("recruitment_documents"."name") <> ''),
	CONSTRAINT "recruitment_documents_mime_not_blank" CHECK (btrim("recruitment_documents"."mime_type") <> ''),
	CONSTRAINT "recruitment_documents_size_positive" CHECK ("recruitment_documents"."size" > 0),
	CONSTRAINT "recruitment_documents_record_version_positive" CHECK ("recruitment_documents"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "shortlist_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"target_size" integer NOT NULL,
	"ranked_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned_candidate_ids" jsonb,
	"unselected_action" text,
	"overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "shortlist_snapshots_size_check" CHECK ("shortlist_snapshots"."target_size" >= 1 AND "shortlist_snapshots"."target_size" <= 10)
);
--> statement-breakpoint
CREATE TABLE "vacancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"employment_type_id" uuid NOT NULL,
	"hiring_manager_id" uuid,
	"project_id" uuid,
	"target_start_date" date,
	"assigned_owner_id" uuid,
	"status" "vacancy_status" NOT NULL,
	"summary" text NOT NULL,
	"responsibilities" jsonb NOT NULL,
	"requirements" jsonb NOT NULL,
	"applicant_count" integer DEFAULT 0 NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"salary_range_encrypted" text,
	"salary_visible_to_public" boolean DEFAULT false NOT NULL,
	"hiring_reason" text NOT NULL,
	"education" text NOT NULL,
	"minimum_experience" text NOT NULL,
	"skills" jsonb NOT NULL,
	"certifications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mandatory_criteria" jsonb,
	"notes" text DEFAULT '' NOT NULL,
	"screening_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "vacancies_title_not_blank" CHECK (btrim("vacancies"."title") <> ''),
	CONSTRAINT "vacancies_applicant_count_non_negative" CHECK ("vacancies"."applicant_count" >= 0),
	CONSTRAINT "vacancies_headcount_positive" CHECK ("vacancies"."headcount" > 0),
	CONSTRAINT "vacancies_public_salary_requires_value" CHECK (NOT "vacancies"."salary_visible_to_public" OR "vacancies"."salary_range_encrypted" IS NOT NULL),
	CONSTRAINT "vacancies_record_version_positive" CHECK ("vacancies"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "vacancy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"responsibilities" jsonb NOT NULL,
	"requirements" jsonb NOT NULL,
	"mandatory_criteria" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "vacancy_versions_version_positive" CHECK ("vacancy_versions"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_employee_id" uuid,
	"actor_display_name" text NOT NULL,
	"active_role" text,
	"actor_roles" text[] DEFAULT '{}' NOT NULL,
	"session_id" uuid,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before_summary" jsonb,
	"after_summary" jsonb,
	"reason" text,
	"risk_level" "audit_risk_level" DEFAULT 'Low' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "audit_events_actor_name_not_blank" CHECK (btrim("audit_events"."actor_display_name") <> ''),
	CONSTRAINT "audit_events_action_not_blank" CHECK (btrim("audit_events"."action") <> ''),
	CONSTRAINT "audit_events_module_not_blank" CHECK (btrim("audit_events"."module") <> ''),
	CONSTRAINT "audit_events_entity_type_not_blank" CHECK (btrim("audit_events"."entity_type") <> '')
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"priority" "notification_priority" DEFAULT 'Normal' NOT NULL,
	"status" "notification_status" DEFAULT 'Unread' NOT NULL,
	"due_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"deduplication_key" text,
	"link" jsonb,
	CONSTRAINT "notifications_title_not_blank" CHECK (btrim("notifications"."title") <> ''),
	CONSTRAINT "notifications_message_not_blank" CHECK (btrim("notifications"."message") <> ''),
	CONSTRAINT "notifications_read_consistency" CHECK ("notifications"."status" <> 'Read' OR "notifications"."read_at" IS NOT NULL),
	CONSTRAINT "notifications_dismissed_consistency" CHECK ("notifications"."status" <> 'Dismissed' OR "notifications"."dismissed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "performance_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid NOT NULL,
	"status" "review_cycle_status" DEFAULT 'Draft' NOT NULL,
	"departments" uuid[] DEFAULT '{}' NOT NULL,
	"employment_types" uuid[] DEFAULT '{}' NOT NULL,
	"self_assessment_deadline" date NOT NULL,
	"manager_review_deadline" date NOT NULL,
	"discussion_deadline" date NOT NULL,
	"objective_setting_deadline" date,
	"requires_moderation" boolean DEFAULT false NOT NULL,
	"employee_can_see_manager_ratings" boolean,
	CONSTRAINT "performance_cycles_name_not_blank" CHECK (btrim("performance_cycles"."name") <> ''),
	CONSTRAINT "performance_cycles_deadline_order" CHECK ("performance_cycles"."self_assessment_deadline" <= "performance_cycles"."manager_review_deadline" AND "performance_cycles"."manager_review_deadline" <= "performance_cycles"."discussion_deadline"),
	CONSTRAINT "performance_cycles_objective_deadline_order" CHECK ("performance_cycles"."objective_setting_deadline" IS NULL OR "performance_cycles"."objective_setting_deadline" <= "performance_cycles"."self_assessment_deadline")
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overall_self_score" numeric(5, 2),
	"overall_manager_score" numeric(5, 2),
	"manager_summary_comment" text,
	"development_plan" text,
	"discussion_held_at" timestamp with time zone,
	"discussion_recorded_at" timestamp with time zone,
	"discussion_recorded_by" uuid,
	"discussion_notes" text,
	"employee_acknowledged_at" timestamp with time zone,
	"employee_acknowledgement_comment" text,
	"employee_agrees_with_review" boolean,
	"moderated_at" timestamp with time zone,
	"moderated_by" uuid,
	"moderation_comment" text,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"corrected_reason" text,
	"original_review_id" uuid,
	CONSTRAINT "performance_reviews_self_score_non_negative" CHECK ("performance_reviews"."overall_self_score" IS NULL OR "performance_reviews"."overall_self_score" >= 0),
	CONSTRAINT "performance_reviews_manager_score_non_negative" CHECK ("performance_reviews"."overall_manager_score" IS NULL OR "performance_reviews"."overall_manager_score" >= 0),
	CONSTRAINT "performance_reviews_lock_consistency" CHECK ("performance_reviews"."locked_at" IS NULL OR "performance_reviews"."locked_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "review_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"max_rating" integer DEFAULT 5 NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"employee_can_see_manager_ratings" boolean DEFAULT false NOT NULL,
	CONSTRAINT "review_templates_name_not_blank" CHECK (btrim("review_templates"."name") <> ''),
	CONSTRAINT "review_templates_rating_range" CHECK ("review_templates"."max_rating" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "training_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"request_id" uuid,
	"session_id" uuid,
	"status" text DEFAULT 'Assigned' NOT NULL,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"attendance_recorded_at" timestamp with time zone,
	"attendance_recorded_by" uuid,
	"completion_date" date,
	"result" text,
	"actual_cost" numeric(14, 2),
	"cancellation_reason" text,
	CONSTRAINT "training_assignments_cost_non_negative" CHECK ("training_assignments"."actual_cost" IS NULL OR "training_assignments"."actual_cost" >= 0),
	CONSTRAINT "training_assignments_cancellation_reason" CHECK ("training_assignments"."status" <> 'Cancelled' OR btrim(coalesce("training_assignments"."cancellation_reason", '')) <> '')
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"delivery_type" text NOT NULL,
	"duration_hours" numeric(8, 2) NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"validity_months" integer,
	"renewal_interval_months" integer,
	"required_roles" text[] DEFAULT '{}' NOT NULL,
	"required_locations" uuid[] DEFAULT '{}' NOT NULL,
	"required_projects" uuid[] DEFAULT '{}' NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "training_courses_title_not_blank" CHECK (btrim("training_courses"."title") <> ''),
	CONSTRAINT "training_courses_duration_positive" CHECK ("training_courses"."duration_hours" > 0),
	CONSTRAINT "training_courses_cost_non_negative" CHECK ("training_courses"."cost" >= 0),
	CONSTRAINT "training_courses_currency_format" CHECK ("training_courses"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "training_courses_delivery_type" CHECK ("training_courses"."delivery_type" IN ('Classroom', 'Virtual', 'Blended', 'Self-paced'))
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"course_id" uuid,
	"assignment_id" uuid,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"completion_date" date NOT NULL,
	"expiry_date" date,
	"certificate_file_id" uuid,
	"hr_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"verification_comment" text,
	"rejected_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejection_reason" text,
	CONSTRAINT "training_records_date_order" CHECK ("training_records"."expiry_date" IS NULL OR "training_records"."expiry_date" >= "training_records"."completion_date"),
	CONSTRAINT "training_records_verification_consistency" CHECK (NOT "training_records"."hr_verified" OR ("training_records"."verified_at" IS NOT NULL AND "training_records"."verified_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "training_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'Pending Supervisor' NOT NULL,
	"supervisor_decision_at" timestamp with time zone,
	"supervisor_decision_by" uuid,
	"supervisor_comment" text,
	"hr_decision_at" timestamp with time zone,
	"hr_decision_by" uuid,
	"hr_comment" text,
	"rejection_reason" text,
	CONSTRAINT "training_requests_origin" CHECK ("training_requests"."origin" IN ('Employee Request', 'Supervisor Assignment', 'HR Assignment')),
	CONSTRAINT "training_requests_reason_not_blank" CHECK (btrim("training_requests"."reason") <> ''),
	CONSTRAINT "training_requests_rejection_reason" CHECK ("training_requests"."status" <> 'Rejected' OR btrim(coalesce("training_requests"."rejection_reason", '')) <> '')
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"facilitator" text NOT NULL,
	"capacity" integer NOT NULL,
	"status" text DEFAULT 'Scheduled' NOT NULL,
	CONSTRAINT "training_sessions_date_order" CHECK ("training_sessions"."end_at" > "training_sessions"."start_at"),
	CONSTRAINT "training_sessions_capacity_positive" CHECK ("training_sessions"."capacity" > 0),
	CONSTRAINT "training_sessions_status" CHECK ("training_sessions"."status" IN ('Scheduled', 'Completed', 'Cancelled'))
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"attendance_record_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"correction_type" text NOT NULL,
	"original_clock_in" timestamp with time zone,
	"original_clock_out" timestamp with time zone,
	"original_status" "attendance_status" NOT NULL,
	"proposed_clock_in" timestamp with time zone,
	"proposed_clock_out" timestamp with time zone,
	"explanation" text NOT NULL,
	"evidence_file_id" uuid,
	"status" "attendance_correction_status" DEFAULT 'Pending Manager' NOT NULL,
	"manager_notes" text,
	"manager_reviewed_by" uuid,
	"manager_reviewed_at" timestamp with time zone,
	"hr_notes" text,
	"hr_reviewed_by" uuid,
	"hr_reviewed_at" timestamp with time zone,
	CONSTRAINT "attendance_corrections_type" CHECK ("attendance_corrections"."correction_type" IN ('Punch Correction', 'Missed Sign-out')),
	CONSTRAINT "attendance_corrections_explanation_not_blank" CHECK (btrim("attendance_corrections"."explanation") <> ''),
	CONSTRAINT "attendance_corrections_proposed_order" CHECK ("attendance_corrections"."proposed_clock_in" IS NULL OR "attendance_corrections"."proposed_clock_out" IS NULL OR "attendance_corrections"."proposed_clock_out" >= "attendance_corrections"."proposed_clock_in")
);
--> statement-breakpoint
CREATE TABLE "attendance_exception_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"site_visit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"destination" text NOT NULL,
	"status" text NOT NULL,
	"owner_id" uuid,
	"investigation_notes" text,
	"resolution_notes" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "attendance_exception_type" CHECK ("attendance_exception_cases"."type" = 'Site Visit No Clock-In'),
	CONSTRAINT "attendance_exception_status" CHECK ("attendance_exception_cases"."status" IN ('Open', 'Investigating', 'Resolved')),
	CONSTRAINT "attendance_exception_resolution_consistency" CHECK ("attendance_exception_cases"."status" <> 'Resolved' OR ("attendance_exception_cases"."resolved_by" IS NOT NULL AND "attendance_exception_cases"."resolved_at" IS NOT NULL AND btrim(coalesce("attendance_exception_cases"."resolution_notes", '')) <> ''))
);
--> statement-breakpoint
CREATE TABLE "attendance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"standard_daily_hours" numeric(5, 2) NOT NULL,
	"expected_clock_in" text NOT NULL,
	"expected_clock_out" text NOT NULL,
	"default_break_minutes" integer NOT NULL,
	"late_grace_minutes" integer NOT NULL,
	"maximum_location_accuracy_meters" integer NOT NULL,
	"sign_out_reminder_offsets_minutes" integer[] NOT NULL,
	CONSTRAINT "attendance_policies_daily_hours_range" CHECK ("attendance_policies"."standard_daily_hours" > 0 AND "attendance_policies"."standard_daily_hours" <= 24),
	CONSTRAINT "attendance_policies_break_range" CHECK ("attendance_policies"."default_break_minutes" BETWEEN 0 AND 1439),
	CONSTRAINT "attendance_policies_grace_non_negative" CHECK ("attendance_policies"."late_grace_minutes" >= 0),
	CONSTRAINT "attendance_policies_accuracy_positive" CHECK ("attendance_policies"."maximum_location_accuracy_meters" > 0),
	CONSTRAINT "attendance_policies_three_reminders" CHECK (cardinality("attendance_policies"."sign_out_reminder_offsets_minutes") = 3)
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"expected_clock_in" text,
	"expected_clock_out" text,
	"clock_in_at" timestamp with time zone,
	"clock_out_at" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"location" text,
	"location_id" uuid,
	"captured_latitude" double precision,
	"captured_longitude" double precision,
	"captured_accuracy_meters" double precision,
	"clock_out_location_id" uuid,
	"clock_out_captured_latitude" double precision,
	"clock_out_captured_longitude" double precision,
	"clock_out_captured_accuracy_meters" double precision,
	"source" "attendance_source" NOT NULL,
	"work_mode" text,
	"site_visit_id" uuid,
	"status" "attendance_status" NOT NULL,
	"calculated_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"is_early_departure" boolean DEFAULT false NOT NULL,
	CONSTRAINT "attendance_records_break_range" CHECK ("attendance_records"."break_minutes" BETWEEN 0 AND 1439),
	CONSTRAINT "attendance_records_hours_range" CHECK ("attendance_records"."calculated_hours" BETWEEN 0 AND 24),
	CONSTRAINT "attendance_records_punch_order" CHECK ("attendance_records"."clock_in_at" IS NULL OR "attendance_records"."clock_out_at" IS NULL OR "attendance_records"."clock_out_at" >= "attendance_records"."clock_in_at"),
	CONSTRAINT "attendance_records_latitude_range" CHECK ("attendance_records"."captured_latitude" IS NULL OR "attendance_records"."captured_latitude" BETWEEN -90 AND 90),
	CONSTRAINT "attendance_records_longitude_range" CHECK ("attendance_records"."captured_longitude" IS NULL OR "attendance_records"."captured_longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "overtime_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"project_id" uuid,
	"cost_centre_id" uuid NOT NULL,
	"activity_code_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence_file_id" uuid,
	"compensation_type" text NOT NULL,
	"toil_credited_at" timestamp with time zone,
	"toil_reversed_at" timestamp with time zone,
	"payroll_period_id" uuid,
	"cross_check_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "overtime_claim_status" DEFAULT 'Pending Manager' NOT NULL,
	"manager_notes" text,
	"hr_notes" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"original_claim_id" uuid,
	CONSTRAINT "overtime_claims_hours_range" CHECK ("overtime_claims"."hours" > 0 AND "overtime_claims"."hours" <= 24),
	CONSTRAINT "overtime_claims_reason_not_blank" CHECK (btrim("overtime_claims"."reason") <> ''),
	CONSTRAINT "overtime_claims_compensation" CHECK ("overtime_claims"."compensation_type" IN ('Payment', 'TOIL')),
	CONSTRAINT "overtime_claims_approval_consistency" CHECK ("overtime_claims"."status" <> 'Approved' OR ("overtime_claims"."approved_at" IS NOT NULL AND "overtime_claims"."approved_by" IS NOT NULL)),
	CONSTRAINT "overtime_claims_toil_consistency" CHECK ("overtime_claims"."toil_credited_at" IS NULL OR "overtime_claims"."compensation_type" = 'TOIL')
);
--> statement-breakpoint
CREATE TABLE "site_visit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"purpose" text NOT NULL,
	"project_id" uuid,
	"status" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"hr_reviewed_by" uuid,
	"hr_reviewed_at" timestamp with time zone,
	"hr_notes" text,
	"attendance_record_id" uuid,
	CONSTRAINT "site_visit_requests_origin" CHECK ("site_visit_requests"."origin" IN ('Office', 'Home')),
	CONSTRAINT "site_visit_requests_status" CHECK ("site_visit_requests"."status" IN ('Pending HR', 'Approved', 'Rejected', 'Cancelled', 'Completed')),
	CONSTRAINT "site_visit_requests_time_order" CHECK ("site_visit_requests"."start_time" < "site_visit_requests"."end_time")
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"project_id" uuid NOT NULL,
	"cost_centre_id" uuid NOT NULL,
	"activity_code_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"notes" text,
	"is_leave" boolean DEFAULT false NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	CONSTRAINT "timesheet_entries_hours_range" CHECK ("timesheet_entries"."hours" > 0 AND "timesheet_entries"."hours" <= 24),
	CONSTRAINT "timesheet_entries_leave_holiday_exclusive" CHECK (NOT ("timesheet_entries"."is_leave" AND "timesheet_entries"."is_holiday"))
);
--> statement-breakpoint
CREATE TABLE "timesheet_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" timesheet_period_status DEFAULT 'Open' NOT NULL,
	CONSTRAINT "timesheet_periods_date_order" CHECK ("timesheet_periods"."end_date" >= "timesheet_periods"."start_date")
);
--> statement-breakpoint
CREATE TABLE "timesheet_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"weekly_period_start_day" integer NOT NULL,
	"standard_daily_hours" numeric(5, 2) NOT NULL,
	"submission_deadline_days" integer NOT NULL,
	"overtime_threshold_weekly" numeric(6, 2) NOT NULL,
	"allow_copy_previous_week" boolean DEFAULT true NOT NULL,
	"payroll_lock_behaviour" text NOT NULL,
	"require_hr_overtime_verification" boolean DEFAULT true NOT NULL,
	"attendance_variance_tolerance_hours" numeric(5, 2) NOT NULL,
	CONSTRAINT "timesheet_settings_start_day_range" CHECK ("timesheet_settings"."weekly_period_start_day" BETWEEN 0 AND 6),
	CONSTRAINT "timesheet_settings_daily_hours_range" CHECK ("timesheet_settings"."standard_daily_hours" > 0 AND "timesheet_settings"."standard_daily_hours" <= 24),
	CONSTRAINT "timesheet_settings_deadline_non_negative" CHECK ("timesheet_settings"."submission_deadline_days" >= 0),
	CONSTRAINT "timesheet_settings_overtime_range" CHECK ("timesheet_settings"."overtime_threshold_weekly" > 0 AND "timesheet_settings"."overtime_threshold_weekly" <= 168),
	CONSTRAINT "timesheet_settings_lock_behaviour" CHECK ("timesheet_settings"."payroll_lock_behaviour" IN ('Manual by HR', 'Automatic on Approval')),
	CONSTRAINT "timesheet_settings_tolerance_non_negative" CHECK ("timesheet_settings"."attendance_variance_tolerance_hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"status" timesheet_status DEFAULT 'Draft' NOT NULL,
	"expected_hours" numeric(8, 2) NOT NULL,
	"total_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"supervisor_reviewed_at" timestamp with time zone,
	"supervisor_reviewed_by" uuid,
	"manager_notes" text,
	"attendance_discrepancy_explanations" jsonb,
	"attendance_reconciliation_snapshot" jsonb,
	"payroll_period_id" uuid,
	"original_timesheet_id" uuid,
	CONSTRAINT "timesheets_expected_non_negative" CHECK ("timesheets"."expected_hours" >= 0),
	CONSTRAINT "timesheets_total_non_negative" CHECK ("timesheets"."total_hours" >= 0),
	CONSTRAINT "timesheets_approval_consistency" CHECK ("timesheets"."approved_at" IS NULL OR "timesheets"."approved_by" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"travel_request_id" uuid NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(14, 6),
	"reference" text NOT NULL,
	"date" date NOT NULL,
	"notes" text,
	"receipt_file_id" uuid,
	CONSTRAINT "expense_items_category" CHECK ("expense_items"."category" IN ('Transport', 'Accommodation', 'Per Diem', 'Other')),
	CONSTRAINT "expense_items_amount_positive" CHECK ("expense_items"."amount" > 0),
	CONSTRAINT "expense_items_exchange_rate_positive" CHECK ("expense_items"."exchange_rate" IS NULL OR "expense_items"."exchange_rate" > 0),
	CONSTRAINT "expense_items_reference_not_blank" CHECK (btrim("expense_items"."reference") <> ''),
	CONSTRAINT "expense_items_currency_format" CHECK ("expense_items"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "payroll_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledgement_notes" text,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "payroll_exceptions_severity" CHECK ("payroll_exceptions"."severity" IN ('High', 'Medium', 'Low')),
	CONSTRAINT "payroll_exceptions_ack_consistency" CHECK (NOT "payroll_exceptions"."acknowledged" OR ("payroll_exceptions"."acknowledged_by" IS NOT NULL AND "payroll_exceptions"."acknowledged_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "payroll_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"approved_overtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"unpaid_leave_days" numeric(8, 2) DEFAULT '0' NOT NULL,
	"reimbursements_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"reimbursements_currency" text NOT NULL,
	"manual_adjustments_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "payroll_inputs_overtime_non_negative" CHECK ("payroll_inputs"."approved_overtime_hours" >= 0),
	CONSTRAINT "payroll_inputs_leave_non_negative" CHECK ("payroll_inputs"."unpaid_leave_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_manual_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_file_id" uuid,
	CONSTRAINT "payroll_adjustments_type" CHECK ("payroll_manual_adjustments"."type" IN ('Allowance', 'Deduction', 'Correction')),
	CONSTRAINT "payroll_adjustments_amount_non_zero" CHECK ("payroll_manual_adjustments"."amount" <> 0),
	CONSTRAINT "payroll_adjustments_currency_format" CHECK ("payroll_manual_adjustments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payroll_adjustments_reason_not_blank" CHECK (btrim("payroll_manual_adjustments"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"cutoff_date" date NOT NULL,
	"payment_date" date NOT NULL,
	"status" "payroll_period_status" DEFAULT 'Draft' NOT NULL,
	"notes" text,
	"compiled_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "payroll_periods_date_order" CHECK ("payroll_periods"."end_date" >= "payroll_periods"."start_date"),
	CONSTRAINT "payroll_periods_cutoff_order" CHECK ("payroll_periods"."cutoff_date" <= "payroll_periods"."payment_date"),
	CONSTRAINT "payroll_periods_name_not_blank" CHECK (btrim("payroll_periods"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"travel_request_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"rejection_reason" text,
	CONSTRAINT "reimbursements_amount_non_negative" CHECK ("reimbursements"."amount" >= 0),
	CONSTRAINT "reimbursements_currency_format" CHECK ("reimbursements"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "travel_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"travel_request_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"state" "travel_approval_state" NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "travel_approvals_stage" CHECK ("travel_approvals"."stage" IN ('HR', 'Accounts')),
	CONSTRAINT "travel_approvals_rejection_reason" CHECK ("travel_approvals"."state" <> 'Rejected' OR btrim(coalesce("travel_approvals"."reason", '')) <> '')
);
--> statement-breakpoint
CREATE TABLE "travel_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"destination" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"project_id" uuid,
	"cost_centre_id" uuid,
	"est_transport" numeric(14, 2) DEFAULT '0' NOT NULL,
	"est_accommodation" numeric(14, 2) DEFAULT '0' NOT NULL,
	"est_per_diem" numeric(14, 2) DEFAULT '0' NOT NULL,
	"est_other" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_estimate" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"notes" text,
	"evidence_file_id" uuid,
	"hr_approval_status" "travel_approval_state" DEFAULT 'Pending' NOT NULL,
	"accounts_approval_status" "travel_approval_state" DEFAULT 'Pending' NOT NULL,
	"hr_notes" text,
	"accounts_notes" text,
	"hr_approved_at" timestamp with time zone,
	"hr_approved_by" uuid,
	"accounts_approved_at" timestamp with time zone,
	"accounts_approved_by" uuid,
	"pre_authorised_at" timestamp with time zone,
	"authorised_budget" jsonb,
	"actual_total" numeric(14, 2),
	"actual_total_omr" numeric(14, 2),
	"variance_explanation" text,
	"closure_notes" text,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"payroll_period_id" uuid,
	"status" "travel_request_status" DEFAULT 'Draft' NOT NULL,
	CONSTRAINT "travel_requests_date_order" CHECK ("travel_requests"."end_date" >= "travel_requests"."start_date"),
	CONSTRAINT "travel_requests_estimates_non_negative" CHECK ("travel_requests"."est_transport" >= 0 AND "travel_requests"."est_accommodation" >= 0 AND "travel_requests"."est_per_diem" >= 0 AND "travel_requests"."est_other" >= 0 AND "travel_requests"."total_estimate" >= 0),
	CONSTRAINT "travel_requests_actual_non_negative" CHECK ("travel_requests"."actual_total" IS NULL OR "travel_requests"."actual_total" >= 0),
	CONSTRAINT "travel_requests_actual_omr_non_negative" CHECK ("travel_requests"."actual_total_omr" IS NULL OR "travel_requests"."actual_total_omr" >= 0),
	CONSTRAINT "travel_requests_currency_format" CHECK ("travel_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "travel_requests_pre_authorised_dual_approval" CHECK ("travel_requests"."status" <> 'Pre-authorised' OR ("travel_requests"."hr_approval_status" = 'Approved' AND "travel_requests"."accounts_approval_status" = 'Approved' AND "travel_requests"."pre_authorised_at" IS NOT NULL)),
	CONSTRAINT "travel_requests_record_version_positive" CHECK ("travel_requests"."record_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_employee_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_file_id_file_metadata_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_file_id_file_metadata_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_replaced_by_id_employee_documents_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_assigned_owner_id_employees_id_fk" FOREIGN KEY ("assigned_owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_changes" ADD CONSTRAINT "employment_changes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment_changes" ADD CONSTRAINT "employment_changes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_metadata" ADD CONSTRAINT "file_metadata_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_id_file_metadata_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_entitlement_overrides" ADD CONSTRAINT "employee_leave_entitlement_overrides_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_entitlement_overrides" ADD CONSTRAINT "employee_leave_entitlement_overrides_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_leave_entitlement_overrides" ADD CONSTRAINT "employee_leave_entitlement_overrides_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_handover_contact_id_employees_id_fk" FOREIGN KEY ("handover_contact_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_attachment_file_id_file_metadata_id_fk" FOREIGN KEY ("attachment_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_policy_id_leave_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."leave_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_transactions" ADD CONSTRAINT "leave_transactions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_template_id_offboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."offboarding_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_financial_clearance_by_users_id_fk" FOREIGN KEY ("financial_clearance_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_legal_clearance_by_users_id_fk" FOREIGN KEY ("legal_clearance_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_cases" ADD CONSTRAINT "offboarding_cases_assigned_hr_id_employees_id_fk" FOREIGN KEY ("assigned_hr_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_case_id_offboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."offboarding_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_tasks" ADD CONSTRAINT "offboarding_tasks_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_templates" ADD CONSTRAINT "offboarding_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_template_id_onboarding_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."onboarding_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_cases" ADD CONSTRAINT "onboarding_cases_assigned_hr_id_employees_id_fk" FOREIGN KEY ("assigned_hr_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_case_id_onboarding_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."onboarding_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_cv_file_id_recruitment_documents_id_fk" FOREIGN KEY ("cv_file_id") REFERENCES "public"."recruitment_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_hr_interview_recommendation_id_candidate_interview_recommendations_id_fk" FOREIGN KEY ("hr_interview_recommendation_id") REFERENCES "public"."candidate_interview_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_assessment_score_id_candidate_score_runs_id_fk" FOREIGN KEY ("assessment_score_id") REFERENCES "public"."candidate_score_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_preparation_run_id_candidate_preparation_runs_id_fk" FOREIGN KEY ("preparation_run_id") REFERENCES "public"."candidate_preparation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_batches" ADD CONSTRAINT "candidate_assessment_batches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_batches" ADD CONSTRAINT "candidate_assessment_batches_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_inclusions" ADD CONSTRAINT "candidate_assessment_inclusions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_inclusions" ADD CONSTRAINT "candidate_assessment_inclusions_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_inclusions" ADD CONSTRAINT "candidate_assessment_inclusions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_assessment_inclusions" ADD CONSTRAINT "candidate_assessment_inclusions_cv_record_id_candidate_cv_records_id_fk" FOREIGN KEY ("cv_record_id") REFERENCES "public"."candidate_cv_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_contacted_by_user_id_users_id_fk" FOREIGN KEY ("contacted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_contacts" ADD CONSTRAINT "candidate_contacts_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_application_id_candidate_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."candidate_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_file_id_recruitment_documents_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."recruitment_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_cv_records" ADD CONSTRAINT "candidate_cv_records_recommendation_id_candidate_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."candidate_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_application_id_candidate_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."candidate_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_cv_record_id_candidate_cv_records_id_fk" FOREIGN KEY ("cv_record_id") REFERENCES "public"."candidate_cv_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_recommended_by_user_id_users_id_fk" FOREIGN KEY ("recommended_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_interview_recommendations" ADD CONSTRAINT "candidate_interview_recommendations_assessment_score_id_candidate_score_runs_id_fk" FOREIGN KEY ("assessment_score_id") REFERENCES "public"."candidate_score_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_application_id_candidate_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."candidate_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_cv_record_id_candidate_cv_records_id_fk" FOREIGN KEY ("cv_record_id") REFERENCES "public"."candidate_cv_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_cv_file_id_recruitment_documents_id_fk" FOREIGN KEY ("cv_file_id") REFERENCES "public"."recruitment_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preparation_runs" ADD CONSTRAINT "candidate_preparation_runs_reused_from_preparation_run_id_candidate_preparation_runs_id_fk" FOREIGN KEY ("reused_from_preparation_run_id") REFERENCES "public"."candidate_preparation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_hr_owner_id_employees_id_fk" FOREIGN KEY ("hr_owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_application_id_candidate_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."candidate_applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_cv_record_id_candidate_cv_records_id_fk" FOREIGN KEY ("cv_record_id") REFERENCES "public"."candidate_cv_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_cv_file_id_recruitment_documents_id_fk" FOREIGN KEY ("cv_file_id") REFERENCES "public"."recruitment_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_score_runs" ADD CONSTRAINT "candidate_score_runs_assessment_batch_id_candidate_assessment_batches_id_fk" FOREIGN KEY ("assessment_batch_id") REFERENCES "public"."candidate_assessment_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_cv_file_id_recruitment_documents_id_fk" FOREIGN KEY ("cv_file_id") REFERENCES "public"."recruitment_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_hr_owner_id_employees_id_fk" FOREIGN KEY ("hr_owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_converted_to_employee_id_employees_id_fk" FOREIGN KEY ("converted_to_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_merged_into_id_candidates_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_latest_cv_record_id_candidate_cv_records_id_fk" FOREIGN KEY ("latest_cv_record_id") REFERENCES "public"."candidate_cv_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_system_recommended_candidate_id_candidates_id_fk" FOREIGN KEY ("system_recommended_candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_final_selected_candidate_id_candidates_id_fk" FOREIGN KEY ("final_selected_candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hiring_decisions" ADD CONSTRAINT "hiring_decisions_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_dispositions" ADD CONSTRAINT "interview_dispositions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_dispositions" ADD CONSTRAINT "interview_dispositions_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_dispositions" ADD CONSTRAINT "interview_dispositions_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_dispositions" ADD CONSTRAINT "interview_dispositions_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_dispositions" ADD CONSTRAINT "interview_dispositions_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_panelists" ADD CONSTRAINT "interview_panelists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_scorecards" ADD CONSTRAINT "interview_scorecards_panel_user_id_users_id_fk" FOREIGN KEY ("panel_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_templates" ADD CONSTRAINT "interview_templates_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_template_id_interview_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."interview_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_converted_to_employee_id_employees_id_fk" FOREIGN KEY ("converted_to_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_documents" ADD CONSTRAINT "recruitment_documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_snapshots" ADD CONSTRAINT "shortlist_snapshots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist_snapshots" ADD CONSTRAINT "shortlist_snapshots_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_employment_type_id_employment_types_id_fk" FOREIGN KEY ("employment_type_id") REFERENCES "public"."employment_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_hiring_manager_id_employees_id_fk" FOREIGN KEY ("hiring_manager_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_assigned_owner_id_employees_id_fk" FOREIGN KEY ("assigned_owner_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_versions" ADD CONSTRAINT "vacancy_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacancy_versions" ADD CONSTRAINT "vacancy_versions_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_performance_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_discussion_recorded_by_users_id_fk" FOREIGN KEY ("discussion_recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_original_review_id_performance_reviews_id_fk" FOREIGN KEY ("original_review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_request_id_training_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."training_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_attendance_recorded_by_users_id_fk" FOREIGN KEY ("attendance_recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_assignment_id_training_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."training_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_certificate_file_id_file_metadata_id_fk" FOREIGN KEY ("certificate_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_supervisor_decision_by_users_id_fk" FOREIGN KEY ("supervisor_decision_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_hr_decision_by_users_id_fk" FOREIGN KEY ("hr_decision_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_manager_reviewed_by_users_id_fk" FOREIGN KEY ("manager_reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_hr_reviewed_by_users_id_fk" FOREIGN KEY ("hr_reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_cases" ADD CONSTRAINT "attendance_exception_cases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_cases" ADD CONSTRAINT "attendance_exception_cases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_cases" ADD CONSTRAINT "attendance_exception_cases_site_visit_id_site_visit_requests_id_fk" FOREIGN KEY ("site_visit_id") REFERENCES "public"."site_visit_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_cases" ADD CONSTRAINT "attendance_exception_cases_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_exception_cases" ADD CONSTRAINT "attendance_exception_cases_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_clock_out_location_id_locations_id_fk" FOREIGN KEY ("clock_out_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_site_visit_id_site_visit_requests_id_fk" FOREIGN KEY ("site_visit_id") REFERENCES "public"."site_visit_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_activity_code_id_activity_codes_id_fk" FOREIGN KEY ("activity_code_id") REFERENCES "public"."activity_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_original_claim_id_overtime_claims_id_fk" FOREIGN KEY ("original_claim_id") REFERENCES "public"."overtime_claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_requests" ADD CONSTRAINT "site_visit_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_requests" ADD CONSTRAINT "site_visit_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_requests" ADD CONSTRAINT "site_visit_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_requests" ADD CONSTRAINT "site_visit_requests_hr_reviewed_by_users_id_fk" FOREIGN KEY ("hr_reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visit_requests" ADD CONSTRAINT "site_visit_requests_attendance_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_activity_code_id_activity_codes_id_fk" FOREIGN KEY ("activity_code_id") REFERENCES "public"."activity_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_periods" ADD CONSTRAINT "timesheet_periods_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_settings" ADD CONSTRAINT "timesheet_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_period_id_timesheet_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."timesheet_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_supervisor_reviewed_by_users_id_fk" FOREIGN KEY ("supervisor_reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_original_timesheet_id_timesheets_id_fk" FOREIGN KEY ("original_timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_travel_request_id_travel_requests_id_fk" FOREIGN KEY ("travel_request_id") REFERENCES "public"."travel_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_receipt_file_id_file_metadata_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exceptions" ADD CONSTRAINT "payroll_exceptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exceptions" ADD CONSTRAINT "payroll_exceptions_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exceptions" ADD CONSTRAINT "payroll_exceptions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exceptions" ADD CONSTRAINT "payroll_exceptions_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_manual_adjustments" ADD CONSTRAINT "payroll_manual_adjustments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_manual_adjustments" ADD CONSTRAINT "payroll_manual_adjustments_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_manual_adjustments" ADD CONSTRAINT "payroll_manual_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_manual_adjustments" ADD CONSTRAINT "payroll_manual_adjustments_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_travel_request_id_travel_requests_id_fk" FOREIGN KEY ("travel_request_id") REFERENCES "public"."travel_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_approvals" ADD CONSTRAINT "travel_approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_approvals" ADD CONSTRAINT "travel_approvals_travel_request_id_travel_requests_id_fk" FOREIGN KEY ("travel_request_id") REFERENCES "public"."travel_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_approvals" ADD CONSTRAINT "travel_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_hr_approved_by_users_id_fk" FOREIGN KEY ("hr_approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_accounts_approved_by_users_id_fk" FOREIGN KEY ("accounts_approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_payroll_period_id_payroll_periods_id_fk" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_version_unique" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "document_versions_org_document_idx" ON "document_versions" USING btree ("organisation_id","document_id");--> statement-breakpoint
CREATE INDEX "employee_documents_org_employee_idx" ON "employee_documents" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "employee_documents_org_expiry_idx" ON "employee_documents" USING btree ("organisation_id","expiry_date","status");--> statement-breakpoint
CREATE INDEX "employment_changes_org_employee_date_idx" ON "employment_changes" USING btree ("organisation_id","employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "file_metadata_org_owner_idx" ON "file_metadata" USING btree ("organisation_id","owner_entity_type","owner_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_metadata_org_storage_key_unique" ON "file_metadata" USING btree ("organisation_id","storage_key") WHERE "file_metadata"."storage_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "import_batches_org_module_status_idx" ON "import_batches" USING btree ("organisation_id","module","status");--> statement-breakpoint
CREATE INDEX "profile_change_requests_org_employee_status_idx" ON "profile_change_requests" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "leave_overrides_org_employee_idx" ON "employee_leave_entitlement_overrides" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_balances_employee_policy_year_unique" ON "leave_balances" USING btree ("employee_id","policy_id","leave_year");--> statement-breakpoint
CREATE INDEX "leave_balances_org_employee_idx" ON "leave_balances" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_policies_org_code_unique" ON "leave_policies" USING btree ("organisation_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "leave_policies_org_name_unique" ON "leave_policies" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE INDEX "leave_policies_org_enabled_idx" ON "leave_policies" USING btree ("organisation_id","is_enabled");--> statement-breakpoint
CREATE INDEX "leave_requests_org_employee_status_idx" ON "leave_requests" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "leave_requests_org_dates_idx" ON "leave_requests" USING btree ("organisation_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_transactions_org_employee_date_idx" ON "leave_transactions" USING btree ("organisation_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "leave_transactions_policy_idx" ON "leave_transactions" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "offboarding_cases_org_status_last_day_idx" ON "offboarding_cases" USING btree ("organisation_id","status","last_working_date");--> statement-breakpoint
CREATE INDEX "offboarding_cases_org_employee_idx" ON "offboarding_cases" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE INDEX "offboarding_tasks_org_status_due_idx" ON "offboarding_tasks" USING btree ("organisation_id","status","due_date");--> statement-breakpoint
CREATE INDEX "offboarding_tasks_case_idx" ON "offboarding_tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "offboarding_tasks_assignee_idx" ON "offboarding_tasks" USING btree ("organisation_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "offboarding_templates_org_active_idx" ON "offboarding_templates" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE INDEX "onboarding_cases_org_employee_status_idx" ON "onboarding_cases" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_org_status_due_idx" ON "onboarding_tasks" USING btree ("organisation_id","status","due_date");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_case_idx" ON "onboarding_tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "onboarding_tasks_assignee_idx" ON "onboarding_tasks" USING btree ("organisation_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "onboarding_templates_org_active_idx" ON "onboarding_templates" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE INDEX "workflow_tasks_org_assignee_status_idx" ON "workflow_tasks" USING btree ("organisation_id","assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_org_role_status_idx" ON "workflow_tasks" USING btree ("organisation_id","assigned_role","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_org_entity_idx" ON "workflow_tasks" USING btree ("organisation_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_applications_org_reference_unique" ON "candidate_applications" USING btree ("organisation_id","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cand_app_cand_vac_unique_idx" ON "candidate_applications" USING btree ("candidate_id","vacancy_id");--> statement-breakpoint
CREATE INDEX "candidate_applications_org_status_idx" ON "candidate_applications" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "candidate_applications_vacancy_idx" ON "candidate_applications" USING btree ("vacancy_id");--> statement-breakpoint
CREATE INDEX "candidate_assessment_batches_org_idx" ON "candidate_assessment_batches" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_assessment_inclusions_org_idx" ON "candidate_assessment_inclusions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_contacts_org_candidate_idx" ON "candidate_contacts" USING btree ("organisation_id","candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_cv_records_org_idx" ON "candidate_cv_records" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_interview_recommendations_org_idx" ON "candidate_interview_recommendations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_preparation_runs_org_idx" ON "candidate_preparation_runs" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_recommendations_org_idx" ON "candidate_recommendations" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "candidate_score_runs_org_idx" ON "candidate_score_runs" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_org_email_unique_idx" ON "candidates" USING btree ("organisation_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_org_phone_unique_idx" ON "candidates" USING btree ("organisation_id","phone");--> statement-breakpoint
CREATE INDEX "candidates_org_stage_idx" ON "candidates" USING btree ("organisation_id","stage");--> statement-breakpoint
CREATE INDEX "candidates_org_hr_owner_idx" ON "candidates" USING btree ("organisation_id","hr_owner_id");--> statement-breakpoint
CREATE INDEX "hiring_decisions_org_idx" ON "hiring_decisions" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "interview_dispositions_org_idx" ON "interview_dispositions" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_panelists_unique_idx" ON "interview_panelists" USING btree ("interview_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_scorecards_interview_panel_unique" ON "interview_scorecards" USING btree ("interview_id","panel_user_id");--> statement-breakpoint
CREATE INDEX "interview_scorecards_org_idx" ON "interview_scorecards" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "interview_templates_org_idx" ON "interview_templates" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "interviews_org_status_idx" ON "interviews" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "interviews_org_candidate_idx" ON "interviews" USING btree ("organisation_id","candidate_id");--> statement-breakpoint
CREATE INDEX "job_offers_org_status_idx" ON "job_offers" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "recruitment_documents_org_owner_idx" ON "recruitment_documents" USING btree ("organisation_id","owner_entity_type","owner_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_documents_org_checksum_unique" ON "recruitment_documents" USING btree ("organisation_id","checksum") WHERE "recruitment_documents"."checksum" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "shortlist_snapshots_org_idx" ON "shortlist_snapshots" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "vacancies_org_status_idx" ON "vacancies" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "vacancies_org_hiring_manager_idx" ON "vacancies" USING btree ("organisation_id","hiring_manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vacancy_versions_vacancy_version_unique" ON "vacancy_versions" USING btree ("vacancy_id","version_number");--> statement-breakpoint
CREATE INDEX "vacancy_versions_org_vacancy_idx" ON "vacancy_versions" USING btree ("organisation_id","vacancy_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_occurred_idx" ON "audit_events" USING btree ("organisation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_org_actor_idx" ON "audit_events" USING btree ("organisation_id","actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_entity_idx" ON "audit_events" USING btree ("organisation_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_module_action_idx" ON "audit_events" USING btree ("organisation_id","module","action");--> statement-breakpoint
CREATE INDEX "notifications_org_recipient_status_idx" ON "notifications" USING btree ("organisation_id","recipient_user_id","status");--> statement-breakpoint
CREATE INDEX "notifications_org_due_idx" ON "notifications" USING btree ("organisation_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_dedup_unique" ON "notifications" USING btree ("organisation_id","recipient_user_id","deduplication_key") WHERE "notifications"."deduplication_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "performance_cycles_org_status_idx" ON "performance_cycles" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "performance_cycles_org_deadlines_idx" ON "performance_cycles" USING btree ("organisation_id","self_assessment_deadline","manager_review_deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "performance_reviews_employee_cycle_unique" ON "performance_reviews" USING btree ("employee_id","cycle_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_org_status_idx" ON "performance_reviews" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "performance_reviews_org_employee_idx" ON "performance_reviews" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_templates_org_name_unique" ON "review_templates" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE INDEX "review_templates_org_active_idx" ON "review_templates" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "training_assignments_employee_course_session_unique" ON "training_assignments" USING btree ("employee_id","course_id","session_id");--> statement-breakpoint
CREATE INDEX "training_assignments_org_status_idx" ON "training_assignments" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "training_assignments_org_employee_idx" ON "training_assignments" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "training_courses_org_code_unique" ON "training_courses" USING btree ("organisation_id",lower("code"));--> statement-breakpoint
CREATE INDEX "training_courses_org_active_idx" ON "training_courses" USING btree ("organisation_id","is_active");--> statement-breakpoint
CREATE INDEX "training_records_org_employee_idx" ON "training_records" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE INDEX "training_records_org_expiry_idx" ON "training_records" USING btree ("organisation_id","expiry_date");--> statement-breakpoint
CREATE INDEX "training_requests_org_employee_status_idx" ON "training_requests" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "training_sessions_org_start_idx" ON "training_sessions" USING btree ("organisation_id","start_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_org_status_idx" ON "attendance_corrections" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "attendance_corrections_employee_idx" ON "attendance_corrections" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_exception_site_visit_unique" ON "attendance_exception_cases" USING btree ("site_visit_id");--> statement-breakpoint
CREATE INDEX "attendance_exception_org_status_idx" ON "attendance_exception_cases" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_policies_org_unique" ON "attendance_policies" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_employee_date_unique" ON "attendance_records" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_org_date_status_idx" ON "attendance_records" USING btree ("organisation_id","date","status");--> statement-breakpoint
CREATE INDEX "overtime_claims_org_employee_status_idx" ON "overtime_claims" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "overtime_claims_org_date_idx" ON "overtime_claims" USING btree ("organisation_id","date");--> statement-breakpoint
CREATE INDEX "site_visit_requests_org_date_status_idx" ON "site_visit_requests" USING btree ("organisation_id","date","status");--> statement-breakpoint
CREATE INDEX "timesheet_entries_org_date_idx" ON "timesheet_entries" USING btree ("organisation_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheet_entries_project_cost_idx" ON "timesheet_entries" USING btree ("project_id","cost_centre_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_timesheet_idx" ON "timesheet_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_periods_org_dates_unique" ON "timesheet_periods" USING btree ("organisation_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "timesheet_periods_org_status_idx" ON "timesheet_periods" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_settings_org_unique" ON "timesheet_settings" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheets_employee_period_unique" ON "timesheets" USING btree ("employee_id","period_id");--> statement-breakpoint
CREATE INDEX "timesheets_org_status_idx" ON "timesheets" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "timesheets_org_employee_idx" ON "timesheets" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE INDEX "expense_items_org_request_date_idx" ON "expense_items" USING btree ("organisation_id","travel_request_id","date");--> statement-breakpoint
CREATE INDEX "payroll_exceptions_org_period_severity_idx" ON "payroll_exceptions" USING btree ("organisation_id","period_id","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_inputs_period_employee_unique" ON "payroll_inputs" USING btree ("period_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_inputs_org_employee_idx" ON "payroll_inputs" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_org_period_employee_idx" ON "payroll_manual_adjustments" USING btree ("organisation_id","period_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_org_dates_unique" ON "payroll_periods" USING btree ("organisation_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "payroll_periods_org_status_idx" ON "payroll_periods" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reimbursements_travel_request_unique" ON "reimbursements" USING btree ("travel_request_id");--> statement-breakpoint
CREATE INDEX "reimbursements_org_employee_status_idx" ON "reimbursements" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_approvals_request_stage_unique" ON "travel_approvals" USING btree ("travel_request_id","stage");--> statement-breakpoint
CREATE INDEX "travel_approvals_org_state_idx" ON "travel_approvals" USING btree ("organisation_id","state");--> statement-breakpoint
CREATE INDEX "travel_requests_org_employee_status_idx" ON "travel_requests" USING btree ("organisation_id","employee_id","status");--> statement-breakpoint
CREATE INDEX "travel_requests_org_dates_idx" ON "travel_requests" USING btree ("organisation_id","start_date","end_date");--> statement-breakpoint

-- Complete the circular employee/recruitment conversion links after both groups exist.
ALTER TABLE "employees" ADD CONSTRAINT "employees_candidate_id_candidates_id_fk"
  FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id")
  ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_offer_id_job_offers_id_fk"
  FOREIGN KEY ("offer_id") REFERENCES "public"."job_offers"("id")
  ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint

-- Enforce tenant ownership for every single-column FK between organisation-scoped tables.
-- Ordinary FKs only prove that an ID exists; this guard also proves that it belongs to
-- the same organisation as the row being written.
CREATE OR REPLACE FUNCTION "via_hr_enforce_same_organisation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_id uuid;
  referenced_organisation_id uuid;
BEGIN
  referenced_id := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  IF referenced_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT organisation_id FROM public.%I WHERE id = $1', TG_ARGV[0])
    INTO referenced_organisation_id
    USING referenced_id;

  -- The normal FK reports a missing referenced record. This trigger handles tenant mismatch.
  IF referenced_organisation_id IS NOT NULL
     AND referenced_organisation_id <> NEW."organisation_id" THEN
    RAISE EXCEPTION 'Cross-organisation reference rejected: %.%', TG_TABLE_NAME, TG_ARGV[1]
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DO $$
DECLARE
  relation record;
  tenant_trigger_name text;
BEGIN
  FOR relation IN
    SELECT
      constraint_record.conname,
      child_table.relname AS child_table,
      parent_table.relname AS parent_table,
      child_column.attname AS child_column
    FROM pg_constraint constraint_record
    JOIN pg_class child_table ON child_table.oid = constraint_record.conrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child_table.relnamespace
    JOIN pg_class parent_table ON parent_table.oid = constraint_record.confrelid
    JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent_table.relnamespace
    JOIN pg_attribute child_column
      ON child_column.attrelid = constraint_record.conrelid
     AND child_column.attnum = constraint_record.conkey[1]
    WHERE constraint_record.contype = 'f'
      AND child_namespace.nspname = 'public'
      AND parent_namespace.nspname = 'public'
      AND cardinality(constraint_record.conkey) = 1
      AND child_column.attname <> 'organisation_id'
      AND EXISTS (
        SELECT 1 FROM pg_attribute attribute
        WHERE attribute.attrelid = child_table.oid
          AND attribute.attname = 'organisation_id'
          AND NOT attribute.attisdropped
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute attribute
        WHERE attribute.attrelid = parent_table.oid
          AND attribute.attname = 'organisation_id'
          AND NOT attribute.attisdropped
      )
  LOOP
    tenant_trigger_name := 'via_hr_tenant_' || substr(md5(relation.conname), 1, 20);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organisation_id, %I ON public.%I FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_same_organisation(%L, %L)',
      tenant_trigger_name,
      relation.child_column,
      relation.child_table,
      relation.parent_table,
      relation.child_column
    );
  END LOOP;
END;
$$;--> statement-breakpoint

-- Audit history is append-only even for a table owner using ordinary DML.
CREATE OR REPLACE FUNCTION "via_hr_reject_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only; UPDATE and DELETE are not permitted.'
    USING ERRCODE = '42501';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "audit_events_append_only"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION "via_hr_reject_audit_mutation"();--> statement-breakpoint

-- Runtime connections inherit this group role. Migration ownership remains separate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'via_hr_runtime') THEN
    CREATE ROLE "via_hr_runtime" NOLOGIN;
  END IF;
END;
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "via_hr_runtime";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "via_hr_runtime";--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "via_hr_runtime";--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "audit_events" FROM "via_hr_runtime";--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "via_hr_runtime";
