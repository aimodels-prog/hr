CREATE TABLE "hr_independent_review_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"module" text NOT NULL,
	"request_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"reviewer_employee_id" uuid NOT NULL,
	"stage" text DEFAULT 'HR' NOT NULL,
	CONSTRAINT "hr_independent_review_module_valid" CHECK ("hr_independent_review_assignments"."module" IN ('Leave','Timesheet','Attendance Correction','Overtime','Training')),
	CONSTRAINT "hr_independent_review_not_self" CHECK ("hr_independent_review_assignments"."requester_employee_id" <> "hr_independent_review_assignments"."reviewer_employee_id")
);
--> statement-breakpoint
ALTER TABLE "hr_independent_review_assignments" ADD CONSTRAINT "hr_independent_review_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_independent_review_assignments" ADD CONSTRAINT "hr_independent_review_assignments_requester_employee_id_employees_id_fk" FOREIGN KEY ("requester_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_independent_review_assignments" ADD CONSTRAINT "hr_independent_review_assignments_reviewer_employee_id_employees_id_fk" FOREIGN KEY ("reviewer_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_independent_review_request_stage_unique" ON "hr_independent_review_assignments" USING btree ("organisation_id","module","request_id","stage");--> statement-breakpoint
CREATE INDEX "hr_independent_review_reviewer_idx" ON "hr_independent_review_assignments" USING btree ("organisation_id","reviewer_employee_id");