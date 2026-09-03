CREATE TABLE "employee_goals" (
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
	"title" text NOT NULL,
	"description" text NOT NULL,
	"success_measure" text NOT NULL,
	"target_value" text NOT NULL,
	"start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"weight" integer NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"manager_feedback" text,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	CONSTRAINT "employee_goals_title_not_blank" CHECK (btrim("employee_goals"."title") <> ''),
	CONSTRAINT "employee_goals_description_not_blank" CHECK (btrim("employee_goals"."description") <> ''),
	CONSTRAINT "employee_goals_measure_not_blank" CHECK (btrim("employee_goals"."success_measure") <> ''),
	CONSTRAINT "employee_goals_target_not_blank" CHECK (btrim("employee_goals"."target_value") <> ''),
	CONSTRAINT "employee_goals_date_order" CHECK ("employee_goals"."due_date" >= "employee_goals"."start_date"),
	CONSTRAINT "employee_goals_weight_range" CHECK ("employee_goals"."weight" BETWEEN 1 AND 100),
	CONSTRAINT "employee_goals_progress_range" CHECK ("employee_goals"."progress_percent" BETWEEN 0 AND 100),
	CONSTRAINT "employee_goals_status" CHECK ("employee_goals"."status" IN ('Draft','Pending Approval','Changes Requested','Active','Completion Pending','Completed','Cancelled'))
);
--> statement-breakpoint
CREATE TABLE "goal_check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"progress_percent" integer NOT NULL,
	"progress_comment" text NOT NULL,
	"evidence_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "goal_check_ins_progress_range" CHECK ("goal_check_ins"."progress_percent" BETWEEN 0 AND 100),
	CONSTRAINT "goal_check_ins_comment_not_blank" CHECK (btrim("goal_check_ins"."progress_comment") <> '')
);
--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_cycle_id_performance_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_check_ins" ADD CONSTRAINT "goal_check_ins_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_check_ins" ADD CONSTRAINT "goal_check_ins_goal_id_employee_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."employee_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_check_ins" ADD CONSTRAINT "goal_check_ins_evidence_file_id_file_metadata_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."file_metadata"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_goals_org_employee_cycle_idx" ON "employee_goals" USING btree ("organisation_id","employee_id","cycle_id");--> statement-breakpoint
CREATE INDEX "employee_goals_org_status_idx" ON "employee_goals" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "goal_check_ins_org_goal_created_idx" ON "goal_check_ins" USING btree ("organisation_id","goal_id","created_at");