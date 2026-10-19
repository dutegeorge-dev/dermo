/**
 * Заполнение Excel-шаблонов (.xlsx) без сторонних библиотек: значения пишутся прямо в XML
 * листа, оформление ячеек (стиль s="…") и объединения сохраняются. Формулы, которые мы не
 * трогаем, Excel пересчитает при открытии (fullCalcOnLoad).
 */

import JSZip from "jszip";

export type CellValue = string | number | null;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

export function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export const rowIndex = (ref: string) => Number(/\d+/.exec(ref)?.[0] ?? 0);

export type SheetInfo = { name: string; path: string; hidden: boolean };

/** Листы книги по порядку: имя → файл (через workbook.xml.rels). */
export async function sheetsOf(zip: JSZip): Promise<SheetInfo[]> {
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const out: SheetInfo[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const path = target.get(rid);
    if (path) out.push({ name, path, hidden: /state="(hidden|veryHidden)"/.test(m[0]) });
  }
  return out;
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const xml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => unesc(t[1])).join(""));
}

export type Grid = { sheet: string; hidden: boolean; cells: { ref: string; text: string }[]; merges: string[] };

/** Непустые ячейки и объединения каждого листа — чтобы понять, куда что вписывать. */
export async function readGrid(buffer: Buffer): Promise<Grid[]> {
  const zip = await JSZip.loadAsync(buffer);
  const shared = await sharedStrings(zip);
  const out: Grid[] = [];
  for (const sh of await sheetsOf(zip)) {
    const xml = (await zip.file(sh.path)?.async("string")) ?? "";
    const cells: { ref: string; text: string }[] = [];
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner = ""] = c;
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const f = /<f[^>]*>([^<]*)<\/f>/.exec(inner)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      if (f) text = `=${unesc(f)}`;
      else if (type === "s" && v !== undefined) text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => unesc(t[1])).join("");
      else if (v !== undefined) text = unesc(v);
      if (text.trim()) cells.push({ ref, text: text.replace(/\s+/g, " ").trim() });
    }
    const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]);
    out.push({ sheet: sh.name, hidden: sh.hidden, cells, merges });
  }
  return out;
}

function cellXml(ref: string, style: string, value: CellValue): string {
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Записать значение в ячейку листа (XML строки). */
export function setCell(xml: string, ref: string, value: CellValue): string {
  const r = rowIndex(ref);
  const col = colIndex(ref);
  const rowRe = new RegExp(`<row\\b[^>]*\\br="${r}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
  const row = rowRe.exec(xml);
  if (!row) {
    // Строки нет — вставляем по порядку номеров.
    const newRow = `<row r="${r}">${cellXml(ref, "", value)}</row>`;
    const after = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].find((m) => Number(m[1]) > r);
    if (after) return xml.slice(0, after.index) + newRow + xml.slice(after.index);
    if (/<sheetData\s*\/>/.test(xml)) return xml.replace(/<sheetData\s*\/>/, `<sheetData>${newRow}</sheetData>`);
    return xml.replace("</sheetData>", `${newRow}</sheetData>`);
  }
  let rowXml = row[0];
  if (rowXml.endsWith("/>")) rowXml = `${rowXml.slice(0, -2)}></row>`;
  const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const cell = cellRe.exec(rowXml);
  if (cell) {
    const style = /\bs="(\d+)"/.exec(cell[1])?.[1] ?? "";
    rowXml = rowXml.replace(cell[0], cellXml(ref, style, value));
  } else {
    // Ячейки нет — вставляем по порядку столбцов, стиль берём у строки, если есть.
    const style = /\bs="(\d+)"[^>]*customFormat="1"/.exec(rowXml.slice(0, rowXml.indexOf(">")))?.[1] ?? "";
    const next = [...rowXml.matchAll(/<c r="([A-Z]+)\d+"/g)].find((m) => colIndex(m[1]) > col);
    const piece = cellXml(ref, style, value);
    rowXml = next ? rowXml.slice(0, next.index) + piece + rowXml.slice(next.index) : rowXml.replace("</row>", `${piece}</row>`);
  }
  return xml.replace(row[0], rowXml);
}

/** Заполнить лист sheet (по имени; null — первый видимый) значениями { "B2": "…" }. */
export async function fillXlsx(buffer: Buffer, sheet: string | null, values: Record<string, CellValue>): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const sheets = await sheetsOf(zip);
  const target = sheets.find((s) => s.name === sheet) ?? sheets.find((s) => !s.hidden) ?? sheets[0];
  if (!target) throw new Error("В файле нет листов");
  let xml = (await zip.file(target.path)?.async("string")) ?? "";
  for (const [ref, value] of Object.entries(values)) xml = setCell(xml, ref.toUpperCase(), value);
  zip.file(target.path, xml);

  // Формулы итогов пересчитаются при открытии; цепочку вычислений убираем — она могла устареть.
  let wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)\/?>/, (_m, attrs: string) => `<calcPr${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`);
  else {
    const anchor = ["</definedNames>", "</externalReferences>", "</sheets>"].find((a) => wb.includes(a))!;
    wb = wb.replace(anchor, `${anchor}<calcPr fullCalcOnLoad="1"/>`);
  }
  zip.file("xl/workbook.xml", wb);
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
    zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*calcChain[^>]*\/>/g, ""));
    const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
    zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ""));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
