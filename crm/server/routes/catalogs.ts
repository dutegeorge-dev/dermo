/**
 * Каталоги фабрик из рассылки (только админ): загрузка пачкой, скриншоты «Файлы» WeChat (кто прислал),
 * очередь разбора, проверка и подтверждение в фабрики, категории (переименовать / объединить).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import type { CatalogResult } from "../../shared/factories.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { attachments, catalogs, catalogSenders, factories } from "../db/schema.ts";
import { aiEnabled } from "../lib/ai.ts";
import { audit } from "../lib/audit.ts";
import {
  applySenders,
  catalogMime,
  companyCore,
  type ConfirmGroup,
  confirmCatalogs,
  kickCatalogQueue,
  knownCategories,
  matchSender,
  recognizeSenders,
  renameCategory,
  senderKey,
  setCatalogLogger,
  stopCatalogQueue,
  suggestFactories,
} from "../lib/catalogs.ts";
import { body, HttpError, intParam, requireAdmin } from "../lib/http.ts";
import { storagePath, unlinkStoredFiles } from "./files.ts";

const itemColumns = {
  id: catalogs.id,
  filename: catalogs.filename,
  size: catalogs.size,
  sender: catalogs.sender,
  chat: catalogs.chat,
  status: catalogs.status,
  method: catalogs.method,
  pages: catalogs.pages,
  result: catalogs.result,
  note: catalogs.note,
  attachmentId: catalogs.attachmentId,
  factoryId: catalogs.factoryId,
  createdAt: catalogs.createdAt,
};

/** Группа на проверке: файлы одного отправителя (без отправителя — одной компании, иначе файл отдельно). */
function groupKey(c: { id: number; sender: string | null; result: CatalogResult | null }): string {
  if (c.sender) return `s:${senderKey(c.sender)}`;
  const core = companyCore(c.result?.company);
  return core.length >= 4 ? `c:${core}` : `f:${c.id}`;
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  setCatalogLogger(app.log);
  app.addHook("onClose", async () => stopCatalogQueue());

  app.get("/catalogs", async (request) => {
    requireAdmin(request);
    const [items, done, counts, senders, categories] = await Promise.all([
      db.select(itemColumns).from(catalogs).where(ne(catalogs.status, "done")).orderBy(catalogs.id).limit(3000),
      db
        .select({ ...itemColumns, factoryName: factories.name, factoryNameRu: factories.nameRu })
        .from(catalogs)
        .innerJoin(factories, eq(factories.id, catalogs.factoryId))
        .where(eq(catalogs.status, "done"))
        .orderBy(desc(catalogs.updatedAt))
        .limit(30),
      db.select({ status: catalogs.status, n: sql<number>`count(*)::int` }).from(catalogs).groupBy(catalogs.status),
      db.selectDistinct({ sender: catalogSenders.sender }).from(catalogSenders).orderBy(catalogSenders.sender).limit(3000),
      knownCategories(db),
    ]);
    const groups = new Map<string, { key: string; sender: string | null; chat: string | null; catalogIds: number[]; results: CatalogResult[] }>();
    for (const c of items) {
      if (c.status !== "review" && c.status !== "failed") continue;
      const key = groupKey(c);
      const g = groups.get(key) ?? { key, sender: c.sender, chat: c.chat, catalogIds: [], results: [] };
      g.catalogIds.push(c.id);
      if (c.result) g.results.push(c.result);
      groups.set(key, g);
    }
    const list = [...groups.values()];
    const matches = await suggestFactories(db, list);
    return {
      ai: aiEnabled(),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      items,
      done,
      groups: list.map((g, i) => ({ key: g.key, sender: g.sender, chat: g.chat, catalogIds: g.catalogIds, match: matches[i] })),
      senders: senders.map((s) => s.sender),
      categories,
    };
  });

  /** Какие файлы уже загружены (имя + размер) — чтобы при повторной загрузке папки не слать их снова. */
  app.post("/catalogs/check", async (request) => {
    requireAdmin(request);
    const input = body<{ files?: { name?: string; size?: number }[] }>(request);
    const files = (Array.isArray(input.files) ? input.files : []).slice(0, 5000);
    if (!files.length) return { exists: [] };
    const rows = await db
      .select({ filename: catalogs.filename, size: catalogs.size })
      .from(catalogs)
      .where(inArray(catalogs.filename, [...new Set(files.map((f) => String(f.name ?? "").slice(0, 200)))]));
    const have = new Set(rows.map((r) => `${r.filename}\n${r.size}`));
    return { exists: files.map((f) => have.has(`${String(f.name ?? "").slice(0, 200)}\n${Number(f.size)}`)) };
  });

  /** Один файл каталога (multipart, поле file) → в очередь разбора. Тот же файл (sha256) второй раз не берём. */
  app.post("/catalogs", async (request) => {
    const user = requireAdmin(request);
    const file = await request.file({ limits: { fileSize: config.maxCatalogBytes, files: 1 } });
    if (!file) throw new HttpError(400, "Файл не передан");
    const filename = path.basename(file.filename || "file").slice(0, 200) || "file";
    const id = crypto.randomUUID();
    const key = `${new Date().toISOString().slice(0, 7)}/${id}`;
    const target = storagePath(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const hash = crypto.createHash("sha256");
    const hasher = new Transform({
      transform(chunk, _enc, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(file.file, hasher, fs.createWriteStream(target));
    } catch (error) {
      await fs.promises.rm(target, { force: true });
      throw error;
    }
    if (file.file.truncated) {
      await fs.promises.rm(target, { force: true });
      throw new HttpError(413, `Файл больше ${Math.round(config.maxCatalogBytes / 1024 / 1024)} МБ`);
    }
    const sha256 = hash.digest("hex");
    const [same] = await db.select(itemColumns).from(catalogs).where(eq(catalogs.sha256, sha256)).limit(1);
    if (same) {
      await fs.promises.rm(target, { force: true });
      return { catalog: same, duplicate: true };
    }
    const { size } = await fs.promises.stat(target);
    const rows = await db.select({ filename: catalogSenders.filename, size: catalogSenders.size, sender: catalogSenders.sender, chat: catalogSenders.chat }).from(catalogSenders);
    const from = matchSender({ filename, size }, rows);
    const catalog = await db.transaction(async (tx) => {
      const [created] = await tx.insert(catalogs).values({ filename, size, sha256, sender: from?.sender ?? null, chat: from?.chat ?? null, createdBy: user.id }).returning({ id: catalogs.id });
      await tx.insert(attachments).values({ id, ownerType: "catalog", ownerId: created.id, filename, mime: catalogMime(filename, file.mimetype), size, storageKey: key, label: "catalog", createdBy: user.id });
      await tx.update(catalogs).set({ attachmentId: id }).where(eq(catalogs.id, created.id));
      const [row] = await tx.select(itemColumns).from(catalogs).where(eq(catalogs.id, created.id));
      return row;
    });
    kickCatalogQueue();
    return { catalog, duplicate: false };
  });

  /** Скриншоты окна «Файлы» WeChat (multipart, несколько картинок) → кто какой файл прислал. */
  app.post("/catalogs/senders", async (request) => {
    const user = requireAdmin(request);
    if (!aiEnabled()) throw new HttpError(503, "ИИ не подключён");
    const files: { buffer: Buffer; filename: string; mime: string }[] = [];
    for await (const part of request.files({ limits: { files: 10 } })) {
      files.push({ buffer: await part.toBuffer(), filename: part.filename || "screenshot.png", mime: part.mimetype || "" });
    }
    if (!files.length) throw new HttpError(400, "Нет скриншотов");
    const { rows, usage, skipped } = await recognizeSenders(files);
    request.log.info({ ai: "catalog-senders", model: config.ai.model, files: files.length, rows: rows.length, usage }, "ИИ: отправители каталогов");
    const matched = await db.transaction(async (tx) => {
      if (rows.length) await tx.insert(catalogSenders).values(rows.map((r) => ({ ...r, createdBy: user.id })));
      return applySenders(tx);
    });
    return { rows: rows.length, matched, skipped };
  });

  /** Указать отправителя вручную. */
  app.patch("/catalogs/:id", async (request) => {
    requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ sender?: string | null }>(request);
    const sender = typeof input.sender === "string" ? input.sender.trim().slice(0, 300) || null : null;
    const [row] = await db
      .update(catalogs)
      .set({ sender, chat: null, updatedAt: new Date() })
      .where(and(eq(catalogs.id, id), ne(catalogs.status, "done")))
      .returning({ id: catalogs.id });
    if (!row) throw new HttpError(404, "Каталог не найден");
    return { ok: true };
  });

  /** Разобрать заново (после ошибки ИИ / пополнения баланса). id = all — все с ошибкой. */
  app.post("/catalogs/:id/retry", async (request) => {
    requireAdmin(request);
    const raw = (request.params as { id: string }).id;
    const where = raw === "all" ? eq(catalogs.status, "failed") : and(eq(catalogs.id, intParam(raw)), inArray(catalogs.status, ["failed", "review"]));
    const rows = await db.update(catalogs).set({ status: "queued", note: null, updatedAt: new Date() }).where(where).returning({ id: catalogs.id });
    kickCatalogQueue();
    return { queued: rows.length };
  });

  /** Удалить каталог (не подтверждённый) вместе с файлом. */
  app.delete("/catalogs/:id", async (request) => {
    const user = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const keys = await db.transaction(async (tx) => {
      const [row] = await tx.delete(catalogs).where(and(eq(catalogs.id, id), inArray(catalogs.status, ["queued", "review", "failed"]))).returning();
      if (!row) throw new HttpError(404, "Каталог не найден или уже подтверждён / разбирается");
      const files = row.attachmentId
        ? await tx.delete(attachments).where(and(eq(attachments.id, row.attachmentId), eq(attachments.ownerType, "catalog"))).returning({ key: attachments.storageKey })
        : [];
      await audit(tx, { userId: user.id, action: "delete", entityType: "catalog", entityId: id, summary: `Удалил каталог «${row.filename}»`, ip: request.ip });
      return files.map((f) => f.key);
    });
    await unlinkStoredFiles(keys);
    return { ok: true };
  });

  /** Подтвердить группы: каждая → новая или найденная фабрика. Ошибка в одной группе не отменяет остальные. */
  app.post("/catalogs/confirm", async (request) => {
    const user = requireAdmin(request);
    const input = body<{ groups?: ConfirmGroup[] }>(request);
    const groups = Array.isArray(input.groups) ? input.groups.slice(0, 500) : [];
    if (!groups.length) throw new HttpError(400, "Нечего подтверждать");
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const g of groups) {
      try {
        const r = await db.transaction((tx) =>
          confirmCatalogs(
            tx,
            user,
            {
              catalogIds: (Array.isArray(g.catalogIds) ? g.catalogIds : []).map(Number),
              factoryId: g.factoryId ? Number(g.factoryId) : null,
              name: typeof g.name === "string" ? g.name : null,
              nameRu: typeof g.nameRu === "string" ? g.nameRu : null,
              categories: Array.isArray(g.categories) ? g.categories.map(String) : null,
            },
            request.ip,
          ),
        );
        if (r.created) created++;
        else updated++;
      } catch (error) {
        errors.push(error instanceof HttpError ? error.message : "не удалось сохранить");
      }
    }
    return { created, updated, errors };
  });

  /** Переименовать категорию или слить с существующей (во всех фабриках). */
  app.post("/factories/categories/rename", async (request) => {
    const user = requireAdmin(request);
    const input = body<{ from?: string; to?: string }>(request);
    const n = await db.transaction(async (tx) => {
      const count = await renameCategory(tx, String(input.from ?? ""), String(input.to ?? ""));
      await audit(tx, { userId: user.id, action: "update", entityType: "factory", entityId: null, summary: `Категория «${input.from}» → «${input.to}» (${count} фабрик)`, ip: request.ip });
      return count;
    });
    return { factories: n };
  });
}
