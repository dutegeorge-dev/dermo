/**
 * Вставка позиций из Excel / таблицы PDF: строки через перевод строки,
 * колонки через табуляцию. Колонки распознаются по содержимому: самая
 * длинная текстовая — наименование, короткая текстовая — единица, числа
 * по порядку — количество, цена, сумма.
 */

import type { DocItem } from "../../lib/types.ts";

/** «1,234.50» / «1 234,50» / «14,600» / «9,49» → число. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[¥$€₽]|RMB|CNY|USD|EUR|RUB/gi, "").replace(/[\s ]/g, "").trim();
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Десятичный разделитель — тот, что правее.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const groups = s.split(",");
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3);
    s = thousands ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function detectCurrency(text: string): string | null {
  if (/¥|RMB|CNY|юан/i.test(text)) return "CNY";
  if (/\$|USD|доллар/i.test(text)) return "USD";
  if (/€|EUR|евро/i.test(text)) return "EUR";
  return null;
}

export function isTabular(text: string): boolean {
  return text.includes("\t") || text.trim().split(/\r?\n/).length > 1;
}

export function parsePastedItems(text: string): DocItem[] {
  const rows = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.split("\t").map((c) => c.trim()))
    .filter((cells) => cells.some(Boolean));
  const items: DocItem[] = [];
  const hasNumbers = (cells: string[]) => cells.some((c) => parseNumber(c) !== null);
  // Строку заголовков («Description, Qty, Price…») узнаём по отсутствию чисел, когда в других строках они есть.
  const anyNumeric = rows.some(hasNumbers);
  for (const cells of rows) {
    if (anyNumeric && !hasNumbers(cells)) continue;
    const texts: string[] = [];
    const numbers: number[] = [];
    cells.forEach((cell, i) => {
      if (!cell) return;
      const n = parseNumber(cell);
      // Первая колонка-порядковый номер (1, 2, 3…) — пропускаем.
      if (n !== null && i === 0 && Number.isInteger(n) && n < 1000 && cells.length >= 4) return;
      if (n !== null) numbers.push(n);
      else texts.push(cell);
    });
    if (texts.length === 0) continue;
    // Строки итогов из инвойса не переносим.
    if (/^(total|итого|всего|sum)\b/i.test(texts[0])) continue;
    const sorted = [...texts].sort((a, b) => b.length - a.length);
    const name = sorted[0];
    const unit = texts.find((t) => t !== name && t.length <= 12) ?? null;
    const [quantity = null, price = null, amount = null] =
      numbers.length >= 3 ? numbers.slice(-3) : numbers.length === 2 ? [numbers[0], numbers[1], null] : [numbers[0] ?? null, null, null];
    items.push({ productId: null, name, batchNo: null, hsCode: null, quantity, unit, price, amount });
  }
  return items;
}
