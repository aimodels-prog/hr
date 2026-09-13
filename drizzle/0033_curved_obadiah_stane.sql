ALTER TABLE "job_offers" ADD COLUMN "approver_user_id" uuid;--> statement-breakpoint
ALTER TABLE "job_offers" ADD COLUMN "approval_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "job_offers" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_approval_requested_by_users_id_fk" FOREIGN KEY ("approval_requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;