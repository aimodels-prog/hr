CREATE TYPE "public"."employee_status" AS ENUM('Onboarding', 'Active', 'Probation', 'Notice', 'Inactive', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."system_role_code" AS ENUM('Employee', 'Line Manager', 'HR', 'Accounts', 'Super Admin', 'IT');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('Active', 'Suspended', 'Archived');--> statement-breakpoint
CREATE TABLE "employee_bank_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"encrypted_payload" text NOT NULL,
	CONSTRAINT "employee_bank_details_payload_not_blank" CHECK (btrim("employee_bank_details"."encrypted_payload") <> ''),
	CONSTRAINT "employee_bank_details_record_version_positive" CHECK ("employee_bank_details"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employee_compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"encrypted_payload" text NOT NULL,
	CONSTRAINT "employee_compensation_payload_not_blank" CHECK (btrim("employee_compensation"."encrypted_payload") <> ''),
	CONSTRAINT "employee_compensation_record_version_positive" CHECK ("employee_compensation"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employee_reporting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"supervisor_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_primary" boolean DEFAULT true NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "employee_reporting_lines_not_self" CHECK ("employee_reporting_lines"."employee_id" <> "employee_reporting_lines"."supervisor_id"),
	CONSTRAINT "employee_reporting_lines_date_order" CHECK ("employee_reporting_lines"."effective_to" IS NULL OR "employee_reporting_lines"."effective_to" >= "employee_reporting_lines"."effective_from"),
	CONSTRAINT "employee_reporting_lines_reason_not_blank" CHECK (btrim("employee_reporting_lines"."reason") <> ''),
	CONSTRAINT "employee_reporting_lines_record_version_positive" CHECK ("employee_reporting_lines"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employee_sensitive_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"passport_number_encrypted" text,
	"national_id_encrypted" text,
	"social_insurance_number_encrypted" text,
	CONSTRAINT "employee_sensitive_identifiers_record_version_positive" CHECK ("employee_sensitive_identifiers"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_number" text NOT NULL,
	"legal_name" text NOT NULL,
	"preferred_name" text NOT NULL,
	"work_email" text NOT NULL,
	"personal_email" text,
	"phone" text,
	"department_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"grade_id" uuid,
	"location_id" uuid NOT NULL,
	"employment_type_id" uuid NOT NULL,
	"working_time_id" uuid,
	"line_manager_id" uuid,
	"project_id" uuid,
	"cost_centre_id" uuid,
	"country" text,
	"legal_entity" text,
	"start_date" date NOT NULL,
	"probation_end_date" date,
	"workspace_email" text,
	"candidate_id" uuid,
	"offer_id" uuid,
	"status" "employee_status" DEFAULT 'Onboarding' NOT NULL,
	"address" text,
	"emergency_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dependants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"nationality" text,
	"marital_status" text,
	"termination_date" date,
	"termination_reason" text,
	"weekly_hours" numeric(6, 2),
	"performance_rating" numeric(3, 2),
	"performance_notes" text,
	CONSTRAINT "employees_legal_name_not_blank" CHECK (btrim("employees"."legal_name") <> ''),
	CONSTRAINT "employees_preferred_name_not_blank" CHECK (btrim("employees"."preferred_name") <> ''),
	CONSTRAINT "employees_number_not_blank" CHECK (btrim("employees"."employee_number") <> ''),
	CONSTRAINT "employees_work_email_normalized" CHECK ("employees"."work_email" = lower(btrim("employees"."work_email"))),
	CONSTRAINT "employees_workspace_email_normalized" CHECK ("employees"."workspace_email" IS NULL OR "employees"."workspace_email" = lower(btrim("employees"."workspace_email"))),
	CONSTRAINT "employees_manager_not_self" CHECK ("employees"."line_manager_id" IS NULL OR "employees"."line_manager_id" <> "employees"."id"),
	CONSTRAINT "employees_probation_date_order" CHECK ("employees"."probation_end_date" IS NULL OR "employees"."probation_end_date" >= "employees"."start_date"),
	CONSTRAINT "employees_termination_consistency" CHECK ("employees"."termination_date" IS NULL OR "employees"."termination_date" >= "employees"."start_date"),
	CONSTRAINT "employees_weekly_hours_range" CHECK ("employees"."weekly_hours" IS NULL OR ("employees"."weekly_hours" > 0 AND "employees"."weekly_hours" <= 168)),
	CONSTRAINT "employees_performance_rating_range" CHECK ("employees"."performance_rating" IS NULL OR ("employees"."performance_rating" >= 0 AND "employees"."performance_rating" <= 5)),
	CONSTRAINT "employees_record_version_positive" CHECK ("employees"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"code" "system_role_code" NOT NULL,
	"description" text NOT NULL,
	"is_assignable" boolean DEFAULT true NOT NULL,
	"is_protected" boolean DEFAULT true NOT NULL,
	CONSTRAINT "roles_description_not_blank" CHECK (btrim("roles"."description") <> ''),
	CONSTRAINT "roles_record_version_positive" CHECK ("roles"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid NOT NULL,
	"reason" text DEFAULT 'Initial employee access' NOT NULL,
	CONSTRAINT "user_roles_pk" PRIMARY KEY("user_id","role_id"),
	CONSTRAINT "user_roles_reason_not_blank" CHECK (btrim("user_roles"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"workspace_email" text NOT NULL,
	"workspace_subject" text,
	"status" "user_status" DEFAULT 'Active' NOT NULL,
	CONSTRAINT "users_display_name_not_blank" CHECK (btrim("users"."display_name") <> ''),
	CONSTRAINT "users_workspace_email_normalized" CHECK ("users"."workspace_email" = lower(btrim("users"."workspace_email"))),
	CONSTRAINT "users_record_version_positive" CHECK ("users"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "activity_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_codes_name_not_blank" CHECK (btrim("activity_codes"."name") <> ''),
	CONSTRAINT "activity_codes_code_length" CHECK ("activity_codes"."code" IS NULL OR length("activity_codes"."code") <= 30),
	CONSTRAINT "activity_codes_order_non_negative" CHECK ("activity_codes"."order_index" >= 0),
	CONSTRAINT "activity_codes_record_version_positive" CHECK ("activity_codes"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "cost_centres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cost_centres_name_not_blank" CHECK (btrim("cost_centres"."name") <> ''),
	CONSTRAINT "cost_centres_code_length" CHECK ("cost_centres"."code" IS NULL OR length("cost_centres"."code") <= 30),
	CONSTRAINT "cost_centres_order_non_negative" CHECK ("cost_centres"."order_index" >= 0),
	CONSTRAINT "cost_centres_record_version_positive" CHECK ("cost_centres"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"symbol" text,
	"decimal_places" integer DEFAULT 2 NOT NULL,
	CONSTRAINT "currencies_name_not_blank" CHECK (btrim("currencies"."name") <> ''),
	CONSTRAINT "currencies_code_length" CHECK ("currencies"."code" IS NULL OR length("currencies"."code") <= 30),
	CONSTRAINT "currencies_order_non_negative" CHECK ("currencies"."order_index" >= 0),
	CONSTRAINT "currencies_record_version_positive" CHECK ("currencies"."record_version" >= 1),
	CONSTRAINT "currencies_iso_code" CHECK ("currencies"."code" IS NULL OR "currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_decimal_places_range" CHECK ("currencies"."decimal_places" >= 0 AND "currencies"."decimal_places" <= 4)
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "departments_name_not_blank" CHECK (btrim("departments"."name") <> ''),
	CONSTRAINT "departments_code_length" CHECK ("departments"."code" IS NULL OR length("departments"."code") <= 30),
	CONSTRAINT "departments_order_non_negative" CHECK ("departments"."order_index" >= 0),
	CONSTRAINT "departments_record_version_positive" CHECK ("departments"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "employment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "employment_types_name_not_blank" CHECK (btrim("employment_types"."name") <> ''),
	CONSTRAINT "employment_types_code_length" CHECK ("employment_types"."code" IS NULL OR length("employment_types"."code") <= 30),
	CONSTRAINT "employment_types_order_non_negative" CHECK ("employment_types"."order_index" >= 0),
	CONSTRAINT "employment_types_record_version_positive" CHECK ("employment_types"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "grades_name_not_blank" CHECK (btrim("grades"."name") <> ''),
	CONSTRAINT "grades_code_length" CHECK ("grades"."code" IS NULL OR length("grades"."code") <= 30),
	CONSTRAINT "grades_order_non_negative" CHECK ("grades"."order_index" >= 0),
	CONSTRAINT "grades_record_version_positive" CHECK ("grades"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"address" text,
	"city" text,
	"country" text,
	"timezone" text,
	"latitude" double precision,
	"longitude" double precision,
	"radius_meters" integer,
	"is_clock_in_site" boolean DEFAULT false NOT NULL,
	CONSTRAINT "locations_name_not_blank" CHECK (btrim("locations"."name") <> ''),
	CONSTRAINT "locations_code_length" CHECK ("locations"."code" IS NULL OR length("locations"."code") <= 30),
	CONSTRAINT "locations_order_non_negative" CHECK ("locations"."order_index" >= 0),
	CONSTRAINT "locations_record_version_positive" CHECK ("locations"."record_version" >= 1),
	CONSTRAINT "locations_latitude_range" CHECK ("locations"."latitude" IS NULL OR ("locations"."latitude" >= -90 AND "locations"."latitude" <= 90)),
	CONSTRAINT "locations_longitude_range" CHECK ("locations"."longitude" IS NULL OR ("locations"."longitude" >= -180 AND "locations"."longitude" <= 180)),
	CONSTRAINT "locations_radius_range" CHECK ("locations"."radius_meters" IS NULL OR ("locations"."radius_meters" >= 25 AND "locations"."radius_meters" <= 50000)),
	CONSTRAINT "locations_clock_site_complete" CHECK (NOT "locations"."is_clock_in_site" OR ("locations"."latitude" IS NOT NULL AND "locations"."longitude" IS NOT NULL AND "locations"."radius_meters" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"department_id" uuid,
	CONSTRAINT "positions_name_not_blank" CHECK (btrim("positions"."name") <> ''),
	CONSTRAINT "positions_code_length" CHECK ("positions"."code" IS NULL OR length("positions"."code") <= 30),
	CONSTRAINT "positions_order_non_negative" CHECK ("positions"."order_index" >= 0),
	CONSTRAINT "positions_record_version_positive" CHECK ("positions"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"client" text,
	"type" text,
	"location_id" uuid,
	"start_date" date,
	"end_date" date,
	"cost_centre_id" uuid,
	"manager_id" uuid,
	"additional_attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "projects_name_not_blank" CHECK (btrim("projects"."name") <> ''),
	CONSTRAINT "projects_code_length" CHECK ("projects"."code" IS NULL OR length("projects"."code") <= 30),
	CONSTRAINT "projects_order_non_negative" CHECK ("projects"."order_index" >= 0),
	CONSTRAINT "projects_record_version_positive" CHECK ("projects"."record_version" >= 1),
	CONSTRAINT "projects_date_order" CHECK ("projects"."end_date" IS NULL OR "projects"."start_date" IS NULL OR "projects"."end_date" > "projects"."start_date")
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"holiday_date" date NOT NULL,
	"location_id" uuid,
	CONSTRAINT "public_holidays_name_not_blank" CHECK (btrim("public_holidays"."name") <> ''),
	CONSTRAINT "public_holidays_code_length" CHECK ("public_holidays"."code" IS NULL OR length("public_holidays"."code") <= 30),
	CONSTRAINT "public_holidays_order_non_negative" CHECK ("public_holidays"."order_index" >= 0),
	CONSTRAINT "public_holidays_record_version_positive" CHECK ("public_holidays"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "working_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"working_days" integer[] NOT NULL,
	CONSTRAINT "working_times_name_not_blank" CHECK (btrim("working_times"."name") <> ''),
	CONSTRAINT "working_times_code_length" CHECK ("working_times"."code" IS NULL OR length("working_times"."code") <= 30),
	CONSTRAINT "working_times_order_non_negative" CHECK ("working_times"."order_index" >= 0),
	CONSTRAINT "working_times_record_version_positive" CHECK ("working_times"."record_version" >= 1),
	CONSTRAINT "working_times_break_range" CHECK ("working_times"."break_minutes" >= 0 AND "working_times"."break_minutes" < 1440),
	CONSTRAINT "working_times_start_before_end" CHECK ("working_times"."start_time" < "working_times"."end_time")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"timezone" text NOT NULL,
	"base_currency" text NOT NULL,
	"working_days" integer[] NOT NULL,
	"standard_daily_hours" numeric(5, 2) NOT NULL,
	"standard_weekly_hours" numeric(6, 2) NOT NULL,
	"leave_year_start" text NOT NULL,
	"leave_year_end" text NOT NULL,
	"document_reminder_days" integer[] NOT NULL,
	"employee_number_format" text NOT NULL,
	"candidate_reference_format" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"require_onboarding_completion_before_dashboard" boolean DEFAULT true NOT NULL,
	"additional_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "app_settings_currency_format" CHECK ("app_settings"."base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "app_settings_daily_hours_range" CHECK ("app_settings"."standard_daily_hours" > 0 AND "app_settings"."standard_daily_hours" <= 24),
	CONSTRAINT "app_settings_weekly_hours_range" CHECK ("app_settings"."standard_weekly_hours" >= "app_settings"."standard_daily_hours" AND "app_settings"."standard_weekly_hours" <= 168),
	CONSTRAINT "app_settings_leave_year_start_format" CHECK ("app_settings"."leave_year_start" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "app_settings_leave_year_end_format" CHECK ("app_settings"."leave_year_end" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "app_settings_schema_version_positive" CHECK ("app_settings"."schema_version" >= 1),
	CONSTRAINT "app_settings_record_version_positive" CHECK ("app_settings"."record_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "organisations_name_not_blank" CHECK (btrim("organisations"."name") <> ''),
	CONSTRAINT "organisations_slug_format" CHECK ("organisations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "organisations_record_version_positive" CHECK ("organisations"."record_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_bank_details" ADD CONSTRAINT "employee_bank_details_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_compensation" ADD CONSTRAINT "employee_compensation_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_reporting_lines" ADD CONSTRAINT "employee_reporting_lines_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_reporting_lines" ADD CONSTRAINT "employee_reporting_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_reporting_lines" ADD CONSTRAINT "employee_reporting_lines_supervisor_id_employees_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_sensitive_identifiers" ADD CONSTRAINT "employee_sensitive_identifiers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_sensitive_identifiers" ADD CONSTRAINT "employee_sensitive_identifiers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_employment_type_id_employment_types_id_fk" FOREIGN KEY ("employment_type_id") REFERENCES "public"."employment_types"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_working_time_id_working_times_id_fk" FOREIGN KEY ("working_time_id") REFERENCES "public"."working_times"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_line_manager_id_employees_id_fk" FOREIGN KEY ("line_manager_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "activity_codes" ADD CONSTRAINT "activity_codes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employment_types" ADD CONSTRAINT "employment_types_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cost_centre_id_cost_centres_id_fk" FOREIGN KEY ("cost_centre_id") REFERENCES "public"."cost_centres"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "working_times" ADD CONSTRAINT "working_times_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_bank_details_employee_unique" ON "employee_bank_details" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_bank_details_org_idx" ON "employee_bank_details" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_compensation_employee_unique" ON "employee_compensation" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_compensation_org_idx" ON "employee_compensation" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_reporting_lines_current_primary_unique" ON "employee_reporting_lines" USING btree ("employee_id") WHERE "employee_reporting_lines"."is_primary" AND "employee_reporting_lines"."effective_to" IS NULL AND "employee_reporting_lines"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "employee_reporting_lines_supervisor_idx" ON "employee_reporting_lines" USING btree ("organisation_id","supervisor_id","effective_to");--> statement-breakpoint
CREATE INDEX "employee_reporting_lines_employee_idx" ON "employee_reporting_lines" USING btree ("organisation_id","employee_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_sensitive_identifiers_employee_unique" ON "employee_sensitive_identifiers" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_sensitive_identifiers_org_idx" ON "employee_sensitive_identifiers" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_number_unique" ON "employees" USING btree ("organisation_id","employee_number");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_work_email_unique" ON "employees" USING btree ("organisation_id",lower("work_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "employees_workspace_email_unique" ON "employees" USING btree ("organisation_id",lower("workspace_email")) WHERE "employees"."workspace_email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("organisation_id","department_id","status");--> statement-breakpoint
CREATE INDEX "employees_location_idx" ON "employees" USING btree ("organisation_id","location_id","status");--> statement-breakpoint
CREATE INDEX "employees_position_idx" ON "employees" USING btree ("organisation_id","position_id","status");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("organisation_id","line_manager_id","status");--> statement-breakpoint
CREATE INDEX "employees_project_idx" ON "employees" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE INDEX "employees_cost_centre_idx" ON "employees" USING btree ("organisation_id","cost_centre_id","status");--> statement-breakpoint
CREATE INDEX "employees_start_date_idx" ON "employees" USING btree ("organisation_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_code_unique" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "user_roles_organisation_idx" ON "user_roles" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_unique" ON "users" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_workspace_email_unique" ON "users" USING btree ("organisation_id",lower("workspace_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_workspace_subject_unique" ON "users" USING btree ("workspace_subject") WHERE "users"."workspace_subject" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_codes_organisation_name_unique" ON "activity_codes" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "activity_codes_organisation_code_unique" ON "activity_codes" USING btree ("organisation_id",lower("code")) WHERE "activity_codes"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_codes_active_order_idx" ON "activity_codes" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centres_organisation_name_unique" ON "cost_centres" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centres_organisation_code_unique" ON "cost_centres" USING btree ("organisation_id",lower("code")) WHERE "cost_centres"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cost_centres_active_order_idx" ON "cost_centres" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_organisation_name_unique" ON "currencies" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_organisation_code_unique" ON "currencies" USING btree ("organisation_id",lower("code")) WHERE "currencies"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "currencies_active_order_idx" ON "currencies" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_organisation_name_unique" ON "departments" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "departments_organisation_code_unique" ON "departments" USING btree ("organisation_id",lower("code")) WHERE "departments"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "departments_active_order_idx" ON "departments" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "employment_types_organisation_name_unique" ON "employment_types" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "employment_types_organisation_code_unique" ON "employment_types" USING btree ("organisation_id",lower("code")) WHERE "employment_types"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "employment_types_active_order_idx" ON "employment_types" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_organisation_name_unique" ON "grades" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "grades_organisation_code_unique" ON "grades" USING btree ("organisation_id",lower("code")) WHERE "grades"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "grades_active_order_idx" ON "grades" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_organisation_name_unique" ON "locations" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "locations_organisation_code_unique" ON "locations" USING btree ("organisation_id",lower("code")) WHERE "locations"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "locations_active_order_idx" ON "locations" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_organisation_name_unique" ON "positions" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "positions_organisation_code_unique" ON "positions" USING btree ("organisation_id",lower("code")) WHERE "positions"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "positions_active_order_idx" ON "positions" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE INDEX "positions_department_idx" ON "positions" USING btree ("organisation_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_organisation_name_unique" ON "projects" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "projects_organisation_code_unique" ON "projects" USING btree ("organisation_id",lower("code")) WHERE "projects"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "projects_active_order_idx" ON "projects" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE INDEX "projects_cost_centre_idx" ON "projects" USING btree ("organisation_id","cost_centre_id");--> statement-breakpoint
CREATE INDEX "projects_location_idx" ON "projects" USING btree ("organisation_id","location_id");--> statement-breakpoint
CREATE INDEX "projects_manager_idx" ON "projects" USING btree ("organisation_id","manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_organisation_name_unique" ON "public_holidays" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_organisation_code_unique" ON "public_holidays" USING btree ("organisation_id",lower("code")) WHERE "public_holidays"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "public_holidays_active_order_idx" ON "public_holidays" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "public_holidays_scope_date_unique" ON "public_holidays" USING btree ("organisation_id","holiday_date",coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "public_holidays_date_idx" ON "public_holidays" USING btree ("organisation_id","holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "working_times_organisation_name_unique" ON "working_times" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "working_times_organisation_code_unique" ON "working_times" USING btree ("organisation_id",lower("code")) WHERE "working_times"."code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "working_times_active_order_idx" ON "working_times" USING btree ("organisation_id","is_active","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "app_settings_organisation_unique" ON "app_settings" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "app_settings_organisation_idx" ON "app_settings" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_slug_unique" ON "organisations" USING btree (lower("slug"));--> statement-breakpoint

-- H3.2 invariants that cannot be represented by the Drizzle table DSL.
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_employees_id_fk"
  FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id")
  ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint

INSERT INTO "roles" ("id", "created_by", "updated_by", "code", "description", "is_assignable", "is_protected") VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Employee', 'Standard employee self-service access', true, true),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Line Manager', 'Direct-report supervision and first-stage approvals', true, true),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'HR', 'People operations administration and approvals', true, true),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Accounts', 'Payroll and financial workflow access', true, true),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Super Admin', 'Organisation-wide configuration and final authority', true, true),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'IT', 'Technology and equipment onboarding responsibilities', true, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "via_hr_assign_employee_role"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "user_roles" ("organisation_id", "user_id", "role_id", "assigned_by", "reason")
  SELECT NEW."organisation_id", NEW."id", "roles"."id", NEW."created_by", 'Default role assigned when the user was created'
  FROM "roles"
  WHERE "roles"."code" = 'Employee'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "users_assign_employee_role"
AFTER INSERT ON "users"
FOR EACH ROW EXECUTE FUNCTION "via_hr_assign_employee_role"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "via_hr_prevent_management_cycle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW."line_manager_id" IS NULL THEN
    RETURN NEW;
  END IF;

  WITH RECURSIVE manager_chain AS (
    SELECT "id", "line_manager_id"
    FROM "employees"
    WHERE "id" = NEW."line_manager_id"
    UNION ALL
    SELECT employee."id", employee."line_manager_id"
    FROM "employees" employee
    JOIN manager_chain chain ON employee."id" = chain."line_manager_id"
  )
  SELECT EXISTS (SELECT 1 FROM manager_chain WHERE "id" = NEW."id") INTO cycle_found;

  IF cycle_found THEN
    RAISE EXCEPTION 'The reporting-line change would create a management cycle.';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "employees_prevent_management_cycle"
BEFORE INSERT OR UPDATE OF "line_manager_id" ON "employees"
FOR EACH ROW EXECUTE FUNCTION "via_hr_prevent_management_cycle"();
