CREATE TYPE "public"."background_job_status" AS ENUM('Queued', 'Running', 'Retry Scheduled', 'Completed', 'Failed', 'Cancelled');--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"module" text NOT NULL,
	"job_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "background_job_status" DEFAULT 'Queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"completed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "background_jobs_attempts_valid" CHECK ("background_jobs"."attempts" >= 0 AND "background_jobs"."max_attempts" > 0),
	CONSTRAINT "background_jobs_type_not_blank" CHECK (btrim("background_jobs"."job_type") <> '')
);
--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "background_jobs_org_entity_idx" ON "background_jobs" USING btree ("organisation_id","entity_type","entity_id");