CREATE TYPE "public"."asset_assignment_status" AS ENUM('Assigned', 'Returned', 'Lost', 'Damaged');--> statement-breakpoint
CREATE TYPE "public"."asset_condition" AS ENUM('New', 'Good', 'Fair', 'Damaged');--> statement-breakpoint
CREATE TYPE "public"."company_asset_status" AS ENUM('Available', 'Assigned', 'Lost', 'Damaged', 'Retired');--> statement-breakpoint
CREATE TABLE "asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_date" date NOT NULL,
	"condition_at_assignment" "asset_condition" NOT NULL,
	"status" "asset_assignment_status" DEFAULT 'Assigned' NOT NULL,
	"returned_date" date,
	"return_condition" "asset_condition",
	"notes" text,
	CONSTRAINT "asset_assignments_return_consistency" CHECK ("asset_assignments"."status" <> 'Returned' OR ("asset_assignments"."returned_date" IS NOT NULL AND "asset_assignments"."return_condition" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "company_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"asset_type" text NOT NULL,
	"asset_tag" text NOT NULL,
	"description" text NOT NULL,
	"current_condition" "asset_condition" NOT NULL,
	"status" "company_asset_status" DEFAULT 'Available' NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	CONSTRAINT "company_assets_tag_not_blank" CHECK (btrim("company_assets"."asset_tag") <> ''),
	CONSTRAINT "company_assets_description_not_blank" CHECK (btrim("company_assets"."description") <> '')
);
--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_company_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."company_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_assets" ADD CONSTRAINT "company_assets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_assignments_org_employee_idx" ON "asset_assignments" USING btree ("organisation_id","employee_id");--> statement-breakpoint
CREATE INDEX "asset_assignments_org_asset_status_idx" ON "asset_assignments" USING btree ("organisation_id","asset_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_assets_org_tag_unique" ON "company_assets" USING btree ("organisation_id","asset_tag");--> statement-breakpoint
CREATE INDEX "company_assets_org_status_idx" ON "company_assets" USING btree ("organisation_id","status");