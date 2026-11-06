/** Стоп-лист рассылки (do_not_contact): ИНН и / или email. Проверяется перед каждой отправкой и при отборе продавцов. */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { DbOrTx } from "../../db/client.ts";
import { doNotContact, leadContacts } from "../../db/schema.ts";

export async function isStopped(tx: DbOrTx, inn: string | null, email?: string | null): Promise<boolean> {
  const conds = [inn ? eq(doNotContact.inn, inn) : undefined, email ? eq(doNotContact.email, email.toLowerCase()) : undefined].filter(Boolean);
  if (!conds.length) return false;
  const [row] = await tx.select({ id: doNotContact.id }).from(doNotContact).where(or(...conds)).limit(1);
  return Boolean(row);
}

/** В стоп-лист: ИНН продавца и все его email (чтобы не написать и с другого ящика / по другому ИНН). */
export async function addToStopList(tx: DbOrTx, entry: { inn?: string | null; email?: string | null; reason: string; userId?: number | null }): Promise<void> {
  const emails = new Set<string>();
  if (entry.email) emails.add(entry.email.toLowerCase());
  if (entry.inn) {
    const rows = await tx.select({ value: leadContacts.value }).from(leadContacts).where(and(eq(leadContacts.sellerInn, entry.inn), eq(leadContacts.type, "email")));
    for (const r of rows) emails.add(r.value);
    const [hasInn] = await tx.select({ id: doNotContact.id }).from(doNotContact).where(and(eq(doNotContact.inn, entry.inn), isNull(doNotContact.email))).limit(1);
    if (!hasInn) await tx.insert(doNotContact).values({ inn: entry.inn, reason: entry.reason, createdBy: entry.userId ?? null });
  }
  if (emails.size) {
    const have = await tx.select({ email: doNotContact.email }).from(doNotContact).where(inArray(doNotContact.email, [...emails]));
    const fresh = [...emails].filter((e) => !have.some((h) => h.email === e));
    if (fresh.length) await tx.insert(doNotContact).values(fresh.map((email) => ({ inn: entry.inn ?? null, email, reason: entry.reason, createdBy: entry.userId ?? null })));
  }
}

/** SQL-условие «продавца нет в стоп-листе по ИНН» — для отбора в работу. */
export const notStoppedInn = (innColumn: unknown) => sql`not exists (select 1 from do_not_contact d where d.inn = ${innColumn})`;
