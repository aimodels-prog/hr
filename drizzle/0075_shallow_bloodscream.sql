ALTER TABLE "attendance_policies" ALTER COLUMN "punch_deduplication_minutes" SET DEFAULT 15;--> statement-breakpoint
-- Raise the previous two-minute default so a repeated morning thumb five minutes later
-- remains a sign-in. Preserve policies where HR chose any other interval.
UPDATE "attendance_policies"
SET "punch_deduplication_minutes" = 15,
    "record_version" = "record_version" + 1,
    "updated_at" = now()
WHERE "punch_deduplication_minutes" = 2;
