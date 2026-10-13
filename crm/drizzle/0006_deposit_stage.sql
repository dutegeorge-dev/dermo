-- Новый первый этап «Заказ сформирован, ждём депозит». Дата оплаты депозита
-- становится ключевой датой этапа 1 (milestone deposit). Существующие сделки
-- уже прошли депозит: факт = deposit_date или дата создания, этап +1.
INSERT INTO "shipment_milestones" ("shipment_id", "key", "plan", "fact")
SELECT "id", 'deposit', coalesce("deposit_date", "created_at"::date), coalesce("deposit_date", "created_at"::date) FROM "shipments"
ON CONFLICT ("shipment_id", "key") DO NOTHING;
--> statement-breakpoint
UPDATE "shipments" SET "stage" = "stage" + 1;
--> statement-breakpoint
UPDATE "shipment_events" SET
  "old_value" = CASE WHEN jsonb_typeof("old_value") = 'number' THEN to_jsonb(("old_value" #>> '{}')::int + 1) ELSE "old_value" END,
  "new_value" = CASE WHEN jsonb_typeof("new_value") = 'number' THEN to_jsonb(("new_value" #>> '{}')::int + 1) ELSE "new_value" END
WHERE "kind" = 'stage';
--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "deposit_date";
