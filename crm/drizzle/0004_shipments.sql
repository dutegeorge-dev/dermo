CREATE SEQUENCE "public"."shipment_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shipment_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"field" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_milestones" (
	"shipment_id" integer NOT NULL,
	"key" text NOT NULL,
	"plan" date,
	"fact" date,
	CONSTRAINT "shipment_milestones_shipment_id_key_pk" PRIMARY KEY("shipment_id","key")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer DEFAULT nextval('shipment_number_seq') NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stage" integer DEFAULT 1 NOT NULL,
	"client_id" integer,
	"supplier_id" integer,
	"carrier_id" integer,
	"carrier_invoice_id" integer,
	"deal_id" integer,
	"container_no" text,
	"cargo" text DEFAULT '' NOT NULL,
	"transport" text,
	"route" text,
	"deposit_date" date,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "shipments_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_client_id_counterparties_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_id_counterparties_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_invoice_id_documents_id_fk" FOREIGN KEY ("carrier_invoice_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipment_events_idx" ON "shipment_events" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "shipment_milestones_plan_idx" ON "shipment_milestones" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "shipments_client_idx" ON "shipments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "shipments_carrier_idx" ON "shipments" USING btree ("carrier_id");