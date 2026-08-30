ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_counts_non_negative";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_counts_consistent";--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "seed_version" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "dataset_checksum" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "unchanged_rows" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_counts_non_negative" CHECK ("import_batches"."total_rows" >= 0 AND "import_batches"."valid_rows" >= 0 AND "import_batches"."unchanged_rows" >= 0 AND "import_batches"."rejected_rows" >= 0);--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_counts_consistent" CHECK ("import_batches"."valid_rows" + "import_batches"."unchanged_rows" + "import_batches"."rejected_rows" <= "import_batches"."total_rows");