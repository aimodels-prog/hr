ALTER TABLE "expense_items" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "payroll_inputs" ALTER COLUMN "reimbursements_total" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "payroll_inputs" ALTER COLUMN "reimbursements_total" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "reimbursements" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_transport" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_transport" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_accommodation" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_accommodation" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_per_diem" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_per_diem" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_other" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "est_other" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "total_estimate" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "actual_total" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "travel_requests" ALTER COLUMN "actual_total_omr" SET DATA TYPE numeric(15, 3);