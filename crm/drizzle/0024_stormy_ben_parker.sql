ALTER TABLE "mailboxes" ALTER COLUMN "daily_limit" SET DEFAULT 25;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "warmup_stage" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "warmup_stage_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "warmup_hold_reason" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "warmup_firsts_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "warmup_limit_override" integer;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "smtp_error" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "imap_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "check_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "check_test_to" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "imap_poll_requested_at" timestamp with time zone;--> statement-breakpoint
-- Общие первые письма: новая редакция владельца; уже отправленные письма сохраняют свой текст и версию.
UPDATE "mail_templates"
SET "body" = $tpl${Добрый день|Здравствуйте}, {name_patronymic}!

Видел ваши {product} под брендом {brand} на WB. {marking_note}

Это Торгово-логистическая компания Барс, мы занимаемся доставкой и ввозом товаров из Китая с полным пакетом документов. Менять поставщика не предлагаю: забираем товар с вашей текущей фабрики и берём на себя всю логистику и оформление.

У нас собственная команда и склады в Китае. Перед отправкой можем провести инспекцию, проверить товар, комплектацию и упаковку. Коды «Честного знака» наносим на своих складах в Китае, после чего ввозим товар по своему контракту и передаём документы для маркетплейса.

Могу рассчитать стоимость доставки и ввоза именно вашего товара: логистика от фабрики, инспекция, маркировка, таможенные платежи и наши услуги — с итоговой стоимостью единицы. Так вы сможете сравнить нашу схему с вашей текущей логистикой.

Если актуально, пришлите артикул товара на WB и примерный объём партии. Если известны город фабрики, вес и объём груза — добавьте их, чтобы расчёт был точнее. Подготовлю его за день.

{signature}$tpl$,
"version" = "version" + 1,
"updated_at" = now()
WHERE "category_id" IS NULL AND "touch" = 'first' AND "for_marking" IS NOT NULL;
