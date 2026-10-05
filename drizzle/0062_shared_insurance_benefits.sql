ALTER TABLE "company_library" DROP CONSTRAINT IF EXISTS "company_library_kind";--> statement-breakpoint
ALTER TABLE "company_library" DROP CONSTRAINT IF EXISTS "company_library_access";--> statement-breakpoint
ALTER TABLE "company_library" DROP CONSTRAINT IF EXISTS "company_library_kind_check";--> statement-breakpoint
ALTER TABLE "company_library" DROP CONSTRAINT IF EXISTS "company_library_audience_check";--> statement-breakpoint
ALTER TABLE "company_library" ADD COLUMN "employee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "company_library" ADD CONSTRAINT "company_library_kind" CHECK ("company_library"."kind" IN ('Library', 'Company', 'Insurance'));--> statement-breakpoint
ALTER TABLE "company_library" ADD CONSTRAINT "company_library_access" CHECK (("company_library"."audience" IN ('All staff', 'HR only') OR ("company_library"."kind" = 'Insurance' AND "company_library"."audience" = 'Selected employees' AND cardinality("company_library"."employee_ids") > 0)) AND ("company_library"."kind" <> 'Company' OR "company_library"."audience" = 'HR only'));
