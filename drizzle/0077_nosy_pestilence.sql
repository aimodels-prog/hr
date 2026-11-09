CREATE TYPE "public"."leave_attendance_review_status" AS ENUM('Pending', 'Resolved', 'Kept');--> statement-breakpoint
CREATE TABLE "leave_attendance_overlap_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"attendance_record_id" uuid NOT NULL,
	"date" date NOT NULL,
	"observed_work_hours" numeric(6, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "leave_attendance_review_status" DEFAULT 'Pending' NOT NULL,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "leave_attendance_reviews_reason_not_blank" CHECK (btrim("leave_attendance_overlap_reviews"."reason") <> ''),
	CONSTRAINT "leave_attendance_reviews_hours_non_negative" CHECK ("leave_attendance_overlap_reviews"."observed_work_hours" >= 0)
);
--> statement-breakpoint
ALTER TABLE "leave_attendance_overlap_reviews" ADD CONSTRAINT "leave_attendance_overlap_reviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_attendance_overlap_reviews" ADD CONSTRAINT "leave_attendance_overlap_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_attendance_overlap_reviews" ADD CONSTRAINT "leave_attendance_overlap_reviews_request_id_leave_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."leave_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_attendance_overlap_reviews" ADD CONSTRAINT "leave_attendance_overlap_reviews_attendance_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_attendance_overlap_reviews" ADD CONSTRAINT "leave_attendance_overlap_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_attendance_reviews_request_date_unique" ON "leave_attendance_overlap_reviews" USING btree ("request_id","date");--> statement-breakpoint
CREATE INDEX "leave_attendance_reviews_org_status_date_idx" ON "leave_attendance_overlap_reviews" USING btree ("organisation_id","status","date");