/**
 * Вложения: загрузка, выдача, удаление. Файлы лежат на диске в CRM_UPLOAD_DIR,
 * в БД — метаданные. Отдаются только вошедшим пользователям (проверка сессии
 * общая для всего API).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { config } from "../config.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { attachments, deals, kbPages } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { addEvent, parseDealKey } from "../lib/deals.ts";
import { currentUser, HttpError, intParam } from "../lib/http.ts";

/** Эти типы безопасно показывать прямо в браузере; остальное — только скачиванием. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

function storagePath(key: string): string {
  const full = path.resolve(config.uploadDir, key);
  if (!full.startsWith(path.resolve(config.uploadDir) + path.sep)) throw new HttpError(400, "Некорректный путь");
  return full;
}

/** Удаляет записи о вложениях владельцев и возвращает ключи файлов (удалить после коммита). */
export async function deleteAttachmentRows(tx: DbOrTx, ownerType: string, ownerIds: number[]): Promise<string[]> {
  if (ownerIds.length === 0) return [];
  const rows = await tx
    .delete(attachments)
    .where(and(eq(attachments.ownerType, ownerType), inArray(attachments.ownerId, ownerIds)))
    .returning({ key: attachments.storageKey });
  return rows.map((r) => r.key);
}

export async function unlinkStoredFiles(keys: string[]): Promise<void> {
  for (const key of keys) {
    await fs.promises.rm(storagePath(key), { force: true });
  }
}

function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Принимает файл из multipart-запроса (поле file), кладёт на диск и в attachments. */
async function saveUpload(request: FastifyRequest, ownerType: string, ownerId: number, ownerLabel: string) {
  const user = currentUser(request);
  const file = await request.file();
  if (!file) throw new HttpError(400, "Файл не передан");

  const filename = path.basename(file.filename || "file").slice(0, 200) || "file";
  const id = crypto.randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const key = `${month}/${id}`;
  const target = storagePath(key);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await pipeline(file.file, fs.createWriteStream(target));
  if (file.file.truncated) {
    await fs.promises.rm(target, { force: true });
    throw new HttpError(413, `Файл больше ${Math.round(config.maxUploadBytes / 1024 / 1024)} МБ`);
  }
  const { size } = await fs.promises.stat(target);

  const [created] = await db
    .insert(attachments)
    .values({
      id,
      ownerType,
      ownerId,
      filename,
      mime: file.mimetype || "application/octet-stream",
      size,
      storageKey: key,
      createdBy: user.id,
    })
    .returning();
  await audit(db, {
    userId: user.id,
    action: "create",
    entityType: "attachment",
    entityId: id,
    summary: `Прикрепил файл «${filename}» ${ownerLabel}`,
    ip: request.ip,
  });
  return {
    id: created.id,
    filename: created.filename,
    mime: created.mime,
    size: created.size,
    createdAt: created.createdAt,
    createdByName: user.name,
    url: `${config.basePath}/api/files/${created.id}`,
  };
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  /** Загрузка вложения к странице базы знаний (multipart, поле file). */
  app.post("/kb/pages/:id/attachments", async (request) => {
    const pageId = intParam((request.params as { id: string }).id);
    const [page] = await db.select({ id: kbPages.id, title: kbPages.title }).from(kbPages).where(eq(kbPages.id, pageId));
    if (!page) throw new HttpError(404, "Страница не найдена");
    return { attachment: await saveUpload(request, "kb_page", pageId, `к странице «${page.title}»`) };
  });

  /** Загрузка вложения к сделке. */
  app.post("/deals/:key/attachments", async (request) => {
    const number = parseDealKey((request.params as { key: string }).key);
    const [deal] = await db.select({ id: deals.id, key: deals.key }).from(deals).where(eq(deals.number, number));
    if (!deal) throw new HttpError(404, "Сделка не найдена");
    const attachment = await saveUpload(request, "deal", deal.id, `к сделке ${deal.key}`);
    await addEvent(db, deal.id, currentUser(request).id, "attachment_added", null, null, attachment.filename);
    return { attachment };
  });

  app.get("/files/:id", async (request, reply) => {
    const id = String((request.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Файл не найден");
    const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
    if (!row) throw new HttpError(404, "Файл не найден");
    const full = storagePath(row.storageKey);
    if (!fs.existsSync(full)) throw new HttpError(404, "Файл не найден на диске");

    const inline = INLINE_TYPES.has(row.mime);
    const download = (request.query as { download?: string }).download !== undefined;
    return reply
      .header("cache-control", "private, max-age=86400")
      .header("content-type", inline ? row.mime : "application/octet-stream")
      .header("content-length", row.size)
      .header("content-disposition", contentDisposition(inline && !download ? "inline" : "attachment", row.filename))
      .header("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
      .send(fs.createReadStream(full));
  });

  app.delete("/files/:id", async (request) => {
    const user = currentUser(request);
    const id = String((request.params as { id: string }).id);
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "Файл не найден");
    const [row] = await db.delete(attachments).where(eq(attachments.id, id)).returning();
    if (!row) throw new HttpError(404, "Файл не найден");
    await unlinkStoredFiles([row.storageKey]);
    await audit(db, {
      userId: user.id,
      action: "delete",
      entityType: "attachment",
      entityId: id,
      summary: `Удалил файл «${row.filename}»`,
      data: { ownerType: row.ownerType, ownerId: row.ownerId },
      ip: request.ip,
    });
    return { ok: true };
  });
}
