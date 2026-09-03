CREATE TABLE "attendance_punch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"attendance_record_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_meters" double precision NOT NULL,
	"client_ip" text NOT NULL,
	"network_verified" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "attendance_punch_events_direction" CHECK ("attendance_punch_events"."direction" IN ('in', 'out')),
	CONSTRAINT "attendance_punch_events_accuracy" CHECK ("attendance_punch_events"."accuracy_meters" >= 0),
	CONSTRAINT "attendance_punch_events_network" CHECK ("attendance_punch_events"."network_verified")
);
--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD COLUMN "anti_spoofing_mode" text DEFAULT 'Approved Network' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD COLUMN "approved_network_cidrs" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_attendance_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_punch_events_record_idx" ON "attendance_punch_events" USING btree ("attendance_record_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attendance_punch_events_employee_idx" ON "attendance_punch_events" USING btree ("organisation_id","employee_id","occurred_at");--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_anti_spoofing" CHECK ("attendance_policies"."anti_spoofing_mode" = 'Approved Network');