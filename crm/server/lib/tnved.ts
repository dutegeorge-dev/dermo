/**
 * Справочник ТН ВЭД ЕАЭС со ставками ввозных пошлин. Источник — бесплатная ежедневная
 * выгрузка tws.by (Excel: код, наименование, тариф; «как есть, без гарантий»; антидемпинговых
 * пошлин в ней нет). Обновление — `npm run tnved:update` (cron раз в сутки, deploy — если пусто).
 */

import { inArray, lt, sql } from "drizzle-orm";

import { parseTariff } from "../../shared/customs.ts";
import type { DbOrTx } from "../db/client.ts";
import { tnved } from "../db/schema.ts";
import { xlsxText } from "./file-text.ts";

export const TNVED_URL = process.env.CRM_TNVED_URL?.trim() || "https://www.tws.by/tws/tnved/download/excel";

export type TnvedRow = { code: string; name: string; tariff: string };

/** Строки листа «ТНВЭД»: «код<TAB>наименование<TAB>тариф<TAB>…». */
export async function parseTnvedXlsx(buffer: Buffer): Promise<TnvedRow[]> {
  const rows = new Map<string, TnvedRow>();
  for (const line of (await xlsxText(buffer)).split("\n")) {
    const [code, name, tariff] = line.split("\t");
    if (!/^\d{10}$/.test(code ?? "")) continue;
    rows.set(code, { code, name: (name ?? "").replace(/\s*🠺\s*/g, " → ").trim(), tariff: (tariff ?? "").trim() });
  }
  return [...rows.values()];
}

export async function saveTnved(tx: DbOrTx, rows: TnvedRow[]): Promise<void> {
  const started = new Date();
  for (let i = 0; i < rows.length; i += 1000) {
    await tx
      .insert(tnved)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({ target: tnved.code, set: { name: sql`excluded.name`, tariff: sql`excluded.tariff`, updatedAt: sql`now()` } });
  }
  // Коды, которых больше нет в тарифе, удаляем.
  await tx.delete(tnved).where(lt(tnved.updatedAt, started));
}

export async function downloadTnved(): Promise<Buffer> {
  const res = await fetch(TNVED_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Справочник ТН ВЭД: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function tnvedCount(tx: DbOrTx): Promise<number> {
  const r = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tnved`);
  return Number(r.rows[0]?.n ?? 0);
}

export async function tnvedByCodes(tx: DbOrTx, codes: string[]): Promise<Map<string, TnvedRow>> {
  const list = [...new Set(codes.filter((c) => /^\d{10}$/.test(c)))];
  if (!list.length) return new Map();
  const rows = await tx.select({ code: tnved.code, name: tnved.name, tariff: tnved.tariff }).from(tnved).where(inArray(tnved.code, list));
  return new Map(rows.map((r) => [r.code, r]));
}

/** Поиск: по началу кода (цифры) или по словам наименования. */
export async function searchTnved(tx: DbOrTx, q: string, limit = 30): Promise<(TnvedRow & { parsed: ReturnType<typeof parseTariff> })[]> {
  const text = q.trim().slice(0, 100);
  const digits = text.replace(/\s/g, "");
  let rows: TnvedRow[];
  if (/^\d{2,10}$/.test(digits)) {
    rows = await tx.select({ code: tnved.code, name: tnved.name, tariff: tnved.tariff }).from(tnved).where(sql`${tnved.code} LIKE ${`${digits}%`}`).orderBy(tnved.code).limit(limit);
  } else {
    const words = text.split(/\s+/).filter((w) => w.length >= 3).slice(0, 5);
    if (!words.length) return [];
    const conds = words.map((w) => sql`${tnved.name} ILIKE ${`%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    rows = await tx.select({ code: tnved.code, name: tnved.name, tariff: tnved.tariff }).from(tnved).where(sql.join(conds, sql` AND `)).orderBy(tnved.code).limit(limit);
  }
  return rows.map((r) => ({ ...r, parsed: parseTariff(r.tariff) }));
}
