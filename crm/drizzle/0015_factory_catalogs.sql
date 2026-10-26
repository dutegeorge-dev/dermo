CREATE TABLE "catalog_senders" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"sender" text NOT NULL,
	"chat" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"attachment_id" uuid,
	"filename" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text,
	"sender" text,
	"chat" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"method" text,
	"pages" integer,
	"result" jsonb,
	"text" text DEFAULT '' NOT NULL,
	"note" text,
	"usage" jsonb,
	"factory_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_senders" ADD CONSTRAINT "catalog_senders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_senders_filename_idx" ON "catalog_senders" USING btree ("filename");--> statement-breakpoint
CREATE INDEX "catalogs_status_idx" ON "catalogs" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "catalogs_sha_idx" ON "catalogs" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "catalogs_factory_idx" ON "catalogs" USING btree ("factory_id");