ALTER TABLE "deals" ALTER COLUMN "status_key" SET DEFAULT 'new_request';--> statement-breakpoint
-- Описание сделки — обычный текст (интерфейса сделок до этой версии не было, данных нет).
ALTER TABLE "deals" ALTER COLUMN "description" SET DATA TYPE text USING coalesce("description" #>> '{}', '');--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
UPDATE "deals" SET "description" = '' WHERE "description" IS NULL;--> statement-breakpoint
ALTER TABLE "deals" ALTER COLUMN "description" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_statuses" ADD COLUMN "color" text DEFAULT '#94A3B8' NOT NULL;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "lost_reason" text;--> statement-breakpoint
-- Этапы воронки «Общая воронка» (как в текущей CRM). Названия, цвета и порядок
-- дальше меняются в интерфейсе: «Сделки» → «Этапы».
INSERT INTO "deal_statuses" ("key", "name", "position", "color", "is_final") VALUES
  ('new_request',       'Новая заявка',                       10, '#FFF200', false),
  ('product_search',    'Поиск товара',                       20, '#EE3800', false),
  ('prelim_calc',       'Расчёт доставки предварительный',    30, '#00BDF2', false),
  ('offer',             'Предложение клиенту',                40, '#FFF46B', false),
  ('supplier_order',    'Заказ у поставщика',                 50, '#EE1C1C', false),
  ('delivery_calc',     'Расчёт доставки',                    60, '#00BDF2', false),
  ('delivery_approval', 'Согласование доставки',              70, '#FFF200', false),
  ('delivery',          'Доставка / информирование клиента',  80, '#00AEEF', false),
  ('done',              'Завершено',                          90, '#77D600', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Интерфейса сделок до этой версии не было, но на всякий случай переносим
-- возможные сделки со старых статусов этапа 1 на близкие новые.
UPDATE "deals" SET "status_key" = CASE "status_key"
    WHEN 'closed' THEN 'done'
    WHEN 'delivered' THEN 'done'
    WHEN 'in_transit' THEN 'delivery'
    WHEN 'customs' THEN 'delivery'
    WHEN 'supplier_payment' THEN 'supplier_order'
    WHEN 'contract' THEN 'offer'
    WHEN 'quote_sent' THEN 'offer'
    ELSE 'new_request' END
  WHERE "status_key" IN ('new_lead', 'qualification', 'quote_sent', 'contract', 'supplier_payment', 'in_transit', 'customs', 'delivered', 'closed');
--> statement-breakpoint
DELETE FROM "deal_statuses"
  WHERE "key" IN ('new_lead', 'qualification', 'quote_sent', 'contract', 'supplier_payment', 'in_transit', 'customs', 'delivered', 'closed');
--> statement-breakpoint
-- Итог теперь бывает и без завершающего этапа (отказ на любом этапе) — правило в приложении.
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_outcome_only_when_closed";
