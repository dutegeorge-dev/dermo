/** Строка справочника в режиме чтения: вопросы клиенту, тема, раскрываемые ответы. */

import type { ReactNode } from "react";

import { Highlight } from "../../lib/highlight.tsx";
import type { CallTopic } from "../../lib/types.ts";
import { IconChevronRight } from "../Icons.tsx";
import { AnswerText } from "./AnswerText.tsx";
import { CopyButton } from "./CopyButton.tsx";

export function TopicView({
  topic,
  terms,
  expanded,
  openQuestions,
  onToggle,
  onToggleQuestion,
  controls,
}: {
  topic: CallTopic;
  terms: string[];
  expanded: boolean;
  openQuestions: Set<number>;
  onToggle: () => void;
  onToggleQuestion: (index: number) => void;
  /** Кнопки режима правки справа. */
  controls?: ReactNode;
}) {
  const lines = topic.ask.length > 0 ? topic.ask : [topic.title];
  const showTitle = topic.ask.length > 0;

  return (
    <div id={`topic-${topic.id}`} className="scroll-mt-20">
      <div className="flex items-start">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-2 px-3 py-3 text-left hover:bg-slate-50 sm:px-4 dark:hover:bg-neutral-800/50"
        >
          <IconChevronRight
            size={14}
            className={`mt-1 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 flex-1">
            {lines.map((line, i) => (
              <span
                key={i}
                className={
                  i === 0
                    ? "block text-[15px] font-medium leading-snug text-slate-900 dark:text-neutral-50"
                    : "mt-0.5 block text-sm leading-snug text-slate-600 dark:text-neutral-300"
                }
              >
                <Highlight text={line} terms={terms} />
              </span>
            ))}
          </span>
          {showTitle && (
            <span className="ml-3 mt-0.5 max-w-[35%] shrink-0 text-right text-xs leading-snug text-slate-400 dark:text-neutral-500">
              <Highlight text={topic.title} terms={terms} />
            </span>
          )}
        </button>
        {controls && <div className="flex shrink-0 items-center gap-0.5 py-2.5 pr-2">{controls}</div>}
      </div>

      {expanded && (
        <div className="pb-3 pl-9 pr-3 sm:pl-10 sm:pr-4">
          {topic.qa.length === 0 ? (
            <p className="text-sm muted">Ответов пока нет.</p>
          ) : (
            <>
              <p className="mb-1 text-xs muted">Если клиент спрашивает:</p>
              <ul>
                {topic.qa.map((item, i) => {
                  const open = openQuestions.has(i);
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => onToggleQuestion(i)}
                        aria-expanded={open}
                        className={`block w-full py-1 text-left text-sm leading-snug hover:text-accent dark:hover:text-accent-bright ${
                          open ? "font-medium text-accent dark:text-accent-bright" : "text-slate-800 dark:text-neutral-200"
                        }`}
                      >
                        <Highlight text={item.q} terms={terms} />
                      </button>
                      {open && (
                        <div className="mb-2 mt-1 border-l-2 border-accent/30 pl-3 dark:border-accent-bright/30">
                          <AnswerText text={item.a} terms={terms} />
                          {item.a && (
                            <div className="mt-2">
                              <CopyButton text={item.a} />
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
