CREATE TABLE "estimates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"scheme" text DEFAULT 'commission' NOT NULL,
	"request" text DEFAULT '' NOT NULL,
	"params" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"freight" jsonb,
	"rates_date" date,
	"rates" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimates_created_idx" ON "estimates" USING btree ("created_at");