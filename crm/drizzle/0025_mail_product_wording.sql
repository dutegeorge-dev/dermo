UPDATE "mail_templates"
SET "body" = replace("body", 'Видел ваши {product} под брендом {brand} на WB.', 'Видел {product_accusative} под брендом «{brand}» на WB.'),
    "version" = "version" + 1,
    "updated_at" = now()
WHERE "category_id" IS NULL
  AND "touch" = 'first'
  AND "for_marking" IS NOT NULL
  AND "body" LIKE '%Видел ваши {product} под брендом {brand} на WB.%';--> statement-breakpoint

UPDATE "mailboxes"
SET "signature" = $sig$С уважением,
ООО ТЛК БАРС
+7 (495) 133-12-60$sig$,
    "updated_at" = now()
WHERE btrim("signature") = '';
