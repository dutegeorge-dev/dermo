UPDATE "mail_messages"
SET "status" = 'cancelled',
    "error" = 'повторные касания отключены'
WHERE "touch" = 'followup' AND "status" = 'planned';--> statement-breakpoint

UPDATE "lead_queue"
SET "status" = 'cancelled',
    "note" = 'повторные касания отключены'
WHERE "touch" = 'followup' AND "status" = 'planned';--> statement-breakpoint

UPDATE "mail_templates"
SET "active" = false,
    "updated_at" = now()
WHERE "touch" = 'followup' AND "active" = true;
