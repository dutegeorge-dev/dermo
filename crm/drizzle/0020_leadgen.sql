CREATE TABLE "lead_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"supplier_id" bigint NOT NULL,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank" double precision DEFAULT random() NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reason" text,
	"inn" text,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"queries" text[] DEFAULT '{}'::text[] NOT NULL,
	"stop_words" text[] DEFAULT '{}'::text[] NOT NULL,
	"marking" boolean DEFAULT false NOT NULL,
	"marking_note" text DEFAULT '' NOT NULL,
	"quota" integer DEFAULT 150 NOT NULL,
	"template" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_inn" text NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"valid" boolean DEFAULT true NOT NULL,
	"note" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_inn" text NOT NULL,
	"type" text NOT NULL,
	"comment" text,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'collect' NOT NULL,
	"progress" jsonb DEFAULT '{"categories":{},"requests":{"wb":0,"dadata":0,"checko":0,"site":0}}'::jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_inn" text NOT NULL,
	"planned_date" date NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"touch" text DEFAULT 'first' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"sent_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sellers" (
	"inn" text PRIMARY KEY NOT NULL,
	"wb_supplier_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"brands" text[] DEFAULT '{}'::text[] NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"ogrn" text,
	"kind" text DEFAULT 'ul' NOT NULL,
	"manager_name" text,
	"manager_post" text,
	"reg_date" date,
	"okved" text,
	"region" text,
	"address" text,
	"egr_status" text,
	"sku_count" integer,
	"feedbacks_total" integer,
	"china_share" double precision,
	"products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category_id" integer,
	"batch_month" text NOT NULL,
	"job_id" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"first_line" text DEFAULT '' NOT NULL,
	"first_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_candidates" ADD CONSTRAINT "lead_candidates_job_id_lead_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."lead_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_candidates" ADD CONSTRAINT "lead_candidates_category_id_lead_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lead_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_seller_inn_lead_sellers_inn_fk" FOREIGN KEY ("seller_inn") REFERENCES "public"."lead_sellers"("inn") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_seller_inn_lead_sellers_inn_fk" FOREIGN KEY ("seller_inn") REFERENCES "public"."lead_sellers"("inn") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_jobs" ADD CONSTRAINT "lead_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_queue" ADD CONSTRAINT "lead_queue_seller_inn_lead_sellers_inn_fk" FOREIGN KEY ("seller_inn") REFERENCES "public"."lead_sellers"("inn") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD CONSTRAINT "lead_sellers_category_id_lead_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lead_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD CONSTRAINT "lead_sellers_job_id_lead_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."lead_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_candidates_job_cat_supplier_uq" ON "lead_candidates" USING btree ("job_id","category_id","supplier_id");--> statement-breakpoint
CREATE INDEX "lead_candidates_job_status_idx" ON "lead_candidates" USING btree ("job_id","category_id","status");--> statement-breakpoint
CREATE INDEX "lead_candidates_inn_idx" ON "lead_candidates" USING btree ("inn");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_contacts_uq" ON "lead_contacts" USING btree ("seller_inn","type","value");--> statement-breakpoint
CREATE INDEX "lead_events_seller_idx" ON "lead_events" USING btree ("seller_inn","created_at");--> statement-breakpoint
CREATE INDEX "lead_jobs_status_idx" ON "lead_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lead_queue_plan_idx" ON "lead_queue" USING btree ("status","planned_date","position");--> statement-breakpoint
CREATE INDEX "lead_queue_seller_idx" ON "lead_queue" USING btree ("seller_inn");--> statement-breakpoint
CREATE INDEX "lead_sellers_batch_idx" ON "lead_sellers" USING btree ("batch_month","category_id");--> statement-breakpoint
CREATE INDEX "lead_sellers_status_idx" ON "lead_sellers" USING btree ("status");
--> statement-breakpoint
-- Категории первого месяца (квота 150): правятся в разделе «Лидогенерация» → «Категории».
INSERT INTO "lead_categories" ("name", "queries", "stop_words", "marking", "marking_note", "quota", "template", "active", "sort") VALUES
('Радиоэлектроника без аккумуляторов', ARRAY['блок питания','сетевое зарядное устройство','кабель usb type-c','сетевой фильтр удлинитель','умная розетка','выключатель','датчик умный дом','светодиодная лента']::text[], ARRAY['аккумулятор','power bank','повербанк','беспроводн','портативн']::text[], true, 'с 01.12.2026', 150, 'Видел ваши {product} под брендом {brand} на WB. С 1 декабря такие товары ввозятся только с кодами Честного знака — мы наносим их на фабрике в Китае и ввозим под своим контрактом с полным пакетом документов.', true, 1),
('Стройматериалы и сантехника', ARRAY['смеситель для ванной','душевая система','раковина','сифон','герметик','монтажная пена','затирка для плитки','инсталляция для унитаза']::text[], '{}'::text[], true, 'стройматериалы', 150, 'Видел ваши {product} под брендом {brand} на WB. С 1 декабря такие товары ввозятся только с кодами Честного знака — мы наносим их на фабрике в Китае и ввозим под своим контрактом с полным пакетом документов.', true, 2),
('Посуда, кухня, уборка, декор', ARRAY['сковорода','набор кастрюль','кухонные принадлежности','контейнеры для еды','швабра с отжимом','ведро с отжимом','ваза декоративная','органайзер для кухни']::text[], ARRAY['электрическ','аккумулятор']::text[], true, 'проект с 01.12.2026', 150, 'Видел ваши {product} под брендом {brand} на WB. С 1 декабря такие товары ввозятся только с кодами Честного знака — мы наносим их на фабрике в Китае и ввозим под своим контрактом с полным пакетом документов.', true, 3),
('Сад без электрики', ARRAY['теплица','шланг поливочный','капельный полив','кашпо','садовая мебель','садовые фигуры','парник']::text[], ARRAY['электрическ','аккумулятор','бензин']::text[], false, '', 150, 'Видел ваши {product} под брендом {brand} на WB. Мы ввозим такие товары из Китая по-белому под своим контрактом: документы для маркетплейса, НДС к вычету, без рисков карго.', true, 4),
('Зоотовары без кормов', ARRAY['лежанка для собак','когтеточка','переноска для кошек','клетка для птиц','аквариум','миска для собак']::text[], ARRAY['корм','лакомств','витамин']::text[], false, '', 150, 'Видел ваши {product} под брендом {brand} на WB. Мы ввозим такие товары из Китая по-белому под своим контрактом: документы для маркетплейса, НДС к вычету, без рисков карго.', true, 5),
('Фитнес-инвентарь', ARRAY['гантели','скамья для жима','турник','коврик для йоги','эспандер','гиря','степ платформа']::text[], ARRAY['велосипед','одежда','костюм','электр']::text[], false, '', 150, 'Видел ваши {product} под брендом {brand} на WB. Мы ввозим такие товары из Китая по-белому под своим контрактом: документы для маркетплейса, НДС к вычету, без рисков карго.', true, 6);
