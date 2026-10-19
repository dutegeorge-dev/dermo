/**
 * Текст из Word (.docx) и Excel (.xlsx) — для разбора ИИ: PDF и картинки модель читает
 * сама, а офисные файлы ей передаём текстом (таблицы — через табуляцию).
 */

import JSZip from "jszip";

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
  const workbook = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const names = [...workbook.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  if (!sheets.length) throw new Error("not an xlsx");
  const out: string[] = [];
  for (const [i, file] of sheets.entries()) {
    const xml = await zip.file(file)!.async("string");
    out.push(`=== Лист ${names[i] ?? i + 1}`);
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
