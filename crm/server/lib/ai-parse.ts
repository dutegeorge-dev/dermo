/**
 * ИИ-разбор документа: файл (PDF, фото, Word, Excel) → черновик формы документа.
 *
 * Модели отдаём файл и справочник из CRM (контрагенты, сделки в работе с их документами,
 * договоры) — она определяет тип документа, стороны, номер, суммы, позиции, номер
 * контейнера и к какой сделке он относится. Ответ — строго по JSON-схеме. Затем
 * resolveDraft сверяет ссылки с базой: черновик никогда не ссылается на несуществующее.
 * Сохраняет документ человек — после проверки в форме.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { DocumentDraft } from "../../shared/ai.ts";
import { CONTRACTOR_TYPES, COST_CATEGORIES, CURRENCIES, DOC_TYPES, docSpec, type DocType } from "../../shared/documents.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documents } from "../db/schema.ts";
import { aiBase, aiClient, aiError } from "./ai.ts";
import { docxText, xlsxText } from "./file-text.ts";
import { HttpError } from "./http.ts";
import { getCompany } from "./settings.ts";
import { listShipments } from "./shipment-query.ts";

/** PDF и картинки модель читает сама; ограничение — размер запроса к API. */
export const AI_MAX_FILE_BYTES = 20 * 1024 * 1024;

const CONTRACT_TYPES = Object.entries(DOC_TYPES)
  .filter(([, s]) => "contract" in s && s.contract)
  .map(([k]) => k);

/** Когда какой тип — подсказки модели (ключи DOC_TYPES). */
const TYPE_HINTS: Partial<Record<DocType, string>> = {
  supplier_invoice: "инвойс / проформа (PI, Commercial Invoice, «购销合同» с ценами) от поставщика товара",
  supplier_contract: "контракт на поставку товара с поставщиком (рамочный, без конкретной партии)",
  packing_list: "упаковочный лист поставщика",
  contractor_invoice: "счёт / инвойс / debit note перевозчика, экспедитора, брокера, СВХ — за услуги (фрахт, ж/д тариф, оформление)",
  contractor_contract: "договор с перевозчиком, экспедитором, брокером, СВХ",
  railway_bill: "железнодорожная накладная СМГС / ЦИМ/СМГС",
  cmr: "автомобильная накладная CMR",
  bill_of_lading: "морской коносамент (B/L)",
  air_waybill: "авианакладная (AWB)",
  customs_declaration: "декларация на товары (ДТ, ГТД)",
  conformity: "декларация соответствия / сертификат соответствия ЕАЭС",
  commission_contract: "договор комиссии ТЛК БАРС с клиентом",
  supply_contract: "договор поставки ТЛК БАРС с клиентом",
  teu_contract: "договор транспортно-экспедиционных услуг с клиентом",
  client_invoice: "счёт, который ТЛК БАРС выставила клиенту",
};

const nullable = (type: "string" | "number" | "integer") => ({ type: [type, "null"] });

/** JSON-схема ответа модели (structured outputs). */
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "docType", "number", "date", "currency", "amount", "counterparty", "contractorType", "clientMatchId",
    "contractNumber", "shipmentMatchNumber", "shipmentReason", "cargoTitle", "containerNo", "weightKg",
    "incoterms", "paymentTerms", "validUntil", "costCategory", "items", "summary", "warnings",
  ],
  properties: {
    docType: { type: "string", enum: Object.keys(DOC_TYPES) },
    number: nullable("string"),
    date: { ...nullable("string"), description: "YYYY-MM-DD" },
    currency: { type: ["string", "null"], enum: [...CURRENCIES, null] },
    amount: { ...nullable("number"), description: "Итого по документу" },
    counterparty: {
      type: "object",
      additionalProperties: false,
      required: ["matchId", "name", "fullName", "inn", "regNumber", "country", "address"],
      properties: {
        matchId: { ...nullable("integer"), description: "id из справочника контрагентов, если это он" },
        name: nullable("string"),
        fullName: nullable("string"),
        inn: { ...nullable("string"), description: "ИНН — только российский (10 или 12 цифр)" },
        regNumber: { ...nullable("string"), description: "рег. номер иностранной компании (USCC и т.п.)" },
        country: { ...nullable("string"), description: "по-русски: Китай, Россия" },
        address: nullable("string"),
      },
    },
    contractorType: { type: ["string", "null"], enum: [...Object.keys(CONTRACTOR_TYPES), null] },
    clientMatchId: { ...nullable("integer"), description: "id клиента из справочника, если документ явно про него" },
    contractNumber: { ...nullable("string"), description: "номер договора / контракта, к которому относится документ" },
    shipmentMatchNumber: { ...nullable("integer"), description: "номер сделки в работе, к которой относится документ" },
    shipmentReason: { ...nullable("string"), description: "почему эта сделка (или почему не нашлась)" },
    cargoTitle: { ...nullable("string"), description: "короткое название груза по-русски" },
    containerNo: nullable("string"),
    weightKg: nullable("number"),
    incoterms: nullable("string"),
    paymentTerms: nullable("string"),
    validUntil: { ...nullable("string"), description: "YYYY-MM-DD" },
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
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

type ModelDraft = {
  docType: string;
  number: string | null;
  date: string | null;
  currency: string | null;
  amount: number | null;
  counterparty: {
    matchId: number | null;
    name: string | null;
    fullName: string | null;
    inn: string | null;
    regNumber: string | null;
    country: string | null;
    address: string | null;
  };
  contractorType: string | null;
  clientMatchId: number | null;
  contractNumber: string | null;
  shipmentMatchNumber: number | null;
  shipmentReason: string | null;
  cargoTitle: string | null;
  containerNo: string | null;
  weightKg: number | null;
  incoterms: string | null;
  paymentTerms: string | null;
  validUntil: string | null;
  costCategory: string | null;
  items: { name: string; hsCode: string | null; quantity: number | null; unit: string | null; price: number | null; amount: number | null }[];
  summary: string;
  warnings: string[];
};

const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const normNo = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^0-9a-zа-я]/gi, "");

/** Справочник CRM для модели: компактным текстом. */
async function crmContext(tx: DbOrTx) {
  const company = await getCompany(tx);
  const cps = await tx
    .select({
      id: counterparties.id,
      role: counterparties.role,
      contractorType: counterparties.contractorType,
      name: counterparties.name,
      fullName: counterparties.fullName,
      inn: counterparties.inn,
      regNumber: counterparties.regNumber,
    })
    .from(counterparties)
    .orderBy(counterparties.name)
    .limit(1000);
  const active = await listShipments(tx, sql`s.status = 'active'`);
  const ids = active.map((s) => s.id);
  const docs = ids.length
    ? await tx
        .select({ shipmentId: documents.shipmentId, type: documents.type, number: documents.number, date: documents.date, counterpartyId: documents.counterpartyId, amount: sql<number | null>`${documents.amount}::float8`, currency: documents.currency })
        .from(documents)
        .where(inArray(documents.shipmentId, ids))
    : [];
  const items = ids.length
    ? await tx.execute<{ shipment_id: number; names: string }>(sql`
        SELECT d.shipment_id, string_agg(DISTINCT i.name, '; ') AS names
          FROM document_items i JOIN documents d ON d.id = i.document_id
         WHERE d.shipment_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
         GROUP BY d.shipment_id`)
    : { rows: [] };
  const contracts = await tx
    .select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, counterpartyId: documents.counterpartyId, clientId: documents.clientId, status: documents.status })
    .from(documents)
    .where(inArray(documents.type, CONTRACT_TYPES))
    .limit(1000);

  const cpName = new Map(cps.map((c) => [c.id, c.name]));
  const lines: string[] = [];
  lines.push(
    `Наша компания (покупатель / заказчик / комиссионер — НИКОГДА не контрагент): ${oneLine(company.name) || "ООО «ТЛК БАРС»"}` +
      `${company.fullName ? `, ${oneLine(company.fullName)}` : ""}${company.inn ? `, ИНН ${company.inn}` : ""}.` +
      " В иностранных документах пишется латиницей: «BARS TRADING CO., LTD», «LIMITED TRADE DEVELOPMENT BARS TRADING CO.» и похоже.",
  );
  lines.push("", "## Контрагенты (id | роль | название | ИНН / рег. номер)");
  for (const c of cps) {
    const role = c.role === "contractor" ? `подрядчик${c.contractorType ? `:${c.contractorType}` : ""}` : c.role === "supplier" ? "поставщик" : "клиент";
    lines.push(`${c.id} | ${role} | ${oneLine(c.name)}${c.fullName && c.fullName !== c.name ? ` (${oneLine(c.fullName)})` : ""} | ${c.inn ?? c.regNumber ?? ""}`);
  }
  if (!cps.length) lines.push("(пусто)");
  lines.push("", "## Договоры и контракты (id | тип | номер | дата | сторона | клиент)");
  for (const d of contracts) {
    lines.push(`${d.id} | ${d.type} | ${d.number ?? "без номера"} | ${d.date ?? ""} | ${cpName.get(d.counterpartyId ?? 0) ?? ""} | ${cpName.get(d.clientId ?? 0) ?? ""}${d.status === "cancelled" ? " | аннулирован" : ""}`);
  }
  if (!contracts.length) lines.push("(пусто)");
  lines.push("", "## Сделки в работе (одна сделка = одна отгрузка, обычно один контейнер)");
  const itemNames = new Map(items.rows.map((r) => [Number(r.shipment_id), String(r.names)]));
  for (const s of active) {
    const sDocs = docs
      .filter((d) => d.shipmentId === s.id)
      .map((d) => `${d.type} № ${d.number ?? "—"}${d.date ? ` от ${d.date}` : ""}${d.counterpartyId ? ` (${cpName.get(d.counterpartyId) ?? ""})` : ""}${d.amount != null ? ` ${d.amount} ${d.currency ?? ""}` : ""}`);
    lines.push(
      `- Сделка № ${s.number} «${oneLine(s.title)}»: этап ${s.stage}, схема ${s.scheme}` +
        `, клиент ${s.client?.name ?? "—"}, поставщик ${s.supplier?.name ?? "—"}, перевозчик ${s.carrier?.name ?? "—"}` +
        `, контейнер ${s.containerNo ?? "—"}${s.hsCode ? `, ТН ВЭД ${s.hsCode}` : ""}${s.weightKg ? `, вес ${s.weightKg} кг` : ""}` +
        `${s.pickupLocation ? `, откуда ${oneLine(s.pickupLocation)}` : ""}${s.deliveryLocation ? `, куда ${oneLine(s.deliveryLocation)}` : ""}` +
        `${itemNames.get(s.id) ? `; товары: ${oneLine(itemNames.get(s.id)).slice(0, 300)}` : ""}` +
        `${sDocs.length ? `; документы: ${sDocs.join("; ")}` : ""}`,
    );
  }
  if (!active.length) lines.push("(нет)");
  return lines.join("\n");
}

const SYSTEM_PROMPT = `Ты разбираешь документы для CRM компании ООО «ТЛК БАРС» (Красногорск): закупка и доставка товаров из Китая «под ключ» — поставщики в Китае, перевозка ж/д, морем, авто, растаможка в России. Сотрудник загрузил файл; твоя задача — заполнить карточку документа, чтобы человеку осталось только проверить и сохранить.

Типы документов (docType):
${(Object.entries(DOC_TYPES) as [DocType, { label: string }][]).map(([k, s]) => `- ${k}: ${s.label}${TYPE_HINTS[k] ? ` — ${TYPE_HINTS[k]}` : ""}`).join("\n")}

Правила:
- Контрагент (counterparty) — вторая сторона документа: продавец, перевозчик, экспедитор, брокер. Наша компания никогда не контрагент. Если он есть в справочнике — matchId (сверяй по названию, ИНН, банковским реквизитам, контактам; написание может отличаться). Если нет — matchId null, name — короткое название как в документе.
- contractorType — только для подрядчиков: carrier_cn — перевозчик / экспедитор в Китае (Китайская компания, оплата в CNY/USD), carrier_ru — российский перевозчик, broker — таможенный брокер, warehouse — СВХ / терминал, agent, other.
- Сделка (shipmentMatchNumber): к какой сделке в работе относится документ. Сверяй номер контейнера, номера инвойсов и контрактов в документах сделки, поставщика и товары, перевозчика, маршрут, суммы. Если однозначно не понять — null и объясни в shipmentReason. Не выдумывай.
- clientMatchId — только если клиент явно назван в документе (грузополучатель, маркировка). Иначе null.
- contractNumber — номер договора / контракта, на который ссылается документ (CONTRACT NO., «по договору №»).
- Позиции (items) — для инвойсов поставщика, поручений, спецификаций, сертификатов: каждая строка отдельно. name — наименование с отличающими характеристиками (артикул, размер, толщина), как в документе; если размеров несколько — отдельная позиция на каждый. quantity — количество в той единице, к которой относится цена (м², кг, шт); число рулонов / мест допиши в name, например «(52 рул.)». unit — по-русски: «м²», «м», «шт», «кг», «рул.», «компл.». price — цена за единицу, amount — сумма строки. Доп. расходы в инвойсе (упаковка, доставка до порта) — отдельной позицией. Для счетов подрядчиков позиции не нужны — пустой массив.
- Числа: «37 456,95» и «7503,30» — десятичная запятая; пробелы — разделители тысяч. ￥, RMB, rmb, 元 — CNY.
- Даты — YYYY-MM-DD. «15/10/2026» — день/месяц/год. «20th Sept, 2026» — 2026-09-20.
- amount — итог документа. Для ДТ — сумма таможенных платежей в рублях.
- containerNo — номер контейнера (4 буквы + 7 цифр, например MSKU1234567), если есть. weightKg — вес брутто груза, если указан (для накладных).
- incoterms — кратко: «EXW Xinle», «FOB Xingang». paymentTerms — кратко по-русски: «100% до отгрузки», «30% депозит, 70% до погрузки».
- validUntil — срок действия договора / сертификата, если указан.
- costCategory — только для счетов подрядчиков, если очевидно: transport, broker, terminal…; иначе null.
- cargoTitle — короткое название груза по-русски, как его назовёт менеджер: «Искусственная трава 20 и 35 мм», «ПВХ линолеум K105».
- summary — 1–2 предложения по-русски: что это за документ, от кого, на что и на какую сумму.
- warnings — по-русски, коротко, не больше 4: только то, что человеку реально надо проверить (сумма позиций не сходится с итогом, неразборчиво, сделка под вопросом). Не пиши то, что и так видно в форме (новый контрагент, нет ТН ВЭД), и не пиши, что «всё сходится». Пустой массив, если всё чисто.
- Номера (документа, договора, контейнера, заказа) переписывай символ в символ, сверяя по тексту документа.
- Не нашёл значение — null. Ничего не придумывай.`;

/** Файл → содержимое сообщения для модели. */
async function fileContent(buffer: Buffer, filename: string, mime: string): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }];
  }
  const images: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
  const imageType = images[ext] ?? (Object.values(images) as string[]).find((t) => t === mime);
  if (imageType) {
    return [{ type: "image", source: { type: "base64", media_type: imageType as "image/jpeg", data: buffer.toString("base64") } }];
  }
  let text: string;
  try {
    if (ext === "docx") text = await docxText(buffer);
    else if (ext === "xlsx") text = await xlsxText(buffer);
    else if (["txt", "csv", "tsv"].includes(ext) || mime.startsWith("text/")) text = buffer.toString("utf8");
    else throw new HttpError(400, "ИИ читает PDF, фото (JPG, PNG), Word (.docx) и Excel (.xlsx). Старые .doc / .xls пересохраните в новый формат или PDF.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Не удалось прочитать файл — он повреждён или в другом формате");
  }
  if (!text.trim()) throw new HttpError(400, "В файле нет текста");
  return [{ type: "text", text: `Содержимое файла «${filename}»:\n\n${text.slice(0, 300_000)}` }];
}

/** Вызов модели: файл + справочник → сырой черновик по схеме. */
async function askModel(tx: DbOrTx, buffer: Buffer, filename: string, mime: string): Promise<ModelDraft> {
  const content = await fileContent(buffer, filename, mime);
  const context = await crmContext(tx);
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: DRAFT_SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Справочник CRM на сегодня (${new Date().toISOString().slice(0, 10)}):\n\n${context}` },
            ...content,
            { type: "text", text: `Файл: «${filename}». Разбери документ и заполни карточку.` },
          ],
        },
      ],
    });
  } catch (error) {
    throw aiError(error);
  }
  if (response.stop_reason === "refusal") throw new HttpError(502, "ИИ отказался разбирать этот документ — заполните вручную");
  if (response.stop_reason === "max_tokens") throw new HttpError(502, "Документ слишком большой для разбора — заполните вручную или загрузите по частям");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text) as ModelDraft;
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
}

const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
const text = (s: unknown, max: number) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);

/** Сверка ответа модели с базой: только существующие id, нормальные даты и числа. */
export async function resolveDraft(tx: DbOrTx, raw: ModelDraft): Promise<DocumentDraft> {
  const type: DocType = raw.docType in DOC_TYPES ? (raw.docType as DocType) : "other";
  const spec = docSpec(type)!;
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter((w) => typeof w === "string").slice(0, 10) : [];

  // Контрагент: id от модели → ИНН → точное название; иначе — новый.
  let counterparty: DocumentDraft["counterparty"] = null;
  let newCounterparty: DocumentDraft["newCounterparty"] = null;
  const rc = raw.counterparty ?? ({} as ModelDraft["counterparty"]);
  const inn = (rc.inn ?? "").replace(/\D/g, "");
  if (spec.party) {
    const byId = rc.matchId ? (await tx.select({ id: counterparties.id, name: counterparties.name }).from(counterparties).where(eq(counterparties.id, rc.matchId)))[0] : undefined;
    const byInn = !byId && (inn.length === 10 || inn.length === 12) ? (await tx.select({ id: counterparties.id, name: counterparties.name }).from(counterparties).where(eq(counterparties.inn, inn)))[0] : undefined;
    const name = text(rc.name, 300);
    const byName = !byId && !byInn && name ? (await tx.select({ id: counterparties.id, name: counterparties.name }).from(counterparties).where(sql`lower(${counterparties.name}) = lower(${name})`))[0] : undefined;
    const found = byId ?? byInn ?? byName;
    if (found) counterparty = found;
    else if (name) {
      counterparty = { id: null, name };
      newCounterparty = {};
      const country = text(rc.country, 60);
      if (inn.length === 10 || inn.length === 12) newCounterparty.inn = inn;
      for (const [k, v] of [["fullName", text(rc.fullName, 500)], ["regNumber", text(rc.regNumber, 60)], ["legalAddress", text(rc.address, 500)], ["country", country]] as const) {
        if (v) newCounterparty[k] = v;
      }
      if (spec.party !== "client" && (!country || !/росс|russia|^ru$/i.test(country))) newCounterparty.kind = "foreign";
      if (spec.party === "contractor" && raw.contractorType && raw.contractorType in CONTRACTOR_TYPES) newCounterparty.contractorType = raw.contractorType;
    }
  }

  // Сделка — только из тех, что в работе.
  let shipment: DocumentDraft["shipment"] = null;
  if (!spec.contract && raw.shipmentMatchNumber) {
    const [row] = await listShipments(tx, sql`s.status = 'active' AND s.number = ${raw.shipmentMatchNumber}`);
    if (row) shipment = { id: row.id, number: row.number, title: row.title, containerNo: row.containerNo, weightKg: row.weightKg };
  }

  // Клиент: явный из документа или клиент сделки.
  let client: DocumentDraft["client"] = null;
  if (raw.clientMatchId) {
    const [row] = await tx.select({ id: counterparties.id, name: counterparties.name }).from(counterparties).where(and(eq(counterparties.id, raw.clientMatchId), eq(counterparties.role, "client")));
    if (row) client = row;
  }
  if (!client && shipment) {
    const [row] = await listShipments(tx, sql`s.id = ${shipment.id}`);
    if (row?.client) client = { id: row.client.id, name: row.client.name };
  }
  if (spec.party === "client" && !counterparty && client) counterparty = client;

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

  const currency = raw.currency && (CURRENCIES as readonly string[]).includes(raw.currency) ? raw.currency : null;
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
  const container = text(raw.containerNo, 20)?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? null;

  return {
    type,
    number: text(raw.number, 100),
    date: isDate(raw.date) ? raw.date : null,
    currency,
    amount: num(raw.amount),
    counterparty,
    newCounterparty,
    client,
    parentId,
    contractNumber,
    shipment,
    shipmentReason: text(raw.shipmentReason, 500),
    cargoTitle: text(raw.cargoTitle, 300),
    containerNo: container || null,
    weightKg: num(raw.weightKg),
    incoterms: text(raw.incoterms, 200),
    paymentTerms: text(raw.paymentTerms, 300),
    validUntil: isDate(raw.validUntil) ? raw.validUntil : null,
    costCategory: raw.costCategory && raw.costCategory in COST_CATEGORIES ? raw.costCategory : null,
    items,
    summary: text(raw.summary, 1000) ?? "",
    warnings,
  };
}

export async function parseDocumentFile(tx: DbOrTx, buffer: Buffer, filename: string, mime: string): Promise<DocumentDraft> {
  if (buffer.length > AI_MAX_FILE_BYTES) throw new HttpError(413, `Для разбора ИИ файл должен быть не больше ${AI_MAX_FILE_BYTES / 1024 / 1024} МБ`);
  return resolveDraft(tx, await askModel(tx, buffer, filename, mime));
}
