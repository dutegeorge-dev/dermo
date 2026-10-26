/**
 * Инструкция для новых сотрудников в базе знаний (пространство «Компания»): тексты — crm/seed/guide/*.md,
 * скриншоты (вымышленные демо-данные) — crm/seed/guide/img/*.png.
 *
 *   npm run kb:guide             # создать, если её ещё нет (так запускает деплой)
 *   npm run kb:guide -- --force  # обновить из файлов (новые версии страниц, картинки заменятся)
 *
 * 00-index.md — главная страница, остальные — её подстраницы по порядку имён. Разметка — простой Markdown:
 * «# заголовок страницы», «## / ###», абзацы, списки «- » и «1. », цитата «> », **жирный**, `код`,
 * картинка «![подпись](файл.png)» — отдельной строкой.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { and, eq, isNull } from "drizzle-orm";

import { config, CRM_ROOT } from "../config.ts";
import { db, type DbOrTx, pool } from "../db/client.ts";
import { attachments, kbPages, kbPageVersions, kbSpaces, type TiptapDoc } from "../db/schema.ts";
import { tiptapToText } from "../lib/text.ts";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });

const GUIDE_DIR = path.join(CRM_ROOT, "seed", "guide");
const LABEL = "guide";

type Node = Record<string, unknown>;

/** «текст **жирный** `код`» → текстовые узлы TipTap. */
function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { type: "text", text: m[1], marks: [{ type: "bold" }] } : { type: "text", text: m[2], marks: [{ type: "code" }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text);
}

const paragraph = (text: string): Node => ({ type: "paragraph", content: inline(text) });

/** Markdown страницы → заголовок и документ TipTap; картинки — через image(файл) → URL. */
function markdownToDoc(md: string, image: (file: string) => string): { title: string; doc: TiptapDoc } {
  const lines = md.replace(/\r/g, "").split("\n");
  let title = "";
  const content: Node[] = [];
  let para: string[] = [];
  let list: { type: "bulletList" | "orderedList"; items: string[] } | null = null;
  let quote: string[] = [];
  const flush = () => {
    if (para.length) content.push(paragraph(para.join(" ")));
    para = [];
    if (list) content.push({ type: list.type, content: list.items.map((li) => ({ type: "listItem", content: [paragraph(li)] })) });
    list = null;
    if (quote.length) content.push({ type: "blockquote", content: [paragraph(quote.join(" "))] });
    quote = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) flush();
    else if ((m = /^#\s+(.+)$/.exec(line))) {
      flush();
      title = m[1].trim();
    } else if ((m = /^(#{2,3})\s+(.+)$/.exec(line))) {
      flush();
      content.push({ type: "heading", attrs: { level: m[1].length }, content: inline(m[2].trim()) });
    } else if ((m = /^!\[(.*?)\]\((.+?)\)$/.exec(line.trim()))) {
      flush();
      content.push({ type: "image", attrs: { src: image(m[2].trim()), alt: m[1], title: m[1] } });
      if (m[1]) content.push({ type: "paragraph", content: [{ type: "text", text: m[1], marks: [{ type: "italic" }] }] });
    } else if ((m = /^-\s+(.+)$/.exec(line))) {
      if (para.length || quote.length || list?.type === "orderedList") flush();
      list ??= { type: "bulletList", items: [] };
      list.items.push(m[1]);
    } else if ((m = /^\d+\.\s+(.+)$/.exec(line))) {
      if (para.length || quote.length || list?.type === "bulletList") flush();
      list ??= { type: "orderedList", items: [] };
      list.items.push(m[1]);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      if (para.length || list) flush();
      quote.push(m[1]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list || quote.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  if (!title) throw new Error("Нет заголовка страницы («# …»)");
  return { title, doc: { type: "doc", content } };
}

/** Картинку — в хранилище вложений страницы; владелец файла — как у папки загрузок (деплой идёт от root). */
async function storeImage(tx: DbOrTx, pageId: number, file: string): Promise<string> {
  const buffer = fs.readFileSync(path.join(GUIDE_DIR, "img", file));
  const id = crypto.randomUUID();
  const dir = new Date().toISOString().slice(0, 7);
  const key = `${dir}/${id}`;
  const target = path.join(config.uploadDir, key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
  if (process.getuid?.() === 0) {
    const owner = fs.statSync(config.uploadDir);
    fs.chownSync(path.dirname(target), owner.uid, owner.gid);
    fs.chownSync(target, owner.uid, owner.gid);
  }
  await tx.insert(attachments).values({ id, ownerType: "kb_page", ownerId: pageId, filename: file, mime: "image/png", size: buffer.length, storageKey: key, label: LABEL });
  return `${config.basePath}/api/files/${id}`;
}

async function main(): Promise<void> {
  const files = fs.readdirSync(GUIDE_DIR).filter((f) => f.endsWith(".md")).sort();
  if (!files.length || !files[0].startsWith("00")) throw new Error(`Нет ${GUIDE_DIR}/00-*.md`);
  const sources = files.map((f) => fs.readFileSync(path.join(GUIDE_DIR, f), "utf8"));
  const titles = sources.map((md) => /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? "");

  let [space] = await db.select().from(kbSpaces).where(eq(kbSpaces.key, "COMPANY"));
  space ??= (await db.insert(kbSpaces).values({ key: "COMPANY", name: "Компания", description: "Регламенты, реквизиты, контакты, онбординг" }).returning())[0];
  const [existing] = await db
    .select({ id: kbPages.id })
    .from(kbPages)
    .where(and(eq(kbPages.spaceId, space.id), isNull(kbPages.parentId), eq(kbPages.title, titles[0])));
  if (existing && !values.force) {
    console.log(`= Инструкция уже есть в базе знаний («${titles[0]}») — обновить: npm run kb:guide -- --force`);
    return;
  }

  const removed: string[] = [];
  await db.transaction(async (tx) => {
    let parentId: number | null = existing?.id ?? null;
    for (const [i, md] of sources.entries()) {
      const isIndex = i === 0;
      // Страница: та, что уже есть (главная — по id, подстраницы — по заголовку), или новая.
      let found: number | null = isIndex ? parentId : null;
      if (!isIndex && parentId) {
        const rows = await tx.select({ id: kbPages.id }).from(kbPages).where(and(eq(kbPages.parentId, parentId), eq(kbPages.title, titles[i])));
        found = rows[0]?.id ?? null;
      }
      const created = found === null;
      let pageId: number;
      if (found === null) {
        const empty: TiptapDoc = { type: "doc", content: [] };
        const rows = await tx
          .insert(kbPages)
          .values({ spaceId: space.id, parentId: isIndex ? null : parentId, title: titles[i], content: empty, contentText: "", position: isIndex ? 0 : i, version: 0 })
          .returning({ id: kbPages.id });
        pageId = rows[0].id;
      } else {
        pageId = found;
        // Прежние картинки инструкции — заменяем (файлы удалим после коммита).
        const old = await tx
          .delete(attachments)
          .where(and(eq(attachments.ownerType, "kb_page"), eq(attachments.ownerId, pageId), eq(attachments.label, LABEL)))
          .returning({ key: attachments.storageKey });
        removed.push(...old.map((o) => o.key));
      }
      const images = new Map<string, string>();
      for (const m of md.matchAll(/^!\[.*?\]\((.+?)\)\s*$/gm)) if (!images.has(m[1])) images.set(m[1], await storeImage(tx, pageId, m[1]));
      const { title, doc } = markdownToDoc(md, (file) => images.get(file) ?? "");
      const contentText = tiptapToText(doc);
      const [page] = await tx.select({ version: kbPages.version }).from(kbPages).where(eq(kbPages.id, pageId));
      const version = (page?.version ?? 0) + 1;
      await tx.update(kbPages).set({ title, content: doc, contentText, version, updatedAt: new Date() }).where(eq(kbPages.id, pageId));
      await tx.insert(kbPageVersions).values({ pageId, version, title, content: doc, contentText, note: created ? "Создание (инструкция)" : "Обновление инструкции" });
      if (isIndex) parentId = pageId;
      console.log(`${created ? "+" : "~"} ${title} (картинок: ${images.size})`);
    }
  });
  for (const key of removed) fs.rmSync(path.join(config.uploadDir, key), { force: true });
  console.log("✓ Инструкция в базе знаний: пространство «Компания»");
}

main()
  .catch((e) => {
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

