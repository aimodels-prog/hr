CREATE TABLE "report_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"report_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	CONSTRAINT "report_saved_views_report_not_blank" CHECK (btrim("report_saved_views"."report_id") <> ''),
	CONSTRAINT "report_saved_views_name_length" CHECK (char_length(btrim("report_saved_views"."name")) BETWEEN 2 AND 60)
);
--> statement-breakpoint
ALTER TABLE "report_saved_views" ADD CONSTRAINT "report_saved_views_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_saved_views" ADD CONSTRAINT "report_saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_saved_views_owner_report_idx" ON "report_saved_views" USING btree ("organisation_id","owner_user_id","report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_saved_views_owner_name_unique" ON "report_saved_views" USING btree ("organisation_id","owner_user_id","report_id",lower("name")) WHERE "report_saved_views"."archived_at" IS NULL;