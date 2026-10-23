CREATE TABLE "catalog_shots" (
	"id" serial PRIMARY KEY NOT NULL,
	"attachment_id" uuid,
	"filename" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_shots" ADD CONSTRAINT "catalog_shots_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_shots" ADD CONSTRAINT "catalog_shots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_shots_status_idx" ON "catalog_shots" USING btree ("status","id");