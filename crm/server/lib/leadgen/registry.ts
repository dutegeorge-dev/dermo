/**
 * Реквизиты и контакты по ИНН: DaData (findById/party — статус, дата регистрации, руководитель, ОКВЭД, адрес) и
 * Checko (API v2: /company — организации, /entrepreneur — ИП; контакты — блок «Контакты»).
 * Ключи — только из окружения (DADATA_TOKEN, CHECKO_API_KEY), в адресах логов скрыты (redact).
 */

import { FetchError, type Http } from "./http.ts";

export const DADATA_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";
export const CHECKO_URL = "https://api.checko.ru/v2";

export type Requisites = {
  kind: "ul" | "ip";
  legalName: string;
  ogrn: string | null;
  /** ACTIVE / LIQUIDATING / LIQUIDATED / BANKRUPT / REORGANIZING. */
  status: string;
  regDate: string | null;
  managerName: string | null;
  managerPost: string | null;
  okved: string | null;
  address: string | null;
  region: string | null;
};

export type RawContacts = { phones: string[]; emails: string[]; sites: string[] };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function parseDadata(json: unknown): Requisites | null {
  const first = (json as { suggestions?: { value?: string; data?: Record<string, any> }[] } | null)?.suggestions?.[0];
  if (!first?.data) return null;
  const d = first.data;
  const ip = d.type === "INDIVIDUAL";
  const reg = typeof d.state?.registration_date === "number" ? new Date(d.state.registration_date).toISOString().slice(0, 10) : d.ogrn_date ? new Date(d.ogrn_date).toISOString().slice(0, 10) : null;
  const fio = d.fio ? [d.fio.surname, d.fio.name, d.fio.patronymic].filter(Boolean).join(" ") : "";
  return {
    kind: ip ? "ip" : "ul",
    legalName: s(d.name?.short_with_opf) || s(first.value),
    ogrn: s(d.ogrn) || null,
    status: s(d.state?.status) || "UNKNOWN",
    regDate: reg,
    managerName: ip ? fio || s(first.value).replace(/^ИП\s+/i, "") || null : s(d.management?.name) || null,
    managerPost: ip ? "Индивидуальный предприниматель" : s(d.management?.post) || null,
    okved: [s(d.okved), s(d.okved_name ?? d.okveds?.find?.((o: { main?: boolean }) => o.main)?.name)].filter(Boolean).join(" ") || null,
    address: s(d.address?.unrestricted_value ?? d.address?.value) || null,
    region: s(d.address?.data?.region_with_type) || null,
  };
}

export async function dadataParty(http: Http, token: string, inn: string): Promise<Requisites | null> {
  const res = await http.request(DADATA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Token ${token}` },
    body: JSON.stringify({ query: inn, branch_type: "MAIN", count: 1 }),
  });
  if (res.status === 401 || res.status === 403) {
    // 403 — суточный лимит (10 000 бесплатных) или неверный токен: дальше без DaData нельзя — задача ждёт.
    throw new FetchError(`DaData: HTTP ${res.status} — неверный DADATA_TOKEN или исчерпан суточный лимит`, res.status, true);
  }
  if (res.status < 200 || res.status >= 300) throw new FetchError(`DaData: HTTP ${res.status}`, res.status, false);
  return parseDadata(JSON.parse(res.text));
}

/** Все строки из значения (строка, массив строк, массив объектов с полем-строкой). */
function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(/[,;]\s*(?=[+\d(]|[\w.-]+@)/).map((x) => x.trim()).filter(Boolean);
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

/**
 * Контакты из ответа Checko. Основной путь — data.Контакты: { Тел: [...], Емэйл: [...], ВебСайт: "...", Телеграм: "..." }
 * (сверено с живым ответом /v2/company, ноябрь 2026; Телеграм не берём).
 * Если Checko переименует поля — ищем по смыслу имени ключа (тел / phone, email / емэйл / почт, сайт / web).
 */
export function parseCheckoContacts(json: unknown): RawContacts {
  const data = ((json as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
  const block = (data["Контакты"] ?? data.contacts ?? data) as Record<string, unknown>;
  const out: RawContacts = { phones: [], emails: [], sites: [] };
  for (const [key, value] of Object.entries(block ?? {})) {
    const k = key.toLowerCase();
    if (/телеграм|telegram|whatsapp|ватсап|vk|вконтакте/.test(k)) continue; // мессенджеры — не телефоны и не сайт
    if (/^тел|телефон|phone/.test(k)) out.phones.push(...strings(value));
    else if (/емэйл|email|e-mail|почт|mail/.test(k)) out.emails.push(...strings(value));
    else if (/сайт|web|site|url/.test(k)) out.sites.push(...strings(value));
  }
  return out;
}

export async function checkoContacts(http: Http, key: string, inn: string, kind: "ul" | "ip"): Promise<RawContacts> {
  const method = kind === "ip" ? "entrepreneur" : "company";
  const url = `${CHECKO_URL}/${method}?key=${encodeURIComponent(key)}&inn=${encodeURIComponent(inn)}`;
  let res: { data: { meta?: { status?: string; message?: string } } | null };
  try {
    res = await http.json<{ meta?: { status?: string; message?: string } }>(url);
  } catch (error) {
    // Неверный ключ / нет оплаты — касается всех продавцов: задача ждёт, а не отсеивает всех подряд.
    if (error instanceof FetchError && [401, 402, 403].includes(error.status)) throw new FetchError(`Checko: HTTP ${error.status} — проверьте CHECKO_API_KEY и баланс`, error.status, true);
    throw error;
  }
  const meta = res.data?.meta;
  if (meta?.status && meta.status !== "ok") {
    const message = meta.message ?? meta.status;
    // Баланс / ключ — задача ждёт (пополнят — «Продолжить»); «не найдено» — просто нет контактов.
    if (/баланс|ключ|key|лимит|limit|доступ/i.test(message)) throw new FetchError(`Checko: ${message}`, 402, true);
    return { phones: [], emails: [], sites: [] };
  }
  return parseCheckoContacts(res.data);
}
