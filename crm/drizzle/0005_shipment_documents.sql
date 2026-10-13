CREATE TABLE "shipment_parties" (
	"shipment_id" integer NOT NULL,
	"counterparty_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_parties_shipment_id_counterparty_id_pk" PRIMARY KEY("shipment_id","counterparty_id")
);
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_supplier_id_counterparties_id_fk";
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_client_contract_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_supplier_contract_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_deal_id_deals_id_fk";
--> statement-breakpoint
DROP INDEX "documents_deal_idx";
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "shipment_id" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "title" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "scheme" "deal_scheme" DEFAULT 'commission' NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "contact_id" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "assignee_id" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "client_contract_id" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "supplier_contract_id" integer;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "hs_code" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "weight_kg" numeric(14, 3);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "volume_m3" numeric(14, 3);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_location" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivery_location" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "export_license" "export_license";
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "certificates" "certificate_status";
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "certificate_holder" text;
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "chestny_znak" "chestny_znak";
--> statement-breakpoint
ALTER TABLE "shipment_parties" ADD CONSTRAINT "shipment_parties_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipment_parties" ADD CONSTRAINT "shipment_parties_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_client_contract_id_documents_id_fk" FOREIGN KEY ("client_contract_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplier_contract_id_documents_id_fk" FOREIGN KEY ("supplier_contract_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "documents_shipment_idx" ON "documents" USING btree ("shipment_id");
--> statement-breakpoint
-- Перенос из воронки в сделки (отгрузки): название груза, маршрут, договоры,
-- поля груза, документы и подрядчики. Сделки воронки с документами без
-- отгрузки получают свою отгрузку.
UPDATE "shipments" SET "title" = "cargo";
--> statement-breakpoint
UPDATE "shipments" SET
  "pickup_location" = CASE WHEN "route" ~ '(→|->| - )' THEN trim(regexp_replace("route", '\s*(→|->| - ).*$', '')) ELSE "route" END,
  "delivery_location" = CASE WHEN "route" ~ '(→|->| - )' THEN trim(regexp_replace("route", '^.*(→|->| - )\s*', '')) END
WHERE "route" IS NOT NULL AND "route" <> '';
--> statement-breakpoint
UPDATE "shipments" s SET
  "scheme" = d."scheme",
  "supplier_id" = coalesce(s."supplier_id", d."supplier_id"),
  "contact_id" = coalesce(s."contact_id", d."contact_id"),
  "client_contract_id" = d."client_contract_id",
  "supplier_contract_id" = d."supplier_contract_id",
  "hs_code" = d."hs_code",
  "weight_kg" = d."weight_kg",
  "volume_m3" = d."volume_m3",
  "pickup_location" = coalesce(s."pickup_location", d."pickup_location"),
  "delivery_location" = coalesce(s."delivery_location", d."delivery_location"),
  "transport" = coalesce(s."transport", d."route"::text),
  "export_license" = d."export_license",
  "certificates" = d."certificates",
  "certificate_holder" = d."certificate_holder",
  "chestny_znak" = d."chestny_znak",
  "assignee_id" = d."assignee_id"
FROM "deals" d WHERE d."id" = s."deal_id";
--> statement-breakpoint
INSERT INTO "shipments" ("status", "stage", "title", "deal_id", "client_id", "supplier_id", "contact_id", "assignee_id", "scheme",
  "client_contract_id", "supplier_contract_id", "hs_code", "weight_kg", "volume_m3", "transport", "pickup_location", "delivery_location",
  "export_license", "certificates", "certificate_holder", "chestny_znak", "notes", "created_by", "created_at")
SELECT CASE WHEN d."outcome" = 'lost' THEN 'cancelled' ELSE 'active' END, 1,
  coalesce(nullif(d."product", ''), d."title"), d."id", d."client_id", d."supplier_id", d."contact_id", d."assignee_id", d."scheme",
  d."client_contract_id", d."supplier_contract_id", d."hs_code", d."weight_kg", d."volume_m3", d."route"::text, d."pickup_location", d."delivery_location",
  d."export_license", d."certificates", d."certificate_holder", d."chestny_znak", CASE WHEN d."source" = 'demo' THEN 'демо' ELSE '' END, d."created_by", d."created_at"
FROM "deals" d
WHERE NOT EXISTS (SELECT 1 FROM "shipments" s WHERE s."deal_id" = d."id")
  AND (EXISTS (SELECT 1 FROM "documents" x WHERE x."deal_id" = d."id") OR EXISTS (SELECT 1 FROM "deal_parties" p WHERE p."deal_id" = d."id"));
--> statement-breakpoint
INSERT INTO "shipment_milestones" ("shipment_id", "key", "plan")
SELECT s."id", 'ready', d."goods_ready_date" FROM "shipments" s JOIN "deals" d ON d."id" = s."deal_id"
WHERE d."goods_ready_date" IS NOT NULL
ON CONFLICT ("shipment_id", "key") DO UPDATE SET "plan" = coalesce("shipment_milestones"."plan", excluded."plan");
--> statement-breakpoint
UPDATE "documents" x SET "shipment_id" = (SELECT min(s."id") FROM "shipments" s WHERE s."deal_id" = x."deal_id") WHERE x."deal_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "shipment_parties" ("shipment_id", "counterparty_id", "created_at")
SELECT (SELECT min(s."id") FROM "shipments" s WHERE s."deal_id" = p."deal_id"), p."counterparty_id", p."created_at"
FROM "deal_parties" p WHERE EXISTS (SELECT 1 FROM "shipments" s WHERE s."deal_id" = p."deal_id")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "shipment_parties" ("shipment_id", "counterparty_id")
SELECT "id", "carrier_id" FROM "shipments" WHERE "carrier_id" IS NOT NULL
ON CONFLICT DO NOTHING
--> statement-breakpoint
ALTER TABLE "deal_parties" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TABLE "deal_parties" CASCADE;
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "scheme";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "supplier_id";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "client_contract_id";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "supplier_contract_id";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "hs_code";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "weight_kg";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "volume_m3";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "pickup_location";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "delivery_location";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "goods_ready_date";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "route";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "contract_party";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "export_license";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "certificates";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "certificate_holder";
--> statement-breakpoint
ALTER TABLE "deals" DROP COLUMN "chestny_znak";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "deal_id";
--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "cargo";
--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "route";
--> statement-breakpoint
DROP TYPE "public"."contract_party";
--> statement-breakpoint
DROP TYPE "public"."deal_route";
