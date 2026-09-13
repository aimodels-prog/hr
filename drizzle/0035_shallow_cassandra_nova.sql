ALTER TABLE "payroll_periods" ADD COLUMN "prepared_by" uuid;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM training_requests WHERE archived_at IS NULL
    AND status IN ('Pending Supervisor', 'Pending HR', 'Approved')
    GROUP BY organisation_id, employee_id, course_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Reconcile duplicate open training requests before applying migration 0035. No training records have been deleted.';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "training_requests_open_employee_course_unique" ON "training_requests" USING btree ("organisation_id","employee_id","course_id") WHERE "training_requests"."archived_at" IS NULL AND "training_requests"."status" IN ('Pending Supervisor', 'Pending HR', 'Approved');
