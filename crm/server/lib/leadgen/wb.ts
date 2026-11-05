/**
 * Wildberries: поиск, профиль продавца, его каталог и рейтинг, карточки товаров («Страна производства»).
 * Все адреса — в wb-endpoints.json (или в своём файле LEADGEN_WB_CONFIG): сменил WB версию — правим конфиг.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FetchError, Http } from "./http.ts";

export type WbEndpoints = {
  dest: string;
  headers: Record<string, string>;
  search: { urls: string[]; headers?: Record<string, string> };
  sellerCatalog: { urls: string[]; headers?: Record<string, string> };
  sellerInfo: { urls: string[]; headers?: Record<string, string> };
  sellerRating: { urls: string[]; headers?: Record<string, string> };
  upstreams: { url: string; routeMap: string };
  card: { url: string; countryOption: string };
  productUrl: string;
  sellerUrl: string;
};

const DEFAULT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "wb-endpoints.json");

/** Конфиг эндпоинтов: файл по умолчанию + поверх него свой (LEADGEN_WB_CONFIG) — для правки на сервере без git. */
export function loadWbEndpoints(file = process.env.LEADGEN_WB_CONFIG?.trim()): WbEndpoints {
  const base = JSON.parse(fs.readFileSync(DEFAULT_FILE, "utf8")) as WbEndpoints;
  if (!file) return base;
  const own = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WbEndpoints>;
  const merged = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(own)) {
    const b = merged[k];
    merged[k] = v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" ? { ...b, ...v } : v;
  }
  return merged as WbEndpoints;
}

export const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? encodeURIComponent(String(vars[k])) : `{${k}}`));

/** Товар из выдачи / каталога продавца. */
export type WbProduct = { nm: number; name: string; brand: string; supplierId: number; supplier: string; feedbacks: number };

/** Профиль продавца с WB (static supplier-by-id). */
export type WbSellerInfo = {
  supplierId: number;
  name: string;
  fullName: string;
  inn: string;
  ogrn: string;
  trademark: string;
  address: string;
  emails: string[];
  phones: string[];
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Товары из ответа поиска / каталога: { products } (новые версии) или { data: { products } } (старые). */
export function parseProducts(json: unknown): { products: WbProduct[]; total: number | null } {
  const j = (json ?? {}) as { products?: unknown; data?: { products?: unknown; total?: unknown }; total?: unknown };
  const list = Array.isArray(j.products) ? j.products : Array.isArray(j.data?.products) ? j.data.products : [];
  const totalRaw = j.total ?? j.data?.total;
  const products = list.flatMap((p: Record<string, unknown>) => {
    const nm = num(p.id ?? p.nmId ?? p.nm_id);
    if (!nm) return [];
    return [
      {
        nm,
        name: str(p.name ?? p.title),
        brand: str(p.brand ?? p.brandName),
        supplierId: num(p.supplierId ?? p.supplier_id),
        supplier: str(p.supplier ?? p.supplierName),
        feedbacks: num(p.feedbacks ?? p.nmFeedbacks ?? p.feedbackCount),
      },
    ];
  });
  return { products, total: typeof totalRaw === "number" ? totalRaw : totalRaw ? num(totalRaw) || null : null };
}

export function parseSellerInfo(supplierId: number, json: unknown): WbSellerInfo | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str) : str(v) ? [str(v)] : []).filter(Boolean);
  return {
    supplierId,
    name: str(j.supplierName ?? j.name),
    fullName: str(j.supplierFullName ?? j.fullName),
    inn: str(j.inn ?? j.taxpayerCode).replace(/\D/g, ""),
    ogrn: str(j.ogrn ?? j.ogrnip).replace(/\D/g, ""),
    trademark: str(j.trademark),
    address: str(j.legalAddress),
    emails: list(j.email ?? j.emails),
    phones: list(j.phone ?? j.phones),
  };
}

/** Страна производства из card.json: options[].name === countryOption. */
export function parseCardCountry(json: unknown, option: string): string | null {
  const j = (json ?? {}) as { options?: { name?: string; value?: unknown }[]; grouped_options?: { options?: { name?: string; value?: unknown }[] }[] };
  const all = [...(j.options ?? []), ...(j.grouped_options ?? []).flatMap((g) => g.options ?? [])];
  const hit = all.find((o) => (o.name ?? "").trim().toLowerCase() === option.toLowerCase());
  return hit ? str(hit.value) || null : null;
}

export const isChina = (country: string) => /кита|china|кнр|\bprc\b/i.test(country);

type RouteHost = { vol_range_from?: number; vol_range_to?: number; host: string };

export class WbClient {
  private routes: RouteHost[] | null = null;
  /** Какой из urls сработал — дальше сразу он. */
  private working = new Map<string, string>();

  constructor(
    readonly http: Http,
    readonly ep: WbEndpoints = loadWbEndpoints(),
  ) {}

  private headers(extra?: Record<string, string>) {
    return { ...this.ep.headers, ...(extra ?? {}) };
  }

  /** Пробует адреса по очереди: 403/404/400 у одного — следующий; запоминает рабочий. */
  private async tryUrls(kind: "search" | "sellerCatalog" | "sellerInfo" | "sellerRating", vars: Record<string, string | number>): Promise<unknown | null> {
    const spec = this.ep[kind];
    const known = this.working.get(kind);
    const urls = known ? [known, ...spec.urls.filter((u) => u !== known)] : spec.urls;
    let lastError: FetchError | null = null;
    let notFound = false;
    for (const template of urls) {
      try {
        const res = await this.http.json(fill(template, { dest: this.ep.dest, ...vars }), { headers: this.headers(spec.headers) });
        if (res.data === null) {
          notFound = true;
          // 404 на конкретного продавца — это ответ, а не сломанный адрес, если адрес уже работал.
          if (known === template) return null;
          continue;
        }
        this.working.set(kind, template);
        return res.data;
      } catch (error) {
        if (!(error instanceof FetchError) || error.transient) throw error;
        lastError = error;
      }
    }
    if (notFound && !lastError) return null;
    throw lastError ?? new FetchError(`WB: ни один адрес ${kind} не ответил — обновите wb-endpoints.json`, 0, false);
  }

  async search(query: string, page: number): Promise<WbProduct[]> {
    const data = await this.tryUrls("search", { query, page });
    return parseProducts(data).products;
  }

  async sellerCatalog(supplierId: number, page: number): Promise<{ products: WbProduct[]; total: number | null }> {
    return parseProducts(await this.tryUrls("sellerCatalog", { supplierId, page }));
  }

  async sellerInfo(supplierId: number): Promise<WbSellerInfo | null> {
    return parseSellerInfo(supplierId, await this.tryUrls("sellerInfo", { supplierId }));
  }

  /** Отзывы о продавце (suppliers-shipment): feedbacksCount; null — эндпоинт не ответил. */
  async sellerFeedbacks(supplierId: number): Promise<number | null> {
    try {
      const data = (await this.tryUrls("sellerRating", { supplierId })) as Record<string, unknown> | null;
      if (!data) return null;
      const v = data.feedbacksCount ?? data.feedbacks ?? data.feedbackCount;
      return typeof v === "number" ? v : null;
    } catch (error) {
      if (error instanceof FetchError && !error.transient) return null;
      throw error;
    }
  }

  private async basketHost(vol: number): Promise<string> {
    if (!this.routes) {
      const res = await this.http.json<Record<string, unknown>>(this.ep.upstreams.url, { headers: this.headers() });
      let node: unknown = res.data;
      for (const key of this.ep.upstreams.routeMap.split(".")) node = (node as Record<string, unknown> | undefined)?.[key];
      const hosts = Array.isArray(node) ? ((node[0] as { hosts?: RouteHost[] })?.hosts ?? []) : [];
      if (!hosts.length) throw new FetchError("WB: в upstreams нет карты корзин — проверьте upstreams.routeMap", 0, false);
      this.routes = hosts;
    }
    const hit = this.routes.find((h) => (h.vol_range_from ?? 0) <= vol && vol <= (h.vol_range_to ?? Infinity));
    return (hit ?? this.routes[this.routes.length - 1]).host;
  }

  private async card(nm: number): Promise<unknown | null> {
    const vol = Math.floor(nm / 100000);
    const part = Math.floor(nm / 1000);
    const url = this.ep.card.url.replace("{basket}", await this.basketHost(vol));
    return (await this.http.json(fill(url, { vol, part, nm }), { headers: this.headers() })).data;
  }

  /** Страна производства товара; undefined — карточки нет. */
  async cardCountry(nm: number): Promise<string | null | undefined> {
    const data = await this.card(nm);
    if (data === null) return undefined;
    return parseCardCountry(data, this.ep.card.countryOption);
  }

  /** Товар по карточке (продавец, название, бренд) — когда из браузера пришли только артикулы. */
  async cardProduct(nm: number): Promise<WbProduct | null> {
    const data = (await this.card(nm)) as { imt_name?: string; selling?: { supplier_id?: number; brand_name?: string } } | null;
    const supplierId = Number(data?.selling?.supplier_id);
    if (!data || !supplierId) return null;
    return { nm, name: str(data.imt_name), brand: str(data.selling?.brand_name), supplierId, supplier: "", feedbacks: 0 };
  }

  productUrl(nm: number): string {
    return fill(this.ep.productUrl, { nm });
  }
}
