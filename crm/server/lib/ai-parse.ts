/**
 * ИИ-разбор документа: файл (PDF, фото, Word, Excel) → черновик формы документа.
 *
 * Экономно: текст из PDF / Word / Excel достаёт код (file-text.ts), модели уходит только
 * этот текст (скан или фото — сам файл) и короткая инструкция; справочник CRM ей не
 * передаём. Модель (по умолчанию дешёвая Haiku, без размышлений) только переписывает
 * поля документа в JSON по схеме. Всё сопоставление — кто это из контрагентов, какой
 * договор, какая сделка — делает код (resolveDraft): по ИНН, названию, номерам документов,
 * контейнеру. Сохраняет документ человек — после проверки в форме.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { DocumentDraft } from "../../shared/ai.ts";
import { CONTRACTOR_TYPES, COST_CATEGORIES, CURRENCIES, DOC_TYPES, docSpec, type DocType } from "../../shared/documents.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documents, shipmentParties } from "../db/schema.ts";
import { type AiUsage, aiBase, aiClient, aiError, usageOf } from "./ai.ts";
import { docxText, pdfText, xlsxText } from "./file-text.ts";
import { HttpError } from "./http.ts";
import { listShipments } from "./shipment-query.ts";

/** Ограничение размера файла для разбора (сканы уходят модели целиком). */
export const AI_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Длинный текст (договоры на 20 страниц) — начало и конец: реквизиты, номер, срок там. */
const MAX_TEXT = 24_000;

/** Когда какой тип — подсказки модели (ключи DOC_TYPES). */
const TYPE_HINTS: Partial<Record<DocType, string>> = {
  supplier_invoice: "инвойс / проформа (PI, Commercial Invoice, «购销合同» с ценами) от поставщика товара",
  supplier_contract: "контракт на поставку с поставщиком (рамочный)",
  contractor_invoice: "счёт / инвойс / debit note перевозчика, экспедитора, брокера, СВХ за услуги",
  railway_bill: "ж/д накладная СМГС",
  bill_of_lading: "морской коносамент B/L",
  customs_declaration: "декларация на товары (ДТ, ГТД)",
  conformity: "декларация / сертификат соответствия ЕАЭС",
  client_invoice: "счёт, который ТЛК БАРС выставила клиенту",
};

const nullable = (type: "string" | "number") => ({ type: [type, "null"] });

/** JSON-схема ответа модели (structured outputs). Только то, что написано в документе. */
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "docType", "number", "date", "currency", "amount", "counterparty", "contractorType", "clientName", "contractNumber",
    "relatedNumbers", "cargoTitle", "containerNo", "weightKg", "incoterms", "paymentTerms", "validUntil", "costCategory",
    "items", "summary",
  ],
  properties: {
    docType: { type: "string", enum: Object.keys(DOC_TYPES) },
    number: nullable("string"),
    date: nullable("string"),
    currency: { type: ["string", "null"], enum: [...CURRENCIES, null] },
    amount: nullable("number"),
    counterparty: {
      type: "object",
      additionalProperties: false,
      required: ["name", "fullName", "inn", "regNumber", "country", "address"],
      properties: {
        name: nullable("string"),
        fullName: nullable("string"),
        inn: nullable("string"),
        regNumber: nullable("string"),
        country: nullable("string"),
        address: nullable("string"),
      },
    },
    contractorType: { type: ["string", "null"], enum: [...Object.keys(CONTRACTOR_TYPES), null] },
    clientName: nullable("string"),
    contractNumber: nullable("string"),
    relatedNumbers: { type: "array", items: { type: "string" } },
    cargoTitle: nullable("string"),
    containerNo: nullable("string"),
    weightKg: nullable("number"),
    incoterms: nullable("string"),
    paymentTerms: nullable("string"),
    validUntil: nullable("string"),
    costCategory: { type: ["string", "null"], enum: [...Object.keys(COST_CATEGORIES), null] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "hsCode", "quantity", "unit", "price", "amount"],
        properties: {
          name: { type: "string" },
          hsCode: nullable("string"),
          quantity: nullable("number"),
          unit: nullable("string"),
          price: nullable("number"),
          amount: nullable("number"),
        },
      },
    },
    summary: { type: "string" },
  },
} as const;

export type ModelDraft = {
  docType: string;
  number: string | null;
  date: string | null;
  currency: string | null;
  amount: number | null;
  counterparty: { name: string | null; fullName: string | null; inn: string | null; regNumber: string | null; country: string | null; address: string | null };
  contractorType: string | null;
  clientName: string | null;
  contractNumber: string | null;
  relatedNumbers: string[];
  cargoTitle: string | null;
  containerNo: string | null;
  weightKg: number | null;
  incoterms: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  costCategory: string | null;
  items: { name: string; hsCode: string | null; quantity: number | null; unit: string | null; price: number | null; amount: number | null }[];
  summary: string;
};

const SYSTEM_PROMPT = `Ты переписываешь документ в карточку CRM компании ООО «ТЛК БАРС» (закупка и доставка товаров из Китая). Наша компания — покупатель / заказчик (в документах: BARS TRADING CO., LTD; LIMITED TRADE DEVELOPMENT BARS TRADING CO.; ТЛК БАРС; ИНН 5024256988) — она никогда не контрагент.

docType: ${(Object.entries(DOC_TYPES) as [DocType, { label: string }][]).map(([k, s]) => `${k} (${s.label}${TYPE_HINTS[k] ? `: ${TYPE_HINTS[k]}` : ""})`).join("; ")}.

Правила:
- counterparty — вторая сторона: продавец, перевозчик, экспедитор, брокер. name — короткое название как в документе. inn — только российский ИНН (10/12 цифр); иностранный рег. номер — regNumber. country — по-русски.
- contractorType — для подрядчиков: carrier_cn (перевозчик/экспедитор в Китае), carrier_ru, broker, warehouse (СВХ), agent, other.
- clientName — наш клиент, если явно назван (грузополучатель, маркировка), иначе null.
- contractNumber — номер договора / контракта, на который ссылается документ. relatedNumbers — другие номера из документа: заказ, заявка, B/L, накладная, инвойс, на который ссылаются.
- items — для инвойсов поставщика, спецификаций, сертификатов: каждая строка отдельно. name коротко: товар + артикул + размер («Искусственная трава 20 мм, 2×25 м (52 рул.)»), общие характеристики не повторяй; число рулонов/мест — в скобках. quantity — в единице цены (м², кг, шт); unit по-русски (м², м, шт, кг, рул.); price — цена за единицу, amount — сумма строки. Если цена за м² написана один раз на несколько строк — она общая для них; м² = ширина × длина рулона × число рулонов (проверь: quantity × price = amount). Доп. расходы (упаковка) — отдельной строкой. Для счетов подрядчиков items пустой.
- Числа: «37 456,95», «7503,30» — десятичная запятая. ￥, RMB, 元 — CNY. Даты — YYYY-MM-DD; «15/10/2026» — день/месяц/год.
- amount — итог документа (для ДТ — таможенные платежи в рублях). containerNo — 4 буквы + 7 цифр. weightKg — только если в документе прямо написан общий вес брутто (не считай сам).
- incoterms кратко («EXW Xinle»); paymentTerms кратко по-русски («30% депозит, 70% до погрузки»). validUntil — срок действия. costCategory — для счетов подрядчиков (transport, broker, terminal…).
- cargoTitle — короткое название груза по-русски («Искусственная трава 20 и 35 мм»).
- summary — одно короткое предложение по-русски (до 25 слов): что за документ, от кого, на что, сумма.
- Номера переписывай символ в символ. Нет значения — null. Ничего не придумывай.`;

/** Содержимое для модели: текст, если его можно достать кодом; иначе — сам файл. */
async function fileContent(buffer: Buffer, filename: string, mime: string): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  let text = "";
  try {
    if (mime === "application/pdf" || ext === "pdf") {
      text = await pdfText(buffer);
      // Скан без текстового слоя — отдаём PDF как есть (дороже: страницы — картинками).
      if (text.replace(/\s/g, "").length < 40) {
        return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }];
      }
    } else if (ext === "docx") text = await docxText(buffer);
    else if (ext === "xlsx") text = await xlsxText(buffer);
    else if (["txt", "csv", "tsv"].includes(ext) || mime.startsWith("text/")) text = buffer.toString("utf8");
    else {
      const images: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
      const media = images[ext] ?? Object.values(images).find((t) => t === mime);
      if (!media) throw new HttpError(400, "ИИ читает PDF, фото (JPG, PNG), Word (.docx) и Excel (.xlsx). Старые .doc / .xls пересохраните в новый формат или PDF.");
      return [{ type: "image", source: { type: "base64", media_type: media, data: buffer.toString("base64") } }];
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Не удалось прочитать файл — он повреждён или в другом формате");
  }
  text = text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new HttpError(400, "В файле нет текста");
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 6000)}\n…\n${text.slice(-6000)}`;
  return [{ type: "text", text: `Документ «${filename}»:\n\n${text}` }];
}

/** Вызов модели: файл → сырой черновик по схеме. */
async function askModel(buffer: Buffer, filename: string, mime: string): Promise<{ raw: ModelDraft; usage: AiUsage }> {
  const content = await fileContent(buffer, filename, mime);
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 16000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  if (response.stop_reason === "refusal") throw new HttpError(502, "ИИ отказался разбирать этот документ — заполните вручную");
  if (response.stop_reason === "max_tokens") throw new HttpError(502, "Документ слишком большой для разбора — заполните вручную");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return { raw: JSON.parse(text) as ModelDraft, usage: usageOf(response) };
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
}

// ── Сопоставление с базой (код, без ИИ) ────────────────────────────────────

const COMPANY_WORDS = new Set(["co", "ltd", "limited", "company", "inc", "llc", "corp", "corporation", "the", "ооо", "ип", "ао", "зао", "пао", "оао", "тов"]);

/** «Hebei Xiniu Technology Co.,Ltd» → «hebei xiniu technology». */
export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/[^0-9a-zа-я一-鿿]+/g, " ")
    .split(" ")
    .filter((w) => w && !COMPANY_WORDS.has(w))
    .join(" ");
}

/** Номера сравниваем без пробелов, тире, слэшей и регистра: «SSR-03-26» = «SSR 03/26». */
export const normNo = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^0-9a-zа-я]/gi, "");

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
const text = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

type CpRow = { id: number; role: string; name: string; fullName: string | null; inn: string | null; regNumber: string | null };

/** Контрагент: ИНН → рег. номер → название (точно, затем одно входит в другое). */
function matchCounterparty(rows: CpRow[], role: string | null, c: { name?: string | null; fullName?: string | null; inn?: string | null; regNumber?: string | null }): CpRow | null {
  const inn = (c.inn ?? "").replace(/\D/g, "");
  if (inn.length === 10 || inn.length === 12) {
    const hit = rows.find((r) => r.inn === inn);
    if (hit) return hit;
  }
  const reg = normNo(c.regNumber);
  if (reg.length >= 6) {
    const hit = rows.find((r) => normNo(r.regNumber) === reg);
    if (hit) return hit;
  }
  const names = [normName(c.name), normName(c.fullName)].filter((n) => n.length >= 3);
  if (!names.length) return null;
  const pool = role ? [...rows.filter((r) => r.role === role), ...rows.filter((r) => r.role !== role)] : rows;
  const exact = pool.find((r) => [normName(r.name), normName(r.fullName)].some((n) => n && names.includes(n)));
  if (exact) return exact;
  const partial = pool.filter((r) =>
    [normName(r.name), normName(r.fullName)].some((n) => n.length >= 6 && names.some((m) => m.length >= 6 && (n.includes(m) || m.includes(n)))),
  );
  return partial.length === 1 ? partial[0] : null;
}

/** Ответ модели → черновик формы: ссылки только на существующее в базе. */
export async function resolveDraft(tx: DbOrTx, raw: ModelDraft): Promise<DocumentDraft> {
  const type: DocType = raw.docType in DOC_TYPES ? (raw.docType as DocType) : "other";
  const spec = docSpec(type)!;
  const warnings: string[] = [];
  const rc = raw.counterparty ?? ({} as ModelDraft["counterparty"]);

  const cps: CpRow[] = await tx
    .select({ id: counterparties.id, role: counterparties.role, name: counterparties.name, fullName: counterparties.fullName, inn: counterparties.inn, regNumber: counterparties.regNumber })
    .from(counterparties);

  // Контрагент: найденный или новый с реквизитами из документа.
  let counterparty: DocumentDraft["counterparty"] = null;
  let newCounterparty: DocumentDraft["newCounterparty"] = null;
  if (spec.party) {
    const found = matchCounterparty(cps, spec.party, rc);
    const name = text(rc.name, 300) ?? text(rc.fullName, 300);
    if (found) counterparty = { id: found.id, name: found.name };
    else if (name) {
      counterparty = { id: null, name };
      newCounterparty = {};
      const inn = (rc.inn ?? "").replace(/\D/g, "");
      const country = text(rc.country, 60);
      if (inn.length === 10 || inn.length === 12) newCounterparty.inn = inn;
      for (const [k, v] of [["fullName", text(rc.fullName, 500)], ["regNumber", text(rc.regNumber, 60)], ["legalAddress", text(rc.address, 500)], ["country", country]] as const) {
        if (v) newCounterparty[k] = v;
      }
      if (spec.party !== "client" && (!country || !/росс|russia|^ru$/i.test(country))) newCounterparty.kind = "foreign";
      if (spec.party === "contractor" && raw.contractorType && raw.contractorType in CONTRACTOR_TYPES) newCounterparty.contractorType = raw.contractorType;
    }
  }

  // Договор-родитель — по номеру среди договоров этой стороны.
  let parentId: number | null = null;
  const contractNumber = text(raw.contractNumber, 100);
  if (spec.parentTypes && contractNumber) {
    const rows = await tx
      .select({ id: documents.id, number: documents.number, counterpartyId: documents.counterpartyId })
      .from(documents)
      .where(inArray(documents.type, spec.parentTypes));
    const want = normNo(contractNumber);
    const candidates = rows.filter((r) => want && normNo(r.number) === want);
    parentId = (candidates.find((r) => counterparty?.id && r.counterpartyId === counterparty.id) ?? (counterparty?.id ? undefined : candidates[0]))?.id ?? null;
  }

  const container = text(raw.containerNo, 20)?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  const number = text(raw.number, 100);

  // Сделка: контейнер → номера документов сделки → договор → контрагент (если у него одна сделка в работе).
  let shipment: DocumentDraft["shipment"] = null;
  let shipmentReason: string | null = null;
  if (!spec.contract) {
    const active = await listShipments(tx, sql`s.status = 'active'`);
    const ids = active.map((s) => s.id);
    const docs = ids.length
      ? await tx.select({ shipmentId: documents.shipmentId, number: documents.number, parentId: documents.parentId }).from(documents).where(inArray(documents.shipmentId, ids))
      : [];
    const parties = ids.length ? await tx.select().from(shipmentParties).where(inArray(shipmentParties.shipmentId, ids)) : [];
    const refs = new Set([contractNumber, ...(Array.isArray(raw.relatedNumbers) ? raw.relatedNumbers : [])].map((n) => normNo(n)).filter((n) => n.length >= 4));
    const scored = active.map((s) => {
      const sDocs = docs.filter((d) => d.shipmentId === s.id);
      const cpId = counterparty?.id;
      if (container && s.containerNo === container) return { s, score: 100, why: `контейнер ${container}` };
      const ref = sDocs.find((d) => refs.has(normNo(d.number)));
      if (ref) return { s, score: 80, why: `в сделке есть документ № ${ref.number}` };
      if (parentId && (s.supplierContractId === parentId || s.clientContractId === parentId || sDocs.some((d) => d.parentId === parentId))) {
        return { s, score: 50, why: `договор № ${contractNumber}` };
      }
      if (cpId && (s.supplierId === cpId || s.carrierId === cpId || parties.some((p) => p.shipmentId === s.id && p.counterpartyId === cpId))) {
        return { s, score: 30, why: `единственная сделка в работе с ${counterparty!.name}` };
      }
      return { s, score: 0, why: "" };
    });
    const top = Math.max(0, ...scored.map((x) => x.score));
    const best = scored.filter((x) => x.score === top && top > 0);
    if (best.length === 1) {
      const { s, why } = best[0];
      shipment = { id: s.id, number: s.number, title: s.title, containerNo: s.containerNo, weightKg: s.weightKg };
      shipmentReason = why;
    } else if (best.length > 1) {
      shipmentReason = `подходят несколько сделок: ${best.slice(0, 5).map((x) => `№ ${x.s.number} «${x.s.title}»`).join(", ")} — выберите`;
    } else {
      shipmentReason = "сделку не нашли: ни контейнер, ни номера документов, ни контрагент не совпали со сделками в работе";
    }
  }

  // Клиент: назван в документе или клиент сделки.
  let client: DocumentDraft["client"] = null;
  const namedClient = raw.clientName ? matchCounterparty(cps.filter((c) => c.role === "client"), "client", { name: raw.clientName }) : null;
  if (namedClient) client = { id: namedClient.id, name: namedClient.name };
  else if (shipment) {
    const [row] = await listShipments(tx, sql`s.id = ${shipment.id}`);
    if (row?.client) client = { id: row.client.id, name: row.client.name };
  }
  if (spec.party === "client" && !counterparty && client) counterparty = client;

  // Такой документ уже загружали?
  if (number && counterparty?.id) {
    const [dup] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.type, type), eq(documents.counterpartyId, counterparty.id), sql`lower(regexp_replace(${documents.number}, '[^0-9a-zA-Zа-яА-ЯёЁ]', '', 'g')) = ${normNo(number)}`));
    if (dup) warnings.unshift(`Документ № ${number} от ${counterparty.name} уже есть в CRM — не дубль ли?`);
  }

  const items = spec.items
    ? (Array.isArray(raw.items) ? raw.items : [])
        .filter((i) => typeof i?.name === "string" && i.name.trim())
        .slice(0, 200)
        .map((i) => ({
          productId: null,
          name: i.name.trim().slice(0, 500),
          batchNo: null,
          hsCode: text(i.hsCode, 20)?.replace(/\s/g, "") ?? null,
          quantity: num(i.quantity),
          unit: text(i.unit, 30),
          price: num(i.price),
          amount: num(i.amount),
        }))
    : [];

  // Проверки кодом: суммы строк против итога, строки без цены.
  const amount = num(raw.amount);
  if (items.length) {
    const sum = items.reduce((t, i) => t + (i.amount ?? (i.quantity != null && i.price != null ? i.quantity * i.price : 0)), 0);
    if (amount != null && Math.abs(sum - amount) > Math.max(1, amount * 0.005)) {
      warnings.push(`Сумма позиций ${sum.toLocaleString("ru-RU")} не равна итогу документа ${amount.toLocaleString("ru-RU")} — проверьте позиции`);
    }
    const empty = items.filter((i) => i.amount == null && (i.price == null || i.quantity == null)).length;
    if (empty) warnings.push(`У ${empty} поз. нет ни суммы, ни цены с количеством — дополните`);
  }

  return {
    type,
    number,
    date: isDate(raw.date) ? raw.date : null,
    currency: raw.currency && (CURRENCIES as readonly string[]).includes(raw.currency) ? raw.currency : null,
    amount,
    counterparty,
    newCounterparty,
    client,
    parentId,
    contractNumber,
    shipment,
    shipmentReason,
    cargoTitle: text(raw.cargoTitle, 300),
    containerNo: container,
    weightKg: num(raw.weightKg),
    incoterms: text(raw.incoterms, 200),
    paymentTerms: text(raw.paymentTerms, 300),
    validUntil: isDate(raw.validUntil) ? raw.validUntil : null,
    costCategory: type === "contractor_invoice" && raw.costCategory && raw.costCategory in COST_CATEGORIES ? raw.costCategory : null,
    items,
    summary: text(raw.summary, 1000) ?? "",
    warnings,
  };
}

export async function parseDocumentFile(tx: DbOrTx, buffer: Buffer, filename: string, mime: string): Promise<{ draft: DocumentDraft; usage: AiUsage }> {
  if (buffer.length > AI_MAX_FILE_BYTES) throw new HttpError(413, `Для разбора ИИ файл должен быть не больше ${AI_MAX_FILE_BYTES / 1024 / 1024} МБ`);
  const { raw, usage } = await askModel(buffer, filename, mime);
  return { draft: await resolveDraft(tx, raw), usage };
}
