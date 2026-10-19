/**
 * База фабрик: доступ (кандидатов видит админ и тот, кто нашёл; фабрики-поставщики — все), разбор полей,
 * цены фабрики с привязкой к справочнику товаров.
 */

import { and, eq, isNotNull, or, type SQL } from "drizzle-orm";

import { EMPTY_PROFILE, FACTORY_STATUSES, type FactoryProfile, type Offer, type YesNo } from "../../shared/factories.ts";
import { CURRENCIES } from "../../shared/documents.ts";
import type { DbOrTx } from "../db/client.ts";
import { factories, productOffers, products } from "../db/schema.ts";
import { type AuthUser, HttpError } from "./http.ts";
import { productBaseKey, productBaseName } from "./product-match.ts";

/** Какие фабрики видит пользователь. */
export function factoryAccess(user: AuthUser): SQL | undefined {
  if (user.role === "admin") return undefined;
  return or(isNotNull(factories.counterpartyId), eq(factories.foundBy, user.id));
}

export async function getFactory(tx: DbOrTx, user: AuthUser, id: number) {
  const [row] = await tx.select().from(factories).where(and(eq(factories.id, id), factoryAccess(user)));
  if (!row) throw new HttpError(404, "Фабрика не найдена");
  return row;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const yesNo = (v: unknown): YesNo => (v === "yes" || v === "no" ? v : "");
const dateStr = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** WeChat ID для сравнения дублей: без пробелов и регистра. */
export const normWechat = (v: string | null | undefined) => (v ?? "").replace(/\s/g, "").toLowerCase();

export function profileValues(input: unknown): FactoryProfile {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (k: keyof FactoryProfile) => (typeof p[k] === "string" ? (p[k] as string).trim().slice(0, 2000) : "");
  return {
    ...EMPTY_PROFILE,
    leadTime: text("leadTime"),
    prices: text("prices"),
    lot: text("lot"),
    moq: text("moq"),
    exportLicense: yesNo(p.exportLicense),
    vtbShanghai: yesNo(p.vtbShanghai),
    russianClients: text("russianClients"),
    samples: text("samples"),
    hsCode: text("hsCode"),
  };
}

/** Поля фабрики из запроса (только переданные). */
export function factoryValues(input: Record<string, unknown>, user: AuthUser) {
  const v: Partial<typeof factories.$inferInsert> = {};
  if ("name" in input) {
    const name = str(input.name, 300);
    if (!name) throw new HttpError(400, "Укажите название фабрики (как в WeChat)");
    v.name = name;
  }
  for (const [field, max] of [
    ["nameRu", 300],
    ["wechatId", 100],
    ["contactName", 200],
    ["phone", 60],
    ["email", 200],
    ["website", 300],
    ["location", 300],
  ] as const) {
    if (field in input) v[field] = str(input[field], max);
  }
  if ("categories" in input) {
    const list = Array.isArray(input.categories) ? input.categories : String(input.categories ?? "").split(",");
    v.categories = [...new Set(list.map((c) => String(c).trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, 20);
  }
  if ("status" in input) {
    if (!(String(input.status) in FACTORY_STATUSES)) throw new HttpError(400, "Неизвестный статус фабрики");
    v.status = String(input.status);
  }
  if ("profile" in input) v.profile = profileValues(input.profile);
  if ("notes" in input) v.notes = typeof input.notes === "string" ? input.notes.slice(0, 10000) : "";
  // Кто нашёл — меняет только админ (по умолчанию — кто завёл).
  if ("foundBy" in input && user.role === "admin") v.foundBy = input.foundBy ? Number(input.foundBy) : null;
  return v;
}

export function offerValues(raw: unknown): Offer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = str(o.name, 500) ?? str(o.productName, 500);
  if (!name) return null;
  const currency = String(o.currency ?? "CNY").toUpperCase();
  return {
    productId: typeof o.productId === "number" && o.productId > 0 ? o.productId : null,
    productName: str(o.productName, 500),
    name,
    price: num(o.price),
    currency: (CURRENCIES as readonly string[]).includes(currency) ? currency : "CNY",
    unit: str(o.unit, 30),
    moq: num(o.moq),
    perContainer: num(o.perContainer),
    kgPerUnit: num(o.kgPerUnit),
    m3PerUnit: num(o.m3PerUnit),
    conditions: str(o.conditions, 1000) ?? "",
    quotedAt: dateStr(o.quotedAt),
  };
}

/**
 * Цены фабрики целиком заменяются присланным списком. Товар: выбранный, иначе — из справочника по названию
 * без варианта (размер рулона, цвет), иначе заводится новый.
 */
export async function replaceOffers(tx: DbOrTx, factoryId: number, list: Offer[], userId: number): Promise<void> {
  await tx.delete(productOffers).where(eq(productOffers.factoryId, factoryId));
  if (!list.length) return;
  const catalog = await tx.select({ id: products.id, name: products.name }).from(products).limit(20000);
  const byKey = new Map(catalog.map((p) => [productBaseKey(p.name), p.id]));
  const ids = new Set(catalog.map((p) => p.id));
  const rows: (typeof productOffers.$inferInsert)[] = [];
  for (const [i, o] of list.entries()) {
    let productId = o.productId && ids.has(o.productId) ? o.productId : null;
    if (!productId) {
      const base = productBaseName(o.productName || o.name);
      const key = productBaseKey(base);
      productId = byKey.get(key) ?? null;
      if (!productId && key) {
        const [created] = await tx.insert(products).values({ name: base, unit: o.unit, createdBy: userId }).returning({ id: products.id });
        productId = created.id;
        byKey.set(key, productId);
        ids.add(productId);
      }
    }
    rows.push({
      factoryId,
      productId,
      position: i,
      name: o.name,
      price: o.price === null ? null : String(o.price),
      currency: o.currency,
      unit: o.unit,
      moq: o.moq === null ? null : String(o.moq),
      perContainer: o.perContainer === null ? null : String(o.perContainer),
      kgPerUnit: o.kgPerUnit === null ? null : String(o.kgPerUnit),
      m3PerUnit: o.m3PerUnit === null ? null : String(o.m3PerUnit),
      conditions: o.conditions,
      quotedAt: o.quotedAt,
    });
  }
  await tx.insert(productOffers).values(rows);
}
