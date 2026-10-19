/**
 * Сопоставление позиций документов со справочником товаров. Ключ товара — название без
 * регистра, знаков и количества в скобках: «Трава 20 мм, 2×25 м (52 рул.)» и
 * «трава 20мм 2x25м» — один товар.
 */

import { products } from "../db/schema.ts";
import type { DbOrTx } from "../db/client.ts";

export function productKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\d[^)]*(рул|шт|мест|кор|паллет|roll|pcs|pc|ctn|box)[^)]*\)/gi, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[×*х]/g, "x")
    .replace(/(\d)\s*(мм|mm|м|m|см|cm|кг|kg)\b/g, "$1$2")
    .replace(/\s*x\s*/g, "x")
    .replace(/[^0-9a-zа-я.x一-鿿]+/g, " ")
    .trim();
}

// Цвета — целыми словами (иначе «син» съест «синтетический», «сер» — «серию»).
const COLOR =
  "(?:сер(?:ый|ая|ое|ые|ого)|красн(?:ый|ая|ое|ые|ого)|ж[её]лт(?:ый|ая|ое|ые|ого)|син(?:ий|яя|ее|ие|его)|зел[её]н(?:ый|ая|ое|ые|ого)|" +
  "ч[её]рн(?:ый|ая|ое|ые|ого)|бел(?:ый|ая|ое|ые|ого)|коричнев\\p{L}*|бежев\\p{L}*|голуб(?:ой|ая|ое|ые|ого)|оранжев\\p{L}*|фиолетов\\p{L}*|" +
  "розов\\p{L}*|мультиколор|grey|gray|red|yellow|blue|green|black|white|brown|beige|orange|purple|pink)";
const COLORS_RE = new RegExp(`[,;]?\\s*(?<!\\p{L})${COLOR}(?:\\s*[/,]\\s*${COLOR})*(?!\\p{L})`, "giu");
const ROLL_SIZE_RE = /[,;]?\s*\d+(?:[.,]\d+)?\s*[×xх*]\s*\d+(?:[.,]\d+)?\s*(?:мм|mm|см|cm|м|m)?\.?(?![\p{L}\d])/giu;

/**
 * Название товара без варианта: размер рулона, цвет, число мест — это не новый товар.
 * «Искусственная трава 20 мм, 2×25 м (52 рул.)» → «Искусственная трава 20 мм»,
 * «ПВХ-коврик 0,5×25 м, серый/красный (40 рул.)» → «ПВХ-коврик».
 */
export function productBaseName(name: string): string {
  const base = name
    .replace(/\([^)]*\)/g, " ")
    .replace(ROLL_SIZE_RE, " ")
    .replace(COLORS_RE, " ")
    .replace(/\s+([,;])/g, "$1")
    .replace(/[,;]\s*[,;]/g, ",")
    .replace(/[\s,;.-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return base || name.trim();
}

/** Ключ товара справочника — по названию без варианта. */
export const productBaseKey = (name: string | null | undefined) => productKey(productBaseName(name ?? ""));

export type ProductRef = { id: number; name: string; hsCode: string | null };

export async function loadProducts(tx: DbOrTx): Promise<ProductRef[]> {
  return tx.select({ id: products.id, name: products.name, hsCode: products.hsCode }).from(products).limit(20000);
}

/**
 * Товар по названию позиции: сначала тот же ключ, затем то же название без варианта (размер рулона, цвет) —
 * «Трава 20 мм, 4×25 м» идёт к товару «Трава 20 мм». null — товара в справочнике ещё нет.
 */
export function matchProduct(list: ProductRef[], name: string): ProductRef | null {
  const key = productKey(name);
  if (!key) return null;
  const base = productBaseKey(name);
  return list.find((p) => productKey(p.name) === key) ?? list.find((p) => productBaseKey(p.name) === base) ?? null;
}
