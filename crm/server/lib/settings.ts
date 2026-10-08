/** Настройки (таблица settings): реквизиты компании и т.п. */

import { eq } from "drizzle-orm";

import { type CompanySettings, EMPTY_COMPANY } from "../../shared/company.ts";
import type { DbOrTx } from "../db/client.ts";
import { settings } from "../db/schema.ts";

export async function getCompany(tx: DbOrTx): Promise<CompanySettings> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, "company"));
  return { ...EMPTY_COMPANY, ...((row?.value as Partial<CompanySettings>) ?? {}) };
}

export async function setCompany(tx: DbOrTx, value: CompanySettings, userId: number | null): Promise<void> {
  await tx
    .insert(settings)
    .values({ key: "company", value, updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}
