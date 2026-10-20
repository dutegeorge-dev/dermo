/**
 * Сопоставление позиций документов со справочником товаров. Ключ товара — название без
 * регистра, знаков и количества в скобках: «Трава 20 мм, 2×25 м (52 рул.)» и
 * «трава 20мм 2x25м» — один товар.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { documentItems, documents, factories, productOffers, products } from "../db/schema.ts";
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

/**
 * Артикулы в названии: «PVC flooring M103-4, 3m×30m» → ["m103-4"]. Буквы с цифрами (или 4+ цифр), без размеров
 * и единиц («20 мм», «3m», «400г»). По ним позиция находит товар поставщика, даже если названия на разных языках.
 */
export function articleCodes(name: string): string[] {
  const tokens = productBaseName(name).toLowerCase().match(/[\p{L}\d][\p{L}\d.\-/]*/gu) ?? [];
  return [
    ...new Set(
      tokens
        .map((t) => t.replace(/[.\-/]+$/, ""))
        .filter((t) => t.length >= 3 && /\d/.test(t) && (/\p{L}/u.test(t) || /^\d{4,}$/.test(t) || /^\d{2,}-\d+$/.test(t)))
        .filter((t) => !/^\d+([.,]\d+)?(мм|mm|см|cm|м|m|г|g|гр|кг|kg|шт|pcs|м2|m2|мкм)$/.test(t)),
    ),
  ];
}

/** Товары, которые уже брали у поставщика (его инвойсы, цены его фабрики), с названиями вариантов. */
export async function supplierProducts(tx: DbOrTx, counterpartyId: number): Promise<{ id: number; name: string; hsCode: string | null; names: string[] }[]> {
  const fromDocs = await tx
    .select({ id: products.id, name: products.name, hsCode: products.hsCode, item: documentItems.name })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .innerJoin(products, eq(products.id, documentItems.productId))
    .where(and(eq(documents.counterpartyId, counterpartyId), inArray(documents.type, ["supplier_invoice", "packing_list", "supplier_contract", "specification"])));
  const fromOffers = await tx
    .select({ id: products.id, name: products.name, hsCode: products.hsCode, item: productOffers.name })
    .from(productOffers)
    .innerJoin(factories, eq(factories.id, productOffers.factoryId))
    .innerJoin(products, eq(products.id, productOffers.productId))
    .where(and(eq(factories.counterpartyId, counterpartyId), isNotNull(productOffers.productId)));
  const map = new Map<number, { id: number; name: string; hsCode: string | null; names: string[] }>();
  for (const r of [...fromDocs, ...fromOffers]) {
    const p = map.get(r.id) ?? { id: r.id, name: r.name, hsCode: r.hsCode, names: [] };
    if (!p.names.includes(r.item)) p.names.push(r.item);
    map.set(r.id, p);
  }
  return [...map.values()];
}

/** Товары справочника с этими артикулами — в названии товара, его позициях в документах или ценах фабрик. */
export async function productsByArticles(tx: DbOrTx, codes: Set<string>): Promise<{ id: number; name: string; hsCode: string | null; codes: string[] }[]> {
  if (!codes.size) return [];
  const rows = [
    ...(await tx.select({ id: products.id, name: products.name, hsCode: products.hsCode, alias: products.name }).from(products)),
    ...(await tx
      .selectDistinct({ id: products.id, name: products.name, hsCode: products.hsCode, alias: documentItems.name })
      .from(documentItems)
      .innerJoin(products, eq(products.id, documentItems.productId))),
    ...(await tx
      .selectDistinct({ id: products.id, name: products.name, hsCode: products.hsCode, alias: productOffers.name })
      .from(productOffers)
      .innerJoin(products, eq(products.id, productOffers.productId))),
  ];
  const hits = new Map<number, { id: number; name: string; hsCode: string | null; codes: string[] }>();
  for (const r of rows) {
    const found = articleCodes(r.alias).filter((c) => codes.has(c));
    if (!found.length) continue;
    const h = hits.get(r.id) ?? { id: r.id, name: r.name, hsCode: r.hsCode, codes: [] };
    h.codes = [...new Set([...h.codes, ...found])];
    hits.set(r.id, h);
  }
  return [...hits.values()];
}

/**
 * Декларации / сертификаты на товары: привязанные позициями к товару или совпавшие по артикулу — модель из
 * декларации («K105») есть в названии товара, его позициях в документах или ценах фабрик. Так декларация,
 * загруженная раньше товара, подхватывается сама.
 */
export async function conformityIdsForProducts(tx: DbOrTx, productIds: number[]): Promise<number[]> {
  if (!productIds.length) return [];
  const names = [
    ...(await tx.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))),
    ...(await tx.selectDistinct({ id: documentItems.productId, name: documentItems.name }).from(documentItems).where(inArray(documentItems.productId, productIds))),
    ...(await tx.selectDistinct({ id: productOffers.productId, name: productOffers.name }).from(productOffers).where(inArray(productOffers.productId, productIds))),
  ];
  const codes = new Set(names.flatMap((n) => articleCodes(n.name)));
  const rows = await tx
    .select({ id: documents.id, productId: documentItems.productId, name: documentItems.name })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .where(eq(documents.type, "conformity"));
  const ids = new Set<number>();
  for (const r of rows) if ((r.productId && productIds.includes(r.productId)) || articleCodes(r.name).some((c) => codes.has(c))) ids.add(r.id);
  return [...ids];
}
