-- Галочки оплат сделки и статусы оплаты документов — согласовать (см. server/lib/payments.ts).
-- 1) Галочка стоит — её документы «Оплачен» датой галочки.
CREATE TEMP TABLE flag_docs AS
SELECT s.id AS shipment_id, f.key, d.id AS document_id, d.payment_status, d.paid_at
FROM shipments s
CROSS JOIN (VALUES ('balance'), ('freight'), ('customs_payment')) AS f(key)
JOIN documents d ON d.shipment_id = s.id
LEFT JOIN counterparties c ON c.id = d.counterparty_id
WHERE (f.key = 'balance' AND d.type = 'supplier_invoice')
   OR (f.key = 'customs_payment' AND d.type = 'customs_declaration')
   OR (f.key = 'freight' AND d.type = 'contractor_invoice'
       AND (c.contractor_type LIKE 'carrier%' OR d.counterparty_id = s.carrier_id OR d.id = s.carrier_invoice_id));
--> statement-breakpoint
UPDATE documents d
SET payment_status = 'paid', paid_amount = NULL, paid_at = (s.flags ->> fd.key)::date, updated_at = now()
FROM flag_docs fd
JOIN shipments s ON s.id = fd.shipment_id
WHERE d.id = fd.document_id
  AND s.flags ? fd.key
  AND d.payment_status IS DISTINCT FROM 'paid';
--> statement-breakpoint
-- 2) Галочки нет, а все её документы оплачены — поставить (датой последней оплаты).
UPDATE shipments s
SET flags = s.flags || jsonb_build_object(x.key, x.paid_at), updated_at = now()
FROM (
  SELECT shipment_id, key, coalesce(max(paid_at), current_date)::text AS paid_at
  FROM flag_docs
  GROUP BY shipment_id, key
  HAVING bool_and(payment_status = 'paid')
) x
WHERE s.id = x.shipment_id AND NOT s.flags ? x.key;
--> statement-breakpoint
DROP TABLE flag_docs;
