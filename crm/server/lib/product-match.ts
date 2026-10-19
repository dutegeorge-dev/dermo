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

export type ProductRef = { id: number; name: string; hsCode: string | null };

export async function loadProducts(tx: DbOrTx): Promise<ProductRef[]> {
  return tx.select({ id: products.id, name: products.name, hsCode: products.hsCode }).from(products).limit(20000);
}

/** Товар по ключу названия; null — нового товара в справочнике ещё нет. */
export function matchProduct(list: ProductRef[], name: string): ProductRef | null {
  const key = productKey(name);
  if (!key) return null;
  return list.find((p) => productKey(p.name) === key) ?? null;
}
