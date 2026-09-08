CREATE TABLE "candidate_vacancy_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vacancy_id" uuid NOT NULL,
	"vacancy_record_version" integer NOT NULL,
	"candidate_id" uuid NOT NULL,
	"cv_record_id" uuid NOT NULL,
	"preliminary_score" numeric NOT NULL,
	"band" text NOT NULL,
	"compulsory_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matched_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_required_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ranking_model" text NOT NULL,
	"status" text DEFAULT 'Suggested' NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"added_at" timestamp with time zone,
	"added_by_user_id" uuid,
	"dismissal_reason" text,
	CONSTRAINT "candidate_vacancy_matches_score_range" CHECK ("candidate_vacancy_matches"."preliminary_score" >= 0 AND "candidate_vacancy_matches"."preliminary_score" <= 100),
	CONSTRAINT "candidate_vacancy_matches_status_valid" CHECK ("candidate_vacancy_matches"."status" IN ('Suggested', 'Added to Screening', 'Dismissed'))
);
--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "review_status" text DEFAULT 'Pending HR Review' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "review_reason" text;--> statement-breakpoint
UPDATE "candidate_recommendations"
SET "review_status" = CASE
	WHEN "recommender_employee_id" IS NOT NULL AND "source_outcome" = 'Submitted'
		THEN 'Pending HR Review'
	ELSE 'Approved for Interview'
END;--> statement-breakpoint
ALTER TABLE "candidate_vacancy_matches" ADD CONSTRAINT "candidate_vacancy_matches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_vacancy_matches" ADD CONSTRAINT "candidate_vacancy_matches_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_vacancy_matches" ADD CONSTRAINT "candidate_vacancy_matches_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_vacancy_matches" ADD CONSTRAINT "candidate_vacancy_matches_cv_record_id_candidate_cv_records_id_fk" FOREIGN KEY ("cv_record_id") REFERENCES "public"."candidate_cv_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_vacancy_matches" ADD CONSTRAINT "candidate_vacancy_matches_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_vacancy_matches_version_unique" ON "candidate_vacancy_matches" USING btree ("organisation_id","vacancy_id","vacancy_record_version","candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_vacancy_matches_vacancy_score_idx" ON "candidate_vacancy_matches" USING btree ("organisation_id","vacancy_id","preliminary_score");--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_review_status_valid" CHECK ("candidate_recommendations"."review_status" IN ('Pending HR Review', 'Approved for Interview', 'Declined'));
