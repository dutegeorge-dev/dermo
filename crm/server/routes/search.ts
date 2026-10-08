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
    if (!tsq) return { pages: [], callTopics: [], deals: [], clients: [], documents: [], products: [] };
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

    const num = /^(?:bars-?)?(\d{1,9})$/i.exec(q);
    const dealRows = await db.execute<{ key: string; title: string; client: string | null; status: string; outcome: string | null }>(sql`
      SELECT d.key, d.title, c.name AS client, s.name AS status, d.outcome
      FROM deals d
      LEFT JOIN counterparties c ON c.id = d.client_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
      JOIN deal_statuses s ON s.key = d.status_key
      WHERE d.title ILIKE ${like} OR d.product ILIKE ${like} OR d.hs_code ILIKE ${like}
         OR c.name ILIKE ${like} OR c.inn ILIKE ${like} OR ct.name ILIKE ${like} OR ct.phone ILIKE ${like}
         ${num ? sql`OR d.number = ${Number(num[1])}` : sql``}
      ORDER BY d.outcome NULLS FIRST, d.updated_at DESC
      LIMIT 10`);

    const clientRows = await db.execute<{ id: number; name: string; inn: string | null; role: string }>(sql`
      SELECT c.id, c.name, c.inn, c.role FROM counterparties c
      WHERE c.name ILIKE ${like} OR c.inn ILIKE ${like} OR c.full_name ILIKE ${like}
         OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.counterparty_id = c.id AND (ct.name ILIKE ${like} OR ct.phone ILIKE ${like}))
      ORDER BY c.name
      LIMIT 10`);

    const docRows = await db.execute<{ id: number; type: string; number: string | null; date: string | null; party: string | null }>(sql`
      SELECT d.id, d.type, d.number, d.date::text, c.name AS party FROM documents d
      LEFT JOIN counterparties c ON c.id = d.counterparty_id
      WHERE d.number ILIKE ${like}
         OR EXISTS (SELECT 1 FROM document_items i WHERE i.document_id = d.id AND i.name ILIKE ${like})
      ORDER BY d.date DESC NULLS LAST, d.id DESC
      LIMIT 10`);

    const productRows = await db.execute<{ id: number; name: string; hs_code: string | null }>(sql`
      SELECT p.id, p.name, p.hs_code FROM products p
      WHERE p.name ILIKE ${like} OR p.name_ru ILIKE ${like} OR p.hs_code ILIKE ${like}
      ORDER BY p.name LIMIT 10`);

    return {
      deals: dealRows.rows,
      clients: clientRows.rows.map((r) => ({ ...r, id: Number(r.id) })),
      documents: docRows.rows.map((r) => ({ ...r, id: Number(r.id) })),
      products: productRows.rows.map((r) => ({ id: Number(r.id), name: r.name, hsCode: r.hs_code })),
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
