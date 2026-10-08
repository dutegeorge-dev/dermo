/** Подсветка совпадений поиска (без учёта регистра и ё/е). */

import { Fragment, type ReactNode } from "react";

/** Нормализация для сравнения: нижний регистр, ё → е. Длина строки не меняется. */
export function norm(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

/** Слова запроса. */
export function queryTerms(query: string): string[] {
  return norm(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function containsAny(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const n = norm(text);
  return terms.some((t) => n.includes(t));
}

export function Highlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
  if (terms.length === 0 || !text) return text;
  const n = norm(text);
  const marks: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = n.indexOf(term, from);
      if (at === -1) break;
      marks.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (marks.length === 0) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([...m]);
  }
  const out: ReactNode[] = [];
  let pos = 0;
  merged.forEach(([s, e], i) => {
    if (s > pos) out.push(text.slice(pos, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    pos = e;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <Fragment>{out}</Fragment>;
}

/** Сниппет от сервера: экранируем всё, кроме наших <mark>. */
export function SnippetHtml({ html }: { html: string }) {
  const parts = html.split(/(<mark>|<\/mark>)/);
  let inside = false;
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part === "<mark>") inside = true;
    else if (part === "</mark>") inside = false;
    else if (part) out.push(inside ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>);
  });
  return <>{out}</>;
}
