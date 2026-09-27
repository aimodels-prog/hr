ALTER TABLE "employee_payslips"
  ADD COLUMN "revision" integer NOT NULL DEFAULT 1,
  ADD COLUMN "replaces_payslip_id" uuid REFERENCES "employee_payslips"("id"),
  ADD COLUMN "replacement_reason" text;
--> statement-breakpoint
ALTER TABLE "employee_payslips" ADD CONSTRAINT "employee_payslips_revision_valid" CHECK (
  ("revision" = 1 AND "replaces_payslip_id" IS NULL AND "replacement_reason" IS NULL)
  OR ("revision" > 1 AND "replaces_payslip_id" IS NOT NULL AND "replacement_reason" IS NOT NULL
    AND length(btrim("replacement_reason")) BETWEEN 5 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_payslips_replacement_unique" ON "employee_payslips" ("replaces_payslip_id");
