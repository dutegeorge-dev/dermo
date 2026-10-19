/**
 * Спецификация для перевозчика («Счёт-фактура — упаковочный лист — спецификация»): после погрузки
 * перевозчик просит заполнить её по инвойсу и упаковочному листу. Строки — ровно по позициям документов
 * (часто это не коды ТН ВЭД, а места: рулоны 2 м — 65 шт., 3 м — 105 шт.): места / нетто / брутто — из
 * упаковочного листа, стоимость — из инвойса поставщика (строки листа сопоставляются с инвойсом по
 * названию, иначе по порядку).
 *
 * Шаблоны у перевозчиков немного разные. Свой шаблон — templates/carrier_spec.xlsx (разметка известна);
 * чужой — ИИ один раз определяет, в какие ячейки что вписывать (только адреса, значения пишет код),
 * разметка кэшируется по хэшу файла в settings.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";

import { DEFAULT_SPEC_PARAMS, type PackingData, type SpecLine, type SpecParams } from "../../shared/cargo.ts";
import { CRM_ROOT } from "../config.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documentItems, documents, products, settings, shipments } from "../db/schema.ts";
import { type AiUsage, aiBase, aiClient, aiEnabled, aiError, usageOf } from "./ai.ts";
import { HttpError } from "./http.ts";
import { productKey } from "./product-match.ts";
import { getCompany } from "./settings.ts";
import { type CellValue, colIndex, fillXlsx, type Grid, readGrid, rowIndex } from "./xlsx-fill.ts";

export const SPEC_TEMPLATE = path.join(CRM_ROOT, "templates", "carrier_spec.xlsx");

const FIELDS = ["contract", "invoiceNo", "invoiceDate", "consignee", "seller", "buyer", "terms", "country", "container", "station", "ceo", "priceHeader", "amountHeader"] as const;
const COLUMNS = ["no", "hsCode", "origin", "description", "qty", "packages", "netKg", "grossKg", "price", "amount"] as const;
type Field = (typeof FIELDS)[number];
type Column = (typeof COLUMNS)[number];

/** Где в шаблоне что: адреса ячеек полей и столбцы таблицы товаров. */
export type SpecMapping = {
  sheet: string | null;
  fields: Partial<Record<Field, string | null>>;
  table: { firstRow: number; rows: number; columns: Partial<Record<Column, string | null>> };
};

/** Разметка нашего шаблона (templates/carrier_spec.xlsx). */
export const DEFAULT_MAPPING: SpecMapping = {
  sheet: "Спецификация",
  fields: {
    contract: "B2", invoiceNo: "F2", invoiceDate: "I2", consignee: "C4", seller: "C7", buyer: "F7",
    terms: "C11", country: "H11", container: "C12", station: "H12", ceo: "D28", priceHeader: "I14", amountHeader: "J14",
  },
  table: { firstRow: 15, rows: 10, columns: { no: "A", hsCode: "B", origin: "C", description: "D", qty: "E", packages: "F", netKg: "G", grossKg: "H", price: "I", amount: "J" } },
};

const dmy = (d: string | null) => (d ? d.split("-").reverse().join(".") : "");
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const PIECES = /^(шт|pcs|pc|piece|pieces|компл|set|sets)\.?$/i;

type ShipmentRow = typeof shipments.$inferSelect;

/** Данные спецификации: поля шапки и строки — по позициям инвойса / упаковочного листа. missing — чего не хватает. */
export async function specData(tx: DbOrTx, sh: ShipmentRow) {
  const params: SpecParams = { ...DEFAULT_SPEC_PARAMS, ...(sh.spec ?? {}) };
  const missing: string[] = [];
  const invoices = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.shipmentId, sh.id), eq(documents.type, "supplier_invoice")))
    .orderBy(asc(documents.date), asc(documents.id));
  if (!invoices.length) missing.push("инвойс поставщика");
  const packings = await tx.select().from(documents).where(and(eq(documents.shipmentId, sh.id), eq(documents.type, "packing_list")));
  if (!packings.length) missing.push("упаковочный лист");
  if (!sh.containerNo) missing.push("номер контейнера");
  if (!params.consignee.trim()) missing.push("получатель (consignee)");
  if (!params.station.trim()) missing.push("станция назначения");

  const items = invoices.length
    ? await tx
        .select({ name: documentItems.name, itemHs: documentItems.hsCode, productHs: products.hsCode, nameRu: products.nameRu, quantity: documentItems.quantity, unit: documentItems.unit, amount: documentItems.amount })
        .from(documentItems)
        .leftJoin(products, eq(products.id, documentItems.productId))
        .where(inArray(documentItems.documentId, invoices.map((i) => i.id)))
        .orderBy(asc(documentItems.documentId), asc(documentItems.position))
    : [];
  const currency = invoices[0]?.currency ?? "CNY";

  // Позиции — ровно как в инвойсе / упаковочном листе (рулоны 2 м — одна строка, 3 м — другая).
  type Item = (typeof items)[number];
  const hsOf = (it: Item) => (it.productHs ?? it.itemHs ?? "").replace(/\D/g, "");
  if (items.some((it) => !hsOf(it))) missing.push("код ТН ВЭД у товаров");
  const pieces = (it: Item) => (it.quantity !== null && PIECES.test((it.unit ?? "").trim()) ? Number(it.quantity) : null);
  /** «(52 рул.)» в названии позиции инвойса — мест, если упаковочного листа нет. */
  const rollsInName = (name: string) => {
    const m = /\((\d+)\s*(рул|roll|кор|box|carton|мест|pkg|pall|пал)/i.exec(name);
    return m ? Number(m[1]) : null;
  };

  const pl = packings.map((d) => (d.data as { packing?: PackingData } | null)?.packing).filter((p): p is PackingData => !!p);
  const plLines = pl.flatMap((p) => p.lines);
  const total = { packages: 0, netKg: 0, grossKg: 0 };
  for (const p of pl) {
    total.packages += p.totals.packages ?? 0;
    total.netKg += p.totals.netKg ?? 0;
    total.grossKg += p.totals.grossKg ?? 0;
  }

  // Строка упаковочного листа → позиция инвойса: по названию, иначе (столько же строк) — по порядку.
  let pairs: number[] | null = null;
  if (plLines.length && items.length) {
    const keys = items.map((it) => productKey(it.name));
    const byName = plLines.map((l) => keys.indexOf(productKey(l.name)));
    if (byName.every((i) => i >= 0) && new Set(byName).size === items.length) pairs = byName;
    else if (plLines.length === items.length) pairs = plLines.map((_, i) => i);
  }
  const warnings: string[] = [];
  type Row = { item: Item | null; name: string; amount: number; qtyHint: number | null; packages: number | null; netKg: number | null; grossKg: number | null };
  let rows: Row[];
  if (pairs) {
    // Позиция инвойса на нескольких строках листа — стоимость делим по количеству (или местам).
    const share = plLines.map((l, i) => {
      const same = plLines.filter((_, j) => pairs![j] === pairs![i]);
      if (same.length === 1) return 1;
      const by = (f: (x: typeof l) => number | null) => {
        const t = same.reduce((s, x) => s + (f(x) ?? 0), 0);
        return t ? (f(l) ?? 0) / t : null;
      };
      return by((x) => x.quantity) ?? by((x) => x.packages) ?? 1 / same.length;
    });
    rows = plLines.map((l, i) => {
      const it = items[pairs![i]];
      return { item: it, name: l.name || it.name, amount: Number(it.amount ?? 0) * share[i], qtyHint: share[i] === 1 ? pieces(it) : null, packages: l.packages, netKg: l.netKg, grossKg: l.grossKg };
    });
  } else {
    // Позиции листа не сходятся с инвойсом — строки по инвойсу, места и веса делим по стоимости.
    if (plLines.length) warnings.push("Позиции упаковочного листа не совпадают с инвойсом: строки взяты из инвойса, места и веса разделены пропорционально стоимости — проверьте.");
    const amountTotal = items.reduce((s, it) => s + Number(it.amount ?? 0), 0);
    let packagesLeft = Math.round(total.packages);
    rows = items.map((it, i) => {
      const share = amountTotal ? Number(it.amount ?? 0) / amountTotal : 1 / items.length;
      const last = i === items.length - 1;
      const packages = !pl.length ? rollsInName(it.name) : last ? packagesLeft : Math.round(total.packages * share);
      if (pl.length) packagesLeft -= packages ?? 0;
      return {
        item: it,
        name: it.name,
        amount: Number(it.amount ?? 0),
        qtyHint: pieces(it),
        packages,
        netKg: pl.length ? total.netKg * share : null,
        grossKg: pl.length ? total.grossKg * share : null,
      };
    });
  }

  const usedKeys = new Set<string>();
  const lines: SpecLine[] = rows.map((r, i) => {
    let key = productKey(r.name) || `#${i + 1}`;
    while (usedKeys.has(key)) key += "#";
    usedKeys.add(key);
    const hsCode = r.item ? hsOf(r.item) : "";
    // «Кол-во шт»: штучный товар — штуки из инвойса, иначе — места (рулоны, коробки).
    const qty = r.qtyHint && r.qtyHint > 0 ? r.qtyHint : (r.packages ?? 0);
    return {
      no: i + 1,
      key,
      hsCode,
      origin: params.origin,
      description: params.descriptions[key] ?? params.descriptions[hsCode] ?? r.item?.nameRu ?? r.name,
      qty,
      packages: r.packages,
      netKg: r.netKg === null ? null : round(r.netKg),
      grossKg: r.grossKg === null ? null : round(r.grossKg),
      price: qty ? round(r.amount / qty, 4) : null,
      amount: round(r.amount, 2),
    };
  });

  const [supplier] = sh.supplierId ? await tx.select().from(counterparties).where(eq(counterparties.id, sh.supplierId)) : [];
  const contractId = sh.supplierContractId ?? invoices.find((i) => i.parentId)?.parentId ?? null;
  const [contract] = contractId ? await tx.select().from(documents).where(eq(documents.id, contractId)) : [];
  const company = await getCompany(tx);
  const incoterms = invoices.map((i) => (i.data as { incoterms?: string } | null)?.incoterms).find(Boolean) ?? "";
  if (!supplier) missing.push("поставщик в сделке");

  const fields: Record<Field, string> = {
    contract: contract ? `${contract.number ?? "б/н"}${contract.date ? ` от ${dmy(contract.date)}` : ""}` : "",
    invoiceNo: invoices.map((i) => i.number ?? "б/н").join(", "),
    invoiceDate: dmy(invoices[0]?.date ?? null),
    consignee: params.consignee,
    seller: supplier ? [supplier.fullName || supplier.name, supplier.legalAddress ? `ADDRESS: ${supplier.legalAddress}` : ""].filter(Boolean).join("\n") : "",
    buyer: [company.fullName || company.name, company.legalAddress ? `Адрес: ${company.legalAddress}` : "", company.inn ? `ИНН ${company.inn}${company.kpp ? `/КПП ${company.kpp}` : ""}` : ""].filter(Boolean).join("\n"),
    terms: incoterms,
    country: params.country,
    container: sh.containerNo ?? "",
    station: params.station,
    ceo: company.signatoryName,
    priceHeader: currency,
    amountHeader: currency,
  };
  return { params, fields, lines, currency, missing, warnings, packing: pl.length ? total : null };
}

// ── Разметка чужого шаблона (ИИ) ───────────────────────────────────────────

// Не больше 16 полей-объединений в схеме ответа — «нет» = пустая строка (её отсекают okRef / okCol).
const ref = { type: "string" } as const;
const col = { type: "string" } as const;
export const MAPPING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sheet", "fields", "table"],
  properties: {
    sheet: { type: "string" },
    fields: { type: "object", additionalProperties: false, required: [...FIELDS], properties: Object.fromEntries(FIELDS.map((f) => [f, ref])) },
    table: {
      type: "object",
      additionalProperties: false,
      required: ["firstRow", "rows", "columns"],
      properties: {
        firstRow: { type: "integer" },
        rows: { type: "integer" },
        columns: { type: "object", additionalProperties: false, required: [...COLUMNS], properties: Object.fromEntries(COLUMNS.map((c) => [c, col])) },
      },
    },
  },
} as const;

const MAPPING_PROMPT = `Тебе дан Excel-шаблон спецификации для перевозчика (счёт-фактура / упаковочный лист / спецификация): адреса непустых ячеек с текстом и объединения. Определи, в какие ячейки вписывать данные. Значения не придумывай — только адреса.

В шаблоне бывают поясняющие блоки вокруг формы (подсказки вида «Полное наименование продавца…», «Номер и дата документа…», часто с китайским текстом) — это НЕ поля, туда ничего не пишем. Форма — это подписи полей: «Договор №:», «№:» / «Инвойс №:», «Date / Дата:», «Получатель / Consignee», «Отправитель / Продавец / Shipper/Seller», «Покупатель / Buyer», «Terms of delivery», «Destination countries», «Container», «Destination Station», заголовки таблицы.
fields — адрес ЛЕВОЙ ВЕРХНЕЙ ячейки, куда вписать значение: справа от подписи в той же строке (или ниже, если справа нет места); ячейка с «必填» или пустая — как раз место для значения. Если ячейка объединена — её начало. Не пиши адрес самой подписи и поясняющего блока. Поля: contract (номер и дата договора), invoiceNo (номер инвойса / документа), invoiceDate (дата), consignee (получатель), seller (продавец / отправитель с адресом), buyer (покупатель с адресом), terms (условия поставки), country (страна назначения), container (номер контейнера), station (станция назначения), ceo (ФИО директора под подписью), priceHeader и amountHeader — ячейки заголовков «Цена за шт, USD» и «Общая стоимость, USD» (там поменяем валюту). Нет такого места в шаблоне — пустая строка.
table — таблица товаров: firstRow — номер первой строки для товаров (под заголовком), rows — сколько строк до строки «Итого/Total» (не включая её), columns — буквы столбцов: no (№), hsCode (код ТН ВЭД), origin (страна происхождения), description (описание товара), qty (кол-во шт), packages (кол-во мест), netKg (нетто), grossKg (брутто), price (цена за шт), amount (сумма). Нет столбца — пустая строка.
sheet — имя листа с шаблоном (если листов несколько — тот, что выглядит как пустой образец для заполнения).`;

const CJK = /[\u4e00-\u9fff]/;
/** Можно ли писать поверх: пусто, плейсхолдер «必填» или китайская подсказка. */
const writable = (text: string | undefined) => !text || CJK.test(text) || text === "0";

function mergeOf(sheet: Grid, ref: string): { from: string; toCol: number } {
  const c = colIndex(ref);
  const r = rowIndex(ref);
  for (const m of sheet.merges) {
    const [a, b = a] = m.split(":");
    if (c >= colIndex(a) && c <= colIndex(b) && r >= rowIndex(a) && r <= rowIndex(b)) return { from: a, toCol: colIndex(b) };
  }
  return { from: ref, toCol: c };
}

/** Ячейка для значения: начало объединения; если там подпись — следующая ячейка справа. */
function valueCell(sheet: Grid, ref: string): string | null {
  let target = ref;
  for (let i = 0; i < 4; i++) {
    const m = mergeOf(sheet, target);
    const text = sheet.cells.find((c) => c.ref === m.from)?.text;
    if (writable(text)) return m.from;
    target = `${colLetter(m.toCol + 1)}${rowIndex(target)}`;
  }
  return null;
}

const colLetter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

async function cachedMapping(tx: DbOrTx, hash: string): Promise<SpecMapping | null> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, `spec_template:${hash}`));
  return (row?.value as SpecMapping | undefined) ?? null;
}

/** Разметка чужого шаблона: из кэша или одним запросом к ИИ (адреса проверяются кодом). */
export async function mapTemplate(tx: DbOrTx, buffer: Buffer): Promise<{ mapping: SpecMapping; usage: AiUsage | null }> {
  const hash = crypto.createHash("sha1").update(buffer).digest("hex");
  const hit = await cachedMapping(tx, hash);
  if (hit) return { mapping: hit, usage: null };
  if (!aiEnabled()) throw new HttpError(503, "Чтобы разобрать шаблон перевозчика, нужен ИИ — или скачайте спецификацию по нашему шаблону");
  let grid: Grid[];
  try {
    grid = (await readGrid(buffer)).filter((g) => !g.hidden && g.cells.length);
  } catch {
    throw new HttpError(400, "Шаблон — файл Excel .xlsx (старый .xls пересохраните)");
  }
  if (!grid.length) throw new HttpError(400, "В шаблоне нет заполненных листов");
  const text = grid
    .map((g) => `### Лист «${g.sheet}»\nОбъединения: ${g.merges.join(", ") || "нет"}\n${g.cells.slice(0, 400).map((c) => `${c.ref}: ${c.text.slice(0, 120)}`).join("\n")}`)
    .join("\n\n");
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 2000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: MAPPING_SCHEMA as unknown as Record<string, unknown> } },
      system: MAPPING_PROMPT,
      messages: [{ role: "user", content: text }],
    });
  } catch (error) {
    throw aiError(error);
  }
  let raw: SpecMapping;
  try {
    raw = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")) as SpecMapping;
  } catch {
    throw new HttpError(502, "ИИ не разобрал шаблон — скачайте по нашему шаблону");
  }
  const okRef = (r: string | null | undefined) => (r && /^[A-Z]{1,3}\d{1,5}$/.test(r.toUpperCase()) ? r.toUpperCase() : null);
  const okCol = (c: string | null | undefined) => (c && /^[A-Z]{1,3}$/.test(c.toUpperCase()) ? c.toUpperCase() : null);
  const sheet = grid.find((g) => g.sheet === raw.sheet) ?? grid[0];
  const seen = new Set<string>();
  const mapping: SpecMapping = {
    sheet: sheet.sheet,
    fields: Object.fromEntries(
      FIELDS.map((f) => {
        const r = okRef(raw.fields?.[f]);
        const fixed = r && !f.endsWith("Header") ? valueCell(sheet, r) : r;
        // Одна ячейка — одно поле (дата и номер в одной ячейке — оставляем первое).
        if (!fixed || seen.has(fixed)) return [f, null];
        seen.add(fixed);
        return [f, fixed];
      }),
    ),
    table: {
      firstRow: Math.max(1, Math.min(10000, Number(raw.table?.firstRow) || 1)),
      rows: Math.max(1, Math.min(200, Number(raw.table?.rows) || 1)),
      columns: Object.fromEntries(COLUMNS.map((c) => [c, okCol(raw.table?.columns?.[c])])),
    },
  };
  if (!mapping.table.columns.description && !mapping.table.columns.amount) throw new HttpError(502, "В шаблоне не нашлась таблица товаров — скачайте по нашему шаблону");
  await tx
    .insert(settings)
    .values({ key: `spec_template:${hash}`, value: mapping })
    .onConflictDoUpdate({ target: settings.key, set: { value: mapping, updatedAt: new Date() } });
  return { mapping, usage: usageOf(response) };
}

// ── Заполнение ─────────────────────────────────────────────────────────────

/** Значения ячеек по разметке. Заголовки «…, USD» — меняем валюту на валюту инвойса. */
export async function renderSpec(template: Buffer, mapping: SpecMapping, data: Awaited<ReturnType<typeof specData>>): Promise<Buffer> {
  if (data.lines.length > mapping.table.rows) {
    throw new HttpError(400, `В шаблоне ${mapping.table.rows} строк для товаров, а позиций — ${data.lines.length}. Возьмите наш шаблон или шаблон с бо́льшим числом строк.`);
  }
  const grid = await readGrid(template);
  const sheetGrid = grid.find((g) => g.sheet === mapping.sheet) ?? grid[0];
  const textAt = (r: string) => sheetGrid?.cells.find((c) => c.ref === r)?.text ?? "";
  const values: Record<string, CellValue> = {};
  for (const f of FIELDS) {
    const r = mapping.fields[f];
    if (!r) continue;
    if (f === "priceHeader" || f === "amountHeader") {
      const t = textAt(r);
      if (t && /\b(USD|CNY|EUR|RUB)\b/.test(t)) values[r] = t.replace(/\b(USD|CNY|EUR|RUB)\b/g, data.currency);
      continue;
    }
    values[r] = data.fields[f] || null;
  }
  const cols = mapping.table.columns;
  data.lines.forEach((l, i) => {
    const row = mapping.table.firstRow + i;
    for (const c of COLUMNS) {
      const letter = cols[c];
      if (!letter) continue;
      const v = l[c];
      values[`${letter}${row}`] = v === null || v === undefined || v === "" ? null : v;
    }
  });
  return fillXlsx(template, mapping.sheet, values);
}

export const defaultTemplate = (): Promise<Buffer> => fs.promises.readFile(SPEC_TEMPLATE);
