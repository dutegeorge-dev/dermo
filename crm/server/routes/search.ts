/**
 * Глобальный поиск по разделу: страницы базы знаний и справочник для звонков.
 * PostgreSQL full-text search со словарём russian (морфология) + префиксы
 * слов, чтобы находилось по мере набора («тамож» → «таможня»).
 */

import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.ts";

/** tsquery из пользовательской строки: слова через &, к каждому — префикс. */
export function buildPrefixQuery(input: string): string | null {
  const words = input
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request) => {
    const q = String((request.query as { q?: string }).q ?? "").trim().slice(0, 200);
    const tsq = buildPrefixQuery(q);
    if (!tsq) return { pages: [], callTopics: [] };
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const pages = await db.execute<{
      id: number;
      title: string;
      space_key: string;
      space_name: string;
      snippet: string;
      updated_at: string;
    }>(sql`
      SELECT p.id, p.title, s.key AS space_key, s.name AS space_name, p.updated_at,
             ts_headline('russian', p.content_text, to_tsquery('russian', ${tsq}),
                         'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=12, MaxFragments=1') AS snippet
      FROM kb_pages p
      JOIN kb_spaces s ON s.id = p.space_id
      WHERE p.search @@ to_tsquery('russian', ${tsq}) OR p.title ILIKE ${like}
      ORDER BY ts_rank(p.search, to_tsquery('russian', ${tsq})) DESC, p.updated_at DESC
      LIMIT 20`);

    const topics = await db.execute<{ id: string; title: string; ask: string[]; snippet: string }>(sql`
      SELECT t.id, t.title, t.ask,
             ts_headline('russian', t.search_text, to_tsquery('russian', ${tsq}),
                         'StartSel=<mark>, StopSel=</mark>, MaxWords=30, MinWords=12, MaxFragments=1') AS snippet
      FROM call_script_topics t
      WHERE t.search @@ to_tsquery('russian', ${tsq}) OR t.title ILIKE ${like} OR t.search_text ILIKE ${like}
      ORDER BY ts_rank(t.search, to_tsquery('russian', ${tsq})) DESC, t.position
      LIMIT 20`);

    return {
      pages: pages.rows.map((r) => ({
        id: Number(r.id),
        title: r.title,
        spaceKey: r.space_key,
        spaceName: r.space_name,
        snippet: r.snippet,
        updatedAt: r.updated_at,
      })),
      callTopics: topics.rows.map((r) => ({ id: r.id, title: r.title, ask: r.ask, snippet: r.snippet })),
    };
  });
}
