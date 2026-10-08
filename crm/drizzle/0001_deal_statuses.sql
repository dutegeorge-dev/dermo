-- Этап 2: колонки канбан-доски сделок в порядке нашего процесса.
-- «Закрыто» — финальный статус; итог (успешно / отказ) хранится в deals.outcome.
INSERT INTO "deal_statuses" ("key", "name", "position", "is_final") VALUES
  ('new_lead',         'Новый лид',                  10, false),
  ('qualification',    'Квалификация',               20, false),
  ('quote_sent',       'Расчёт отправлен',           30, false),
  ('contract',         'Договор',                    40, false),
  ('supplier_payment', 'Оплата поставщику / выкуп',  50, false),
  ('in_transit',       'В пути',                     60, false),
  ('customs',          'Таможня',                    70, false),
  ('delivered',        'Доставлено',                 80, false),
  ('closed',           'Закрыто',                    90, true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Итог указывается только у закрытой сделки.
ALTER TABLE "deals" ADD CONSTRAINT "deals_outcome_only_when_closed"
  CHECK (("status_key" = 'closed') = ("outcome" IS NOT NULL));
