/**
 * Текст ответа справочника.
 * Пустая строка — новый абзац; «— » в начале строки — пункт списка;
 * «1. » — нумерованный пункт. Остальные переносы строк сохраняются.
 */

import type { ReactNode } from "react";

import { Highlight } from "../../lib/highlight.tsx";

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; start: number; items: string[] };

const BULLET = /^—\s+/;
const NUMBERED = /^(\d+)\.\s+/;

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.replace(/\r\n/g, "\n").split(/\n[ \t]*\n/)) {
    let current: Block | null = null;
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const bullet = BULLET.exec(line);
      const numbered = NUMBERED.exec(line);
      if (bullet) {
        if (current?.kind !== "ul") blocks.push((current = { kind: "ul", items: [] }));
        current.items.push(line.slice(bullet[0].length));
      } else if (numbered) {
        if (current?.kind !== "ol") blocks.push((current = { kind: "ol", start: Number(numbered[1]), items: [] }));
        current.items.push(line.slice(numbered[0].length));
      } else {
        if (current?.kind !== "p") blocks.push((current = { kind: "p", lines: [] }));
        current.lines.push(line);
      }
    }
  }
  return blocks;
}

export function AnswerText({ text, terms }: { text: string; terms: string[] }) {
  const blocks = parseAnswer(text);
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-slate-800 dark:text-neutral-200">
      {blocks.map((block, i) => {
        if (block.kind === "p") {
          const out: ReactNode[] = [];
          block.lines.forEach((line, j) => {
            if (j > 0) out.push(<br key={`br${j}`} />);
            out.push(<Highlight key={j} text={line} terms={terms} />);
          });
          return <p key={i}>{out}</p>;
        }
        if (block.kind === "ul") {
          return (
            <ul key={i} className="space-y-0.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="shrink-0 text-slate-400">—</span>
                  <span>
                    <Highlight text={item} terms={terms} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} start={block.start} className="list-decimal space-y-0.5 pl-6 marker:text-slate-500">
            {block.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                <Highlight text={item} terms={terms} />
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
