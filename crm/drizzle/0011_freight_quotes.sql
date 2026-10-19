CREATE TABLE "freight_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_name" text DEFAULT '' NOT NULL,
	"transport" text DEFAULT 'rail' NOT NULL,
	"mode" text DEFAULT 'container' NOT NULL,
	"container" text,
	"origin" text DEFAULT '' NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"rate" numeric(16, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"kg_per_cbm" numeric(10, 2),
	"min_cbm" numeric(10, 3),
	"fee" numeric(16, 2),
	"fee_currency" text DEFAULT 'USD' NOT NULL,
	"transit_days" integer,
	"etd" text DEFAULT '' NOT NULL,
	"valid_until" date,
	"quoted_at" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"offer_id" integer,
	"client_name" text DEFAULT '' NOT NULL,
	"params" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"freight" jsonb,
	"rates_date" date,
	"rates" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freight_rates" ADD CONSTRAINT "freight_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_quotes" ADD CONSTRAINT "product_quotes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_quotes" ADD CONSTRAINT "product_quotes_offer_id_product_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."product_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_quotes" ADD CONSTRAINT "product_quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_quotes_product_idx" ON "product_quotes" USING btree ("product_id","created_at");