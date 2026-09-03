CREATE TABLE "worker_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" text NOT NULL,
	"hostname" text NOT NULL,
	"build_version" text NOT NULL,
	"status" text DEFAULT 'Running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "worker_instances_id_not_blank" CHECK (btrim("worker_instances"."worker_id") <> ''),
	CONSTRAINT "worker_instances_status" CHECK ("worker_instances"."status" IN ('Running','Stopping','Stopped','Stale'))
);
--> statement-breakpoint
CREATE TABLE "worker_schedules" (
	"task_name" text PRIMARY KEY NOT NULL,
	"interval_seconds" integer NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_completed_at" timestamp with time zone,
	"last_status" text,
	"last_result" jsonb,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "worker_schedules_task_not_blank" CHECK (btrim("worker_schedules"."task_name") <> ''),
	CONSTRAINT "worker_schedules_interval_positive" CHECK ("worker_schedules"."interval_seconds" BETWEEN 1 AND 86400),
	CONSTRAINT "worker_schedules_failures_non_negative" CHECK ("worker_schedules"."consecutive_failures" >= 0),
	CONSTRAINT "worker_schedules_status" CHECK ("worker_schedules"."last_status" IS NULL OR "worker_schedules"."last_status" IN ('Completed','Failed'))
);
--> statement-breakpoint
CREATE TABLE "worker_task_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_instance_id" uuid NOT NULL,
	"task_name" text NOT NULL,
	"status" text DEFAULT 'Running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"result" jsonb,
	"error" text,
	CONSTRAINT "worker_task_runs_task_not_blank" CHECK (btrim("worker_task_runs"."task_name") <> ''),
	CONSTRAINT "worker_task_runs_status" CHECK ("worker_task_runs"."status" IN ('Running','Completed','Failed')),
	CONSTRAINT "worker_task_runs_duration_non_negative" CHECK ("worker_task_runs"."duration_ms" IS NULL OR "worker_task_runs"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "worker_task_runs" ADD CONSTRAINT "worker_task_runs_worker_instance_id_worker_instances_id_fk" FOREIGN KEY ("worker_instance_id") REFERENCES "public"."worker_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_instances_worker_id_unique" ON "worker_instances" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "worker_instances_status_heartbeat_idx" ON "worker_instances" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE INDEX "worker_schedules_due_idx" ON "worker_schedules" USING btree ("next_run_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "worker_task_runs_task_started_idx" ON "worker_task_runs" USING btree ("task_name","started_at");--> statement-breakpoint
CREATE INDEX "worker_task_runs_status_started_idx" ON "worker_task_runs" USING btree ("status","started_at");