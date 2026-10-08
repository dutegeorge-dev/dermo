/** Справочник для звонков: нормализация данных и снимки версий. */

import { asc, desc, eq, max, sql } from "drizzle-orm";

import type { DbOrTx } from "../db/client.ts";
import { type CallQa, type CallTopicSnapshot, callScriptTopics, callScriptVersions, users } from "../db/schema.ts";
import { HttpError } from "./http.ts";
import { callTopicSearchText } from "./text.ts";

export type TopicInput = { title: string; ask: string[]; qa: CallQa[] };

/** Проверяет и чистит строку справочника. Текст ответа сохраняется ровно как набран (кроме хвостовых пробелов). */
export function normalizeTopic(input: unknown): TopicInput {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 200) : "";
  const ask = (Array.isArray(raw.ask) ? raw.ask : [])
    .filter((line): line is string => typeof line === "string")
    .map((line) => line.trim().slice(0, 1000))
    .filter(Boolean)
    .slice(0, 30);
  const qa = (Array.isArray(raw.qa) ? raw.qa : [])
    .map((item) => {
      const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        q: typeof obj.q === "string" ? obj.q.trim().slice(0, 1000) : "",
        a: typeof obj.a === "string" ? obj.a.replace(/\r\n/g, "\n").replace(/\s+$/, "").slice(0, 20_000) : "",
      };
    })
    .filter((item) => item.q || item.a);
  if (!title && ask.length === 0) throw new HttpError(400, "Укажите тему или вопрос клиенту");
  if (qa.some((item) => !item.q)) throw new HttpError(400, "У каждого ответа должен быть вопрос клиента");
  if (qa.length > 200) throw new HttpError(400, "Слишком много вопросов в одной строке");
  return { title: title || ask[0].slice(0, 200), ask, qa };
}

export function topicRow(topic: TopicInput) {
  return { ...topic, searchText: callTopicSearchText(topic.ask, topic.qa) };
}

/** Сериализует правки справочника (одна транзакция за раз). */
export async function lockCallScript(tx: DbOrTx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('call_script'))`);
}

export async function listTopics(tx: DbOrTx): Promise<(CallTopicSnapshot & { updatedAt: Date })[]> {
  return tx
    .select({
      id: callScriptTopics.id,
      title: callScriptTopics.title,
      ask: callScriptTopics.ask,
      qa: callScriptTopics.qa,
      updatedAt: callScriptTopics.updatedAt,
    })
    .from(callScriptTopics)
    .orderBy(asc(callScriptTopics.position), asc(callScriptTopics.id));
}

/** Записывает снимок всего справочника как новую версию. */
export async function snapshotCallScript(tx: DbOrTx, userId: number | null, note: string): Promise<number> {
  const topics = (await listTopics(tx)).map(({ id, title, ask, qa }) => ({ id, title, ask, qa }));
  const [row] = await tx.select({ max: max(callScriptVersions.version) }).from(callScriptVersions);
  const version = (row?.max ?? 0) + 1;
  await tx.insert(callScriptVersions).values({ version, topics, note, createdBy: userId });
  return version;
}

export async function latestVersion(tx: DbOrTx) {
  const [row] = await tx
    .select({
      version: callScriptVersions.version,
      note: callScriptVersions.note,
      createdAt: callScriptVersions.createdAt,
      createdByName: users.name,
    })
    .from(callScriptVersions)
    .leftJoin(users, eq(users.id, callScriptVersions.createdBy))
    .orderBy(desc(callScriptVersions.version))
    .limit(1);
  return row ?? null;
}

/** Полностью заменяет содержимое справочника списком тем (откат, импорт). */
export async function replaceAllTopics(
  tx: DbOrTx,
  topics: (TopicInput & { id: string })[],
  userId: number | null,
): Promise<void> {
  await tx.delete(callScriptTopics);
  for (const [position, topic] of topics.entries()) {
    await tx.insert(callScriptTopics).values({
      id: topic.id,
      position,
      ...topicRow(topic),
      updatedBy: userId,
    });
  }
}
