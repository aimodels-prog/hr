CREATE TABLE "time_away" (
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
	"category" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'Pending HR' NOT NULL,
	"treatment" text,
	"review_note" text,
	"reviewed_by" uuid,
	CONSTRAINT "time_away_status" CHECK ("time_away"."status" IN ('Pending HR','Approved','Rejected','Cancelled')),
	CONSTRAINT "time_away_category" CHECK ("time_away"."category" IN ('Medical appointment','Personal matter','Other')),
	CONSTRAINT "time_away_treatment" CHECK ("time_away"."treatment" IS NULL OR "time_away"."treatment" IN ('Paid time','Unpaid time','Leave')),
	CONSTRAINT "time_away_approved_treatment" CHECK ("time_away"."status" <> 'Approved' OR ("time_away"."treatment" IS NOT NULL AND "time_away"."reviewed_by" IS NOT NULL)),
	CONSTRAINT "time_away_times" CHECK ("time_away"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "time_away"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "time_away"."end_time" > "time_away"."start_time")
);
--> statement-breakpoint
ALTER TABLE "time_away" ADD CONSTRAINT "time_away_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_away" ADD CONSTRAINT "time_away_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_away_org_employee_date" ON "time_away" USING btree ("organisation_id","employee_id","date");