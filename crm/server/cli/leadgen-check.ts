/**
 * Проверка источников лидогенерации с этого сервера: отвечают ли эндпоинты WB из wb-endpoints.json (и своего
 * LEADGEN_WB_CONFIG), DaData и Checko. Запускать после поломки сбора и после правки конфига:
 *
 *   npm run leadgen:check                    # WB: поиск → продавец → каталог → отзывы → карточка
 *   npm run leadgen:check -- --query "гантели" --registry   # + DaData и Checko по ИНН найденного продавца
 *
 * Ключи в вывод не попадают.
 */

import { parseArgs } from "node:util";

import { config } from "../config.ts";
import { Http, redact } from "../lib/leadgen/http.ts";
import { checkoContacts, dadataParty } from "../lib/leadgen/registry.ts";
import { fill, loadWbEndpoints, WbClient } from "../lib/leadgen/wb.ts";

const { values } = parseArgs({ options: { query: { type: "string", default: "сковорода" }, registry: { type: "boolean", default: false } } });

const ep = loadWbEndpoints();
const http = new Http({ name: "WB", minDelayMs: 500, jitterMs: 300, retries: 2, proxy: config.leadgen.wbProxy, log: (m) => console.log(`  … ${m}`) });
const wb = new WbClient(http, ep);
let failed = 0;

async function check<T>(label: string, fn: () => Promise<T>, show: (v: T) => string): Promise<T | null> {
  try {
    const v = await fn();
    console.log(`✓ ${label}: ${show(v)}`);
    return v;
  } catch (error) {
    failed++;
    console.log(`✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

console.log(`Прокси WB: ${config.leadgen.wbProxy ? "задан (WB_PROXY)" : "нет"}; dest=${ep.dest}`);
console.log(`Поиск: ${ep.search.urls.map((u) => redact(fill(u, { query: values.query!, page: 1, dest: ep.dest }))).join("\n        ")}`);

const products = await check("поиск", () => wb.search(values.query!, 1), (p) => `${p.length} товаров${p[0] ? `, первый: ${p[0].nm} «${p[0].name}», продавец ${p[0].supplierId}, отзывов ${p[0].feedbacks}` : ""}`);
const sample = products?.find((p) => p.supplierId) ?? null;
if (sample) {
  const info = await check("профиль продавца", () => wb.sellerInfo(sample.supplierId), (i) => (i ? `${i.fullName || i.name}, ИНН ${i.inn || "—"}, ОГРН ${i.ogrn || "—"}, ТМ ${i.trademark || "—"}${i.emails.length ? `, email ${i.emails.join(", ")}` : ""}` : "нет данных (404)"));
  await check("каталог продавца", () => wb.sellerCatalog(sample.supplierId, 1), (c) => `total=${c.total ?? "нет поля total"}, на странице ${c.products.length}`);
  await check("отзывы продавца", () => wb.sellerFeedbacks(sample.supplierId), (n) => (n === null ? "эндпоинт не ответил — будет сумма по товарам каталога" : String(n)));
  await check("карточка (страна)", () => wb.cardCountry(sample.nm), (c) => (c === undefined ? "карточки нет" : `«${ep.card.countryOption}» = ${c ?? "не указана"}`));
  if (values.registry && info?.inn) {
    if (config.leadgen.dadataToken) {
      const dd = new Http({ name: "DaData", retries: 1 });
      await check("DaData", () => dadataParty(dd, config.leadgen.dadataToken!, info.inn), (r) => (r ? `${r.legalName}, ${r.status}, рег. ${r.regDate}, ${r.region ?? ""}` : "не найдено"));
    } else console.log("– DaData: DADATA_TOKEN не задан");
    if (config.leadgen.checkoKey) {
      const ck = new Http({ name: "Checko", retries: 1 });
      const kind = info.inn.length === 12 ? "ip" : "ul";
      await check("Checko", () => checkoContacts(ck, config.leadgen.checkoKey!, info.inn, kind), (c) => `телефонов ${c.phones.length}, email ${c.emails.length}, сайт ${c.sites.join(", ") || "—"}`);
    } else console.log("– Checko: CHECKO_API_KEY не задан");
  }
}
console.log(failed ? `\nНе работает: ${failed}. Как найти новые адреса — server/lib/leadgen/README.md` : "\nВсё отвечает.");
process.exit(failed ? 1 : 0);
