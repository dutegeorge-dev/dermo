/** Курсы ЦБ РФ (рублей за 1 единицу валюты) на дату — для таможенной стоимости и КП. */

const cache = new Map<string, { at: number; rates: Record<string, number>; date: string }>();

export const CBR_URL = process.env.CRM_CBR_URL?.trim() || "https://www.cbr.ru/scripts/XML_daily.asp";

/** Курсы на дату (по умолчанию — на сегодня; ЦБ отдаёт последние установленные). */
export async function cbrRates(date?: string): Promise<{ date: string; rates: Record<string, number> }> {
  const key = date ?? new Date().toISOString().slice(0, 10);
  // Фиксированные курсы (тесты, работа без интернета): CRM_RATES_FIXED={"USD":80,"EUR":90,"CNY":11}.
  if (process.env.CRM_RATES_FIXED) return { date: key, rates: { RUB: 1, ...(JSON.parse(process.env.CRM_RATES_FIXED) as Record<string, number>) } };
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3 * 60 * 60 * 1000) return hit;
  const [y, m, d] = key.split("-");
  let xml: string;
  try {
    const res = await fetch(`${CBR_URL}?date_req=${d}/${m}/${y}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    // Числа и коды валют — ASCII, кодировка windows-1251 им не мешает.
    xml = Buffer.from(await res.arrayBuffer()).toString("latin1");
  } catch {
    throw new Error("Не удалось получить курсы ЦБ — повторите позже");
  }
  const rates: Record<string, number> = { RUB: 1 };
  for (const m2 of xml.matchAll(/<CharCode>([A-Z]{3})<\/CharCode>[\s\S]*?<VunitRate>([\d,]+)<\/VunitRate>/g)) {
    rates[m2[1]] = Number(m2[2].replace(",", "."));
  }
  const rdate = /Date="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!rates.USD || !rates.EUR) throw new Error("ЦБ вернул пустые курсы — повторите позже");
  const result = { date: rdate ? `${rdate[3]}-${rdate[2]}-${rdate[1]}` : key, rates, at: Date.now() };
  cache.set(key, result);
  return result;
}
