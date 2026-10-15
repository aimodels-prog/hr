ALTER TABLE "attendance_policies" ALTER COLUMN "punch_deduplication_minutes" SET DEFAULT 15;--> statement-breakpoint
-- Raise the old default for saved policies without changing HR-selected alternatives.
UPDATE "attendance_policies"
SET "punch_deduplication_minutes" = 15,
    "record_version" = "record_version" + 1,
    "updated_at" = now()
WHERE "punch_deduplication_minutes" = 2;
