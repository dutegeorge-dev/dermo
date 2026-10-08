CREATE TYPE "public"."counterparty_role" AS ENUM('client', 'supplier', 'contractor');--> statement-breakpoint
CREATE TYPE "public"."deal_scheme" AS ENUM('commission', 'supply', 'teu');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partial', 'paid');--> statement-breakpoint
ALTER TYPE "public"."company_kind" ADD VALUE 'foreign';--> statement-breakpoint
CREATE TABLE "deal_parties" (
	"deal_id" integer NOT NULL,
	"counterparty_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_parties_deal_id_counterparty_id_pk" PRIMARY KEY("deal_id","counterparty_id")
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"position" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"batch_no" text,
	"hs_code" text,
	"quantity" numeric(16, 3),
	"unit" text,
	"price" numeric(16, 4),
	"amount" numeric(16, 2)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"number" text,
	"date" date,
	"counterparty_id" integer,
	"client_id" integer,
	"deal_id" integer,
	"parent_id" integer,
	"seq_no" integer,
	"currency" text,
	"amount" numeric(16, 2),
	"status" text,
	"payment_status" "payment_status",
	"paid_amount" numeric(16, 2),
	"paid_at" date,
	"valid_until" date,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ru" text,
	"hs_code" text,
	"unit" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" RENAME TO "counterparties";--> statement-breakpoint
ALTER TABLE "contacts" RENAME COLUMN "client_id" TO "counterparty_id";--> statement-breakpoint
ALTER TABLE "counterparties" DROP CONSTRAINT "clients_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "deals" DROP CONSTRAINT "deals_client_id_clients_id_fk";
--> statement-breakpoint
DROP INDEX "clients_inn_idx";--> statement-breakpoint
DROP INDEX "contacts_client_idx";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "role" "counterparty_role" DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "contractor_type" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "country" text DEFAULT 'RU' NOT NULL;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "kpp" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "ogrn" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "reg_number" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "legal_address" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_account" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_bik" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_corr_account" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_inn" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_address" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "bank_swift" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "signatory_title" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "signatory_name" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "signatory_basis" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "counterparties" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "scheme" "deal_scheme" DEFAULT 'commission' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "client_contract_id" integer;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "supplier_contract_id" integer;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_parties" ADD CONSTRAINT "deal_parties_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_counterparties_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_id_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_items_doc_idx" ON "document_items" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "document_items_product_idx" ON "document_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("type","date");--> statement-breakpoint
CREATE INDEX "documents_counterparty_idx" ON "documents" USING btree ("counterparty_id");--> statement-breakpoint
CREATE INDEX "documents_client_idx" ON "documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "documents_deal_idx" ON "documents" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "documents_parent_idx" ON "documents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "documents_valid_idx" ON "documents" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_counterparties_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_contract_id_documents_id_fk" FOREIGN KEY ("client_contract_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_supplier_contract_id_documents_id_fk" FOREIGN KEY ("supplier_contract_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counterparties_inn_idx" ON "counterparties" USING btree ("inn");--> statement-breakpoint
CREATE INDEX "counterparties_role_idx" ON "counterparties" USING btree ("role","name");--> statement-breakpoint
CREATE INDEX "contacts_counterparty_idx" ON "contacts" USING btree ("counterparty_id");--> statement-breakpoint
-- Имена служебных объектов — под новое имя таблицы (на работу не влияют).
ALTER SEQUENCE IF EXISTS "clients_id_seq" RENAME TO "counterparties_id_seq";--> statement-breakpoint
ALTER INDEX IF EXISTS "clients_pkey" RENAME TO "counterparties_pkey";
--> statement-breakpoint
-- Страна — словом, как в форме.
UPDATE "counterparties" SET "country" = 'Россия' WHERE "country" = 'RU';
