CREATE TYPE "public"."attendance_device_punch_status" AS ENUM('Applied', 'Unmatched Employee', 'Rejected');--> statement-breakpoint
ALTER TYPE "public"."attendance_source" ADD VALUE 'Multiple Sources';--> statement-breakpoint
CREATE TABLE "attendance_device_employee_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_user_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	CONSTRAINT "attendance_device_mapping_user_not_blank" CHECK (btrim("attendance_device_employee_mappings"."device_user_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "attendance_device_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"external_event_id" text NOT NULL,
	"device_user_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"device_status" integer,
	"punch_method" integer,
	"employee_id" uuid,
	"attendance_record_id" uuid,
	"punch_event_id" uuid,
	"status" "attendance_device_punch_status" NOT NULL,
	"failure_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_device_punch_external_not_blank" CHECK (btrim("attendance_device_punches"."external_event_id") <> ''),
	CONSTRAINT "attendance_device_punch_user_not_blank" CHECK (btrim("attendance_device_punches"."device_user_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "attendance_devices" (
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
	"location_id" uuid NOT NULL,
	"serial_number" text,
	"model" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "attendance_devices_code_not_blank" CHECK (btrim("attendance_devices"."code") <> ''),
	CONSTRAINT "attendance_devices_name_not_blank" CHECK (btrim("attendance_devices"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "attendance_punch_events" DROP CONSTRAINT "attendance_punch_events_network";--> statement-breakpoint
ALTER TABLE "attendance_punch_events" DROP CONSTRAINT "attendance_punch_events_accuracy";--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ALTER COLUMN "location_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ALTER COLUMN "latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ALTER COLUMN "longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ALTER COLUMN "accuracy_meters" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ALTER COLUMN "client_ip" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD COLUMN "punch_deduplication_minutes" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD COLUMN "source" text DEFAULT 'Web' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD COLUMN "external_event_id" text;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD COLUMN "device_user_id" text;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD COLUMN "device_status" integer;--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD COLUMN "punch_method" integer;--> statement-breakpoint
ALTER TABLE "attendance_device_employee_mappings" ADD CONSTRAINT "attendance_device_employee_mappings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_employee_mappings" ADD CONSTRAINT "attendance_device_employee_mappings_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_employee_mappings" ADD CONSTRAINT "attendance_device_employee_mappings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_attendance_record_id_attendance_records_id_fk" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_punch_event_id_attendance_punch_events_id_fk" FOREIGN KEY ("punch_event_id") REFERENCES "public"."attendance_punch_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_user_unique" ON "attendance_device_employee_mappings" USING btree ("device_id","device_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_employee_unique" ON "attendance_device_employee_mappings" USING btree ("device_id","employee_id");--> statement-breakpoint
CREATE INDEX "attendance_device_mapping_org_employee_idx" ON "attendance_device_employee_mappings" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_punch_external_unique" ON "attendance_device_punches" USING btree ("device_id","external_event_id");--> statement-breakpoint
CREATE INDEX "attendance_device_punch_org_status_idx" ON "attendance_device_punches" USING btree ("organisation_id","status","received_at");--> statement-breakpoint
CREATE INDEX "attendance_device_punch_user_idx" ON "attendance_device_punches" USING btree ("device_id","device_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_devices_org_code_unique" ON "attendance_devices" USING btree ("organisation_id","code");--> statement-breakpoint
CREATE INDEX "attendance_devices_org_active_idx" ON "attendance_devices" USING btree ("organisation_id","is_active");--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punch_events_device_external_unique" ON "attendance_punch_events" USING btree ("device_id","external_event_id") WHERE "attendance_punch_events"."device_id" IS NOT NULL AND "attendance_punch_events"."external_event_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_punch_deduplication_range" CHECK ("attendance_policies"."punch_deduplication_minutes" BETWEEN 0 AND 15);--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_source" CHECK ("attendance_punch_events"."source" IN ('Web', 'Hardware Terminal', 'Site Visit Auto'));--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_evidence" CHECK (("attendance_punch_events"."source" = 'Hardware Terminal' AND "attendance_punch_events"."device_id" IS NOT NULL AND "attendance_punch_events"."external_event_id" IS NOT NULL AND "attendance_punch_events"."device_user_id" IS NOT NULL)
          OR ("attendance_punch_events"."source" <> 'Hardware Terminal' AND "attendance_punch_events"."location_id" IS NOT NULL AND "attendance_punch_events"."latitude" IS NOT NULL AND "attendance_punch_events"."longitude" IS NOT NULL AND "attendance_punch_events"."client_ip" IS NOT NULL AND "attendance_punch_events"."network_verified"));--> statement-breakpoint
ALTER TABLE "attendance_punch_events" ADD CONSTRAINT "attendance_punch_events_accuracy" CHECK ("attendance_punch_events"."accuracy_meters" IS NULL OR "attendance_punch_events"."accuracy_meters" >= 0);
--> statement-breakpoint
CREATE TRIGGER via_hr_record_version_guard BEFORE UPDATE ON "attendance_devices"
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
--> statement-breakpoint
CREATE TRIGGER via_hr_record_version_guard BEFORE UPDATE ON "attendance_device_employee_mappings"
FOR EACH ROW EXECUTE FUNCTION via_hr_enforce_record_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "via_hr_protect_attendance_device_punch_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.external_event_id IS DISTINCT FROM OLD.external_event_id
     OR NEW.device_user_id IS DISTINCT FROM OLD.device_user_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.device_status IS DISTINCT FROM OLD.device_status
     OR NEW.punch_method IS DISTINCT FROM OLD.punch_method
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'terminal punch evidence cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER via_hr_attendance_device_punch_evidence_guard
BEFORE UPDATE ON "attendance_device_punches"
FOR EACH ROW EXECUTE FUNCTION via_hr_protect_attendance_device_punch_evidence();
