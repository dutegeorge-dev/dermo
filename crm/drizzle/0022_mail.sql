CREATE TABLE "do_not_contact" (
	"id" serial PRIMARY KEY NOT NULL,
	"inn" text,
	"email" text,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"landing_base_url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"dkim_selector" text DEFAULT 'mail' NOT NULL,
	"dns_check" jsonb,
	"dns_checked_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "mail_inbound" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_id" integer NOT NULL,
	"uid_validity" bigint NOT NULL,
	"uid" bigint NOT NULL,
	"message_id" text,
	"from_email" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone,
	"kind" text NOT NULL,
	"reply_to_message_id" integer,
	"seller_inn" text,
	"bounced_email" text,
	"text" text DEFAULT '' NOT NULL,
	"refusal_hint" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_inn" text NOT NULL,
	"queue_id" integer,
	"mailbox_id" integer NOT NULL,
	"contact_id" integer,
	"to_email" text NOT NULL,
	"sent_to" text,
	"touch" text NOT NULL,
	"template_id" integer,
	"template_version" integer,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"variants" jsonb DEFAULT '{"subject":[],"body":[]}'::jsonb NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"mode" text,
	"plan_day" date NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "mail_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer,
	"for_marking" boolean,
	"touch" text DEFAULT 'first' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"domain_id" integer NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_secure" boolean DEFAULT true NOT NULL,
	"smtp_user" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_user" text NOT NULL,
	"password_enc" text NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"daily_limit" integer DEFAULT 30 NOT NULL,
	"warmup_start" date,
	"status" text DEFAULT 'warming' NOT NULL,
	"pause_reason" text,
	"paused_until" timestamp with time zone,
	"imap_uid_validity" bigint,
	"imap_last_uid" bigint,
	"imap_checked_at" timestamp with time zone,
	"imap_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "lead_categories" ADD COLUMN "slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_categories" ADD COLUMN "mail_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_categories" ADD COLUMN "mail_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD COLUMN "link_token" text;--> statement-breakpoint
ALTER TABLE "do_not_contact" ADD CONSTRAINT "do_not_contact_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_inbound" ADD CONSTRAINT "mail_inbound_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_inbound" ADD CONSTRAINT "mail_inbound_reply_to_message_id_mail_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_inbound" ADD CONSTRAINT "mail_inbound_seller_inn_lead_sellers_inn_fk" FOREIGN KEY ("seller_inn") REFERENCES "public"."lead_sellers"("inn") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_seller_inn_lead_sellers_inn_fk" FOREIGN KEY ("seller_inn") REFERENCES "public"."lead_sellers"("inn") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_queue_id_lead_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."lead_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_contact_id_lead_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."lead_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_template_id_mail_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."mail_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_category_id_lead_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."lead_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "do_not_contact_inn_idx" ON "do_not_contact" USING btree ("inn");--> statement-breakpoint
CREATE INDEX "do_not_contact_email_idx" ON "do_not_contact" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_inbound_uq" ON "mail_inbound" USING btree ("mailbox_id","uid_validity","uid");--> statement-breakpoint
CREATE INDEX "mail_inbound_seller_idx" ON "mail_inbound" USING btree ("seller_inn");--> statement-breakpoint
CREATE INDEX "mail_messages_due_idx" ON "mail_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "mail_messages_seller_idx" ON "mail_messages" USING btree ("seller_inn","touch");--> statement-breakpoint
CREATE INDEX "mail_messages_mailbox_idx" ON "mail_messages" USING btree ("mailbox_id","plan_day");--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD CONSTRAINT "lead_sellers_link_token_unique" UNIQUE("link_token");--> statement-breakpoint
-- Категории: адрес посадочной страницы (/wb/<slug>), {category} и {marking_note} для писем — правятся в «Категориях».
UPDATE "lead_categories" SET "slug" = 'radioelektronika', "mail_name" = 'радиоэлектроники', "mail_note" = 'С 1 декабря 2026 года такие товары ввозятся только с кодами Честного знака.' WHERE "name" LIKE 'Радиоэлектроника%' AND "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "slug" = 'stroymaterialy', "mail_name" = 'стройматериалов и сантехники', "mail_note" = 'Такие товары уже ввозятся только с кодами Честного знака.' WHERE "name" LIKE 'Стройматериалы%' AND "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "slug" = 'posuda', "mail_name" = 'посуды и товаров для кухни', "mail_note" = 'С 1 декабря 2026 года такие товары ввозятся только с кодами Честного знака.' WHERE "name" LIKE 'Посуда%' AND "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "slug" = 'sad', "mail_name" = 'товаров для сада' WHERE "name" LIKE 'Сад%' AND "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "slug" = 'zootovary', "mail_name" = 'зоотоваров' WHERE "name" LIKE 'Зоотовары%' AND "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "slug" = 'fitness', "mail_name" = 'фитнес-инвентаря' WHERE "name" LIKE 'Фитнес%' AND "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "slug" = 'cat-' || "id" WHERE "slug" = '';
--> statement-breakpoint
UPDATE "lead_categories" SET "mail_name" = lower("name") WHERE "mail_name" = '';
--> statement-breakpoint
-- Токены персональных ссылок ?l= для уже собранных продавцов: случайные, 10 символов.
UPDATE "lead_sellers" SET "link_token" = substr(md5(random()::text || "inn" || clock_timestamp()::text), 1, 10) WHERE "link_token" IS NULL;
--> statement-breakpoint
-- Шаблоны первого месяца (правятся в «Рассылка → Шаблоны»).
INSERT INTO "mail_templates" ("category_id", "for_marking", "touch", "name", "subject", "body") VALUES
(NULL, true, 'first', 'Первое — с маркировкой', '{Ввоз|Поставки} {category} с кодами Честного знака', $tpl${Добрый день|Здравствуйте}, {name_patronymic}!

Видел ваши {product} под брендом {brand} на WB. {marking_note} Мы наносим коды на фабрике в Китае и ввозим товар под своим контрактом с полным пакетом документов для маркетплейса.

Пример расчёта по вашей категории: {link}

Если актуально, пришлите, что сейчас везёте, и я посчитаю под ваш товар за день.

{signature}$tpl$),
(NULL, false, 'first', 'Первое — без маркировки', '{Белый ввоз|Ввоз по-белому} {category} из Китая', $tpl${Добрый день|Здравствуйте}, {name_patronymic}!

Видел ваши {product} под брендом {brand} на WB. Мы ввозим такие товары из Китая по-белому под своим контрактом: документы для маркетплейса и бухгалтерии, проверка товара нашей командой в Гуанчжоу до отгрузки, без рисков карго.

Пример расчёта по вашей категории: {link}

Если актуально, пришлите, что сейчас везёте, и я посчитаю за день.

{signature}$tpl$),
(NULL, NULL, 'followup', 'Повтор — все категории', 'Re: {first_subject}', $tpl${name_patronymic}, напомню о себе одной строкой: могу посчитать ввоз ваших {product} по-белому, чтобы вы сравнили с текущей схемой. Если неактуально, ответьте «нет», и я больше не побеспокою.

{signature}$tpl$);
