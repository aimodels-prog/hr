-- Drizzle runs migrations in a transaction. Recreate this enum rather than using
-- ALTER TYPE ADD VALUE, whose new value cannot be used by a CHECK until commit.
ALTER TABLE "travel_requests" DROP CONSTRAINT "travel_requests_pre_authorised_dual_approval";--> statement-breakpoint
ALTER TABLE "travel_approvals" DROP CONSTRAINT "travel_approvals_rejection_reason";--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "manager_approval_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "hr_approval_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "accounts_approval_status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."travel_approval_state" RENAME TO "travel_approval_state_old";--> statement-breakpoint
CREATE TYPE "public"."travel_approval_state" AS ENUM ('Pending', 'Approved', 'Rejected', 'Not Required');--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "manager_approval_status" TYPE "public"."travel_approval_state" USING "manager_approval_status"::text::"public"."travel_approval_state";--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "hr_approval_status" TYPE "public"."travel_approval_state" USING "hr_approval_status"::text::"public"."travel_approval_state";--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "accounts_approval_status" TYPE "public"."travel_approval_state" USING "accounts_approval_status"::text::"public"."travel_approval_state";--> statement-breakpoint
ALTER TABLE "travel_approvals" ALTER COLUMN "state" TYPE "public"."travel_approval_state" USING "state"::text::"public"."travel_approval_state";--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "manager_approval_status" SET DEFAULT 'Pending';--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "hr_approval_status" SET DEFAULT 'Pending';--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "accounts_approval_status" SET DEFAULT 'Pending';--> statement-breakpoint
DROP TYPE "public"."travel_approval_state_old";--> statement-breakpoint
ALTER TABLE "travel_requests" ADD COLUMN "approval_route" jsonb DEFAULT '{"kind":"Standard"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_approvals" ADD CONSTRAINT "travel_approvals_rejection_reason" CHECK ("travel_approvals"."state" <> 'Rejected' OR btrim(coalesce("travel_approvals"."reason", '')) <> '');--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_pre_authorised_dual_approval" CHECK ("travel_requests"."status" <> 'Pre-authorised' OR (
        "travel_requests"."pre_authorised_at" IS NOT NULL AND (
          (("travel_requests"."approval_route"->>'kind') = 'Standard'
            AND "travel_requests"."manager_approval_status" = 'Approved'
            AND "travel_requests"."hr_approval_status" = 'Approved'
            AND "travel_requests"."accounts_approval_status" = 'Approved')
          OR (("travel_requests"."approval_route"->>'kind') = 'Managerless Executive'
            AND "travel_requests"."manager_approval_status" IN ('Approved', 'Not Required')
            AND ((("travel_requests"."approval_route"->>'reviewerRole') = 'Accounts'
                  AND "travel_requests"."hr_approval_status" = 'Not Required'
                  AND "travel_requests"."accounts_approval_status" = 'Approved')
              OR (("travel_requests"."approval_route"->>'reviewerRole') = 'HR'
                  AND "travel_requests"."hr_approval_status" = 'Approved'
                  AND "travel_requests"."accounts_approval_status" = 'Not Required')))
          OR (("travel_requests"."approval_route"->>'kind') = 'HR Own Travel'
            AND "travel_requests"."manager_approval_status" = 'Approved'
            AND "travel_requests"."hr_approval_status" = 'Not Required'
            AND "travel_requests"."accounts_approval_status" = 'Approved')
        )));
