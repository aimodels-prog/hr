ALTER TABLE "attendance_devices" ADD COLUMN "pairing_code_hash" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "pairing_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "credential_encrypted" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "paired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "connector_version" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "connector_platform" text;