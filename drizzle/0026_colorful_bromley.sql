ALTER TYPE "public"."candidate_cv_source" ADD VALUE 'Internal Application';--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD COLUMN "internal_applicant_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD COLUMN "submitted_by_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "recommender_employee_id" uuid;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "candidate_aware" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD COLUMN "years_known" integer;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "accepts_internal_applications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vacancies" ADD COLUMN "accepts_employee_referrals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_internal_applicant_employee_id_employees_id_fk" FOREIGN KEY ("internal_applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_applications" ADD CONSTRAINT "candidate_applications_submitted_by_employee_id_employees_id_fk" FOREIGN KEY ("submitted_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_recommender_employee_id_employees_id_fk" FOREIGN KEY ("recommender_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_applications_internal_employee_idx" ON "candidate_applications" USING btree ("organisation_id","internal_applicant_employee_id");--> statement-breakpoint
CREATE INDEX "candidate_applications_submitter_idx" ON "candidate_applications" USING btree ("organisation_id","submitted_by_employee_id");--> statement-breakpoint
CREATE INDEX "candidate_recommendations_employee_idx" ON "candidate_recommendations" USING btree ("organisation_id","recommender_employee_id");--> statement-breakpoint
ALTER TABLE "candidate_recommendations" ADD CONSTRAINT "candidate_recommendations_years_known_non_negative" CHECK ("candidate_recommendations"."years_known" IS NULL OR "candidate_recommendations"."years_known" >= 0);