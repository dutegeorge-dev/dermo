ALTER TABLE "lead_sellers" ADD COLUMN "picked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD COLUMN "pick_job_id" integer;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD COLUMN "contacts_status" text;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD COLUMN "contacts_job_id" integer;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD COLUMN "contacts_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD CONSTRAINT "lead_sellers_pick_job_id_lead_jobs_id_fk" FOREIGN KEY ("pick_job_id") REFERENCES "public"."lead_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sellers" ADD CONSTRAINT "lead_sellers_contacts_job_id_lead_jobs_id_fk" FOREIGN KEY ("contacts_job_id") REFERENCES "public"."lead_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_sellers_pick_idx" ON "lead_sellers" USING btree ("category_id","picked_at");--> statement-breakpoint
-- Продавцы, отобранные по старой схеме (до «сначала собрать всё»), уже были в работе и с контактами.
UPDATE "lead_sellers" SET "picked_at" = "created_at", "pick_job_id" = "job_id", "contacts_status" = 'found', "contacts_job_id" = "job_id", "contacts_checked_at" = "created_at" WHERE "picked_at" IS NULL;
