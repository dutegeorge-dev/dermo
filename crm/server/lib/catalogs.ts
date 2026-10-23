/**
 * Каталоги фабрик из рассылки: файлы пачкой → очередь разбора в фоне → ИИ (Haiku) определяет компанию и
 * категории товара (без параметров — их узнают в переписке) → админ проверяет и подтверждает → фабрика
 * (новая или найденная), файл — в её карточке. Кто прислал файл — со скриншотов окна «Файлы» WeChat
 * (имя файла, «отправитель | чат», размер). Текст достаёт код (poppler: pdftotext; .docx / .xlsx / .pptx),
 * сканы — несколько страниц картинками (pdftoppm): обложка и заголовки разделов, а не весь каталог.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import JSZip from "jszip";

import { type CatalogResult, normCategory } from "../../shared/factories.ts";
import { config } from "../config.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { attachments, catalogs, catalogSenders, factories } from "../db/schema.ts";
import { storagePath } from "../routes/files.ts";
import { type AiUsage, aiBase, aiClient, aiEnabled, aiError, usageOf } from "./ai.ts";
import { emptyToNull } from "./ai-parse.ts";
import { audit } from "./audit.ts";
import { docxText, pdfText, pptxText, xlsxText } from "./file-text.ts";
import { type AuthUser, HttpError } from "./http.ts";

const exec = promisify(execFile);

/** Картинка больше — не отправляем (лимит API ~5 МБ в base64). */
const MAX_IMAGE_BYTES = 3_700_000;
/** Текст берём с первых страниц (у сканов на 200 страниц текста всё равно нет). */
const TEXT_PAGES = 60;
/** Скан: столько страниц картинками — обложка, вторая и равномерно по каталогу. */
const IMAGE_PAGES = 6;
/** Сколько текста отдаём модели: понемногу с каждой страницы, чтобы попали заголовки разделов. */
const SAMPLE_CHARS = 8000;
/** Сколько текста храним для поиска. */
const STORE_CHARS = 200_000;

// ── Что достаём из файла ────────────────────────────────────────────────────

type Extracted = {
  method: "text" | "images" | "none";
  pages: number | null;
  /** Весь текст, что достал код (для поиска). */
  text: string;
  /** Что отправить модели. */
  content: Anthropic.Beta.BetaContentBlockParam[];
  note: string | null;
};

export type CatalogKind = "pdf" | "docx" | "xlsx" | "pptx" | "image" | "text" | "old" | "archive" | "other";

export function catalogKind(filename: string): CatalogKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") return ext;
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
  if (["txt", "csv", "tsv"].includes(ext)) return "text";
  if (["doc", "xls", "ppt", "wps", "et", "dps"].includes(ext)) return "old";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "other";
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Тип файла по расширению (браузер для каталогов часто присылает application/octet-stream). */
export const catalogMime = (filename: string, sent: string) => MIME[filename.toLowerCase().split(".").pop() ?? ""] ?? (sent || "application/octet-stream");

const clean = (s: string) => s.replace(/\0/g, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
/** Сколько в тексте «настоящих» букв и иероглифов (без цифр, пробелов и знаков). */
const letters = (s: string) => s.replace(/[\s\d\p{P}\p{S}]/gu, "").length;

/** Номера страниц для картинок: 1, 2 и равномерно по остальным. */
export function pickPages(total: number, count: number): number[] {
  if (total <= count) return Array.from({ length: Math.max(1, total) }, (_, i) => i + 1);
  const out = new Set([1, 2]);
  const step = (total - 2) / (count - 2);
  for (let i = 0; i < count - 2; i++) out.add(Math.min(total, 2 + Math.max(1, Math.round(step * (i + 0.5)))));
  return [...out].sort((a, b) => a - b);
}

/** Текст для модели: понемногу с каждой страницы (или с равномерно выбранных), всего ≈ SAMPLE_CHARS. */
export function sampleText(pages: string[], budget = SAMPLE_CHARS): string {
  const list = pages
    .map((p, i) => ({ n: i + 1, t: p.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim() }))
    .filter((p) => p.t.length > 0);
  if (!list.length) return "";
  const maxPages = Math.max(1, Math.floor(budget / 300));
  const chosen = list.length > maxPages ? pickPages(list.length, maxPages).map((i) => list[i - 1]) : list;
  const per = Math.max(300, Math.floor(budget / chosen.length));
  const out: string[] = [];
  let used = 0;
  for (const p of chosen) {
    if (used >= budget) break;
    const chunk = p.t.slice(0, Math.min(per, budget - used));
    out.push(list.length > 1 ? `--- стр. ${p.n}\n${chunk}` : chunk);
    used += chunk.length;
  }
  return out.join("\n");
}

const none = (note: string, text = "", pages: number | null = null): Extracted => ({ method: "none", pages, text, content: [], note });
const jpeg = (buffer: Buffer): Anthropic.Beta.BetaContentBlockParam => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buffer.toString("base64") } });

async function pdfCatalog(file: string): Promise<Extracted> {
  let pages: number | null = null;
  let pageTexts: string[];
  try {
    const info = (await exec("pdfinfo", [file], { timeout: 60_000, maxBuffer: 1 << 20 })).stdout;
    pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]) || null;
    const out = (await exec("pdftotext", ["-q", "-layout", "-enc", "UTF-8", "-f", "1", "-l", String(TEXT_PAGES), file, "-"], { timeout: 180_000, maxBuffer: 64 << 20 })).stdout;
    pageTexts = out.split("\f");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return none("PDF не открылся — файл повреждён или защищён паролем");
    // На сервере нет poppler-utils: текст — через pdfjs (только небольшие файлы), сканы не разобрать.
    const { size } = await fs.promises.stat(file);
    if (size > 60 * 1024 * 1024) return none("На сервере нет poppler-utils (apt install poppler-utils) — большой PDF не разобрать");
    const text = clean(await pdfText(await fs.promises.readFile(file)).catch(() => ""));
    if (letters(text) < 300) return none("На сервере нет poppler-utils (apt install poppler-utils) — сканы не разбираются", text);
    return { method: "text", pages: null, text, content: [{ type: "text", text: sampleText(text.split(/^--- стр\. \d+$/m)) }], note: null };
  }
  const text = clean(pageTexts.join("\n\n"));
  if (letters(text) >= 300) return { method: "text", pages, text, content: [{ type: "text", text: sampleText(pageTexts) }], note: null };

  // Скан (или почти без текста): несколько страниц картинками.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "crm-catalog-"));
  try {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const n of pickPages(pages ?? 1, IMAGE_PAGES)) {
      const out = path.join(dir, `p${n}`);
      try {
        await exec("pdftoppm", ["-q", "-f", String(n), "-l", String(n), "-singlefile", "-scale-to", "1000", "-jpeg", "-jpegopt", "quality=70", file, out], { timeout: 180_000 });
        const buffer = await fs.promises.readFile(`${out}.jpg`);
        if (buffer.length > MAX_IMAGE_BYTES) continue;
        content.push({ type: "text", text: `стр. ${n}` }, jpeg(buffer));
      } catch {
        // Страница не отрисовалась — берём остальные.
      }
    }
    if (!content.length) return none("Страницы PDF не получилось превратить в картинки", text, pages);
    return { method: "images", pages, text, content, note: null };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** Картинки из Word / Excel / PowerPoint (каталог из одних фото) — первые по порядку. */
async function officeImages(buffer: Buffer): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /^(word|ppt|xl)\/media\/[^/]+\.(jpe?g|png)$/i.test(n))
    .sort((a, b) => Number(/(\d+)\.\w+$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.\w+$/.exec(b)?.[1] ?? 0));
  const out: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const name of names) {
    if (out.length >= IMAGE_PAGES) break;
    const data = await zip.file(name)!.async("nodebuffer");
    if (data.length > MAX_IMAGE_BYTES || data.length < 20_000) continue; // иконки и логотипы пропускаем
    out.push({ type: "image", source: { type: "base64", media_type: /\.png$/i.test(name) ? "image/png" : "image/jpeg", data: data.toString("base64") } });
  }
  return out;
}

export async function extractCatalog(file: string, filename: string): Promise<Extracted> {
  const kind = catalogKind(filename);
  if (kind === "pdf") return pdfCatalog(file);
  if (kind === "old") return none("Старый формат (.doc / .xls / .ppt) — пересохраните в PDF или новый формат, либо укажите категории вручную");
  if (kind === "archive") return none("Архив — распакуйте и загрузите файлы из него, либо укажите категории вручную");
  if (kind === "other") return none("Этот формат не разбирается — укажите категории вручную");
  const { size } = await fs.promises.stat(file);
  if (kind === "image") {
    if (size > MAX_IMAGE_BYTES) return none("Картинка больше 3,7 МБ — не разбирали");
    const buffer = await fs.promises.readFile(file);
    const media = catalogMime(filename, "") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    return { method: "images", pages: 1, text: "", content: [{ type: "image", source: { type: "base64", media_type: media, data: buffer.toString("base64") } }], note: null };
  }
  if (size > 200 * 1024 * 1024) return none("Файл больше 200 МБ — не разбирали, укажите категории вручную");
  const buffer = await fs.promises.readFile(file);
  let raw: string;
  try {
    raw = kind === "text" ? buffer.toString("utf8") : kind === "docx" ? await docxText(buffer) : kind === "xlsx" ? await xlsxText(buffer) : await pptxText(buffer);
  } catch {
    return none("Файл не открылся — повреждён или в другом формате");
  }
  const text = clean(raw);
  const pages = kind === "pptx" ? raw.split(/^--- стр\. \d+$/m).slice(1) : [text];
  if (letters(text) >= 300) return { method: "text", pages: kind === "pptx" ? pages.length : null, text, content: [{ type: "text", text: sampleText(pages) }], note: null };
  const images = kind === "text" ? [] : await officeImages(buffer).catch(() => []);
  if (!images.length) return none("В файле почти нет текста и картинок — укажите категории вручную", text);
  return { method: "images", pages: null, text, content: [...(text ? [{ type: "text" as const, text: sampleText(pages) }] : []), ...images], note: null };
}

// ── ИИ: кто это и какие категории ──────────────────────────────────────────

const STR = { type: "string" } as const;

export const CATALOG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["company", "nameRu", "phone", "wechatId", "email", "website", "location", "categories", "notes"],
  properties: {
    company: STR,
    nameRu: STR,
    phone: STR,
    wechatId: STR,
    email: STR,
    website: STR,
    location: STR,
    categories: { type: "array", items: STR },
    notes: STR,
  },
} as const;

function catalogPrompt(known: string[]): string {
  return `Ты разбираешь каталог китайской фабрики для закупщика ООО «ТЛК БАРС» (закупка товаров в Китае для России). Нужно понять, что это за компания и какие виды товара она делает. Перепиши только то, что видно в каталоге. Нет значения — пустая строка "". Ничего не придумывай.

- company — название компании как в каталоге, полностью («Dezhou Chengda Nonwoven Products Co., Ltd.», «德州成达无纺制品有限公司»). Английское, если есть.
- nameRu — коротко по-русски: короткое имя компании + что делает («Chengda — ковролин», «Green Valley — спортивные покрытия»).
- phone — телефон цифрами, как написан (с кодом страны, если есть). wechatId — WeChat ID, если написан. email, website — как написаны.
- location — город и провинция по-русски («Дэчжоу, провинция Шаньдун»).
- categories — 1–3 категории (чаще одна): какие виды товара фабрика делает, по-русски, строчными. Категория — вид товара, по которому ищут фабрику: то, что делается на своём оборудовании («ковролин», «линолеум», «spc-ламинат», «искусственная трава», «резиновая плитка», «обои»). Фабрика ковролина делает любой ковролин, а линолеум — уже другая категория. Разновидности, свойства, назначение и материал — НЕ отдельные категории: «огнестойкий ковролин», «выставочный ковролин», «нескользящий ковролин», «велюровый ковролин» — это всё «ковролин». Общие слова («напольные покрытия», «стройматериалы», «товары для дома») — не категории. Главное, что делает фабрика, — первым.
${known.length ? `- Уже есть категории: ${known.join("; ")}. Если товар подходит под одну из них — пиши её дословно. Новую — только если ни одна не подходит.` : "- Категорий пока нет — называй коротко и понятно, их будут переиспользовать для других фабрик."}
- notes — одно предложение по-русски: что именно в каталоге (виды товара, для чего).`;
}

/** Сравнение категорий: без регистра, ё/е, пробелов и дефисов. */
const categoryKey = (c: string) => normCategory(c).replace(/ё/g, "е").replace(/[\s\-–—]/g, "");

/**
 * Категории ответа: написание — как у существующих; разновидность другой категории из того же ответа
 * («ковролин» и «огнестойкий ковролин») — это она же.
 */
export function normalizeCategories(list: unknown, known: string[]): string[] {
  const byKey = new Map(known.map((k) => [categoryKey(k), k]));
  const names: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const c = normCategory(String(raw ?? ""));
    if (!c) continue;
    const name = byKey.get(categoryKey(c)) ?? c;
    if (!names.includes(name)) names.push(name);
  }
  const out: string[] = [];
  for (const c of names) {
    const base = names.find((d) => d !== c && (c.endsWith(` ${d}`) || c.startsWith(`${d} `)));
    const name = base ?? c;
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 6);
}

/** Все категории: фабрик и каталогов на проверке (чтобы параллельные разборы не заводили дубли); n — сколько фабрик. */
export async function knownCategories(tx: DbOrTx): Promise<{ c: string; n: number }[]> {
  const rows = await tx.execute<{ c: string; n: number }>(sql`
    select c, sum(f)::int n from (
      select unnest(categories) c, 1 f from factories
      union all
      select jsonb_array_elements_text(result -> 'categories'), 0 from catalogs where status = 'review' and result is not null
    ) x where c <> '' group by c order by n desc, c limit 400`);
  return rows.rows;
}

async function recognizeCatalog(
  content: Anthropic.Beta.BetaContentBlockParam[],
  ctx: { filename: string; sender: string | null; known: string[] },
): Promise<{ result: CatalogResult; usage: AiUsage }> {
  const ask = `Файл «${ctx.filename}»${ctx.sender ? `, прислал контакт WeChat «${ctx.sender}»` : ""}. Определи компанию и категории товара.`;
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: CATALOG_SCHEMA as unknown as Record<string, unknown> } },
      system: catalogPrompt(ctx.known),
      messages: [{ role: "user", content: [...content, { type: "text", text: ask }] }],
    });
  } catch (error) {
    throw aiError(error);
  }
  if (response.stop_reason === "refusal") throw new HttpError(502, "ИИ отказался разбирать этот файл — укажите категории вручную");
  let raw: Partial<Record<keyof CatalogResult, unknown>>;
  try {
    raw = emptyToNull(JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")));
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — повторите");
  }
  const s = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    result: {
      company: s(raw.company),
      nameRu: s(raw.nameRu),
      phone: s(raw.phone, 60),
      wechatId: s(raw.wechatId, 100).replace(/^(wechat\s*id|微信号?)\s*[:：]?\s*/i, ""),
      email: s(raw.email, 200),
      website: s(raw.website),
      location: s(raw.location),
      categories: normalizeCategories(raw.categories, ctx.known),
      notes: s(raw.notes, 1000),
    },
    usage: usageOf(response),
  };
}

// ── Очередь разбора (в этом же процессе; переживает перезапуск — status в БД) ──

type Logger = { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void };
let log: Logger = { info: () => {}, error: (o, msg) => console.error(msg, o) };
let active = 0;
let wanted = false;
let stopping = false;
let idle: (() => void)[] = [];

export function setCatalogLogger(logger: Logger): void {
  log = logger;
}

/** Запустить разбор очереди (если ещё не идёт). */
export function kickCatalogQueue(): void {
  wanted = true;
  while (!stopping && active < Math.max(1, config.catalogWorkers)) {
    active++;
    work()
      .catch((error) => log.error({ err: error }, "Каталоги: ошибка очереди"))
      .finally(() => {
        active--;
        if (!active) for (const resolve of idle.splice(0)) resolve();
      });
  }
}

/** После перезапуска: прерванные разборы — снова в очередь. */
export async function resetCatalogQueue(): Promise<void> {
  await db.update(catalogs).set({ status: "queued" }).where(eq(catalogs.status, "processing"));
}

/** Остановить очередь и дождаться текущих разборов (при выключении сервера). */
export async function stopCatalogQueue(): Promise<void> {
  stopping = true;
  if (active) await new Promise<void>((resolve) => idle.push(resolve));
}

/** Недокачанные файлы, брошенные больше недели назад, — удалить. */
export async function sweepPartialUploads(): Promise<void> {
  const dir = path.join(config.uploadDir, "partial");
  const names = await fs.promises.readdir(dir).catch(() => []);
  for (const name of names) {
    const file = path.join(dir, name);
    const st = await fs.promises.stat(file).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 7 * 24 * 60 * 60 * 1000) await fs.promises.rm(file, { force: true });
  }
}

/** Дождаться, пока очередь опустеет (тесты). */
export function catalogQueueIdle(): Promise<void> {
  return active ? new Promise<void>((resolve) => idle.push(resolve)) : Promise.resolve();
}

async function work(): Promise<void> {
  for (;;) {
    if (stopping) return;
    wanted = false;
    const claimed = await db.execute<{ id: number }>(sql`
      update catalogs set status = 'processing', updated_at = now()
      where id = (select id from catalogs where status = 'queued' order by id limit 1 for update skip locked)
      returning id`);
    const id = claimed.rows[0]?.id;
    if (!id) {
      if (wanted) continue;
      return;
    }
    await processCatalog(id);
  }
}

async function processCatalog(id: number): Promise<void> {
  const [row] = await db
    .select({ filename: catalogs.filename, sender: catalogs.sender, key: attachments.storageKey })
    .from(catalogs)
    .leftJoin(attachments, eq(attachments.id, catalogs.attachmentId))
    .where(eq(catalogs.id, id));
  if (!row) return;
  const finish = (values: Partial<typeof catalogs.$inferInsert>) => db.update(catalogs).set({ ...values, updatedAt: new Date() }).where(eq(catalogs.id, id));
  if (!row.key) {
    await finish({ status: "failed", note: "Файл не найден" });
    return;
  }
  let extracted: Extracted;
  try {
    extracted = await extractCatalog(storagePath(row.key), row.filename);
  } catch (error) {
    log.error({ err: error, catalog: id }, "Каталоги: файл не прочитан");
    extracted = none("Файл не прочитан — укажите категории вручную");
  }
  const base = { method: extracted.method, pages: extracted.pages, text: extracted.text.slice(0, STORE_CHARS) };
  if (extracted.method === "none" || !aiEnabled()) {
    await finish({ ...base, status: "review", note: extracted.note ?? "ИИ не подключён — укажите категории вручную" });
    return;
  }
  try {
    const known = (await knownCategories(db)).map((k) => k.c);
    const { result, usage } = await recognizeCatalog(extracted.content, { filename: row.filename, sender: row.sender, known });
    log.info({ ai: "catalog", model: config.ai.model, catalog: id, method: extracted.method, usage }, "ИИ: каталог фабрики");
    await finish({ ...base, status: "review", result, usage, note: result.categories.length ? null : "ИИ не нашёл категорий — укажите вручную" });
  } catch (error) {
    await finish({ ...base, status: "failed", note: aiError(error).message });
  }
}

// ── Кто прислал: строки со скриншотов окна «Файлы» WeChat ──────────────────

export type SenderRow = { filename: string; size: string; sender: string; chat: string | null };

/** «12.8M» → значение, число знаков после запятой и степень (K=1, M=2, G=3). */
function parseShownSize(s: string): { value: number; decimals: number; power: number } | null {
  const m = /^\s*([\d.,]+)\s*([KMG])?i?B?\s*$/i.exec(s);
  if (!m) return null;
  const num = m[1].replace(",", ".");
  const value = Number(num);
  if (!Number.isFinite(value)) return null;
  const power = { K: 1, M: 2, G: 3 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "G"] ?? 0;
  return { value, decimals: num.includes(".") ? num.split(".")[1].length : 0, power };
}

/** Размер файла совпадает с показанным WeChat (округлён; МБ — по 1024 или по 1000). */
export function sizeMatches(bytes: number, shown: string): boolean {
  const p = parseShownSize(shown);
  if (!p) return false;
  const tolerance = 0.5 * 10 ** -p.decimals + 0.001;
  return [1024, 1000].some((base) => Math.abs(bytes / base ** p.power - p.value) <= tolerance);
}

/** Имя файла для сравнения: полуширинные скобки, без регистра и пробелов. */
export const normFilename = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const stripCopy = (s: string) => s.replace(/\(\d+\)(?=\.[^.]+$|$)/, "");

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const x = bigrams(a);
  let common = 0;
  for (const [k, n] of bigrams(b)) common += Math.min(n, x.get(k) ?? 0);
  return (2 * common) / (a.length + b.length - 2);
}

/**
 * Отправитель файла по строкам со скриншотов: имя файла (точно → без «(1)» → обрезанное «…» → похожее, если ИИ
 * ошибся в иероглифе) и размер. Два разных отправителя на одном шаге — не угадываем.
 */
export function matchSender(file: { filename: string; size: number }, rows: SenderRow[]): SenderRow | null {
  const name = normFilename(file.filename);
  const sized = rows.map((r) => ({ r, n: normFilename(r.filename), sizeOk: sizeMatches(file.size, r.size), noSize: !parseShownSize(r.size) }));
  const levels: ((x: (typeof sized)[number]) => boolean)[] = [
    (x) => x.n === name && (x.sizeOk || x.noSize),
    (x) => x.sizeOk && stripCopy(x.n) === stripCopy(name),
    (x) => x.sizeOk && /(…|\.\.\.)$/.test(x.n) && x.n.replace(/(…|\.\.\.)$/, "").length >= 6 && name.startsWith(x.n.replace(/(…|\.\.\.)$/, "")),
    (x) => x.sizeOk && similarity(stripCopy(x.n), stripCopy(name)) >= 0.75,
  ];
  for (const level of levels) {
    const found = sized.filter(level);
    if (!found.length) continue;
    const senders = new Set(found.map((x) => normFilename(x.r.sender)));
    return senders.size === 1 ? found[0].r : null;
  }
  return null;
}

/** Отправитель для каталогов без отправителя — по всем строкам скриншотов. Возвращает, скольким нашли. */
export async function applySenders(tx: DbOrTx, ids?: number[]): Promise<number> {
  const rows = await tx.select({ filename: catalogSenders.filename, size: catalogSenders.size, sender: catalogSenders.sender, chat: catalogSenders.chat }).from(catalogSenders);
  if (!rows.length) return 0;
  const list = await tx
    .select({ id: catalogs.id, filename: catalogs.filename, size: catalogs.size })
    .from(catalogs)
    .where(and(isNull(catalogs.sender), sql`${catalogs.status} <> 'done'`, ids ? inArray(catalogs.id, ids) : undefined));
  let matched = 0;
  for (const c of list) {
    const row = matchSender(c, rows);
    if (!row) continue;
    await tx.update(catalogs).set({ sender: row.sender, chat: row.chat, updatedAt: new Date() }).where(eq(catalogs.id, c.id));
    matched++;
  }
  return matched;
}

const SENDERS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["filename", "sender", "chat", "size"],
        properties: { filename: STR, sender: STR, chat: STR, size: STR },
      },
    },
  },
} as const;

const SENDERS_PROMPT = `Это скриншоты окна «Файлы» (Manage Files / 文件) WeChat. В каждой строке: имя файла; под ним серым — «отправитель | чат»; справа — время и размер («12.8M», «512K»). Перепиши каждую строку файла:
- filename — имя файла символ в символ, с расширением (иероглифы, скобки, «(1)» — как написано).
- sender — часть до « | » (имя контакта WeChat как написано, с цифрами и иероглифами), chat — часть после « | ».
- size — размер как написан («12.8M»).
Заголовки («Today», «Yesterday», даты), строки, обрезанные краем экрана, и пункты меню слева пропусти. Ничего не придумывай.`;

export async function recognizeSenders(files: { buffer: Buffer; filename: string; mime: string }[]): Promise<{ rows: SenderRow[]; usage: AiUsage; skipped: string[] }> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const mime = catalogMime(f.filename, f.mime);
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) skipped.push(`${f.filename} — не картинка`);
    else if (f.buffer.length > MAX_IMAGE_BYTES) skipped.push(`${f.filename} — больше 3,7 МБ`);
    else content.push({ type: "image", source: { type: "base64", media_type: mime as "image/png", data: f.buffer.toString("base64") } });
  }
  if (!content.length) throw new HttpError(400, skipped.length ? `Нечего разбирать: ${skipped.join("; ")}` : "Пришлите скриншоты окна «Файлы» WeChat");
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 8000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SENDERS_SCHEMA as unknown as Record<string, unknown> } },
      system: SENDERS_PROMPT,
      messages: [{ role: "user", content: [...content, { type: "text", text: "Перепиши строки файлов." }] }],
    });
  } catch (error) {
    throw aiError(error);
  }
  let raw: { rows?: Partial<SenderRow>[] };
  try {
    raw = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — повторите");
  }
  const rows = (raw.rows ?? [])
    .map((r) => ({ filename: String(r.filename ?? "").trim().slice(0, 300), sender: String(r.sender ?? "").trim().slice(0, 300), chat: String(r.chat ?? "").trim().slice(0, 300) || null, size: String(r.size ?? "").trim().slice(0, 20) }))
    .filter((r) => r.filename && r.sender);
  return { rows, usage: usageOf(response), skipped };
}

// ── Какая это фабрика ───────────────────────────────────────────────────────

export type FactoryMatch = { id: number; name: string; nameRu: string | null; reason: string };

const digitRuns = (s: string | null | undefined) => (s ?? "").match(/\d[\d\s\-()+]{5,}\d/g)?.map((d) => d.replace(/\D/g, "")).filter((d) => d.length >= 7) ?? [];
const domain = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/^\s*(https?:\/\/)?(www\.)?/, "")
    .replace(/[/?#].*$/, "")
    .trim();
/** Ядро названия компании: без «Co., Ltd.», «有限公司» и знаков. */
export const companyCore = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/(co\.?,?\s*)?(ltd\.?|limited)|company|corporation|corp\.?|inc\.?|有限公司|有限责任公司|股份/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export const senderKey = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Тот же контакт: имя совпадает или одно — начало другого почти целиком (ИИ на одном из скриншотов потерял
 * последний иероглиф: «Leah Lee 18375803260» и «Leah Lee 18375803260李»).
 */
export function sameSender(a: string, b: string): boolean {
  const x = senderKey(a);
  const y = senderKey(b);
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.startsWith(short) && short.length / long.length >= 0.8;
}

type Group = { sender: string | null; results: CatalogResult[] };

/** Подходящая фабрика для группы каталогов (один отправитель): уже присланные им каталоги, имя WeChat, телефон, WeChat ID, сайт, почта, название. */
export async function suggestFactories(tx: DbOrTx, groups: Group[]): Promise<(FactoryMatch | null)[]> {
  if (!groups.length) return [];
  const list = await tx
    .select({ id: factories.id, name: factories.name, nameRu: factories.nameRu, phone: factories.phone, wechatId: factories.wechatId, website: factories.website, email: factories.email })
    .from(factories)
    .limit(50000);
  const byId = new Map(list.map((f) => [f.id, f]));
  const done = await tx
    .select({ sender: catalogs.sender, factoryId: catalogs.factoryId })
    .from(catalogs)
    .where(and(eq(catalogs.status, "done"), sql`${catalogs.sender} is not null`, sql`${catalogs.factoryId} is not null`));

  const tail = (d: string) => d.slice(-9);
  const phonesOf = list.map((f) => ({ f, phones: [...digitRuns(f.phone), ...digitRuns(f.name)].map(tail) }));
  const pick = (f: (typeof list)[number], reason: string): FactoryMatch => ({ id: f.id, name: f.name, nameRu: f.nameRu, reason });

  return groups.map(({ sender, results }) => {
    if (sender) {
      const known = byId.get(done.find((d) => sameSender(d.sender!, sender))?.factoryId ?? 0);
      if (known) return pick(known, "этот контакт уже присылал каталог");
      const byName = list.find((f) => sameSender(f.name, sender));
      if (byName) return pick(byName, "имя в WeChat");
    }
    const phones = new Set([...digitRuns(sender), ...results.flatMap((r) => digitRuns(r.phone))].map(tail));
    if (phones.size) {
      const hit = phonesOf.find((x) => x.phones.some((p) => phones.has(p)));
      if (hit) return pick(hit.f, "телефон");
    }
    for (const r of results) {
      const w = r.wechatId.replace(/\s/g, "").toLowerCase();
      const byWechat = w.length >= 3 && list.find((f) => (f.wechatId ?? "").replace(/\s/g, "").toLowerCase() === w);
      if (byWechat) return pick(byWechat, "WeChat ID");
      const d = domain(r.website);
      const bySite = d.length >= 4 && list.find((f) => domain(f.website) === d);
      if (bySite) return pick(bySite, "сайт");
      const e = r.email.trim().toLowerCase();
      const byEmail = e.includes("@") && list.find((f) => (f.email ?? "").trim().toLowerCase() === e);
      if (byEmail) return pick(byEmail, "e-mail");
      const core = companyCore(r.company);
      const byCompany = core.length >= 6 && list.find((f) => companyCore(`${f.nameRu ?? ""} ${f.name}`).includes(core));
      if (byCompany) return pick(byCompany, "название компании");
    }
    return null;
  });
}

// ── Подтверждение: каталоги → фабрика ───────────────────────────────────────

export type ConfirmGroup = { catalogIds: number[]; factoryId: number | null; name?: string | null; nameRu?: string | null; categories?: string[] | null };

/** Группа каталогов одного отправителя → новая или найденная фабрика; файлы переезжают в её карточку. */
export async function confirmCatalogs(tx: DbOrTx, user: AuthUser, group: ConfirmGroup, ip?: string): Promise<{ factoryId: number; created: boolean }> {
  const ids = [...new Set(group.catalogIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new HttpError(400, "Нет каталогов");
  const rows = await tx.select().from(catalogs).where(and(inArray(catalogs.id, ids), inArray(catalogs.status, ["review", "failed"])));
  if (rows.length !== ids.length) throw new HttpError(409, "Часть каталогов ещё разбирается или уже подтверждена — обновите страницу");
  const results = rows.map((r) => r.result).filter((r): r is CatalogResult => r !== null);
  const first = (k: keyof Omit<CatalogResult, "categories">) => results.map((r) => r[k].trim()).find(Boolean) ?? null;
  const known = (await knownCategories(tx)).map((k) => k.c);
  const categories = normalizeCategories(group.categories ?? results.flatMap((r) => r.categories), known);
  const sender = rows.map((r) => r.sender ?? "").sort((a, b) => b.length - a.length)[0] || null;
  const phone = first("phone") ?? digitRuns(sender).find((d) => d.length >= 11) ?? null;
  const nameRu = group.nameRu?.trim() || first("nameRu");

  let factoryId: number;
  let created = false;
  if (group.factoryId) {
    const [f] = await tx.select().from(factories).where(eq(factories.id, group.factoryId));
    if (!f) throw new HttpError(404, "Фабрика не найдена");
    factoryId = f.id;
    await tx
      .update(factories)
      .set({
        nameRu: f.nameRu || nameRu,
        phone: f.phone || phone,
        wechatId: f.wechatId || first("wechatId"),
        email: f.email || first("email"),
        website: f.website || first("website"),
        location: f.location || first("location"),
        categories: [...new Set([...f.categories, ...categories])].slice(0, 20),
        notes: f.notes || first("notes") || "",
        updatedAt: new Date(),
      })
      .where(eq(factories.id, f.id));
  } else {
    const name = (group.name?.trim() || sender || first("company") || rows[0].filename.replace(/\.[^.]+$/, "")).slice(0, 300);
    const [f] = await tx
      .insert(factories)
      .values({
        name,
        nameRu,
        phone,
        wechatId: first("wechatId"),
        email: first("email"),
        website: first("website"),
        location: first("location"),
        categories,
        notes: first("notes") ?? "",
        foundBy: user.id,
        createdBy: user.id,
      })
      .returning({ id: factories.id });
    factoryId = f.id;
    created = true;
  }
  const files = rows.map((r) => r.attachmentId).filter((a): a is string => a !== null);
  if (files.length) await tx.update(attachments).set({ ownerType: "factory", ownerId: factoryId, label: "catalog" }).where(inArray(attachments.id, files));
  await tx.update(catalogs).set({ status: "done", factoryId, updatedAt: new Date() }).where(inArray(catalogs.id, ids));
  await audit(tx, {
    userId: user.id,
    action: created ? "create" : "update",
    entityType: "factory",
    entityId: factoryId,
    summary: `${created ? "Завёл фабрику" : "Добавил к фабрике"} по каталогам: ${rows.map((r) => r.filename).join(", ").slice(0, 300)}`,
    ip,
  });
  return { factoryId, created };
}

/** Переименовать категорию (или слить с другой) во всех фабриках и каталогах на проверке. */
export async function renameCategory(tx: DbOrTx, from: string, to: string): Promise<number> {
  const a = normCategory(from);
  const b = normCategory(to);
  if (!a || !b) throw new HttpError(400, "Укажите категорию и новое название");
  if (a === b) return 0;
  const updated = await tx.execute(sql`
    update factories set categories = (
      select coalesce(array_agg(c order by i), '{}') from (
        select c, min(i) i from unnest(array_replace(categories, ${a}, ${b})) with ordinality as t(c, i) group by c
      ) x
    ), updated_at = now()
    where ${a} = any(categories)`);
  const pending = await tx
    .select({ id: catalogs.id, result: catalogs.result })
    .from(catalogs)
    .where(and(eq(catalogs.status, "review"), sql`${catalogs.result} -> 'categories' ? ${a}`));
  for (const p of pending) {
    const list = [...new Set(p.result!.categories.map((c) => (c === a ? b : c)))];
    await tx.update(catalogs).set({ result: { ...p.result!, categories: list } }).where(eq(catalogs.id, p.id));
  }
  return updated.rowCount ?? 0;
}
