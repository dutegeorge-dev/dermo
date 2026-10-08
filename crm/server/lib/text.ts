/** Вспомогательные функции для текста и документов TipTap. */

import type { CallQa, TiptapDoc } from "../db/schema.ts";

type PmNode = { type?: string; text?: string; content?: PmNode[]; attrs?: Record<string, unknown> };

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "codeBlock",
  "blockquote",
  "tableRow",
  "tableCell",
  "tableHeader",
  "horizontalRule",
]);

/** Плоский текст документа TipTap — для полнотекстового поиска. */
export function tiptapToText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: PmNode) => {
    if (typeof node.text === "string") parts.push(node.text);
    if (node.type === "hardBreak") parts.push("\n");
    if (node.type === "image" && typeof node.attrs?.alt === "string") parts.push(node.attrs.alt);
    for (const child of node.content ?? []) walk(child);
    if (node.type && BLOCK_TYPES.has(node.type)) parts.push("\n");
  };
  if (doc && typeof doc === "object") walk(doc as PmNode);
  return parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const EMPTY_DOC: TiptapDoc = { type: "doc", content: [{ type: "paragraph" }] };

/** Грубая проверка формы документа TipTap. */
export function isTiptapDoc(value: unknown): value is TiptapDoc {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "doc" &&
    ((value as { content?: unknown }).content === undefined ||
      Array.isArray((value as { content?: unknown }).content))
  );
}

/** Текст строки справочника для глобального поиска. */
export function callTopicSearchText(ask: string[], qa: CallQa[]): string {
  return [...ask, ...qa.flatMap((item) => [item.q, item.a])].join("\n");
}

/** Строка из запроса: обрезаем и ограничиваем длину. */
export function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
