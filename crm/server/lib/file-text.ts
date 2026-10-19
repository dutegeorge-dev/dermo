/**
 * Текст из PDF, Word (.docx) и Excel (.xlsx) — для разбора ИИ. Модели отдаём текст, а не
 * сам файл: так в разы дешевле. PDF — строки восстанавливаем по координатам (колонки
 * таблиц разделены пробелами, как у pdftotext -layout); если текстового слоя нет (скан) —
 * пустая строка, тогда модель получит сам файл.
 */

import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { sheetsOf } from "./xlsx-fill.ts";

type PdfItem = { str: string; x: number; y: number; w: number; h: number };

export async function pdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [, , , d, x, y] = it.transform as number[];
        items.push({ str: it.str, x, y, w: it.width, h: Math.abs(d) || it.height || 10 });
      }
      // Строки: элементы с близкой высотой Y (сверху вниз), внутри — слева направо.
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines: PdfItem[][] = [];
      for (const it of items) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(line[0].y - it.y) <= Math.max(2, it.h * 0.4)) line.push(it);
        else lines.push([it]);
      }
      const out: string[] = [];
      for (const line of lines) {
        line.sort((a, b) => a.x - b.x);
        let text = "";
        let end = 0;
        for (const it of line) {
          const gap = it.x - end;
          if (text) text += gap > it.h * 1.5 ? "   " : gap > it.h * 0.15 ? " " : "";
          text += it.str;
          end = it.x + it.w;
        }
        out.push(text.replace(/\s+$/, ""));
      }
      pages.push(out.join("\n"));
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages.map((p, i) => (pages.length > 1 ? `--- стр. ${i + 1}\n${p}` : p)).join("\n").trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Текст из XML-фрагмента: только содержимое тегов <w:t>/<t>. */
function runsText(xml: string, tag: string): string {
  let out = "";
  for (const m of xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g"))) out += decodeXml(m[1]);
  return out;
}

export async function docxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("not a docx");
  const body = xml.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t>\n</w:t>");
  const lines: string[] = [];
  // Таблицы — строками с ячейками через табуляцию, остальное — абзацами.
  for (const block of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const chunk = block[0];
    if (chunk.startsWith("<w:tbl>")) {
      for (const row of chunk.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) =>
          [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => runsText(p[0], "w:t")).join(" ").trim(),
        );
        lines.push(cells.join("\t"));
      }
    } else {
      lines.push(runsText(chunk, "w:t"));
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function xlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1], "t"));
  // Листы — по workbook.xml и его связям (имена файлов sheetN не обязаны совпадать с порядком); скрытые пропускаем.
  const sheets = (await sheetsOf(zip)).filter((sh) => !sh.hidden && zip.file(sh.path));
  if (!sheets.length) throw new Error("not an xlsx");
  const out: string[] = [];
  for (const sheet of sheets) {
    const xml = await zip.file(sheet.path)!.async("string");
    out.push(`=== Лист ${sheet.name}`);
    for (const row of xml.matchAll(/<row[ >][\s\S]*?<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[0].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
        const type = /t="(\w+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let text = "";
        if (type === "s" && v !== undefined) text = shared[Number(v)] ?? "";
        else if (type === "inlineStr") text = runsText(inner, "t");
        else if (v !== undefined) text = decodeXml(v);
        const idx = ref ? columnIndex(ref) : cells.length;
        while (cells.length < idx) cells.push("");
        cells[idx] = text.replace(/\s+/g, " ").trim();
      }
      if (cells.some(Boolean)) out.push(cells.join("\t"));
    }
  }
  return out.join("\n");
}
