CREATE TABLE "recruitment_mailbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"status" text NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_mailbox_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"verifier_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"email" text NOT NULL,
	"refresh_token_encrypted" text,
	"connected_by" uuid NOT NULL,
	"label_id" text NOT NULL,
	"since_date" text NOT NULL,
	"vacancy_id" uuid,
	"paused" boolean DEFAULT true NOT NULL,
	"page_token" text,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "recruitment_mailbox_messages" ADD CONSTRAINT "recruitment_mailbox_messages_mailbox_id_recruitment_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."recruitment_mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_mailbox_states" ADD CONSTRAINT "recruitment_mailbox_states_mailbox_id_recruitment_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."recruitment_mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_mailbox_states" ADD CONSTRAINT "recruitment_mailbox_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_mailboxes" ADD CONSTRAINT "recruitment_mailboxes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_mailboxes" ADD CONSTRAINT "recruitment_mailboxes_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_mailboxes" ADD CONSTRAINT "recruitment_mailboxes_vacancy_id_vacancies_id_fk" FOREIGN KEY ("vacancy_id") REFERENCES "public"."vacancies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_mailbox_message_unique" ON "recruitment_mailbox_messages" USING btree ("mailbox_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recruitment_mailbox_email_unique" ON "recruitment_mailboxes" USING btree ("organisation_id","email");