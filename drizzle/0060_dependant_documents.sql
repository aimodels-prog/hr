ALTER TABLE "employee_documents" ADD COLUMN "dependant_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "dependant_document_kind" text;
--> statement-breakpoint
-- Preserve existing family details and give each dependant a stable document owner ID.
UPDATE employees e SET dependants = (
  SELECT jsonb_agg(CASE WHEN item->>'id' IS NULL THEN item || jsonb_build_object('id',gen_random_uuid()::text) ELSE item END ORDER BY ordinal)
  FROM jsonb_array_elements(e.dependants) WITH ORDINALITY AS entries(item,ordinal)
) WHERE jsonb_typeof(e.dependants)='array' AND jsonb_array_length(e.dependants)>0;
