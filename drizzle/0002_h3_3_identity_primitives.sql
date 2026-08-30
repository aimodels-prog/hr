CREATE TABLE "portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "portal_sessions_token_hash_not_blank" CHECK (btrim("portal_sessions"."token_hash") <> ''),
	CONSTRAINT "portal_sessions_expiry_after_creation" CHECK ("portal_sessions"."expires_at" > "portal_sessions"."created_at"),
	CONSTRAINT "portal_sessions_revocation_after_creation" CHECK ("portal_sessions"."revoked_at" IS NULL OR "portal_sessions"."revoked_at" >= "portal_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "workspace_identity_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"record_version" integer DEFAULT 1 NOT NULL,
	"organisation_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_email" text NOT NULL,
	"workspace_subject" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "workspace_identity_mappings_email_normalized" CHECK ("workspace_identity_mappings"."workspace_email" = lower(btrim("workspace_identity_mappings"."workspace_email"))),
	CONSTRAINT "workspace_identity_mappings_status" CHECK ("workspace_identity_mappings"."status" IN ('Pending', 'Verified', 'Suspended', 'Archived')),
	CONSTRAINT "workspace_identity_mappings_verification_consistency" CHECK ("workspace_identity_mappings"."status" <> 'Verified' OR "workspace_identity_mappings"."verified_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_identity_mappings" ADD CONSTRAINT "workspace_identity_mappings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_identity_mappings" ADD CONSTRAINT "workspace_identity_mappings_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_identity_mappings" ADD CONSTRAINT "workspace_identity_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_sessions_token_hash_unique" ON "portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_sessions_org_user_expiry_idx" ON "portal_sessions" USING btree ("organisation_id","user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_identity_mappings_employee_unique" ON "workspace_identity_mappings" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_identity_mappings_user_unique" ON "workspace_identity_mappings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_identity_mappings_org_email_unique" ON "workspace_identity_mappings" USING btree ("organisation_id",lower("workspace_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_identity_mappings_subject_unique" ON "workspace_identity_mappings" USING btree ("workspace_subject") WHERE "workspace_identity_mappings"."workspace_subject" IS NOT NULL;--> statement-breakpoint

CREATE TRIGGER "via_hr_tenant_portal_sessions_user"
BEFORE INSERT OR UPDATE OF "organisation_id", "user_id" ON "portal_sessions"
FOR EACH ROW EXECUTE FUNCTION "via_hr_enforce_same_organisation"('users', 'user_id');--> statement-breakpoint
CREATE TRIGGER "via_hr_tenant_workspace_mapping_employee"
BEFORE INSERT OR UPDATE OF "organisation_id", "employee_id" ON "workspace_identity_mappings"
FOR EACH ROW EXECUTE FUNCTION "via_hr_enforce_same_organisation"('employees', 'employee_id');--> statement-breakpoint
CREATE TRIGGER "via_hr_tenant_workspace_mapping_user"
BEFORE INSERT OR UPDATE OF "organisation_id", "user_id" ON "workspace_identity_mappings"
FOR EACH ROW EXECUTE FUNCTION "via_hr_enforce_same_organisation"('users', 'user_id');
