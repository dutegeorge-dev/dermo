/**
 * Курсы валют ЦБ РФ для калькулятора доставки.
 *
 * Источник — ЦБ РФ: основной канал cbr-xml-daily.ru (готовый JSON), резервный —
 * официальный XML cbr.ru/scripts/XML_daily.asp. Курсы не хардкодятся нигде:
 * фронт получает их из этого модуля через GET /api/rates.
 *
 * Три уровня защиты от недоступности ЦБ:
 *   1) кэш в памяти (RATES_TTL_MS, по умолчанию 6 часов) — ЦБ не дёргается на
 *      каждый запрос страницы (курс всё равно меняется раз в сутки);
 *   2) файл последних известных курсов (RATES_CACHE_FILE) — переживает
 *      перезапуск службы;
 *   3) отдача устаревших значений с флагом stale — калькулятор продолжает
 *      считать, а страница честно показывает дату курса.
 */

import fs from "node:fs";
import path from "node:path";

import { config } from "./config.ts";

/** Курсы, отдаваемые фронту. Значения — рублей за 1 единицу валюты. */
export interface Rates {
  /** Курс доллара США, ₽ за 1 $. */
  usd: number;
  /** Курс юаня, ₽ за 1 ¥. */
  cny: number;
  /** Дата курса ЦБ (ISO, YYYY-MM-DD). */
  date: string;
  /** Откуда получены курсы (для диагностики). */
  source: string;
  /** Когда мы их забрали (ISO-таймстамп). */
  fetchedAt: string;
}

/** Ответ эндпоинта /api/rates. */
export interface RatesResponse extends Rates {
  ok: true;
  /**
   * true — ЦБ сейчас недоступен, отдаём последние известные курсы.
   * Фронт по этому флагу показывает предупреждение рядом с курсами.
   */
  stale: boolean;
}

/** Кэш в памяти: последний успешный ответ и время его получения. */
let cached: { rates: Rates; at: number } | null = null;

/** Запрос к ЦБ в полёте: параллельные запросы страницы ждут один и тот же. */
let inFlight: Promise<Rates> | null = null;

/** Проверка, что значение — положительное конечное число. */
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Дата курса в виде YYYY-MM-DD (ЦБ отдаёт ISO с таймзоной). */
function isoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Основной канал: cbr-xml-daily.ru — тот же курс ЦБ, но готовым JSON.
 * Nominal обязателен: ЦБ публикует часть валют за 10/100 единиц (юань долгое
 * время шёл как 10 CNY), и без деления курс завышается на порядок.
 */
async function fetchFromXmlDaily(): Promise<Rates> {
  const response = await fetch(config.rates.jsonUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(config.rates.timeoutMs),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = (await response.json()) as {
    Date?: string;
    Valute?: Record<string, { Value?: number; Nominal?: number }>;
  };

  const usdRaw = body.Valute?.USD;
  const cnyRaw = body.Valute?.CNY;

  if (!positive(usdRaw?.Value) || !positive(cnyRaw?.Value)) {
    throw new Error("в ответе нет курсов USD/CNY");
  }

  const usdNominal = positive(usdRaw?.Nominal) ? usdRaw.Nominal : 1;
  const cnyNominal = positive(cnyRaw?.Nominal) ? cnyRaw.Nominal : 1;

  return {
    usd: usdRaw.Value / usdNominal,
    cny: cnyRaw.Value / cnyNominal,
    date: isoDate(body.Date ?? ""),
    source: "cbr-xml-daily.ru",
    fetchedAt: new Date().toISOString(),
  };
}

/** Достаёт из XML ЦБ курс валюты по CharCode: [значение, номинал]. */
function readXmlValute(xml: string, code: string): [number, number] | null {
  // Названия валют в XML — в windows-1251, но нужные нам поля чисто ASCII,
  // поэтому тело читается как latin1 и разбирается регуляркой без перекодировки.
  const block = new RegExp(
    `<Valute[^>]*>(?:(?!</Valute>)[\\s\\S])*?<CharCode>${code}</CharCode>[\\s\\S]*?</Valute>`,
  ).exec(xml);
  if (!block) return null;

  const nominal = /<Nominal>([\d\s]+)<\/Nominal>/.exec(block[0]);
  const value = /<Value>([\d\s,.]+)<\/Value>/.exec(block[0]);
  if (!value) return null;

  // ЦБ пишет дробную часть через запятую и разделяет тысячи пробелом.
  const parsed = Number(value[1].replace(/\s/g, "").replace(",", "."));
  const nom = nominal ? Number(nominal[1].replace(/\s/g, "")) : 1;

  if (!positive(parsed)) return null;
  return [parsed, positive(nom) ? nom : 1];
}

/** Резервный канал: официальный XML ЦБ РФ. */
async function fetchFromCbrXml(): Promise<Rates> {
  const response = await fetch(config.rates.xmlUrl, {
    signal: AbortSignal.timeout(config.rates.timeoutMs),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const xml = buffer.toString("latin1");

  const usd = readXmlValute(xml, "USD");
  const cny = readXmlValute(xml, "CNY");
  if (!usd || !cny) throw new Error("в XML нет курсов USD/CNY");

  // Дата в атрибуте ValCurs — в формате ДД.ММ.ГГГГ.
  const dateMatch = /<ValCurs[^>]*\sDate="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  const date = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : new Date().toISOString().slice(0, 10);

  return {
    usd: usd[0] / usd[1],
    cny: cny[0] / cny[1],
    date,
    source: "cbr.ru",
    fetchedAt: new Date().toISOString(),
  };
}

/** Записывает последние известные курсы на диск (переживают перезапуск). */
function persist(rates: Rates): void {
  try {
    fs.mkdirSync(path.dirname(config.rates.cacheFile), { recursive: true });
    fs.writeFileSync(config.rates.cacheFile, JSON.stringify(rates), "utf8");
  } catch (error) {
    console.error("[rates] не удалось сохранить кэш курсов:", error);
  }
}

/** Читает последние известные курсы с диска (после перезапуска службы). */
function restore(): Rates | null {
  try {
    if (!fs.existsSync(config.rates.cacheFile)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(config.rates.cacheFile, "utf8"),
    ) as Partial<Rates>;

    if (!positive(parsed.usd) || !positive(parsed.cny)) return null;

    return {
      usd: parsed.usd,
      cny: parsed.cny,
      date: typeof parsed.date === "string" ? parsed.date : "",
      source: typeof parsed.source === "string" ? parsed.source : "кэш",
      fetchedAt:
        typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Забирает курсы у ЦБ: основной канал, при ошибке — резервный. */
async function fetchRates(): Promise<Rates> {
  try {
    return await fetchFromXmlDaily();
  } catch (primaryError) {
    const reason = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`[rates] основной источник недоступен (${reason}), пробуем XML ЦБ`);
    return await fetchFromCbrXml();
  }
}

/**
 * Актуальные курсы для фронта.
 * Пока кэш свежий — сети нет вообще. Если ЦБ не ответил, отдаём последние
 * известные значения с флагом stale; если их нет — бросаем исключение.
 */
export async function getRates(): Promise<RatesResponse> {
  if (cached && Date.now() - cached.at < config.rates.ttlMs) {
    return { ok: true, ...cached.rates, stale: false };
  }

  // Кэш в памяти пуст (первый запрос после старта) — поднимаем с диска, чтобы
  // было чем ответить, если ЦБ прямо сейчас недоступен.
  if (!cached) {
    const restored = restore();
    if (restored) cached = { rates: restored, at: 0 };
  }

  inFlight ??= fetchRates().finally(() => {
    inFlight = null;
  });

  try {
    const rates = await inFlight;
    cached = { rates, at: Date.now() };
    persist(rates);
    return { ok: true, ...rates, stale: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (cached) {
      console.error(`[rates] ЦБ недоступен (${reason}) — отдаём курсы от ${cached.rates.date}`);
      return { ok: true, ...cached.rates, stale: true };
    }
    throw new Error(`курсы ЦБ недоступны: ${reason}`);
  }
}
