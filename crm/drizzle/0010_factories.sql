CREATE TABLE "factories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ru" text,
	"wechat_id" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"website" text,
	"location" text,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"found_by" integer,
	"counterparty_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"factory_id" integer NOT NULL,
	"product_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"price" numeric(16, 4),
	"currency" text DEFAULT 'CNY' NOT NULL,
	"unit" text,
	"moq" numeric(16, 3),
	"per_container" numeric(16, 3),
	"kg_per_unit" numeric(16, 4),
	"m3_per_unit" numeric(16, 6),
	"conditions" text DEFAULT '' NOT NULL,
	"quoted_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "factories" ADD CONSTRAINT "factories_found_by_users_id_fk" FOREIGN KEY ("found_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factories" ADD CONSTRAINT "factories_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factories" ADD CONSTRAINT "factories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "factories_wechat_idx" ON "factories" USING btree ("wechat_id");--> statement-breakpoint
CREATE INDEX "factories_found_by_idx" ON "factories" USING btree ("found_by");--> statement-breakpoint
CREATE UNIQUE INDEX "factories_counterparty_idx" ON "factories" USING btree ("counterparty_id");--> statement-breakpoint
CREATE INDEX "product_offers_factory_idx" ON "product_offers" USING btree ("factory_id","position");--> statement-breakpoint
CREATE INDEX "product_offers_product_idx" ON "product_offers" USING btree ("product_id");