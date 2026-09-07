ALTER TABLE "candidate_assessment_batches" DROP CONSTRAINT "candidate_assessment_batches_target_size";--> statement-breakpoint
ALTER TABLE "shortlist_snapshots" DROP CONSTRAINT "shortlist_snapshots_size_check";--> statement-breakpoint
ALTER TABLE "candidate_assessment_batches" ADD CONSTRAINT "candidate_assessment_batches_target_size" CHECK ("candidate_assessment_batches"."target_size" >= 1);--> statement-breakpoint
ALTER TABLE "shortlist_snapshots" ADD CONSTRAINT "shortlist_snapshots_size_check" CHECK ("shortlist_snapshots"."target_size" >= 1);