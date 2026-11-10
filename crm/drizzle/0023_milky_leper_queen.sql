CREATE TABLE "mail_run_mailboxes" (
	"run_id" integer NOT NULL,
	"mailbox_id" integer NOT NULL,
	CONSTRAINT "mail_run_mailboxes_run_id_mailbox_id_pk" PRIMARY KEY("run_id","mailbox_id")
);
--> statement-breakpoint
CREATE TABLE "mail_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_day" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_runs_plan_day_unique" UNIQUE("plan_day")
);
--> statement-breakpoint
ALTER TABLE "mail_run_mailboxes" ADD CONSTRAINT "mail_run_mailboxes_run_id_mail_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."mail_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_run_mailboxes" ADD CONSTRAINT "mail_run_mailboxes_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_runs" ADD CONSTRAINT "mail_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_run_mailboxes_box_idx" ON "mail_run_mailboxes" USING btree ("mailbox_id");