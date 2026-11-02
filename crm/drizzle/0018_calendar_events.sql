CREATE TABLE "calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"end_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"amount" numeric(16, 2),
	"currency" text,
	"shipment_id" integer,
	"counterparty_id" integer,
	"assignee_id" integer,
	"done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_date_idx" ON "calendar_events" USING btree ("date");