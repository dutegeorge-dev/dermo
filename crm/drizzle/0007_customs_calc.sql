CREATE TABLE "tnved" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tariff" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "vat10" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "calc" jsonb;