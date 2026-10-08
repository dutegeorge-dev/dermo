CREATE TYPE "public"."certificate_status" AS ENUM('yes', 'no', 'in_progress');--> statement-breakpoint
CREATE TYPE "public"."chestny_znak" AS ENUM('not_required', 'required', 'applied');--> statement-breakpoint
CREATE TYPE "public"."company_kind" AS ENUM('ip', 'ooo', 'other');--> statement-breakpoint
CREATE TYPE "public"."contract_party" AS ENUM('ours', 'client');--> statement-breakpoint
CREATE TYPE "public"."deal_outcome" AS ENUM('won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."deal_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."deal_route" AS ENUM('auto', 'rail', 'air', 'sea', 'multimodal');--> statement-breakpoint
CREATE TYPE "public"."export_license" AS ENUM('yes', 'no', 'we_arrange');--> statement-breakpoint
CREATE TYPE "public"."messenger_kind" AS ENUM('telegram', 'whatsapp', 'max', 'wechat', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager');--> statement-breakpoint
CREATE SEQUENCE "public"."deal_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" integer NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"data" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_script_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"ask" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"qa" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('russian', coalesce("title", '')), 'A') || setweight(to_tsvector('russian', coalesce("search_text", '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "call_script_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"topics" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_script_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "company_kind" DEFAULT 'ooo' NOT NULL,
	"name" text NOT NULL,
	"inn" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"name" text NOT NULL,
	"phone" text,
	"messenger" "messenger_kind",
	"messenger_handle" text,
	"email" text,
	"position" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"field" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_statuses" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer DEFAULT nextval('deal_number_seq') NOT NULL,
	"key" text GENERATED ALWAYS AS ('BARS-' || ("number"::text)) STORED,
	"title" text NOT NULL,
	"client_id" integer,
	"contact_id" integer,
	"status_key" text DEFAULT 'new_lead' NOT NULL,
	"outcome" "deal_outcome",
	"product" text,
	"hs_code" text,
	"weight_kg" numeric(14, 3),
	"volume_m3" numeric(14, 3),
	"pickup_location" text,
	"delivery_location" text,
	"goods_ready_date" date,
	"route" "deal_route",
	"contract_party" "contract_party",
	"export_license" "export_license",
	"certificates" "certificate_status",
	"certificate_holder" text,
	"chestny_znak" "chestny_znak",
	"assignee_id" integer,
	"due_date" date,
	"priority" "deal_priority" DEFAULT 'medium' NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" jsonb,
	"board_position" double precision DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "deals_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "kb_page_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"page_id" integer NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_page_versions_page_version_uq" UNIQUE("page_id","version")
);
--> statement-breakpoint
CREATE TABLE "kb_pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"space_id" integer NOT NULL,
	"parent_id" integer,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('russian', coalesce("title", '')), 'A') || setweight(to_tsvector('russian', coalesce("content_text", '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "kb_spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_spaces_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" "user_role" DEFAULT 'manager' NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_script_topics" ADD CONSTRAINT "call_script_topics_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_script_versions" ADD CONSTRAINT "call_script_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_comments" ADD CONSTRAINT "deal_comments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_comments" ADD CONSTRAINT "deal_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_status_key_deal_statuses_key_fk" FOREIGN KEY ("status_key") REFERENCES "public"."deal_statuses"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page_versions" ADD CONSTRAINT "kb_page_versions_page_id_kb_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."kb_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_page_versions" ADD CONSTRAINT "kb_page_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_pages" ADD CONSTRAINT "kb_pages_space_id_kb_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."kb_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_pages" ADD CONSTRAINT "kb_pages_parent_id_kb_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."kb_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_pages" ADD CONSTRAINT "kb_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_pages" ADD CONSTRAINT "kb_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_spaces" ADD CONSTRAINT "kb_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_spaces" ADD CONSTRAINT "kb_spaces_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "call_topics_position_idx" ON "call_script_topics" USING btree ("position");--> statement-breakpoint
CREATE INDEX "call_topics_search_idx" ON "call_script_topics" USING gin ("search");--> statement-breakpoint
CREATE INDEX "clients_inn_idx" ON "clients" USING btree ("inn");--> statement-breakpoint
CREATE INDEX "contacts_client_idx" ON "contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "deal_comments_deal_idx" ON "deal_comments" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_events_deal_idx" ON "deal_events" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deals_board_idx" ON "deals" USING btree ("status_key","board_position");--> statement-breakpoint
CREATE INDEX "deals_assignee_idx" ON "deals" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "deals_client_idx" ON "deals" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "kb_pages_tree_idx" ON "kb_pages" USING btree ("space_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "kb_pages_search_idx" ON "kb_pages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");