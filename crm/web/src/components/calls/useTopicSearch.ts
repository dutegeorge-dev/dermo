/** Поиск по справочнику: фильтр строк и автоматическое раскрытие совпадений в ответах. */

import { useMemo } from "react";

import { containsAny, norm, queryTerms } from "../../lib/highlight.tsx";
import type { CallTopic } from "../../lib/types.ts";

export type SearchState = {
  terms: string[];
  /** Строки, подходящие под запрос (все слова встречаются где-то в строке). */
  visible: CallTopic[];
  /** Строки, которые нужно раскрыть (совпадение в вопросе или ответе клиента). */
  autoRows: Set<string>;
  /** Вопросы, которые нужно раскрыть (совпадение в ответе): ключ «id:индекс». */
  autoQuestions: Set<string>;
};

export function useTopicSearch(topics: CallTopic[], query: string): SearchState {
  return useMemo(() => {
    const terms = queryTerms(query);
    if (terms.length === 0) {
      return { terms, visible: topics, autoRows: new Set(), autoQuestions: new Set() };
    }
    const visible: CallTopic[] = [];
    const autoRows = new Set<string>();
    const autoQuestions = new Set<string>();
    for (const topic of topics) {
      const all = norm([topic.title, ...topic.ask, ...topic.qa.flatMap((x) => [x.q, x.a])].join("\n"));
      if (!terms.every((t) => all.includes(t))) continue;
      visible.push(topic);
      topic.qa.forEach((item, i) => {
        if (containsAny(item.a, terms)) {
          autoRows.add(topic.id);
          autoQuestions.add(`${topic.id}:${i}`);
        } else if (containsAny(item.q, terms)) {
          autoRows.add(topic.id);
        }
      });
    }
    return { terms, visible, autoRows, autoQuestions };
  }, [topics, query]);
}
