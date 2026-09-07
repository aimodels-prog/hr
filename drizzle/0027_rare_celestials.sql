CREATE TABLE "candidate_cv_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"checksum" text NOT NULL,
	"processor_version" text NOT NULL,
	"document_route" text NOT NULL,
	"extraction_method" text NOT NULL,
	"extracted_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"text_quality" numeric NOT NULL,
	CONSTRAINT "candidate_cv_extractions_text_quality_range" CHECK ("candidate_cv_extractions"."text_quality" >= 0 AND "candidate_cv_extractions"."text_quality" <= 1)
);
--> statement-breakpoint
ALTER TABLE "candidate_cv_extractions" ADD CONSTRAINT "candidate_cv_extractions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_cv_extractions_checksum_version_unique" ON "candidate_cv_extractions" USING btree ("organisation_id","checksum","processor_version");--> statement-breakpoint
CREATE INDEX "candidate_cv_extractions_org_idx" ON "candidate_cv_extractions" USING btree ("organisation_id");